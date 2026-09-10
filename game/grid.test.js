// Сетка тач-целей: раскладка целыми числами, попадание пальцем, пары для
// «памяти». Пары гоняются на 200 сидах — это машинная гарантия чётности,
// на которую опирается кит memory.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("./grid.js");
const R = require("./random.js");

const AREA = { x: 8, y: 96, w: 344, h: 424 };

test("layout: сколько просили, всё целое, ничего не пересекается и всё внутри области", () => {
  for (const count of [2, 3, 4, 6, 8, 12, 16, 20]) {
    const lay = G.layout({ count, area: AREA });
    assert.ok(lay.fits, `${count}: ${lay.reason}`);
    assert.equal(lay.cells.length, count);
    for (const c of lay.cells) {
      for (const k of ["x", "y", "w", "h", "cx", "cy"]) {
        assert.ok(Number.isInteger(c[k]), `${count}: ячейка ${c.i}.${k} дробная — ${c[k]}`);
      }
      assert.ok(c.x >= AREA.x && c.y >= AREA.y, `${count}: ячейка ${c.i} левее/выше области`);
      assert.ok(c.x + c.w <= AREA.x + AREA.w && c.y + c.h <= AREA.y + AREA.h, `${count}: ячейка ${c.i} вышла за область`);
    }
    // Непересечение: прямоугольники попарно.
    for (let i = 0; i < lay.cells.length; i++) {
      for (let j = i + 1; j < lay.cells.length; j++) {
        const a = lay.cells[i], b = lay.cells[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        assert.ok(apart, `${count}: ячейки ${i} и ${j} налезают друг на друга`);
      }
    }
  }
});

test("layout: ячейка не мельче тач-цели, иначе fits:false с числом в тексте", () => {
  const lay = G.layout({ count: 12, area: AREA });
  assert.ok(lay.cell.w >= G.LIMITS.minTouch && lay.cell.h >= G.LIMITS.minTouch);

  const tight = G.layout({ count: 20, area: { x: 8, y: 96, w: 336, h: 90 }, min: { w: 24, h: 24 } });
  assert.equal(tight.fits, false);
  assert.equal(tight.cells.length, 0);
  assert.ok(/не хватает места/.test(tight.reason), tight.reason);
  assert.ok(/возьми не больше \d+/.test(tight.reason), tight.reason);

  // Больше потолка ячеек — тоже отказ с числом.
  const many = G.layout({ count: G.LIMITS.maxCells + 1, area: AREA });
  assert.equal(many.fits, false);
  assert.ok(many.reason.includes(String(G.LIMITS.maxCells)), many.reason);
});

test("layout: maxCols держит потолок столбцов (широкие карточки нечитаемы)", () => {
  const lay = G.layout({ count: 12, area: AREA, maxCols: 3 });
  assert.ok(lay.cols <= 3, "столбцов " + lay.cols);
  assert.equal(lay.cells.length, 12);
});

test("hit: центр каждой ячейки попадает в неё, зазор и поля — промах", () => {
  const lay = G.layout({ count: 12, area: AREA, gap: 8 });
  for (const c of lay.cells) {
    assert.equal(G.hit(lay, c.cx, c.cy), c.i, `центр ячейки ${c.i}`);
    assert.equal(G.hit(lay, c.x, c.y), c.i, "левый верх — тоже ячейка");
  }
  const a = lay.cells[0];
  // Точка в зазоре справа от первой ячейки (зазор 8 — центр зазора).
  assert.equal(G.hit(lay, a.x + a.w + 4, a.cy), -1, "зазор — не ячейка");
  assert.equal(G.hit(lay, AREA.x - 5, AREA.y - 5), -1, "мимо области — не ячейка");
});

test("best: детерминирован, не зависит от rng и даёт наибольшую ячейку", () => {
  const one = G.best(12, AREA, {});
  const two = G.best(12, AREA, {});
  assert.deepEqual(one, two, "два вызова — разный ответ");
  assert.ok(one.fits);
  // Любая другая раскладка того же count не даёт ячейку больше.
  for (let cols = 1; cols <= G.LIMITS.maxCols; cols++) {
    const alt = G.layout({ count: 12, area: AREA, cols });
    if (!alt.fits) continue;
    assert.ok(alt.cell.w * alt.cell.h <= one.cell.w * one.cell.h, `cols=${cols} даёт ячейку больше`);
  }
});

test("pairs: длина 2n и каждое значение ровно дважды — на 200 сидах", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = R.create(seed);
    const n = 3 + (seed % 6);
    const list = G.pairs(n, rng);
    assert.equal(list.length, 2 * n, "сид " + seed);
    const count = {};
    for (const v of list) count[v] = (count[v] || 0) + 1;
    assert.equal(Object.keys(count).length, n, "сид " + seed + ": разных значений не n");
    for (const v of Object.keys(count)) assert.equal(count[v], 2, `сид ${seed}: значение ${v} встречается ${count[v]} раз`);
  }
});

test("pairs: один сид — одна перестановка, разные сиды в основном разные", () => {
  const a = G.pairs(6, R.create(42));
  const b = G.pairs(6, R.create(42));
  assert.deepEqual(a, b);
  let same = 0;
  for (let seed = 1; seed <= 50; seed++) {
    if (G.pairs(6, R.create(seed)).join(",") === a.join(",")) same++;
  }
  assert.ok(same <= 2, "перестановка почти не меняется от сида: совпадений " + same);
});

test("neighbours и at: соседи по сетке, за краем — ничего", () => {
  const lay = G.layout({ count: 9, area: AREA, cols: 3 });
  assert.equal(lay.cols, 3);
  assert.equal(G.at(lay, 1, 1), 4);
  assert.equal(G.at(lay, 3, 0), -1, "за правым краем");
  assert.equal(G.at(lay, -1, 0), -1);
  assert.deepEqual(G.neighbours(lay, 4, false).sort((x, y) => x - y), [1, 3, 5, 7]);
  assert.equal(G.neighbours(lay, 4, true).length, 8);
  assert.deepEqual(G.neighbours(lay, 0, false).sort((x, y) => x - y), [1, 3], "угол — два соседа");
  // Неполный последний ряд: соседа за концом списка нет.
  const short = G.layout({ count: 8, area: AREA, cols: 3 });
  assert.equal(G.at(short, 2, 2), -1, "девятой ячейки нет");
});
