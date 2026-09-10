// Лента шагов: модельное время, догон просроченных шагов, отмена, и главное —
// исключение в шаге не блокирует ввод навсегда, а идёт в errors и console.error.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("./timeline.js");

test("модельное время: шаг ждёт своей мс и срабатывает ровно один раз", () => {
  const tl = T.create();
  let hits = 0;
  tl.add(100, () => hits++);
  assert.equal(tl.update(99), false, "сработал раньше срока");
  assert.equal(hits, 0);
  assert.equal(tl.update(1), true);
  assert.equal(hits, 1);
  tl.update(1000);
  assert.equal(hits, 1, "шаг сработал второй раз");
  assert.equal(tl.busy(), false);
  assert.equal(tl.pending(), 0);
});

test("порядок: add/wait/then/repeat выстраиваются по времени", () => {
  const tl = T.create();
  const log = [];
  tl.add(50, () => log.push("a"));
  tl.wait(100);
  tl.then(() => log.push("b"));      // на 150 мс: после wait от конца a
  tl.add(10, () => log.push("c"));   // на 10 мс от текущего момента
  tl.update(200);
  assert.deepEqual(log, ["c", "a", "b"]);

  const tl2 = T.create();
  const seen = [];
  tl2.repeat(3, 100, (i) => seen.push(i));
  tl2.update(250);
  assert.deepEqual(seen, [0, 1]);
  tl2.update(100);
  assert.deepEqual(seen, [0, 1, 2]);
});

test("догон: большая delta (телефон вернулся из фона) выполняет ВСЕ просроченные шаги по порядку", () => {
  const tl = T.create();
  const log = [];
  tl.add(100, () => log.push(1));
  tl.add(200, () => log.push(2));
  tl.add(300, () => log.push(3));
  const fired = tl.update(5000);
  assert.equal(fired, true);
  assert.deepEqual(log, [1, 2, 3], "шаги пропущены или перепутаны — состояние игры разъедется");
  assert.equal(tl.busy(), false);
});

test("clear отменяет незапущенное, flush выполняет всё немедленно", () => {
  const tl = T.create();
  let hits = 0;
  tl.add(100, () => hits++);
  tl.add(500, () => hits++);
  tl.clear();
  tl.update(1000);
  assert.equal(hits, 0, "clear не отменил шаги — хвост прошлой партии выстрелит в новой");
  assert.equal(tl.pending(), 0);

  tl.add(100, () => hits++);
  tl.add(9000, () => hits++);
  assert.equal(tl.pending(), 2);
  tl.flush();
  assert.equal(hits, 2);
  assert.equal(tl.busy(), false);
});

test("flush упёрся в потолок: остаток не молчит, а кричит в errors и в консоль", () => {
  const tl = T.create();
  let hits = 0;
  const over = T.MAX_STEPS_PER_UPDATE + 500;
  tl.repeat(over, 20, () => hits++);
  const errs = [];
  const orig = console.error;
  console.error = (m) => errs.push(String(m));
  try {
    tl.flush();
  } finally {
    console.error = orig;
  }
  assert.equal(hits, T.MAX_STEPS_PER_UPDATE, "flush выполнил не потолок шагов");
  assert.equal(tl.pending(), over - T.MAX_STEPS_PER_UPDATE);
  assert.ok(tl.errors.some((e) => /flush не доделал/.test(e)), "кит получил половину ленты молча: " + tl.errors.join("; "));
  assert.ok(errs.some((e) => /flush не доделал/.test(e)), "e2e не увидит недоделанный flush");
  assert.ok(!tl.errors.some((e) => /сам себя/.test(e)), "ложный диагноз про самодобавление");
});

test("честно длинная лента (догон из фона) не обвиняется в самодобавлении", () => {
  const tl = T.create();
  let hits = 0;
  const over = T.MAX_STEPS_PER_UPDATE * 2;
  tl.repeat(over, 10, () => hits++);
  const errs = [];
  const orig = console.error;
  console.error = (m) => errs.push(String(m));
  try {
    tl.update(60000);                       // телефон вернулся из фона
    assert.equal(hits, T.MAX_STEPS_PER_UPDATE);
    assert.equal(tl.pending(), over - T.MAX_STEPS_PER_UPDATE);
    tl.update(0);                           // остаток догоняется следующим кадром
  } finally {
    console.error = orig;
  }
  assert.equal(hits, over, "остаток ленты потерян");
  assert.deepEqual(tl.errors, [], "ложная ошибка на честной ленте: " + tl.errors.join("; "));
  assert.deepEqual(errs, [], "e2e упадёт на ложном console error");
});

test("шаг, добавленный ИЗ шага, исполняется, а самодобавление без задержки ловится потолком", () => {
  const tl = T.create();
  const log = [];
  tl.add(10, () => { log.push("first"); tl.add(10, () => log.push("second")); });
  tl.update(10);
  assert.deepEqual(log, ["first"], "вложенный шаг не должен срабатывать в том же кадре раньше срока");
  tl.update(10);
  assert.deepEqual(log, ["first", "second"]);

  // Бесконечный цикл: шаг добавляет сам себя без задержки. Потолок обязан
  // прервать кадр и записать это словами, а не повесить игру.
  const loop = T.create();
  let calls = 0;
  const errs = [];
  const orig = console.error;
  console.error = (m) => errs.push(String(m));
  try {
    const again = () => { calls++; loop.add(0, again); };
    loop.add(0, again);
    loop.update(1);
  } finally {
    console.error = orig;
  }
  assert.ok(calls <= T.MAX_STEPS_PER_UPDATE, "цикл не прерван: вызовов " + calls);
  assert.ok(loop.errors.some((e) => /сам себя/.test(e)), loop.errors.join("; "));
  assert.ok(errs.length, "потолок молчит в консоли");
});

test("исключение в шаге: шаг выполнен, ошибка в errors и в console.error, лента идёт дальше", () => {
  const tl = T.create();
  const log = [];
  const errs = [];
  const orig = console.error;
  console.error = (m) => errs.push(String(m));
  try {
    tl.add(10, () => { throw new Error("карточка не нарисовалась"); });
    tl.add(20, () => log.push("next"));
    assert.doesNotThrow(() => tl.update(30), "исключение вырвалось наружу — кадр движка упадёт");
  } finally {
    console.error = orig;
  }
  assert.deepEqual(log, ["next"], "лента встала после сбоя — ввод заблокирован навсегда");
  assert.equal(tl.errors.length, 1);
  assert.ok(tl.errors[0].includes("карточка не нарисовалась"), tl.errors[0]);
  assert.ok(errs.length === 1 && errs[0].includes("карточка не нарисовалась"), "e2e не увидит console error");
  assert.equal(tl.busy(), false);
});

test("время ленты идёт только от update — Date.now() внутри нет", () => {
  const tl = T.create();
  assert.equal(tl.time(), 0);
  tl.update(120);
  assert.equal(tl.time(), 120);
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "timeline.js"), "utf8");
  assert.ok(!/Date\.now\(/.test(src), "Date.now в таймлайне — прогон с сидом перестанет повторяться");
});
