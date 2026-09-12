// Headless-прогон китов в Chromium: игра в iframe хоста (как на чужом сайте), сид
// фиксирован, бот-эксперт обязан выиграть, бот-новичок — проиграть, за партию
// ни ошибки консоли, ни нарушения инвариантов. Запуск: см. README в tests/e2e.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startServer, openGame, launchBrowser } = require("./lib.js");
const L = require("../../game/levels.js");
const levelgen = require("../levelgen.js");
const NOVEL = require("../../game/novel.js");

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

test("persona: исход — один из типов, без приза; сид фиксирует порядок вопросов", async () => {
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
    assert.equal(fin.prize, undefined, "тест без брендирования не выдаёт приз");
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

// Брендированный контент (скилл branding): у типа задан prize — карточка приза
// возвращается на экран результата, код уходит наружу.
test("persona: у типа с prize карточка приза приходит в finish", async () => {
  const data = content("persona.json");
  const branded = JSON.parse(JSON.stringify(data));
  branded.types.forEach((t, i) => {
    t.prize = { title: "Промокод типа", code: "TYPE" + i, text: "Скидка на первый заказ", button: "", url: "" };
  });
  const g = await openGame(browser, server, { archetype: "persona", seed: 5, content: { persona: branded } });
  try {
    const m = await g.mark();
    await g.play();
    await answerAll(g, () => 0);
    const fin = await g.waitFinish(m, 20000);
    const type = branded.types.find((t) => t.id === fin.outcome);
    assert.ok(type, "outcome не из списка типов: " + fin.outcome);
    assert.equal(fin.prize.code, type.prize.code);
    clean(g);
  } finally { await g.close(); }
});

test("wheel: три подачи выдают исход из списка с ненулевым весом, без приза и «Ещё раз»", async () => {
  const items = content("wheel.json").items;
  const check = (fin) => {
    const it = items.find((i) => i.id === fin.outcome);
    assert.ok(it && it.weight > 0, "исход не из списка или с нулевым весом: " + JSON.stringify(fin));
    assert.equal(fin.prize, undefined, "розыгрыш без брендирования карточку приза не рисует");
    assert.equal(fin.won, true);
    return it;
  };
  // Колесо.
  let g = await openGame(browser, server, { archetype: "wheel", seed: 9, params: { spinMs: 900 } });
  try {
    await g.play();
    const fin = await g.expect("finish", () => g.tap(180, 520), 15000);
    const it = check(fin); assert.equal(fin.meta.presentation, "wheel");
    clean(g);
    await g.page.waitForTimeout(300);
    // Заголовок экрана результата — сам исход, а не «Поздравляем!».
    const shown = await g.scene((title) => {
      const sc = window.ZV.game.scene.getScene("zv-result");
      return !!sc.children.list.find((o) => o.text === title);
    }, it.title);
    assert.equal(shown, true, "на экране результата нет заголовка исхода «" + it.title + "»");
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

// Брендированный контент (скилл branding): у исходов есть code — карточка
// приза на экране результата и код наружу, как было до разделения.
test("wheel: у исхода с code приходит приз с этим кодом", async () => {
  const branded = JSON.parse(JSON.stringify(content("wheel.json")));
  branded.items.forEach((it, i) => { it.code = "SPIN" + i; });
  const g = await openGame(browser, server, { archetype: "wheel", seed: 9, params: { spinMs: 900 }, content: { wheel: branded } });
  try {
    await g.play();
    const fin = await g.expect("finish", () => g.tap(180, 520), 15000);
    const it = branded.items.find((i) => i.id === fin.outcome);
    assert.ok(it && it.weight > 0, "исход не из списка: " + JSON.stringify(fin));
    assert.equal(fin.prize.code, it.code);
    clean(g);
  } finally { await g.close(); }
});

test("platformer: эксперт по плану солвера проходит все уровни content/levels.json, progress на каждый, победа", async () => {
  const data = content("levels.json");
  const plans = data.levels.map((lv) => {
    const v = L.validateLevel(lv.map);
    assert.deepEqual(v.errors, [], lv.name);
    return v.solved.plan;
  });
  const g = await openGame(browser, server, { archetype: "platformer", seed: 1, params: { lives: 1 } });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("platformer", "expert", { plans });
    const fin = await g.waitFinish(m, 120000);
    const rep = await g.botReport();
    assert.ok(fin.won, JSON.stringify({ fin, rep }));
    assert.equal(fin.meta.archetype, "platformer");
    assert.equal(fin.meta.levels, data.levels.length);
    const progress = (await g.events()).slice(m).filter((e) => e.type === "progress");
    assert.deepEqual(progress.map((e) => e.step), data.levels.map((_, i) => i + 1));
    assert.equal(progress[0].total, data.levels.length);
    assert.ok(rep.jumps >= data.levels.length, JSON.stringify(rep));
    clean(g, rep);
  } finally { await g.close(); }
});

test("platformer: новичок со случайным вводом за 20 с не выигрывает, ошибок и нарушений нет", async () => {
  const g = await openGame(browser, server, { archetype: "platformer", seed: 4 });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("platformer", "novice");
    await g.page.waitForTimeout(20000);
    const fins = (await g.events()).slice(m).filter((e) => e.type === "finish");
    assert.ok(fins.every((f) => !f.won), JSON.stringify(fins));
    clean(g, await g.botReport());
  } finally { await g.close(); }
});

test("сверка солвера с ботом: «проходим» — бот доходит, «непроходим» — нет", async () => {
  const suite = levelgen.suite(8, 1);
  assert.equal(suite.solvable.length, 8);
  // Проходимые: одной партией, все уровни подряд, одна жизнь.
  const g = await openGame(browser, server, {
    archetype: "platformer", seed: 2, params: { lives: 1 },
    content: { levels: { levels: suite.solvable.map((s) => s.level) } }
  });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("platformer", "expert", { plans: suite.solvable.map((s) => s.plan) });
    const fin = await g.waitFinish(m, 240000);
    const rep = await g.botReport();
    assert.ok(fin.won && fin.meta.levels === 8, "сиды " + suite.solvable.map((s) => s.seed).join(",") + ": " + JSON.stringify({ fin, rep }));
    clean(g, rep);
  } finally { await g.close(); }
  // Непроходимые конструкции: жадный бот бежит и прыгает 8 с — выхода нет.
  for (const u of suite.unsolvable) {
    const n = await openGame(browser, server, {
      archetype: "platformer", seed: 3, params: { lives: 9 }, levelsUnchecked: true,
      content: { levels: { levels: [u.level] } }
    });
    try {
      const m = await n.mark();
      await n.play();
      await n.bot("platformer", "greedy");
      await n.page.waitForTimeout(8000);
      const evs = (await n.events()).slice(m);
      assert.ok(!evs.some((e) => e.type === "progress" || (e.type === "finish" && e.won)), u.kind + ": " + JSON.stringify(evs));
      clean(n, await n.botReport());
    } finally { await n.close(); }
  }
});

// Новелла мышью: тап по панели — «дальше»/показать целиком, тап по варианту.
async function playNovel(g, steps) {
  const path = steps.slice();
  for (let guard = 0; guard < 200; guard++) {
    const st = await g.scene(() => window.__zvBot.novel());
    if (!st) { await g.page.waitForTimeout(100); continue; }
    if (st.typing) { await g.tap(180, 380); await g.page.waitForTimeout(80); continue; }
    if (st.ended) { await g.tap(180, 380); return; }
    if (st.linear) { await g.tap(180, 380); await g.page.waitForTimeout(120); continue; }
    if (st.choices > 0) {
      const i = path.shift();
      assert.ok(typeof i === "number" && i < st.choices, "план кончился раньше сюжета: " + st.id);
      await g.tap(180, 468 + i * 44);
      await g.page.waitForTimeout(300);
      continue;
    }
    await g.page.waitForTimeout(100);
  }
  throw new Error("новелла не дошла до концовки");
}

test("novel: каждая концовка достижима мышью по пути из графа; progress по главам; условная реплика видна", async () => {
  const data = content("novel.json");
  const paths = NOVEL.paths(data);
  assert.deepEqual(Object.keys(paths).sort(), ["delivered", "friend", "late"]);
  for (const outcome of Object.keys(paths)) {
    const g = await openGame(browser, server, { archetype: "novel", seed: 1, params: { typeMs: 0 } });
    try {
      const m = await g.mark();
      await g.play();
      await playNovel(g, paths[outcome]);
      const fin = await g.waitFinish(m, 10000);
      assert.equal(fin.outcome, outcome);
      assert.equal(fin.meta.archetype, "novel");
      assert.equal(fin.won, data.nodes[Object.keys(data.nodes).find((id) => data.nodes[id].end && data.nodes[id].end.outcome === outcome)].end.won);
      const progress = (await g.events()).slice(m).filter((e) => e.type === "progress");
      assert.ok(progress.length >= 1 && progress[0].step === 1 && progress[0].total === 3, JSON.stringify(progress));
      clean(g);
      // «Ещё раз» — сцена переиспользуется, второй create() не должен падать.
      await g.page.waitForTimeout(300);
      await g.expect("start", () => g.tap(180, 430));
      await g.page.waitForTimeout(300);
      const again = await g.scene(() => window.__zvBot.novel());
      assert.ok(again && again.id === data.start, "после «Ещё раз» сюжет с начала: " + JSON.stringify(again));
      clean(g);
    } finally { await g.close(); }
  }
  // Печать по буквам: сразу после старта текст не полный, тап показывает целиком и открывает варианты.
  const t = await openGame(browser, server, { archetype: "novel", seed: 1, params: { typeMs: 40 } });
  try {
    await t.play();
    await t.page.waitForTimeout(200);
    const st = await t.scene(() => window.__zvBot.novel());
    assert.equal(st.typing, true);
    assert.equal(st.choices, 0);
    await t.tap(180, 380);
    await t.page.waitForTimeout(100);
    const st2 = await t.scene(() => window.__zvBot.novel());
    assert.equal(st2.typing, false);
    assert.equal(st2.choices, 2);
    clean(t);
  } finally { await t.close(); }
});

test("quest: каждая концовка достижима, инвентарь на полке совпадает с графом, finish несёт предметы", async () => {
  const data = content("quest.json");
  const paths = NOVEL.paths(data);
  assert.deepEqual(Object.keys(paths).sort(), ["delivered", "late", "unpaid"]);
  for (const outcome of Object.keys(paths)) {
    const g = await openGame(browser, server, { archetype: "quest", seed: 1, params: { typeMs: 0 } });
    try {
      const m = await g.mark();
      await g.play();
      await playNovel(g, paths[outcome]);
      const fin = await g.waitFinish(m, 10000);
      assert.equal(fin.outcome, outcome);
      assert.equal(fin.meta.archetype, "quest");
      assert.ok(Array.isArray(fin.meta.items), JSON.stringify(fin.meta));
      if (outcome === "delivered") assert.ok(fin.meta.items.includes("stamp"), "печать должна быть в руках: " + JSON.stringify(fin.meta.items));
      clean(g);
      await g.page.waitForTimeout(300);
      await g.expect("start", () => g.tap(180, 430));
      await g.page.waitForTimeout(300);
      const again = await g.scene(() => window.__zvBot.novel());
      assert.ok(again && again.id === data.start && again.items.length === 0, "после «Ещё раз» квест с начала и без предметов: " + JSON.stringify(again));
      clean(g);
    } finally { await g.close(); }
  }
  // Полка: после получения пропуска ячейка закрашена, счётчик 1/3.
  const g = await openGame(browser, server, { archetype: "quest", seed: 1, params: { typeMs: 0 } });
  try {
    await g.play();
    await g.page.waitForTimeout(200);
    await g.tap(180, 468);              // «Оформить пропуск на стойке»
    await g.page.waitForTimeout(400);
    const st = await g.scene(() => window.__zvBot.novel());
    assert.deepEqual(st.items, ["pass"]);
    const shelf = await g.scene(() => {
      const sc = window.ZV.game.scene.getScene("zv-play");
      return { text: sc.itemsText.text, passOn: sc.slots.pass.box.fillColor !== 0x1b1f33, keyOn: sc.slots.key.box.fillColor !== 0x1b1f33 };
    });
    assert.deepEqual(shelf, { text: "1/3", passOn: true, keyOn: false });
    clean(g);
  } finally { await g.close(); }
});

test("галерея: все киты поднимаются в своих кадрах, шлют ready, без ошибок консоли", async () => {
  // Карточки-данные (гибрид) поднимают чужой архетип со своим контентом —
  // ready ждём и от них. Список берём из tests/gallery.test.js текстом:
  // require запустил бы его тесты внутри этого прогона.
  const galleryTest = fs.readFileSync(path.join(__dirname, "..", "gallery.test.js"), "utf8");
  const dataCards = [...galleryTest.matchAll(/const DATA_CARDS = \{([^}]*)\}/g)]
    .flatMap((m) => [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]));
  const kits = [...new Set(fs.readdirSync(path.join(__dirname, "..", "..", "game", "kits"))
    .filter((d) => fs.existsSync(path.join(__dirname, "..", "..", "game", "kits", d, "kit.js")))
    .concat(dataCards))].sort();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  try {
    await page.goto(`${server.url}/tests/gallery.html?seed=1`);
    const deadline = Date.now() + 30000;
    let ready = [];
    while (Date.now() < deadline) {
      ready = await page.evaluate(() => [...new Set((window.__galleryEvents || []).filter((e) => e.type === "ready").map((e) => e.kit))].sort());
      if (ready.length >= kits.length) break;
      await page.waitForTimeout(250);
    }
    assert.deepEqual(ready, kits, "не все киты дошли до «Играть»");
    assert.deepEqual(errors, [], "ошибки страницы галереи");
    // Кнопка «Заново» перезапускает кадр: событие start от него.
    const before = await page.evaluate(() => window.__galleryEvents.length);
    await page.locator('section.card').first().locator('[data-act="restart"]').click();
    await page.waitForTimeout(500);
    const evs = await page.evaluate((n) => window.__galleryEvents.slice(n).map((e) => e.type), before);
    assert.ok(evs.includes("start"), "после «Заново» нет start: " + JSON.stringify(evs));
    // Режим одного кита — для телефона.
    await page.goto(`${server.url}/tests/gallery.html?only=quest&seed=1`);
    await page.waitForFunction(() => (window.__galleryEvents || []).some((e) => e.type === "ready" && e.kit === "quest"), null, { timeout: 15000 });
    assert.equal(await page.locator("section.card").count(), 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
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

test("шрифт: весь текст — BitmapText из атласа целым кеглем, canvas-текста нет", async () => {
  const g = await openGame(browser, server, { archetype: "quiz", seed: 2, prize: { title: "Скидка 10%", code: "PX10", text: "На заказ", button: "", url: "" } });
  try {
    const check = (sceneKey) => g.scene((key) => {
      const sc = window.ZV.game.scene.getScene(key);
      const objs = sc.children.list;
      const texts = objs.filter((o) => o.type === "Text").length;
      const bts = objs.filter((o) => o.type === "BitmapText");
      const bad = bts.filter((o) => o.font !== "zv-font" || o.fontSize % 10 !== 0 || !Number.isInteger(o.x) || !Number.isInteger(o.y))
        .map((o) => [o.text, o.font, o.fontSize, o.x, o.y]);
      return { texts, bitmap: bts.length, bad, fontCached: window.ZV.game.cache.bitmapFont.has("zv-font"),
        atlas: window.ZV.game.textures.exists("zv-font"), sample: bts[0] && bts[0].text };
    }, sceneKey);
    const menu = await check("zv-menu");
    assert.equal(menu.texts, 0, "на экране «Играть» есть canvas-текст");
    assert.ok(menu.bitmap >= 3 && menu.fontCached && menu.atlas, JSON.stringify(menu));
    assert.deepEqual(menu.bad, [], "кегль не кратен 10 или дробные координаты");
    await g.play();
    const play = await check("zv-play");
    assert.equal(play.texts, 0); assert.deepEqual(play.bad, []);
    await answerAll(g, (st) => st.correct);
    await g.waitFinish(0, 20000);
    await g.page.waitForTimeout(300);
    const res = await check("zv-result");
    assert.equal(res.texts, 0); assert.deepEqual(res.bad, []);
    assert.ok(res.bitmap >= 6, "на результате мало надписей: " + res.bitmap);
    clean(g);
  } finally { await g.close(); }
});

// Логотип темы: картинка по ссылке, целым масштабом, на «Играть» вместо
// подписи и мелко на «Результат»; битая ссылка не ломает игру.
test("тема: логотип на «Играть» и «Результат» целым масштабом, битая ссылка — без него", async () => {
  const shot = process.env.ZV_SHOTS;   // каталог для скриншотов приёмки, необязательно
  const logos = (g, key) => g.scene((k) => {
    const sc = window.ZV.game.scene.getScene(k);
    return sc.children.list.filter((o) => o.type === "Image" && o.texture.key === "zv-logo")
      .map((o) => ({ x: o.x, y: o.y, scale: o.scaleX, w: o.displayWidth, h: o.displayHeight }));
  }, key);
  const labels = (g, key) => g.scene((k) => window.ZV.game.scene.getScene(k).children.list
    .filter((o) => o.type === "BitmapText").map((o) => o.text), key);
  const toResult = (g) => g.scene(() => {
    window.ZV.game.scene.getScene("zv-menu").scene.start("zv-result", { score: 5, won: true, meta: {} });
  });
  // 64×64: на «Играть» лимит 240×80 → масштаб 1; на «Результат» 160×48 → 1/2.
  let g = await openGame(browser, server, { archetype: "runner", seed: 1,
    theme: { name: "Студия", primary: "#4f7cff", secondary: "#ffd23f", logoUrl: "/tests/fixtures/house_a.png" } });
  try {
    const menu = await logos(g, "zv-menu");
    assert.deepEqual(menu, [{ x: 180, y: 100, scale: 1, w: 64, h: 64 }]);
    assert.ok(!(await labels(g, "zv-menu")).includes("Студия"), "при логотипе подпись темы лишняя");
    if (shot) await g.page.screenshot({ path: path.join(shot, "logo-menu.png") });
    await toResult(g);
    await g.page.waitForTimeout(300);
    const res = await logos(g, "zv-result");
    assert.deepEqual(res, [{ x: 180, y: 100, scale: 0.5, w: 32, h: 32 }]);
    if (shot) await g.page.screenshot({ path: path.join(shot, "logo-result.png") });
    clean(g);
  } finally { await g.close(); }
  g = await openGame(browser, server, { archetype: "runner", seed: 1,
    theme: { name: "Студия", primary: "#4f7cff", secondary: "#ffd23f", logoUrl: "/tests/fixtures/missing.png" } });
  try {
    assert.deepEqual(await logos(g, "zv-menu"), []);
    assert.ok((await labels(g, "zv-menu")).includes("Студия"), "без логотипа подпись темы обязана вернуться");
    await toResult(g);
    await g.page.waitForTimeout(300);
    assert.deepEqual(await logos(g, "zv-result"), []);
    // Браузер честно пишет 404 по картинке в консоль — это и есть «битая
    // ссылка»; ошибок самой игры быть не должно.
    assert.deepEqual(g.errors.filter((e) => !/Failed to load resource/.test(e)), [], "ошибки страницы");
  } finally { await g.close(); }
});

// --- гибрид: сюжет с узлом мини-игры (week4) ---------------------------------
// Фикстура tests/fixtures/hybrid.json подсовывается вместо content/novel.json.
const HYBRID = "/tests/fixtures/hybrid.json";
const hybridData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "hybrid.json"), "utf8"));

// Финал СЮЖЕТА, а не мини-игры: waitFinish поймал бы первый же finish, а его
// шлёт и партия внутри узла play (meta.mini === true).
async function waitStoryFinish(g, since, timeout) {
  const deadline = Date.now() + (timeout || 15000);
  while (Date.now() < deadline) {
    const evs = (await g.events()).slice(since);
    const fin = evs.find((e) => e.type === "finish" && e.meta && e.meta.mini === false);
    if (fin) return fin;
    await g.page.waitForTimeout(100);
  }
  throw new Error("сюжет не дошёл до концовки за отведённое время");
}

// Довести сюжет до концовки, всюду беря первый доступный вариант: нужен там,
// где план шагов уже не важен — важна только сама концовка.
async function toEnding(g) {
  for (let guard = 0; guard < 40; guard++) {
    const st = await g.scene(() => window.__zvBot.hybrid());
    if (!st || !st.storyAwake || st.typing) { await g.page.waitForTimeout(100); continue; }
    if (st.ended) { await g.tap(180, 380); return; }
    if (st.choices > 0) await g.tap(180, 468);
    else await g.tap(180, 380);
    await g.page.waitForTimeout(250);
  }
  throw new Error("сюжет не дошёл до концовки");
}

// Провести сюжет по шагам из paths(): число — индекс варианта, объект
// { kind: "play" } — узел мини-игры (исход подставлен через ZV_TEST.playResult).
async function playHybrid(g, steps) {
  const plan = steps.slice();
  for (let guard = 0; guard < 200; guard++) {
    const st = await g.scene(() => window.__zvBot.hybrid());
    if (!st || !st.storyAwake) { await g.page.waitForTimeout(100); continue; }
    if (st.typing) { await g.tap(180, 380); await g.page.waitForTimeout(80); continue; }
    if (st.ended) { await g.tap(180, 380); return; }
    if (st.start) {
      const s = plan.shift();
      assert.ok(s && s.kind === "play", "сюжет привёл к мини-игре, а в плане её нет");
      await g.tap(st.start.x, st.start.y);
      await g.page.waitForTimeout(400);
      continue;
    }
    if (st.choices > 0) {
      const i = plan.shift();
      assert.ok(typeof i === "number" && i < st.choices, "план кончился раньше сюжета: " + st.node);
      await g.tap(180, 468 + i * 44);
      await g.page.waitForTimeout(300);
      continue;
    }
    await g.tap(180, 380);          // линейный узел — «дальше»
    await g.page.waitForTimeout(120);
  }
  throw new Error("гибрид не дошёл до концовки");
}

test("гибрид: ветвление — каждая концовка достижима, счёт мини-игры лежит в переменной", async () => {
  const paths = NOVEL.paths(hybridData);
  assert.ok(Object.keys(paths).length >= 3, "три концовки: " + Object.keys(paths).join(", "));
  for (const outcome of Object.keys(paths)) {
    const steps = paths[outcome];
    const play = steps.find((s) => s && s.kind === "play");
    assert.ok(play, `путь до ${outcome} обязан идти через мини-игру`);
    const g = await openGame(browser, server, {
      archetype: "novel", seed: 1, params: { typeMs: 0 },
      contentUrl: { novel: HYBRID },
      playResult: { won: play.won, score: play.score }
    });
    try {
      const m = await g.mark();
      await g.play();
      await playHybrid(g, steps);
      await waitStoryFinish(g, m);
      const evs = (await g.events()).slice(m).filter((e) => e.type === "finish");
      // Первый finish — мини-игры (meta.mini, meta.node), последний — сюжета.
      const mini = evs.find((e) => e.meta && e.meta.mini === true);
      assert.ok(mini, "finish мини-игры не пришёл: " + JSON.stringify(evs.map((e) => e.meta)));
      assert.equal(mini.meta.node, "lift_puzzle");
      assert.equal(mini.score, play.score);
      assert.equal(mini.won, play.won);
      const fin = evs[evs.length - 1];
      assert.equal(fin.outcome, outcome);
      assert.equal(fin.meta.mini, false, "финальный finish сюжета не мини-игра");
      assert.equal(fin.meta.archetype, "novel");
      // Счёт партии подставлен в переменную сюжета, итог записан в plays.
      assert.equal(fin.meta.vars.run_score, play.score);
      assert.deepEqual(fin.meta.plays, [{ node: "lift_puzzle", kit: "catch", score: play.score, won: play.won }]);
      clean(g);
    } finally { await g.close(); }
  }
});

test("гибрид: вживую — настоящая ловилка внутри сюжета, возврат без экрана результата", async () => {
  const g = await openGame(browser, server, {
    archetype: "novel", seed: 1, params: { typeMs: 0 },
    contentUrl: { novel: HYBRID }
  });
  try {
    const m = await g.mark();
    await g.play();
    await g.page.waitForTimeout(200);
    await g.tap(180, 468);                       // «Бегу к лифту»
    await g.page.waitForTimeout(400);
    const before = await g.scene(() => window.__zvBot.hybrid());
    assert.equal(before.node, "lift_puzzle");
    assert.ok(before.start && before.start.label === "Ловить", "кнопка запуска не показана: " + JSON.stringify(before));
    assert.equal(before.rules, "Лови пакеты, пропускай мусор", "строка правил под кнопкой обязательна");
    assert.equal(before.mini, null, "мини-игра не должна стартовать до нажатия кнопки");
    // Тап по панели мимо кнопки партию не начинает — предупреждение работает.
    await g.tap(180, 380);
    await g.page.waitForTimeout(200);
    assert.equal((await g.scene(() => window.__zvBot.hybrid())).mini, null, "мини-игра стартовала по тапу по панели");

    await g.tap(before.start.x, before.start.y);
    await g.page.waitForTimeout(500);
    const during = await g.scene(() => window.__zvBot.hybrid());
    assert.equal(during.mini, "zv-mini", "сцена кита обязана жить под ключом zv-mini");
    assert.equal(during.storySleeping, true, "сюжетная сцена во время мини-игры спит, иначе ввод идёт в обе");
    // Параметры узла дошли до кита отдельным слоем, поверх config.params.
    assert.deepEqual(await g.scene(() => window.ZV_PLAY_PARAMS), { duration: 6000, passScore: 3 });
    // Один уровень вложенности: мини-игра не поднимает мини-игру.
    const nested = await g.scene(() => {
      try { window.ZV.play(window.ZV.game.scene.getScene("zv-mini"), "catch", {}); return ""; }
      catch (e) { return String(e.message); }
    });
    assert.match(nested, /мини-игра не может запускать мини-игру/);
    await g.bot("catch", "expert");
    const fin = await g.waitFinish(m, 30000);
    assert.equal(fin.meta.mini, true);
    assert.equal(fin.meta.node, "lift_puzzle");
    assert.equal(fin.meta.archetype, "catch");
    // 0,9 с итога и возврат: активна сцена сюжета, zv-mini снята, результата нет.
    await g.page.waitForTimeout(1500);
    const after = await g.scene(() => ({
      h: window.__zvBot.hybrid(),
      keys: window.ZV.game.scene.scenes.map((s) => s.sys.settings.key),
      result: window.ZV.game.scene.getScene("zv-result").sys.isActive()
    }));
    assert.equal(after.h.storyAwake, true, "после мини-игры активна сцена сюжета");
    assert.ok(!after.keys.includes("zv-mini"), "сцена мини-игры обязана сниматься: " + after.keys.join(", "));
    assert.equal(after.result, false, "экран результата внутри сюжета не показывается");
    assert.ok(["lift_fast", "stairs"].includes(after.h.node), "сюжет ушёл по ветке исхода: " + after.h.node);
    assert.equal(after.h.plays.length, 1);
    // Один тап после возврата — РОВНО один переход (подписки stage.js пережили сон).
    const nodeBefore = after.h.node;
    await g.tap(180, 380);
    await g.page.waitForTimeout(400);
    const step1 = await g.scene(() => window.__zvBot.hybrid());
    assert.notEqual(step1.node, nodeBefore, "тап после возврата не сработал");
    assert.equal(step1.node, "door", "один тап — один переход, а ушли дальше: " + step1.node);
    // Дальше — концовка; итог сюжета за партию ровно один.
    await toEnding(g);
    await waitStoryFinish(g, m);
    await g.page.waitForTimeout(400);
    const results = (await g.events()).slice(m).filter((e) => e.type === "finish" && e.meta && e.meta.mini === false);
    assert.equal(results.length, 1, "итог сюжета за партию ровно один: " + results.length);
    clean(g);
  } finally { await g.close(); }
});

test("гибрид: проигрыш мини-игры — не конец, а другая ветка и другая концовка", async () => {
  const g = await openGame(browser, server, {
    archetype: "novel", seed: 1, params: { typeMs: 0 },
    contentUrl: { novel: HYBRID },
    playResult: { won: false, score: 0 }
  });
  try {
    const m = await g.mark();
    await g.play();
    await g.page.waitForTimeout(200);
    await g.tap(180, 468);                       // «Бегу к лифту»
    await g.page.waitForTimeout(400);
    const st = await g.scene(() => window.__zvBot.hybrid());
    await g.tap(st.start.x, st.start.y);
    await g.page.waitForTimeout(500);
    const after = await g.scene(() => window.__zvBot.hybrid());
    assert.equal(after.node, "stairs", "проигрыш обязан вести в ветку-без-if: " + after.node);
    assert.equal(after.ended, false, "проигрыш мини-игры не заканчивает партию");
    assert.equal(after.vars.run_score, 0);
    // Доводим до концовки: она отличается от победной.
    await toEnding(g);
    const fin = await waitStoryFinish(g, m);
    assert.equal(fin.outcome, "late", "проигранная мини-игра ведёт к своей концовке");
    assert.equal(fin.won, false);
    assert.equal(fin.meta.mini, false);
    assert.deepEqual(fin.meta.plays, [{ node: "lift_puzzle", kit: "catch", score: 0, won: false }]);
    clean(g);
  } finally { await g.close(); }
});

test("гибрид: многоэкранная мини-игра — progress уровней несёт узел сюжета", async () => {
  // Платформер шлёт progress на каждый уровень: внутри сюжета эти события
  // обязаны быть привязаны к узлу так же, как finish, иначе воронка рвётся.
  const data = content("levels.json");
  const plans = data.levels.map((lv) => L.validateLevel(lv.map).solved.plan);
  const g = await openGame(browser, server, {
    archetype: "novel", seed: 1, params: { typeMs: 0 },
    contentUrl: { novel: "/tests/fixtures/hybrid-levels.json" }
  });
  try {
    const m = await g.mark();
    await g.play();
    await g.page.waitForTimeout(200);
    const st = await g.scene(() => window.__zvBot.hybrid());
    assert.equal(st.node, "brief");
    await g.tap(st.start.x, st.start.y);
    await g.page.waitForTimeout(500);
    await g.bot("platformer", "expert", { plans });
    const fin = await g.waitFinish(m, 120000);
    assert.equal(fin.meta.mini, true);
    assert.equal(fin.meta.node, "brief");
    const all = (await g.events()).slice(m).filter((e) => e.type === "progress");
    const mini = all.filter((e) => e.meta && e.meta.mini === true);
    assert.equal(mini.length, data.levels.length, JSON.stringify(all));
    mini.forEach((e, i) => {
      assert.equal(e.meta.node, "brief", "progress мини-игры без узла: " + JSON.stringify(e));
      assert.equal(e.step, i + 1);
      assert.equal(e.total, data.levels.length);
      assert.ok(typeof e.meta.level === "number", "своё meta кита обязано доехать: " + JSON.stringify(e));
    });
    // Собственный progress сюжета остаётся прежним — mini у него не всплывает.
    const story = all.filter((e) => !e.meta || e.meta.mini !== true);
    assert.equal(story.length, 1, JSON.stringify(story));
    assert.equal(story[0].meta.mini, undefined);
    // Возврат в сюжет состоялся, экрана результата не было.
    await g.page.waitForTimeout(1500);
    const after = await g.scene(() => window.__zvBot.hybrid());
    assert.equal(after.storyAwake, true);
    assert.ok(["done", "fell"].includes(after.node), after.node);
    clean(g);
  } finally { await g.close(); }
});

// week4: memory ------------------------------------------------------------
// Синхронизация только по состоянию: бот ждёт busy === false (таймлайн
// свободен), а не спит peekMs. Тапы — настоящей мышью по центрам ячеек, так
// проверяются и тач-цели сетки.
async function memoryState(g) {
  for (let guard = 0; guard < 300; guard++) {
    const st = await g.scene(() => window.__zvBot.memory());
    if (st && !st.busy) return st;
    await g.page.waitForTimeout(50);
  }
  return null;
}

// Один тап эксперта: ячейку выбирает бот внутри страницы по своей карте
// виденного, тест только жмёт мышью.
async function memoryTapExpert(g, st) {
  const i = await g.scene(() => window.__zvBot.memoryPick());
  if (i < 0) return false;
  const cell = st.cells.find((c) => c.i === i);
  if (!cell) return false;
  await g.tap(cell.x, cell.y);
  return true;
}

// Эксперт играет БЕЗ подглядки (previewMs: 0) и без бесплатных промахов:
// иначе это игрок с полной информацией, а не с памятью, и порог по ходам
// проверяется с запасом в разы — регрессия «ход списывается вдвое чаще» не
// упала бы. Бюджет считается точно: сумма 2·pairs + 2 по раундам.
test("memory: эксперт с идеальной памятью укладывается в бюджет moves = 2·pairs + 2", async () => {
  const data = content("memory.json");
  const rounds = data.rounds.map((r) => ({ ...r, moves: r.pairs * 2 + 2 }));
  const g = await openGame(browser, server, {
    archetype: "memory", seed: 21, params: { previewMs: 0, peekMs: 200, openMs: 60, freeMistakes: 0 },
    content: { memory: { ...data, rounds } }
  });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("memory", "expert");
    for (let guard = 0; guard < 400; guard++) {
      const st = await memoryState(g);
      if (!st || st.over) break;
      if (!(await memoryTapExpert(g, st))) break;
    }
    const fin = await g.waitFinish(m, 90000);
    const rep = await g.botReport();
    assert.equal(fin.won, true, JSON.stringify({ fin, rep }));
    assert.equal(fin.meta.archetype, "memory");
    assert.equal(fin.meta.rounds, rounds.length, "пройдены не все раунды: " + JSON.stringify(fin.meta));
    const budget = rounds.reduce((s, r) => s + r.pairs * 2 + 2, 0);
    assert.ok(fin.meta.moves <= budget, `ходов ${fin.meta.moves} при бюджете ${budget}: ` + JSON.stringify(fin.meta));
    // Первая встреча каждого значения может стоить промаха — но не больше.
    const seenOnce = rounds.reduce((s, r) => s + r.pairs, 0);
    assert.ok(fin.meta.mistakes <= seenOnce, `промахов ${fin.meta.mistakes} при пределе ${seenOnce}: ` + JSON.stringify(fin.meta));
    clean(g, rep);
  } finally { await g.close(); }
});

