// Headless-прогон китов в Chromium: игра в iframe хоста (как у бренда), сид
// фиксирован, бот-эксперт обязан выиграть, бот-новичок — проиграть, за партию
// ни ошибки консоли, ни нарушения инвариантов. Запуск: см. README в tests/e2e.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startServer, openGame, launchBrowser } = require("./lib.js");

const content = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "content", name), "utf8"));

let server, browser;
test.before(async () => { server = await startServer(); browser = await launchBrowser(); });
test.after(async () => { await browser.close(); await server.close(); });

function clean(g, report) {
  assert.deepEqual(g.errors, [], "ошибки страницы");
  if (report) assert.deepEqual(report.violations, [], "инварианты");
}

// Ответы квиза/теста мышью: читаем состояние сцены, жмём нужную кнопку.
async function answerAll(g, pickIndex) {
  for (let guard = 0; guard < 60; guard++) {
    const st = await g.scene(() => window.__zvBot.quiz());
    if (!st) { await g.page.waitForTimeout(150); continue; }
    if (st.locked) { await g.page.waitForTimeout(120); continue; }
    const i = pickIndex(st);
    await g.tap(180, 310 + i * 75);
    await g.page.waitForTimeout(150);
    const after = await g.scene(() => window.__zvBot.quiz());
    if (!after || after.index >= after.total) break;
  }
}

test("runner: эксперт набирает порог и выигрывает, новичок проигрывает; «Ещё раз» работает", async () => {
  const g = await openGame(browser, server, { archetype: "runner", seed: 42, params: { passScore: 8 } });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("runner", "expert", { stopAt: 8 });
    const fin = await g.waitFinish(m, 90000);
    const rep = await g.botReport();
    assert.ok(fin.won && fin.score >= 8, JSON.stringify({ fin, rep }));
    assert.equal(fin.meta.archetype, "runner");
    assert.ok(rep.frames > 200 && rep.jumps >= 8, JSON.stringify(rep));
    clean(g, rep);
    // Экран результата: «Ещё раз» на y=430 без приза — новый раунд стартует.
    await g.page.waitForTimeout(300);
    const m2 = await g.mark();
    await g.expect("start", () => g.tap(180, 430));
    await g.bot("runner", "novice");
    const fin2 = await g.waitFinish(m2, 60000);
    assert.equal(fin2.won, false, "новичок со случайными тапами обязан проиграть");
    clean(g, await g.botReport());
  } finally { await g.close(); }
});

test("catch: эксперт ловит порог, новичок с неподвижной корзиной теряет 5 предметов", async () => {
  const g = await openGame(browser, server, { archetype: "catch", seed: 7, params: { duration: 20000, passScore: 10 } });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("catch", "expert");
    const fin = await g.waitFinish(m, 40000);
    const rep = await g.botReport();
    assert.ok(fin.won && fin.score >= 10, JSON.stringify({ fin, rep }));
    assert.equal(fin.meta.archetype, "catch");
    clean(g, rep);
  } finally { await g.close(); }
  const n = await openGame(browser, server, { archetype: "catch", seed: 7, params: { duration: 20000 } });
  try {
    const m = await n.mark();
    await n.play();
    await n.bot("catch", "novice");
    const fin = await n.waitFinish(m, 40000);
    assert.equal(fin.won, false);
    assert.equal(fin.meta.missed, 5);
    clean(n, await n.botReport());
  } finally { await n.close(); }
});

test("quiz: верные ответы дают победу и карточку приза из config.prize, неверные — проигрыш", async () => {
  const prize = { title: "Скидка 10%", code: "QUIZ10", text: "На первый заказ", button: "", url: "" };
  const g = await openGame(browser, server, { archetype: "quiz", seed: 3, prize });
  try {
    const m = await g.mark();
    await g.play();
    await answerAll(g, (st) => st.correct);
    const fin = await g.waitFinish(m, 20000);
    assert.equal(fin.won, true);
    assert.equal(fin.meta.questions, content("quiz.json").questions.length);
    assert.deepEqual(fin.prize, { id: "", title: "Скидка 10%", code: "QUIZ10" });
    clean(g);
    // Кнопка «Скопировать код» на карточке шлёт событие prize.
    await g.page.waitForTimeout(300);
    const y = await g.scene(() => {
      const sc = window.ZV.game.scene.getScene("zv-result");
      const t = sc.children.list.find((o) => o.text === "Скопировать код");
      return t ? t.y : -1;
    });
    assert.ok(y > 0, "кнопки копирования нет на экране результата");
    const pr = await g.expect("prize", () => g.tap(180, y), 3000);
    assert.equal(pr.code, "QUIZ10");
  } finally { await g.close(); }
  const n = await openGame(browser, server, { archetype: "quiz", seed: 3 });
  try {
    const m = await n.mark();
    await n.play();
    await answerAll(n, (st) => (st.correct + 1) % st.answers);
    const fin = await n.waitFinish(m, 20000);
    assert.equal(fin.won, false);
    assert.equal(fin.score, 0);
    assert.equal(fin.prize, undefined, "проигравшему приз не показывают");
    clean(n);
  } finally { await n.close(); }
});

