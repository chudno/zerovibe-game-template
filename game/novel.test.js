// Граф новеллы: форма, обход по состояниям (достижимость, концовки, условные
// варианты, ловушки), рантайм и пути до концовок. content/novel.json обязан
// проходить целиком (см. content.test.js — там же длины текстов).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("./novel.js");

const base = () => ({
  start: "a",
  vars: { key: false, n: 0 },
  nodes: {
    a: { text: "А", choices: [{ text: "к b", goto: "b", set: { key: true } }, { text: "к c", goto: "c", add: { n: 1 } }] },
    b: { text: "Б", goto: "c" },
    c: { text: "В", choices: [{ text: "конец 1", goto: "e1" }, { text: "конец 2", goto: "e2", if: { key: true } }] },
    e1: { text: "Конец", end: { outcome: "one", won: true } },
    e2: { text: "Конец", end: { outcome: "two", won: false } }
  }
});

test("форма: start, узлы, ровно один выход, переменные объявлены, типы условий", () => {
  assert.deepEqual(N.check(base()), []);
  let d = base(); d.start = "zzz";
  assert.ok(N.check(d).some((e) => e.includes("start")));
  d = base(); d.nodes.b.choices = [{ text: "x", goto: "c" }, { text: "y", goto: "c" }];
  assert.ok(N.check(d).some((e) => e.includes("ровно одно")));
  d = base(); d.nodes.b.goto = "nope";
  assert.ok(N.check(d).some((e) => e.includes("«nope» нет")));
  d = base(); d.nodes.a.choices[0].set = { zzz: 1 };
  assert.ok(N.check(d).some((e) => e.includes("не объявлена")));
  d = base(); d.nodes.a.choices[0].set = { key: 1 };
  assert.ok(N.check(d).some((e) => e.includes("ожидается boolean")));
  d = base(); d.nodes.c.choices[1].if = { key: 5 };
  assert.ok(N.check(d).some((e) => e.includes("булево")));
  d = base(); d.nodes.c.choices = [{ text: "один", goto: "e1" }];
  assert.ok(N.check(d).some((e) => e.includes("от 2 до 4")));
  d = base(); d.chapters = ["a", "zzz"];
  assert.ok(N.check(d).some((e) => e.includes("chapters[1]")));
});

test("граф: недостижимый узел, меньше двух концовок, ловушка, условие никогда не выполняется", () => {
  let d = base(); d.nodes.orphan = { text: "О", goto: "c" };
  assert.ok(N.check(d).some((e) => e.includes("orphan: недостижим")));
  d = base(); d.nodes.e2.end.outcome = "one";
  assert.ok(N.check(d).some((e) => e.includes("концовок меньше двух")));
  d = base(); d.nodes.b.goto = "loop"; d.nodes.loop = { text: "Л", goto: "b" };
  const errs = N.check(d);
  assert.ok(errs.some((e) => e.includes("ловушка")), errs.join("; "));
  d = base(); d.nodes.a.choices[0].set = {}; d.nodes.a.choices[1].set = {};
  assert.ok(N.check(d).some((e) => e.includes("никогда не выполняется")));
  // Условие «число не меньше»: n ≥ 1 выполнимо после add.
  d = base(); d.nodes.c.choices[1].if = { n: 1 };
  assert.deepEqual(N.check(d), []);
  d.nodes.c.choices[1].if = { n: { gte: 2 } };
  assert.ok(N.check(d).some((e) => e.includes("никогда")));
});

test("рантайм: эффекты, видимые варианты, линейные узлы, концовка, снимок", () => {
  const rt = N.create(base());
  assert.equal(rt.id(), "a");
  assert.equal(rt.choices().length, 2);
  assert.ok(rt.choose(1));                 // → c, n = 1
  assert.equal(rt.id(), "c");
  assert.equal(rt.vars.n, 1);
  assert.equal(rt.choices().length, 1, "вариант с if key скрыт");
  const snap = rt.state();
  assert.ok(rt.choose(0));
  assert.equal(rt.ended().outcome, "one");
  assert.equal(rt.choose(0), false);
  const rt2 = N.create(base());
  rt2.load(snap);
  assert.equal(rt2.id(), "c");
  assert.equal(rt2.vars.n, 1);
  const rt3 = N.create(base());
  rt3.choose(0);                            // → b, key = true
  assert.equal(rt3.linear(), true);
  assert.ok(rt3.next());
  assert.equal(rt3.choices().length, 2);
  rt3.choose(1);
  assert.equal(rt3.ended().outcome, "two");
  assert.deepEqual(rt3.history, ["a", "b", "c", "e2"]);
});

test("paths: до каждой концовки — индексы видимых вариантов, исполняются рантаймом", () => {
  for (const data of [base(), require("../content/novel.json")]) {
    const p = N.paths(data);
    assert.ok(Object.keys(p).length >= 2);
    for (const outcome of Object.keys(p)) {
      const rt = N.create(data);
      let steps = p[outcome].slice();
      for (let guard = 0; guard < 100 && !rt.ended(); guard++) {
        if (rt.linear()) { rt.next(); continue; }
        assert.ok(rt.choose(steps.shift()), outcome);
      }
      assert.equal(rt.ended().outcome, outcome);
      assert.equal(steps.length, 0);
    }
  }
});

test("content/novel.json: граф целиком, три главы и условная реплика", () => {
  const data = require("../content/novel.json");
  assert.deepEqual(N.check(data), []);
  const ex = N.explore(data);
  assert.deepEqual(Object.keys(ex.endings).sort(), ["delivered", "friend", "late"]);
  assert.equal(data.chapters.length, 3);
});