// Отдельно: подглядка не ломает партию и не мешает буферу тапов (порог по
// ходам тут не при чём — с previewMs эксперт видит всё поле).
test("memory: подглядка в начале раунда не ломает партию", async () => {
  const data = content("memory.json");
  const rounds = [{ ...data.rounds[0], moves: data.rounds[0].pairs * 2 + 2 }];
  const g = await openGame(browser, server, {
    archetype: "memory", seed: 21, params: { previewMs: 600, peekMs: 200, openMs: 60 },
    content: { memory: { ...data, rounds } }
  });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("memory", "expert");
    for (let guard = 0; guard < 200; guard++) {
      const st = await memoryState(g);
      if (!st || st.over) break;
      if (!(await memoryTapExpert(g, st))) break;
    }
    const fin = await g.waitFinish(m, 60000);
    const rep = await g.botReport();
    assert.equal(fin.won, true, JSON.stringify({ fin, rep }));
    assert.equal(fin.meta.pairs, rounds[0].pairs);
    clean(g, rep);
  } finally { await g.close(); }
});

test("memory: новичок со случайными тапами не укладывается в минимальные ходы на 6 пар", async () => {
  const data = content("memory.json");
  const g = await openGame(browser, server, {
    archetype: "memory", seed: 4,
    params: { previewMs: 0, peekMs: 150, openMs: 60, freeMistakes: 0 },
    // 14 = 2·pairs + 2, законный минимум валидатора: идеальная память проходит,
    // случайная игра (≈18–20 ходов на 6 пар) — нет.
    content: { memory: { ...data, rounds: [{ name: "Наугад", hint: "Найди пары", pairs: 6, moves: 14 }] } }
  });
  try {
    const m = await g.mark();
    await g.play();
    for (let guard = 0; guard < 200; guard++) {
      const st = await memoryState(g);
      if (!st || st.over) break;
      // Память нулевая: случайная закрытая ячейка (сид игры фиксирован).
      const free = st.cells.filter((c) => !c.matched && !c.face);
      if (!free.length) break;
      const pick = free[(guard * 7 + 3) % free.length];
      await g.tap(pick.x, pick.y);
    }
    const fin = await g.waitFinish(m, 60000);
    assert.equal(fin.won, false, "случайная игра обязана проиграть по ходам: " + JSON.stringify(fin));
    assert.equal(fin.meta.rounds, 0);
    clean(g);
  } finally { await g.close(); }
});

