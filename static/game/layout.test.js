// Тесты геометрии китов на размерах НАСТОЯЩИХ сгенерированных картинок
// (Retro Diffusion через платформу, проект-образец «курьер»), а не заглушек:
// именно на них три дефекта кита прошли мимо старых проверок.
//   герой:  лист бега 4×2 кадра по 96×96 → 384×192, прозрачные поля;
//   предмет: 32×32 (S) и 64×64 (L), прозрачный фон;
//   фон:    нативно 180×320, платформа увеличивает ×2 → 360×640 (канва 1:1);
//           у старого поставщика приходило 720×1280 — ровно ×2 крупнее канвы.
// Запуск: node --test static/game   (или go test ./... — обёртка в js_test.go)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("./layout.js");
// Размеры настоящих картинок — из манифеста фикстур (те же файлы проверяет
// assets_test.go на Go): числа в двух тестах не разъезжаются.
const M = require("../../internal/static/testdata/assets/manifest.json");

const W = M.canvas.width, H = M.canvas.height;

test("фон 360×640 (нативный ×2 от платформы) ложится 1:1", () => {
  assert.deepEqual(L.fitBackground(360, 640, W, H, false),
    { mode: "upscale", scale: 1, width: 360, height: 640 });
});

test("фон 720×1280 — ровно вдвое крупнее: scale 1/2, а не центральный кусок", () => {
  const fit = L.fitBackground(720, 1280, W, H, false);
  assert.equal(fit.mode, "divisor");
  assert.equal(fit.scale, 0.5);
  assert.equal(fit.width, W);
  assert.equal(fit.height, H);
});

test("фон 1080×1920 — втрое крупнее: scale 1/3", () => {
  const fit = L.fitBackground(1080, 1920, W, H, false);
  assert.equal(fit.mode, "divisor");
  assert.ok(Math.abs(fit.scale - 1 / 3) < 1e-12);
});

test("фон 180×320 (нативный, без апскейла) — целый апскейл ×2", () => {
  assert.deepEqual(L.fitBackground(180, 320, W, H, false),
    { mode: "upscale", scale: 2, width: 360, height: 640 });
});

test("фон чужих пропорций — cover: канва закрыта целиком, лишнее за краем", () => {
  const fit = L.fitBackground(500, 900, W, H, false);
  assert.equal(fit.mode, "cover");
  assert.ok(fit.width >= W && fit.height >= H, "cover обязан закрыть канву");
  assert.ok(fit.width === W || fit.height === H, "одна сторона ровно по канве");
});

test("фон-тайл: только при сторонах-степенях двойки", () => {
  assert.equal(L.fitBackground(256, 256, W, H, true).mode, "tile");
  // 360×640 не POT — tile:true игнорируется, иначе WebGL размажет пиксели.
  assert.equal(L.fitBackground(360, 640, W, H, true).mode, "upscale");
});

test("фон без размеров (текстура не загрузилась) — null, кит рисует заглушку", () => {
  assert.equal(L.fitBackground(0, 0, W, H, false), null);
});

test("лист бега из фикстуры (384×192 по 96×96) — сетка 4×2, 8 кадров", () => {
  const h = M.hero;
  assert.deepEqual(L.sheetGrid(h.width, h.height, h.frame_width, h.frame_height),
    { cols: h.cols, rows: h.rows, frames: h.frames });
});

test("предметы из фикстур: целые пиксельные размеры, масштаб 1 — без подгонки", () => {
  for (const it of M.items) {
    assert.ok(Number.isInteger(it.width) && Number.isInteger(it.height));
    assert.ok(it.width <= W / 2 && it.height <= H / 2, `${it.file} не больше половины канвы`);
  }
});

test("лист, не делящийся на кадр, — null (числа в config не от этого листа)", () => {
  assert.equal(L.sheetGrid(384, 192, 100, 100), null);
  assert.equal(L.sheetGrid(0, 0, 96, 96), null);
});

test("кадров анимации не больше, чем в листе", () => {
  const grid = L.sheetGrid(384, 192, 96, 96);
  assert.equal(L.animFrames(8, grid), 8);
  assert.equal(L.animFrames(12, grid), 8, "config просит 12 — в листе только 8");
  assert.equal(L.animFrames(0, grid), 8, "не задано — весь лист");
  assert.equal(L.animFrames(0, null), 1, "без листа — один кадр, не ноль");
  assert.equal(L.animFrames(2, null), 2, "заглушка: два кадра как просили");
});

test("герой: на земле — бег, в полёте — прыжок (по флагу отрыва, не по blocked.down)", () => {
  assert.equal(L.runnerAnim(false), "run");
  assert.equal(L.runnerAnim(true), "jump");
});

test("хитбокс бегуна уже силуэта, но не меньше 8 и по центру", () => {
  // Непрозрачная область героя 96×96 после обрезки полей ≈ 40 px шириной.
  assert.deepEqual(L.narrowBody(40, 28), { width: 28, offsetX: 34 });
  assert.deepEqual(L.narrowBody(6, 0), { width: 8, offsetX: -1 });
});

test("isPOT", () => {
  for (const v of [1, 2, 64, 128, 256]) assert.equal(L.isPOT(v), true, String(v));
  for (const v of [0, 3, 96, 360, 640]) assert.equal(L.isPOT(v), false, String(v));
});
