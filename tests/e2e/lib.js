// Обвязка headless-прогона: статический сервер репозитория, страница-хост с
// iframe (как на чужом сайте), сбор событий встраивания и ошибок консоли, тестовые
// перекрытия ZV_TEST (сид, параметры, архетип). Боты живут внутри страницы
// (bots.js) — page.evaluate на каждый кадр не поспевает.
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ url, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const botsSource = fs.readFileSync(path.join(__dirname, "bots.js"), "utf8");

// Открыть игру в iframe хоста. opts: { archetype, seed, params, prize, theme,
// content, contentUrl, playResult, levelsUnchecked, clearStorage }. content —
// подмена content/<kind>.json ответом (экран ошибок, сгенерированные уровни);
// contentUrl — адрес файла вместо боевого content/<kind>.json (фикстура);
// playResult { won, score } — исход мини-игры сюжета подставляется без её
// запуска (проверяем ветвление сюжета, а не физику кита);
// levelsUnchecked — не гонять
// солвер при загрузке (заведомо непроходимые уровни для сверки с ботом);
// clearStorage (по умолчанию true) — стирать localStorage перед партией, иначе
// сейв прошлого теста делает следующий прогон невоспроизводимым.
async function openGame(browser, server, opts) {
  opts = opts || {};
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  // Перекрытия: config.js делает window.ZV_GAME = {…} — перехватываем присваивание.
  await page.addInitScript((o) => {
    window.ZV_TEST = { seed: o.seed, params: o.params || {}, levelsUnchecked: !!o.levelsUnchecked };
    if (o.playResult) window.ZV_TEST.playResult = o.playResult;
    if (o.contentUrl) window.ZV_TEST.contentUrl = o.contentUrl;
    let stored;
    Object.defineProperty(window, "ZV_GAME", {
      configurable: true,
      get() { return stored; },
      set(v) {
        if (o.archetype) v.archetype = o.archetype;
        if (o.prize) v.prize = o.prize;
        if (o.theme) v.theme = o.theme;
        stored = v;
      }
    });
  }, opts);
  if (opts.clearStorage !== false) {
    // Доступ к localStorage сам бросает в кадре с запрещёнными куками — под try.
    await page.addInitScript(() => {
      try { window.localStorage.clear(); } catch (e) { /* хранилища нет — и не надо */ }
    });
  }
  await page.addInitScript(botsSource);
  if (opts.content) {
    for (const [kind, body] of Object.entries(opts.content)) {
      await page.route(`**/content/${kind}.json`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
    }
  }
  await page.goto(`${server.url}/tests/e2e/host.html?seed=${encodeURIComponent(opts.seed || 1)}`);
  const handle = await page.waitForSelector("#game");
  const frame = await handle.contentFrame();
  await frame.waitForSelector("canvas", { timeout: 15000 });
  await waitForEvent(page, "ready", 15000, 0);

  const canvas = frame.locator("canvas");
  const api = {
    page, frame, errors, context,
    events: () => page.evaluate(() => window.__events),
    // Отметка в журнале событий: ждать надо события ПОСЛЕ неё, иначе гонка —
    // событие, пришедшее синхронно из обработчика тапа, уже лежит в журнале.
    mark: () => page.evaluate(() => window.__events.length),
    // Клик по координатам канвы 360×640 — настоящая мышь, проверяет тач-цели.
    tap: (x, y) => canvas.click({ position: { x, y } }),
    // Выполнить действие и дождаться события, порождённого им.
    expect: async (type, action, timeout) => {
      const since = await api.mark();
      await action();
      return waitForEvent(page, type, timeout || 5000, since);
    },
    play: () => api.expect("start", () => api.tap(180, 380), 5000),
    scene: (fn, arg) => frame.evaluate(fn, arg),
    bot: (kind, mode, o) => frame.evaluate(([k, m, x]) => window.__zvBot.start(k, m, x), [kind, mode, o || {}]),
    botReport: () => frame.evaluate(() => window.__zvBot.report()),
    waitFinish: (since, timeout) => waitForEvent(page, "finish", timeout || 60000, since),
    close: () => context.close()
  };
  return api;
}

// Ждём событие данного типа с индекса since в журнале хоста.
async function waitForEvent(page, type, timeout, since) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ev = await page.evaluate(([n, t]) => window.__events.slice(n).find((e) => e.type === t) || null, [since || 0, type]);
    if (ev) return ev;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`событие «${type}» не пришло за ${timeout} мс`);
}

async function launchBrowser() {
  const { chromium } = require("playwright");
  return chromium.launch({ headless: true });
}

module.exports = { startServer, openGame, waitForEvent, launchBrowser };