// passRounds больше числа раскладов не должен делать победу невозможной:
// иначе автор ставит 5 при трёх раундах и игра никогда не выиграна.
test("memory: passRounds больше числа раскладов зажимается по нему", async () => {
  const data = content("memory.json");
  const rounds = [{ ...data.rounds[0], moves: data.rounds[0].pairs * 2 + 2 }];
  const g = await openGame(browser, server, {
    archetype: "memory", seed: 21,
    params: { previewMs: 0, peekMs: 150, openMs: 60, freeMistakes: 0, passRounds: 5 },
    content: { memory: { ...data, rounds } }
  });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("memory", "expert");
    for (let guard = 0; guard < 200; guard++) {
      const st = await memoryState(g);
      if (!st || st.over) break;
      if (!(await memoryTapExpert(g, st))) break;
    }
    const fin = await g.waitFinish(m, 60000);
    const rep = await g.botReport();
    assert.equal(fin.won, true, "победа недостижима при passRounds > rounds.length: " + JSON.stringify({ fin, rep }));
    clean(g, rep);
  } finally { await g.close(); }
});

test("memory: один сид — одна раскладка (та же последовательность тапов даёт тот же итог)", async () => {
  const data = content("memory.json");
  const one = { ...data, rounds: [{ name: "Разминка", hint: "Найди пары", pairs: 4, moves: 12 }] };
  const run = async () => {
    const g = await openGame(browser, server, {
      archetype: "memory", seed: 11, params: { previewMs: 0, peekMs: 150, openMs: 60 },
      content: { memory: one }
    });
    try {
      const m = await g.mark();
      await g.play();
      for (let guard = 0; guard < 60; guard++) {
        const st = await memoryState(g);
        if (!st || st.over) break;
        // Обход поля по порядку — одинаковый в обоих прогонах.
        const free = st.cells.filter((c) => !c.matched && !c.face);
        if (!free.length) break;
        await g.tap(free[0].x, free[0].y);
      }
      const fin = await g.waitFinish(m, 60000);
      clean(g);
      return fin;
    } finally { await g.close(); }
  };
  const a = await run();
  const b = await run();
  assert.equal(a.meta.mistakes, b.meta.mistakes, JSON.stringify({ a: a.meta, b: b.meta }));
  assert.equal(a.meta.pairs, b.meta.pairs);
  assert.equal(a.meta.moves, b.meta.moves);
  assert.equal(a.score, b.score);
});

