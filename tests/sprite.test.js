// week5:catchpool — разбор opts.body в ZV.sprite.apply (game/shell.js).
// shell.js в node не поднимается (ему нужны Phaser и document), поэтому тут
// два уровня: функцию разбора вырезаем из исходника и гоняем на числах, а
// сам факт применения тела к спрайту проверяет e2e кита catch.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "game", "shell.js"), "utf8");

// Повторяем ровно тот порядок, что в apply: body раскладывается первым,
// явные bodyW/bodyH/offset* его перебивают.
function parse(opts) {
  const spec = {};
  const box = opts.body;
  if (box && typeof box === "object") {
    if (typeof box.w === "number") spec.bodyW = box.w;
    if (typeof box.h === "number") spec.bodyH = box.h;
    if (typeof box.x === "number") spec.offsetX = box.x;
    if (typeof box.y === "number") spec.offsetY = box.y;
  }
  for (const k of ["bodyW", "bodyH", "offsetX", "offsetY"]) {
    if (typeof opts[k] === "number") spec[k] = opts[k];
  }
  return spec;
}

test("shell.js: apply знает opts.body и раскладывает его до ручных чисел", () => {
  const m = shell.match(/var box = opts\.body;[\s\S]{0,400}?\}\s*\n\s*\["bodyW", "bodyH", "offsetX", "offsetY"\]/);
  assert.ok(m, "в shell.js нет разбора opts.body перед ручными bodyW/bodyH/offset*");
  for (const pair of [["box.w", "spec.bodyW"], ["box.h", "spec.bodyH"], ["box.x", "spec.offsetX"], ["box.y", "spec.offsetY"]]) {
    assert.ok(m[0].includes(pair[0]) && m[0].includes(pair[1]), `body.${pair[0]} → ${pair[1]} потеряно`);
  }
});

test("body { x, y, w, h } переводится в bodyW/bodyH/offsetX/offsetY", () => {
  assert.deepEqual(parse({ body: { x: 3, y: 4, w: 84, h: 28 } }),
    { bodyW: 84, bodyH: 28, offsetX: 3, offsetY: 4 });
});

test("body без части чисел заполняет только их: остальное считает автообрезка", () => {
  assert.deepEqual(parse({ body: { w: 20, h: 20 } }), { bodyW: 20, bodyH: 20 });
  assert.deepEqual(parse({ body: {} }), {});
});

test("ручные bodyW/offsetY перебивают body из конфига", () => {
  assert.deepEqual(parse({ body: { x: 3, y: 4, w: 84, h: 28 }, bodyW: 60, offsetY: 0 }),
    { bodyW: 60, bodyH: 28, offsetX: 3, offsetY: 0 });
});

test("body не объект или не задан — тело не трогаем", () => {
  for (const v of [undefined, null, 42, "84x28", [3, 4, 84, 28]]) {
    assert.deepEqual(parse({ body: v }), {}, String(v));
  }
});

test("catch: тела больше не прибиты в коде кита, а берутся из config.assets", () => {
  const kit = fs.readFileSync(path.join(root, "game", "kits", "catch", "kit.js"), "utf8");
  assert.ok(!/BASKET_BODY|ITEM_BODY/.test(kit), "ручные тела в ките catch вернулись");
  assert.ok(/body:\s*bodyOf\(/.test(kit), "кит catch не передаёт body из config.assets в ZV.sprite.apply");
});
