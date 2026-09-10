// Пул предметов: веса, категории, антиповтор и окно видимости. Про
// сходимость к весам важно помнить: она проверяется с maxRepeat: 0, потому
// что антиповтор ОСОЗНАННО смещает распределение — он делает выпадения
// похожими на честные для глаза, а не для статистики.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./pool.js");
const R = require("./random.js");

const ITEMS = [
  { id: "apple", title: "Яблоко", category: "fruit", weight: 3 },
  { id: "pear", title: "Груша", category: "fruit", weight: 1 },
  { id: "nail", title: "Гвоздь", category: "tool", weight: 2 },
  { id: "saw", title: "Пила", category: "tool", weight: 0 }
];

test("pick: нулевой вес не выпадает никогда, пустой пул — исключение словами", () => {
  const pool = P.create(ITEMS, R.create(7));
  for (let i = 0; i < 300; i++) assert.notEqual(pool.pick({ maxRepeat: 0 }).id, "saw", "предмет с весом 0 выпал");

  const dead = P.create([{ id: "a", category: "x", weight: 0 }], R.create(1));
  assert.throws(() => dead.pick(), /нет предметов с весом больше нуля/);
  const one = P.create(ITEMS, R.create(1));
  assert.throws(() => one.pick({ category: "нет такой" }), /категории/);
});

test("сходимость к весам при maxRepeat: 0 (антиповтор выключен — иначе он смещает доли)", () => {
  const pool = P.create(ITEMS, R.create(2026));
  const count = {};
  const N = 6000;
  for (let i = 0; i < N; i++) {
    const it = pool.pick({ maxRepeat: 0 });
    count[it.id] = (count[it.id] || 0) + 1;
  }
  // Веса 3 : 1 : 2 при общей сумме 6.
  assert.ok(Math.abs(count.apple / N - 0.5) < 0.03, "apple " + count.apple / N);
  assert.ok(Math.abs(count.pear / N - 1 / 6) < 0.03, "pear " + count.pear / N);
  assert.ok(Math.abs(count.nail / N - 1 / 3) < 0.03, "nail " + count.nail / N);
});

test("maxRepeat: по умолчанию 2 — третьего раза подряд нет, пока есть альтернатива", () => {
  assert.equal(P.DEFAULT_MAX_REPEAT, 2);
  const pool = P.create(ITEMS, R.create(11));
  let run = 1, prev = null, worst = 1;
  for (let i = 0; i < 2000; i++) {
    const id = pool.pick().id;
    run = id === prev ? run + 1 : 1;
    prev = id;
    if (run > worst) worst = run;
  }
  assert.ok(worst <= 2, "один и тот же предмет выпал подряд " + worst + " раз");

  // Альтернативы нет — антиповтор молчит, а не вешает игру.
  const solo = P.create([{ id: "only", category: "c", weight: 1 }], R.create(3));
  for (let i = 0; i < 5; i++) assert.equal(solo.pick().id, "only");
});

test("deal: один сид — один расклад, spread не даёт трёх подряд из одной категории", () => {
  const a = P.create(ITEMS, R.create(5)).deal(20, { spread: true }).map((i) => i.id);
  const b = P.create(ITEMS, R.create(5)).deal(20, { spread: true }).map((i) => i.id);
  assert.deepEqual(a, b, "расклад не повторяется при одном сиде");

  const list = P.create(ITEMS, R.create(9)).deal(200, { spread: true });
  let run = 1, prev = null, worst = 1;
  for (const it of list) {
    run = it.category === prev ? run + 1 : 1;
    prev = it.category;
    if (run > worst) worst = run;
  }
  assert.ok(worst <= 2, "подряд " + worst + " предметов из одной категории — игрок решит, что игра сломалась");
});

test("categories и byCategory: порядок первого появления, стабильный", () => {
  const pool = P.create(ITEMS, R.create(1));
  assert.deepEqual(pool.categories(), ["fruit", "tool"]);
  assert.deepEqual(pool.byCategory("tool").map((i) => i.id), ["nail", "saw"]);
  assert.deepEqual(pool.byCategory("нет"), []);
});

test("exclude и category сужают выбор, reset снимает антиповтор", () => {
  const pool = P.create(ITEMS, R.create(4));
  for (let i = 0; i < 50; i++) assert.equal(pool.pick({ category: "fruit", exclude: ["pear"] }).id, "apple");
  assert.equal(pool.reset(), pool);
});

test("checkShape: форма пула словами — id, вес, категория, хоть один положительный вес", () => {
  assert.deepEqual(P.checkShape(ITEMS, { categories: true }), []);
  assert.ok(P.checkShape([], {})[0].includes("хотя бы один"));
  assert.ok(P.checkShape([{ category: "c" }], {})[0].includes("id"));
  assert.ok(P.checkShape([{ id: "a", weight: 1 }, { id: "a", weight: 1 }], {})[0].includes("уже занят"));
  assert.ok(P.checkShape([{ id: "a", weight: -3 }], {}).some((e) => /неотрицательное число/.test(e)));
  assert.ok(P.checkShape([{ id: "a" }], { categories: true }).some((e) => /category/.test(e)));
  assert.ok(P.checkShape([{ id: "a", weight: 0 }], {}).some((e) => /весом больше нуля/.test(e)));
  assert.ok(P.checkShape([{ id: "a" }, { id: "b" }, { id: "c" }], { min: 4 })[0].includes("от 4"));
});

test("visibleMs: сколько мс предмет виден на своём пути (общее окно реакции)", () => {
  assert.equal(P.visibleMs(100, 200), 2000);
  assert.equal(P.visibleMs(190, 380), 2000);
  assert.equal(P.visibleMs(0, 100), 0, "нулевая скорость — не бесконечность");
  assert.equal(P.visibleMs(90, 0), 0);
});