// week4: clicker. Сверка модели с движком: план и время считает солвер
// (game/clicker.js) в node ДО запуска, бот-эксперт отыгрывает его в Chromium.
// Тот же солвер стоит в валидаторе — значит «цель достижима» проверено дважды.
const CLICKER = require("../../game/clicker.js");

test("clicker: эксперт берёт цель по плану солвера и укладывается в его время", async () => {
  const data = content("clicker.json");
  const S = CLICKER.withDefaults({});
  const best = CLICKER.best(data, S);
  assert.ok(best.reachable, "солвер сам не берёт цель — правь content/clicker.json, а не тест");
  const g = await openGame(browser, server, { archetype: "clicker", seed: 7 });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("clicker", "expert", { plan: best.plan, tapsPerSec: S.botTapsPerSec });
    const fin = await g.waitFinish(m, 120000);
    const rep = await g.botReport();
    assert.equal(fin.won, true, JSON.stringify({ fin, rep, best }));
    assert.ok(fin.score >= data.goal.score, JSON.stringify(fin));
    assert.equal(fin.meta.archetype, "clicker");
    // Запас на кадры браузера: модель считает шагом 100 мс, движок — кадрами.
    assert.ok(fin.meta.seconds <= best.seconds * 1.35,
      `движок ${fin.meta.seconds} с против модели ${best.seconds} с — экономика разошлась`);
    assert.ok(fin.meta.upgrades > 0 && fin.meta.careUses > 0, JSON.stringify(fin.meta));
    // Движок обязан выкупить те же ступени, что и модель, а не добраться до
    // цели своим путём. Хвост плана в счёт не идёт: цель приходит раньше, чем
    // очередь кончается, и модель бросает её ровно так же — сверяем с ЕЁ
    // покупками. Без этой строки бот мог молча не купить ничего.
    const model = CLICKER.simulate(data, S, { taps: true, care: true, plan: best.plan.slice() });
    assert.equal(fin.meta.upgrades, model.bought.length,
      `движок купил ${fin.meta.upgrades} ступеней против ${model.bought.length} у модели: ${JSON.stringify({ rep, bought: model.bought, plan: best.plan })}`);
    // Стадии открывались по ходу, а не разом в конце.
    assert.ok(fin.meta.stage >= data.stages.length - 1, JSON.stringify(fin.meta));
    clean(g, rep);
  } finally { await g.close(); }
});

