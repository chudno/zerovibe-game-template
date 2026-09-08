// Инварианты раннера на дефолтах кита: у игрока есть ≥250 мс на реакцию на
// ЛЮБОЙ скорости, окно прыжка не уже 150 мс, а пауза спавна не короче полёта
// с запасом 1.35 — иначе два препятствия подряд непроходимы. На прежнем
// spawnMin 700 последний инвариант падал (700 < 1.35 × 654).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const B = require("./balance.js");

// Дефолты берём из самого кита, чтобы тест не разъехался с кодом.
function runnerDefaults() {
  const src = fs.readFileSync(path.join(__dirname, "kits", "runner", "kit.js"), "utf8");
  const window = { ZV_KITS: {} };
  vm.runInContext(src, vm.createContext({ window, Phaser: { Scene: function () {} } }));
  return window.ZV_KITS.runner.defaults;
}
const BLOCKS = [{ w: 32, h: 32 }, { w: 32, h: 60 }];

test("полёт при дефолтах ≈ 0,65 с, окно над низким блоком на старте ≈ 0,25 с", () => {
  const p = runnerDefaults();
  assert.ok(Math.abs(B.flight(p) - 0.654) < 0.01);
  const win = B.jumpWindow(p, p.speedStart, 32, 32);
  assert.ok(win && win.ms > 200 && win.ms < 320, JSON.stringify(win));
  assert.equal(B.jumpWindow({ jump: 100, gravity: 2600 }, 200, 32, 60), null, "низкий прыжок не перелетает высокий блок");
});

test("дефолты кита: реакция ≥ 250 мс на всём диапазоне, spawnMin ≥ 1.35 полёта", () => {
  const p = runnerDefaults();
  const r = B.runnerReport(p, BLOCKS);
  assert.ok(r.worstReactionMs >= 250, `реакция ${r.worstReactionMs.toFixed(0)} мс на скорости ${r.worstReactionAtSpeed} — снизь speedMax или подними jump`);
  assert.ok(r.spawnMargin >= 1.35, `spawnMin/полёт = ${r.spawnMargin.toFixed(2)} — пары препятствий непроходимы`);
  assert.ok(r.narrowestWindowMs >= 150, `самое узкое окно ${r.narrowestWindowMs.toFixed(0)} мс`);
});

test("прежний spawnMin 700 инвариант не проходит — тест его и ловит; слабый прыжок — тоже", () => {
  const p = Object.assign({}, runnerDefaults(), { spawnMin: 700 });
  assert.ok(B.runnerReport(p, BLOCKS).spawnMargin < 1.35);
  const weak = Object.assign({}, runnerDefaults(), { jump: 600 });
  assert.equal(B.runnerReport(weak, BLOCKS).narrowestWindowMs, 0, "прыжок 600 не перелетает блок 60");
});
