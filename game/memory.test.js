// Раздача «памяти»: чётность на многих сидах (нечётной раскладки не бывает),
// повторяемость по сиду и то, что поле физически влезает в сетку тач-целей.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("./memory.js");
const GRID = require("./grid.js");
const RANDOM = require("./random.js");

const CARDS = ["box", "stamp", "letter", "parcel", "key", "phone", "map", "badge", "cup", "book", "pen", "clock"]
  .map((id, i) => ({ id, title: "К" + i }));

test("2·pairs значений, каждое ровно дважды — на 200 сидах", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const pairs = 2 + (seed % 11);
    const r = M.deal({ pairs }, CARDS, RANDOM.create(seed));
    assert.equal(r.values.length, pairs * 2, "сид " + seed);
    const count = {};
    for (const v of r.values) count[v] = (count[v] || 0) + 1;
    assert.equal(Object.keys(count).length, pairs, "видов на поле должно быть ровно pairs, сид " + seed);
    for (const [id, n] of Object.entries(count)) {
      assert.equal(n, 2, `значение ${id} встречается ${n} раз, сид ${seed}`);
      assert.ok(CARDS.some((c) => c.id === id), "значение не из словаря: " + id);
    }
  }
});

test("один сид — одна раскладка, разные сиды обычно расходятся", () => {
  const a = M.deal({ pairs: 6 }, CARDS, RANDOM.create(11));
  const b = M.deal({ pairs: 6 }, CARDS, RANDOM.create(11));
  assert.deepEqual(a.values, b.values);
  assert.deepEqual(a.order, b.order);
  let same = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const r = M.deal({ pairs: 6 }, CARDS, RANDOM.create(seed));
    if (r.values.join(",") === a.values.join(",")) same++;
  }
  assert.ok(same <= 2, "раскладки не зависят от сида: совпадений " + same);
});

test("видов меньше, чем пар — раздача усекается, а не даёт undefined", () => {
  const r = M.deal({ pairs: 8 }, CARDS.slice(0, 3), RANDOM.create(1));
  assert.equal(r.pairs, 3);
  assert.equal(r.values.length, 6);
  assert.ok(r.values.every((v) => typeof v === "string"));
  // Мусор вместо данных не роняет модуль: пустое поле, а не исключение.
  assert.deepEqual(M.deal(null, null, RANDOM.create(1)).values, []);
});

test("минимум ходов — 2·pairs (первая встреча вида может быть промахом)", () => {
  assert.equal(M.minMoves(6), 12);
  assert.equal(M.minMoves(8), 16);
  assert.equal(M.minMoves(0), 0);
});

test("поле влезает в сетку: до 12 пар при тач-цели 24 px, тесное поле — отказ числом", () => {
  const area = { x: 12, y: 150, w: 336, h: 400 };
  for (const pairs of [2, 4, 6, 8, 12]) {
    const lay = GRID.best(pairs * 2, area, { min: { w: 24, h: 24 }, gap: 8, aspect: 1, maxCols: 5 });
    assert.ok(lay.fits, `${pairs} пар не влезают: ${lay.reason}`);
    assert.equal(lay.cells.length, pairs * 2);
    assert.ok(lay.cell.w >= 24 && lay.cell.h >= 24, JSON.stringify(lay.cell));
    // Центры целые — иначе спрайт мылит, а палец промахивается мимо ячейки.
    for (const c of lay.cells) assert.ok(Number.isInteger(c.cx) && Number.isInteger(c.cy), JSON.stringify(c));
  }
  // Урезанное поле (крупный HUD и подсказка) 12 пар уже не держит — и говорит,
  // сколько ячеек влезет: валидатор пересказывает это автору числом.
  const tight = GRID.best(24, { x: 12, y: 150, w: 336, h: 150 }, { min: { w: 24, h: 24 }, gap: 8, aspect: 1, maxCols: 5 });
  assert.equal(tight.fits, false);
  assert.ok(/не больше \d+ ячеек/.test(tight.reason), tight.reason);
});