test("clicker: новичок (вчетверо реже, без покупок и полива) цель не берёт", async () => {
  // Партия укорочена вдвое вместе с ценой тапа: содержимое остаётся
  // проходимым (валидатор считает достижимость на ЭТИХ params), а ждать
  // проигрыша новичка минуту с лишним незачем.
  const g = await openGame(browser, server, { archetype: "clicker", seed: 7, params: { duration: 30000, tapPoints: 3 } });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("clicker", "novice", { tapsPerSec: CLICKER.PARAMS.botTapsPerSec });
    const fin = await g.waitFinish(m, 60000);
    const rep = await g.botReport();
    assert.equal(fin.won, false, "игра проходится сама: " + JSON.stringify({ fin, rep }));
    assert.equal(fin.meta.upgrades, 0);
    assert.equal(fin.meta.careUses, 0);
    clean(g, rep);
  } finally { await g.close(); }
});

test("clicker: бросающее хранилище — эксперт всё равно побеждает, консоль чиста", async () => {
  const data = content("clicker.json");
  const S = CLICKER.withDefaults({});
  const best = CLICKER.best(data, S);
  const g = await openGame(browser, server, { archetype: "clicker", seed: 7 });
  try {
    // Хранилище бросает на самом обращении к свойству — так ведёт себя
    // приватное окно iOS и кадр с запрещёнными куками. Ставим ловушку и
    // перезапускаем партию из оболочки (кадр не пересоздаём: локаторы теста
    // привязаны к нему), чтобы create() кита прошёл уже с битым хранилищем.
    await g.frame.evaluate(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() { throw new Error("storage disabled"); }
      });
    });
    const m = await g.mark();
    // Перезапуск штатным путём встраивания (source: "zv-host") — тем же,
    // которым игру перезапускает страница-хозяин.
    await g.expect("start", () => g.frame.evaluate(() => window.postMessage({ source: "zv-host", type: "restart" }, "*")));
    await g.bot("clicker", "expert", { plan: best.plan, tapsPerSec: S.botTapsPerSec });
    const fin = await g.waitFinish(m, 120000);
    const rep = await g.botReport();
    assert.equal(fin.won, true, "прохождение зависит от localStorage: " + JSON.stringify({ fin, rep }));
    assert.equal(fin.meta.record, false, "без хранилища рекорда быть не может");
    clean(g, rep);
  } finally { await g.close(); }
});

