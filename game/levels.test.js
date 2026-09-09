// Уровни платформера: разбор карты, физика числами, солвер проходимости и
// исполнение его плана в симуляторе. Сверка того же плана с настоящим движком
// — tests/e2e (бот ведёт героя тем же follower'ом).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("./levels.js");
const gen = require("../tests/levelgen.js");

const flat = (exitCol, cols) => {
  cols = cols || 16;
  const row = ".".repeat(cols).split("");
  row[1] = "S"; row[exitCol || cols - 2] = "X";
  return ["." .repeat(cols), ".".repeat(cols), ".".repeat(cols), row.join(""), "#".repeat(cols)];
};

test("parse: форма карты — прямоугольник, легенда, один старт, есть выход", () => {
  assert.deepEqual(L.parse(flat()).errors, []);
  assert.ok(L.parse(["S...X", "#####"]).errors[0].includes("строк"));
  assert.ok(L.parse([".........", "S..X....", "#########", "#########"]).errors[0].includes("длиной"));
  assert.ok(L.parse([".........", "S..X..?..", "#########", "#########"]).errors[0].includes("«?»"));
  assert.ok(L.parse([".........", "S..X..S..", "#########", "#########"]).errors[0].includes("ровно один старт"));
  assert.ok(L.parse([".........", "S........", "#########", "#########"]).errors[0].includes("нет выхода"));
  const p = L.parse(flat()).level;
  assert.deepEqual(p.start, { c: 1, r: 3 });
  assert.equal(p.exits.length, 1);
  // Грани: у крайних тайлов пола открыт верх и торцы, у средних — только верх.
  assert.equal(p.faces[0 + 4 * p.w] & 4, 4);
  assert.equal(p.faces[0 + 4 * p.w] & 1, 1);
  assert.equal(p.faces[5 + 4 * p.w], 4 | 8);
});

test("reach: прыжок ≈ 3,4 клетки вверх и ≈ 3,7 в длину при дефолтной физике", () => {
  const r = L.reach();
  assert.ok(r.heightTiles > 3.2 && r.heightTiles < 3.6, JSON.stringify(r));
  assert.ok(r.distanceTiles > 3.5 && r.distanceTiles < 4, JSON.stringify(r));
  assert.ok(r.flightTicks > 36 && r.flightTicks < 48);
});

test("solve: ровный пол — план «дойти»; яма 4 проходима, 5 — нет; ступень 3 — да, 4 — нет", () => {
  const solve = (map) => L.solve(L.parse(map).level);
  const r0 = solve(flat());
  assert.equal(r0.ok, true);
  assert.deepEqual(r0.plan.map((s) => s.kind), ["walk"]);
  const pit = (w) => ["................", "................", "................", "S.............X.", "#####" + ".".repeat(w) + "#".repeat(11 - w)];
  assert.equal(solve(pit(4)).ok, true);
  assert.equal(solve(pit(4)).plan[0].kind, "jump");
  assert.equal(solve(pit(5)).ok, false);
  assert.equal(solve(pit(5)).reason, "выход недостижим");
  const step = (h) => {
    const rows = ["................"];
    for (let i = 0; i < 6; i++) rows.push("................");
    rows.push("################");
    for (let y = 1; y <= h; y++) rows[rows.length - 1 - y] = "..........###...";
    rows[rows.length - 2 - h] = "..........X.....";
    rows[rows.length - 2] = "S" + rows[rows.length - 2].slice(1);
    return rows;
  };
  assert.equal(solve(step(3)).ok, true);
  assert.equal(solve(step(4)).ok, false);
});

test("solve: монеты — над полом достижимы, замурованные нет; старт над пропастью — ошибка", () => {
  const v = L.validateLevel(["................", "....o...........", "................", "S.....^.......X.", "################"]);
  assert.deepEqual(v.errors, []);
  const boxed = L.validateLevel(["................", "......###.......", "......#o#.......", "S.....###.....X.", "################"]);
  assert.equal(boxed.errors.length, 1);
  assert.ok(boxed.errors[0].includes("монета в столбце 7, строке 2 недостижима"), boxed.errors[0]);
  const air = L.validateLevel(["................", "................", "................", "S.............X.", "..##############"]);
  assert.ok(air.errors[0].includes("старт над пропастью"), air.errors[0]);
});

test("solve: план исполняется симулятором — герой доходит до выхода (content и сгенерированные уровни)", () => {
  const data = require("../content/levels.json");
  for (const lv of data.levels) {
    const v = L.validateLevel(lv.map);
    assert.deepEqual(v.errors, [], lv.name);
    const rp = L.replay(v.level, null, v.solved.plan);
    assert.equal(rp.end, "exit", lv.name + ": " + JSON.stringify(rp));
  }
  const s = gen.suite(10, 1);
  assert.equal(s.solvable.length, 10, "из первых сидов набирается 10 проходимых уровней");
  for (const it of s.solvable) {
    const level = L.parse(it.level.map).level;
    const rp = L.replay(level, null, it.plan);
    assert.equal(rp.end, "exit", "сид " + it.seed + ": " + JSON.stringify({ end: rp.end, step: rp.step, plan: it.plan }));
    // Контракт плана: шаги jump/drop/walk с целым x внутри карты, направление ±1/0.
    for (const st of it.plan) {
      assert.ok(["jump", "drop", "walk"].includes(st.kind));
      assert.ok(Number.isInteger(st.x) && st.x >= 0 && st.x + L.HERO.w <= level.W);
      if (st.kind !== "walk") assert.ok([-1, 0, 1].includes(st.dir));
    }
  }
  // Детерминизм: тот же уровень — тот же план.
  const a = L.solve(L.parse(s.solvable[0].level.map).level);
  const b = L.solve(L.parse(s.solvable[0].level.map).level);
  assert.deepEqual(a.plan, b.plan);
});

test("solve: непроходимые конструкции распознаются", () => {
  for (const kind of gen.kinds) {
    const lv = gen.impossible(kind);
    const p = L.parse(lv.map);
    assert.deepEqual(p.errors, [], kind);
    const r = L.solve(p.level);
    assert.equal(r.ok, false, kind + " должен быть непроходим");
  }
});

test("solve: запас взлёта — с нулевым slack достижимо не меньше интервалов, чем с шестью", () => {
  const level = L.parse(gen.generate(3).map).level;
  const strict = L.solve(level, null, { slack: 6 });
  const loose = L.solve(level, null, { slack: 0 });
  assert.ok(loose.intervals >= strict.intervals);
});

test("follower: идёт к x, прыгает по прибытии, после приземления берёт следующий шаг", () => {
  const f = L.follower([{ kind: "jump", x: 100, dir: 1 }, { kind: "walk", x: 200 }]);
  assert.deepEqual(f.decide({ x: 10, y: 0, vx: 0, down: true }), { dir: 1, jump: false });
  assert.deepEqual(f.decide({ x: 97, y: 0, vx: 170, down: true }), { dir: 1, jump: true });   // через тик будет 99.8
  assert.deepEqual(f.decide({ x: 100, y: 0, vx: 170, down: true }), { dir: 1, jump: false }); // ждём отрыва
  assert.deepEqual(f.decide({ x: 110, y: -30, vx: 170, down: false }), { dir: 1, jump: false });
  assert.deepEqual(f.decide({ x: 180, y: 0, vx: 170, down: true }), { dir: 1, jump: false });  // приземлились → идём к 200
  assert.equal(f.step(), 1);
  assert.deepEqual(f.decide({ x: 199, y: 0, vx: 170, down: true }), { dir: 0, jump: false });
  assert.equal(f.done, true);
});
