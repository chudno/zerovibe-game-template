// Сид даёт одну и ту же партию; распределения ровные; взвешенный выбор
// сходится к весам — на нём держится честность приза (вес сектора =
// вероятность выигрыша в акции бренда).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./random.js");

test("один сид — одна последовательность, разные сиды — разные", () => {
  const a = R.create(42), b = R.create(42), c = R.create(43);
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test("строковый сид детерминирован и чувствителен к регистру; числовая строка = число", () => {
  assert.equal(R.normalizeSeed("курьер"), R.normalizeSeed("курьер"));
  assert.notEqual(R.normalizeSeed("курьер"), R.normalizeSeed("Курьер"));
  assert.equal(R.normalizeSeed("42"), 42);
  assert.equal(R.create("42").seed, R.create(42).seed);
});

test("пустой сид — случайный, но целый 32-битный", () => {
  const s = R.normalizeSeed(undefined);
  assert.ok(Number.isInteger(s) && s >= 0 && s < 4294967296);
  assert.notEqual(R.normalizeSeed(), R.normalizeSeed());
});

test("сид из адреса: ?seed=42, ?a=1&seed=курьер, пусто", () => {
  assert.equal(R.seedFromSearch("?seed=42"), "42");
  assert.equal(R.seedFromSearch("?embed=1&seed=%D0%BA%D1%83%D1%80%D1%8C%D0%B5%D1%80"), "курьер");
  assert.equal(R.seedFromSearch("?embed=1"), undefined);
  assert.equal(R.seedFromSearch("?seed="), undefined);
  assert.equal(R.seedFromSearch(""), undefined);
});

test("between — целые в границах включительно, каждое значение выпадает", () => {
  const rng = R.create(7);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = rng.between(3, 7);
    assert.ok(Number.isInteger(v) && v >= 3 && v <= 7, String(v));
    seen.add(v);
  }
  assert.equal(seen.size, 5);
});

test("chance(0.3) на 20 000 бросков даёт 0.3 ± 0.02", () => {
  const rng = R.create(11);
  let hits = 0;
  for (let i = 0; i < 20000; i++) if (rng.chance(0.3)) hits++;
  assert.ok(Math.abs(hits / 20000 - 0.3) < 0.02, String(hits / 20000));
});

test("shuffle — перестановка того же массива, при одном сиде одинаковая", () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = R.create(5).shuffle(src.slice()), b = R.create(5).shuffle(src.slice());
  assert.deepEqual(a, b);
  assert.deepEqual(a.slice().sort((x, y) => x - y), src);
  assert.notDeepEqual(R.create(6).shuffle(src.slice()), a);
});

test("weighted сходится к весам на 10 000 прогонов; нулевой вес не выпадает никогда", () => {
  const items = [
    { id: "a", weight: 1 }, { id: "b", weight: 3 }, { id: "c", weight: 0 }, { id: "d", weight: 6 }
  ];
  const rng = R.create(2024);
  const n = { a: 0, b: 0, c: 0, d: 0 };
  for (let i = 0; i < 10000; i++) n[rng.weighted(items).id]++;
  assert.equal(n.c, 0);
  assert.ok(Math.abs(n.a / 10000 - 0.1) < 0.015, `a=${n.a}`);
  assert.ok(Math.abs(n.b / 10000 - 0.3) < 0.02, `b=${n.b}`);
  assert.ok(Math.abs(n.d / 10000 - 0.6) < 0.02, `d=${n.d}`);
});

test("weighted: свой weightOf, все веса нулевые → undefined, пустой список → undefined", () => {
  const rng = R.create(1);
  assert.equal(rng.weighted([{ w: 0 }, { w: 0 }], (it) => it.w), undefined);
  assert.equal(rng.weighted([]), undefined);
  assert.deepEqual(rng.weighted([{ w: 0 }, { w: 5 }], (it) => it.w), { w: 5 });
  assert.equal(rng.pick([]), undefined);
});