// --- собери заказ (sort) -----------------------------------------------------
// Три сценария: эксперт знает верную корзину и обязан выиграть без единой
// ошибки; новичок жмёт первую корзину всегда и обязан проиграть по жизням;
// тач-цели проверяются настоящей мышью в САМЫЙ край корзины.
test("sort: эксперт разбирает ленту без ошибок и выигрывает, мусор пропускает", async () => {
  const g = await openGame(browser, server, { archetype: "sort", seed: 5, params: { duration: 20000, passScore: 60 } });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("sort", "expert");
    const fin = await g.waitFinish(m, 60000);
    const rep = await g.botReport();
    assert.ok(fin.won, JSON.stringify({ fin, rep }));
    assert.equal(fin.meta.archetype, "sort");
    assert.equal(fin.meta.mistakes, 0, "эксперт знает верную корзину — ошибок быть не должно");
    assert.ok(fin.meta.sorted >= 6, "за 20 с разобрано слишком мало: " + fin.meta.sorted);
    // Лента разгоняется, но не выше потолка — иначе инвариант темпа врёт.
    assert.ok(fin.meta.topSpeed >= 90 && fin.meta.topSpeed <= 190, "скорость вне диапазона: " + fin.meta.topSpeed);
    assert.ok(fin.meta.bestStreak >= 5, "серия не набралась: " + fin.meta.bestStreak);
    clean(g, rep);
  } finally { await g.close(); }
});

