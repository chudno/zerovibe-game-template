// Контракт картинок на НАСТОЯЩИХ фикстурах из платформы (tests/fixtures,
// манифест рядом): лист героя делится на кадры, у кадров прозрачные поля, ноги
// на одной высоте, предметы без хромакея. Те же числа читает game/layout.test.js.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { decodePNG, opaqueBounds } = require("./png.js");

const dir = path.join(__dirname, "fixtures");
const M = require("./fixtures/manifest.json");
const png = (name) => decodePNG(fs.readFileSync(path.join(dir, name)));

test("лист героя: размеры по манифесту, делится на кадры, кадры не пустые и с полями", () => {
  const h = M.hero;
  const img = png(h.file);
  assert.equal(img.width, h.width); assert.equal(img.height, h.height);
  assert.equal(h.width % h.frame_width, 0); assert.equal(h.height % h.frame_height, 0);
  const cols = h.width / h.frame_width, rows = h.height / h.frame_height;
  assert.deepEqual([cols, rows, cols * rows], [h.cols, h.rows, h.frames]);
  const bottoms = [];
  for (let i = 0; i < h.frames; i++) {
    const x0 = (i % cols) * h.frame_width, y0 = Math.floor(i / cols) * h.frame_height;
    const ob = opaqueBounds(img, x0, y0, h.frame_width, h.frame_height);
    assert.ok(ob, `кадр ${i} пустой`);
    assert.ok(ob.w < h.frame_width || ob.h < h.frame_height, `кадр ${i} без прозрачных полей`);
    assert.ok(ob.h >= h.frame_height / 2, `кадр ${i}: фигура ниже половины кадра — лист нарезан неверно`);
    bottoms.push(ob.y + ob.h - y0);
  }
  // Низ фигуры (ноги) на одной высоте ±4 px — иначе герой дёргается по кадрам.
  assert.ok(Math.max(...bottoms) - Math.min(...bottoms) <= 4, `низ фигуры гуляет: ${bottoms}`);
});

test("предметы: размеры по манифесту, хромакей снят, фигура не пустая", () => {
  for (const it of M.items) {
    const img = png(it.file);
    assert.equal(img.width, it.width, it.file); assert.equal(img.height, it.height, it.file);
    let transparent = 0;
    for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] === 0) transparent++;
    assert.ok(transparent > 0, `${it.file}: нет прозрачных пикселей — хромакей не снят`);
    const ob = opaqueBounds(img, 0, 0, img.width, img.height);
    assert.ok(ob && ob.w >= img.width / 3 && ob.h >= img.height / 3, `${it.file}: фигура слишком мала`);
  }
});

test("канва манифеста — та, что в shell.js", () => {
  const shell = fs.readFileSync(path.join(__dirname, "..", "game", "shell.js"), "utf8");
  assert.equal(M.canvas.width, 360); assert.equal(M.canvas.height, 640);
  assert.match(shell, /WIDTH = 360/); assert.match(shell, /HEIGHT = 640/);
});
