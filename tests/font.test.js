// Пиксельный шрифт: game/fontdata.js совпадает с растром из TTF (генератор
// tests/fontgen.js), покрывает русский алфавит и знаки, метрики game/font.js
// считают ширины и переносы так, как их сделает BitmapText.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generate, render, OUT } = require("./fontgen.js");
const { parseTTF } = require("./ttf.js");
const F = require("../game/font.js");
const D = require("../game/fontdata.js");

test("game/fontdata.js сгенерирован из текущего TTF (node tests/fontgen.js)", () => {
  assert.equal(fs.readFileSync(OUT, "utf8"), render(generate()), "fontdata устарел — запусти node tests/fontgen.js");
});

test("шрифт: сетка 10 px на капитель, строка 16, все глифы прямоугольные и без кривых", () => {
  assert.equal(D.unit, 10);
  assert.equal(D.line, 16);
  const ttf = parseTTF(fs.readFileSync(path.join(__dirname, "fixtures", "fonts", "pixelcyr_normal.ttf")));
  assert.equal(ttf.unitsPerEm, 1000);
  assert.ok(ttf.names.some((n) => n.nameID === 1 && n.text === "Pixel Cyr"));
  for (const [ch, g] of Object.entries(D.glyphs)) {
    assert.ok(g[0] > 0 && g[0] % 2 === 0, `${ch}: ширина ${g[0]} нечётная — центрирование даст полпикселя`);
    if (g.length > 1) {
      assert.ok(g[3] <= g[0], `${ch}: глиф шире своего advance`);
      assert.equal(g[5].split("|").length, g[4], `${ch}: строк не столько, сколько высота`);
    }
  }
});

test("покрытие: русский алфавит с Ёё, латиница, цифры, кавычки и тире", () => {
  const need = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя"
    + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !?%:;,.-+=/()«»—–";
  assert.deepEqual(F.missing(need), []);
  assert.deepEqual(F.missing("Цена… 100 ₽ №1"), [], "замены для …, ₽, №");
  assert.deepEqual(F.missing("снег ☃"), ["☃"]);
  assert.equal(F.sanitize("Доставка 0 ₽…"), "Доставка 0 р....");
});

test("ширины: буквы по 8, узкие 4/6, широкие 10–14; кегль масштабирует", () => {
  assert.equal(F.width("А", 1), 8);
  assert.equal(F.width("Щ", 1), 14);
  assert.equal(F.width("1", 1), 6);
  assert.equal(F.width("!", 1), 4);
  assert.equal(F.width("Скидка", 1), 54);
  assert.equal(F.width("Скидка", 2), 108);
});

test("перенос по словам как у BitmapText; fit подбирает кегль, 0 — не влезает", () => {
  assert.deepEqual(F.wrap("Скидка 10% на доставку", 100, 1), ["Скидка 10%", "на доставку"]);
  assert.deepEqual(F.wrap("Одно\nДва три", 1000, 1), ["Одно", "Два три"]);
  assert.equal(F.fit("Играть", 208, 1, 2), 2);
  assert.equal(F.fit("Скопировать код", 200, 1, 2), 1, "15 знаков по 16 px не лезут в 200 — кегль 1");
  assert.equal(F.fit("Двенадцатьбукв", 76, 2, 1), 0);
  assert.equal(F.height(3, 2, 6), 3 * 16 * 2 + 12);
});