test("sort: новичок жмёт первую корзину всегда и проигрывает по жизням", async () => {
  const g = await openGame(browser, server, { archetype: "sort", seed: 5, params: { duration: 45000 } });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("sort", "novice");
    const fin = await g.waitFinish(m, 60000);
    const rep = await g.botReport();
    assert.equal(fin.won, false, "игра, которая проходится случайными тапами, не игра");
    // Проиграл именно по жизням: ошибок больше, чем прощается, и время не вышло.
    assert.ok(fin.meta.mistakes > 2, JSON.stringify(fin.meta));
    clean(g, rep);
  } finally { await g.close(); }
});

test("sort: тап настоящей мышью в самый край корзины засчитан — тач-цель ≥24 px", async () => {
  const g = await openGame(browser, server, { archetype: "sort", seed: 9, params: { duration: 45000, beltSpeed: 60, beltMax: 60 } });
  try {
    await g.play();
    // Ждём предмет в полосе решения, чтобы тап отправил именно его.
    let st = null;
    for (let guard = 0; guard < 200; guard++) {
      st = await g.scene(() => window.__zvBot.sort());
      if (st && st.current && st.current.x >= 232) break;
      await g.page.waitForTimeout(50);
    }
    assert.ok(st && st.current, "предмет так и не доехал до полосы решения");
    const bin = st.bins.find((b) => b.id === st.current.bin);
    assert.ok(bin, "у текущего предмета нет своей корзины: " + JSON.stringify(st));
    // Корзина 360/bins шириной; целимся в 2 px от её левой границы.
    const half = Math.floor(360 / st.bins.length / 2);
    const edgeX = bin.x - half + 2;
    const before = st.sorted;
    await g.tap(edgeX, bin.y);
    await g.page.waitForTimeout(200);
    const after = await g.scene(() => window.__zvBot.sort());
    assert.equal(after.sorted, before + 1, "тап в край корзины не засчитан — тач-цель уже 24 px");
    assert.equal(after.lives, st.lives, "верная корзина отняла жизнь");
    assert.deepEqual(g.errors, [], "ошибки страницы");
  } finally { await g.close(); }
});

// week5: match3 -----------------------------------------------------------------
// Ядро играет в node, кит — в Chromium: эксперт каждый ход берёт тот же
// ZV_MATCH3.best(), которым считает валидатор, и обязан взять цель. Инвариант
// «поле полное и без готовых совпадений» держит бот каждый кадр (bots.js).
const MATCH3 = require("../../game/match3.js");

// Дождаться покоя: каскад и падения идут лентой шагов, тапать посреди них
// нельзя — кит и сам не пустит, но тест иначе бы просто гонял впустую.
async function match3State(g) {
  for (let guard = 0; guard < 400; guard++) {
    const st = await g.scene(() => window.__zvBot.match3());
    if (st && !st.busy) return st;
    await g.page.waitForTimeout(50);
  }
  return null;
}

const boardOf = (st) => MATCH3.make(st.cols, st.rows, st.cells);
// Мультимножество видов на поле: перемешивание обязано его сохранить.
function tally(cells) {
  const out = {};
  for (const k of cells) out[k] = (out[k] || 0) + 1;
  return out;
}

test("match3: эксперт берёт цель за отведённые ходы, поле остаётся полным и без совпадений", async () => {
  const g = await openGame(browser, server, {
    archetype: "match3", seed: 12, params: { moves: 20, targetScore: 600 }
  });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("match3", "expert");
    const fin = await g.waitFinish(m, 90000);
    const rep = await g.botReport();
    assert.equal(fin.won, true, JSON.stringify({ fin, rep }));
    assert.equal(fin.meta.archetype, "match3");
    assert.ok(fin.score >= 600, "цель не взята: " + fin.score);
    assert.ok(fin.meta.moves <= 20, "ходов потрачено больше лимита: " + fin.meta.moves);
    assert.ok(fin.meta.cleared >= 20, "собрано подозрительно мало фишек: " + fin.meta.cleared);
    clean(g, rep);
  } finally { await g.close(); }
});

