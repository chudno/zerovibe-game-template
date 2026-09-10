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
  const kits = fs.readdirSync(path.join(__dirname, "..", "..", "game", "kits"))
    .filter((d) => fs.existsSync(path.join(__dirname, "..", "..", "game", "kits", d, "kit.js"))).sort();
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