test("persona: исход — один из типов, у него приз; сид фиксирует порядок вопросов", async () => {
  const data = content("persona.json");
  const g = await openGame(browser, server, { archetype: "persona", seed: 5 });
  try {
    const m = await g.mark();
    await g.play();
    await answerAll(g, () => 0);
    const fin = await g.waitFinish(m, 20000);
    const type = data.types.find((t) => t.id === fin.outcome);
    assert.ok(type, "outcome не из списка типов: " + fin.outcome);
    assert.equal(fin.won, true);
    assert.equal(fin.prize.code, type.prize.code);
    assert.equal(fin.meta.type, type.id);
    clean(g);
    // Тот же сид → тот же исход при тех же ответах.
    const g2 = await openGame(browser, server, { archetype: "persona", seed: 5 });
    try {
      const m2 = await g2.mark();
      await g2.play();
      await answerAll(g2, () => 0);
      const fin2 = await g2.waitFinish(m2, 20000);
      assert.equal(fin2.outcome, fin.outcome);
      assert.deepEqual(fin2.meta.tally, fin.meta.tally);
    } finally { await g2.close(); }
  } finally { await g.close(); }
});

test("wheel: три подачи выдают приз из списка с ненулевым весом, без «Ещё раз»", async () => {
  const items = content("wheel.json").items;
  const check = (fin) => {
    const it = items.find((i) => i.id === fin.outcome);
    assert.ok(it && it.weight > 0, "приз не из списка или с нулевым весом: " + JSON.stringify(fin));
    assert.equal(fin.prize.code, it.code);
    assert.equal(fin.won, true);
  };
  // Колесо.
  let g = await openGame(browser, server, { archetype: "wheel", seed: 9, params: { spinMs: 900 } });
  try {
    await g.play();
    const fin = await g.expect("finish", () => g.tap(180, 520), 15000);
    check(fin); assert.equal(fin.meta.presentation, "wheel");
    clean(g);
    await g.page.waitForTimeout(300);
    const hasReplay = await g.scene(() => {
      const sc = window.ZV.game.scene.getScene("zv-result");
      return !!sc.children.list.find((o) => o.text === "Ещё раз");
    });
    assert.equal(hasReplay, false, "у розыгрыша не должно быть «Ещё раз»");
  } finally { await g.close(); }
  // Скретч: змейкой по карте.
  g = await openGame(browser, server, { archetype: "wheel", seed: 9, params: { presentation: "scratch" } });
  try {
    const m = await g.mark();
    await g.play();
    const canvas = g.frame.locator("canvas");
    const box = await canvas.boundingBox();
    await g.page.mouse.move(box.x + 50, box.y + 220);
    await g.page.mouse.down();
    for (let y = 220; y <= 380; y += 18) {
      for (let x = 45; x <= 315; x += 15) await g.page.mouse.move(box.x + x, box.y + y);
    }
    await g.page.mouse.up();
    const fin = await g.waitFinish(m, 15000);
    check(fin); assert.equal(fin.meta.presentation, "scratch");
    clean(g);
  } finally { await g.close(); }
  // Коробка.
  g = await openGame(browser, server, { archetype: "wheel", seed: 9, params: { presentation: "lootbox", spinMs: 700 } });
  try {
    await g.play();
    const fin = await g.expect("finish", () => g.tap(180, 320), 15000);
    check(fin); assert.equal(fin.meta.presentation, "lootbox");
    clean(g);
  } finally { await g.close(); }
});

test("битый контент — экран ошибки и событие error, а не белая страница", async () => {
  const g = await openGame(browser, server, {
    archetype: "quiz", seed: 1,
    content: { quiz: { questions: [{ q: "В?", answers: ["а"], correct: 3 }] } }
  });
  try {
    const err = await g.expect("error", () => g.play(), 5000);
    assert.ok(err.details.length >= 1 && err.details[0].includes("questions[0]"), JSON.stringify(err));
    // Ошибка в консоли — ожидаемая и единственная.
    assert.equal(g.errors.length, 1, g.errors.join("\n"));
    assert.ok(g.errors[0].includes("content/quiz.json"));
  } finally { await g.close(); }
});