test("match3: новичок со случайными обменами цель не берёт — ходы кончаются", async () => {
  const g = await openGame(browser, server, {
    archetype: "match3", seed: 12, params: { moves: 20, targetScore: 600 }
  });
  try {
    const m = await g.mark();
    await g.play();
    await g.bot("match3", "novice");
    const fin = await g.waitFinish(m, 90000);
    const rep = await g.botReport();
    assert.equal(fin.won, false, "игра, которая проходится случайными обменами, не игра: " + JSON.stringify(fin));
    assert.equal(fin.meta.movesLeft, 0, "проигрыш должен быть по ходам: " + JSON.stringify(fin.meta));
    clean(g, rep);
  } finally { await g.close(); }
});

test("match3: тап-тап настоящей мышью делает ход, а неудачный обмен его тратит впустую", async () => {
  const g = await openGame(browser, server, {
    archetype: "match3", seed: 3, params: { moves: 20, targetScore: 600 }
  });
  try {
    await g.play();
    let st = await match3State(g);
    assert.ok(st, "поле не поднялось");
    const b = boardOf(st);
    const mv = MATCH3.best(b);
    assert.ok(mv, "на раздаче нет ни одного хода");

    // Выбор фишки виден: контур ставится по первому тапу.
    const a = st.layout.find((c) => c.i === mv.a);
    const c2 = st.layout.find((c) => c.i === mv.b);
    await g.tap(a.x, a.y);
    const picked = await g.scene(() => window.__zvBot.match3());
    assert.equal(picked.picked, mv.a, "первый тап не выбрал фишку");

    const before = st.score;
    await g.tap(c2.x, c2.y);
    const after = await match3State(g);
    assert.ok(after.score > before, "верный обмен не дал очков");
    assert.equal(after.movesUsed, 1, "ход не засчитан");
    assert.equal(after.picked, -1, "выбор не снялся после хода");

    // Обмен, который ничего не собирает: очков нет, а ход потрачен
    // (wrongCostsMove по умолчанию включён — иначе тыканье наугад бесплатно).
    const st2 = await match3State(g);
    const board2 = boardOf(st2);
    const good = new Set(MATCH3.moves(board2).map((x) => x.a + ":" + x.b));
    let bad = null;
    for (let i = 0; i < board2.cells.length && !bad; i++) {
      const p = MATCH3.cell(board2, i);
      if (p.c + 1 >= board2.cols) continue;
      const j = MATCH3.idx(board2, p.c + 1, p.r);
      if (!good.has(i + ":" + j) && board2.cells[i] !== board2.cells[j]) bad = [i, j];
    }
    assert.ok(bad, "на поле не нашлось ни одного бесполезного обмена");
    const pa = st2.layout.find((c) => c.i === bad[0]);
    const pb = st2.layout.find((c) => c.i === bad[1]);
    await g.tap(pa.x, pa.y);
    await g.tap(pb.x, pb.y);
    const after2 = await match3State(g);
    assert.equal(after2.score, st2.score, "бесполезный обмен дал очки");
    assert.equal(after2.movesUsed, st2.movesUsed + 1, "бесполезный обмен не потратил ход");
    // И поле не поехало: фишки качнулись и вернулись на свои места.
    assert.deepEqual(after2.cells, st2.cells, "неудачный обмен всё-таки переставил фишки");
    assert.deepEqual(g.errors, [], "ошибки страницы");
  } finally { await g.close(); }
});

test("match3: свайп настоящей мышью делает тот же ход, что и тап-тап", async () => {
  const g = await openGame(browser, server, {
    archetype: "match3", seed: 3, params: { moves: 20, targetScore: 600 }
  });
  try {
    await g.play();
    const st = await match3State(g);
    const b = boardOf(st);
    const mv = MATCH3.best(b);
    assert.ok(mv, "на раздаче нет ни одного хода");
    const from = st.layout.find((c) => c.i === mv.a);
    const to = st.layout.find((c) => c.i === mv.b);

    // Настоящая мышь по канве iframe: жмём на фишке, ведём к соседней,
    // отпускаем. Сдвиг заведомо больше swipeMin (ячейка ≈52 px).
    const box = await g.frame.locator("canvas").boundingBox();
    const sx = box.x + (from.x / 360) * box.width;
    const sy = box.y + (from.y / 640) * box.height;
    const ex = box.x + (to.x / 360) * box.width;
    const ey = box.y + (to.y / 640) * box.height;
    await g.page.mouse.move(sx, sy);
    await g.page.mouse.down();
    await g.page.mouse.move(ex, ey, { steps: 6 });
    await g.page.mouse.up();

    const after = await match3State(g);
    assert.ok(after.score > st.score, "свайп не собрал линию: " + JSON.stringify({ before: st.score, after: after.score }));
    assert.equal(after.movesUsed, 1, "свайп не засчитан ходом");
    assert.equal(after.picked, -1, "свайп оставил фишку выбранной");
    assert.deepEqual(g.errors, [], "ошибки страницы");
  } finally { await g.close(); }
});

test("match3: нет ходов — поле перемешивается теми же фишками, без зависания", async () => {
  // Поле 4×4 на пяти видах запирается почти каждую партию: играем экспертом и
  // проверяем, что кит сам объявил перемешивание, состав фишек при этом не
  // изменился, а партия дошла до конца, а не встала на тупике.
  const g = await openGame(browser, server, {
    archetype: "match3", seed: 8,
    params: { cols: 4, rows: 4, kinds: 5, moves: 20, targetScore: 700 }
  });
  try {
    const m = await g.mark();
    await g.play();
    const first = await match3State(g);
    assert.ok(first, "поле не поднялось");
    const before = tally(first.cells);
    await g.bot("match3", "expert");

    // Ловим момент сразу после перемешивания: состав фишек обязан совпасть с
    // тем, что было на поле ДО него.
    let seen = null, last = first;
    for (let guard = 0; guard < 400 && !seen; guard++) {
      const st = await g.scene(() => window.__zvBot.match3());
      if (!st || st.over) break;
      if (!st.busy && st.shuffles > 0 && last.shuffles === 0) seen = { before: tally(last.cells), after: tally(st.cells) };
      if (st && !st.busy) last = st;
      await g.page.waitForTimeout(40);
    }
    const fin = await g.waitFinish(m, 90000);
    const rep = await g.botReport();
    assert.ok(fin.meta.shuffles >= 1, "за 20 ходов на поле 4×4 ни одного тупика: " + JSON.stringify(fin.meta));
    assert.equal(fin.meta.movesLeft === 0 || fin.won, true, "партия встала: " + JSON.stringify(fin.meta));
    if (seen) assert.deepEqual(seen.after, seen.before, "перемешивание подменило фишки");
    assert.ok(before, "состав стартового поля не прочитан");
    clean(g, rep);
  } finally { await g.close(); }
});

test("match3: битый контент — экран ошибки, а не белая страница", async () => {
  const g = await openGame(browser, server, {
    archetype: "match3", seed: 1,
    content: { match3: { goal: { title: "Цель" }, kinds: [{ id: "a", title: "А", color: "#2e9e5b", shape: "circle" }] } }
  });
  try {
    const err = await g.expect("error", () => g.play(), 5000);
    assert.ok(err.details.length >= 1 && err.details[0].includes("kinds"), JSON.stringify(err));
    assert.equal(g.errors.length, 1, g.errors.join("\n"));
    assert.ok(g.errors[0].includes("content/match3.json"));
  } finally { await g.close(); }
});
