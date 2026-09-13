// Канва стоит по центру окна любого размера: центрирует только CSS-флекс #game,
// Phaser — NO_CENTER. При CENTER_BOTH оба центрировали разом, и на широком
// экране канва уезжала вправо на половину свободного места (превью 13 сент).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, launchBrowser } = require("./lib.js");

let server, browser;
test.before(async () => { server = await startServer(); browser = await launchBrowser(); });
test.after(async () => { await browser.close(); await server.close(); });

for (const vp of [{ width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 360, height: 640 }]) {
  test(`канва по центру окна ${vp.width}×${vp.height}`, async () => {
    const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`${server.url}/?embed=1`);
      await page.waitForSelector("canvas", { timeout: 15000 });
      await page.waitForTimeout(500);   // Scale.FIT применяется после boot
      const r = await page.evaluate(() => {
        const b = document.querySelector("canvas").getBoundingClientRect();
        return { left: b.left, top: b.top, width: b.width, height: b.height, vw: innerWidth, vh: innerHeight };
      });
      const where = JSON.stringify(r);
      assert.ok(r.width <= r.vw + 1 && r.height <= r.vh + 1, `канва больше окна: ${where}`);
      assert.ok(Math.abs(r.left - (r.vw - r.width) / 2) <= 1, `канва не по центру по горизонтали: ${where}`);
      assert.ok(Math.abs(r.top - (r.vh - r.height) / 2) <= 1, `канва не по центру по вертикали: ${where}`);
      assert.deepEqual(errors, [], "ошибки страницы");
    } finally { await context.close(); }
  });
}
