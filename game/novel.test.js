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

// Предметы квеста: сахар над булевыми переменными — give/take/needs.
test("items: проверка ссылок и выдачи, инвентарь в рантайме, needs как условие", () => {
  const q = () => ({
    start: "a",
    items: { key: { title: "Ключ" } },
    nodes: {
      a: { text: "А", choices: [{ text: "взять", goto: "b", give: ["key"] }, { text: "мимо", goto: "b" }] },
      b: { text: "Б", choices: [{ text: "открыть", goto: "e1", needs: ["key"], take: ["key"] }, { text: "уйти", goto: "e2" }] },
      e1: { text: "К", end: { outcome: "open" } },
      e2: { text: "К", end: { outcome: "left" } }
    }
  });
  assert.deepEqual(N.check(q()), []);
  let d = q(); d.nodes.a.choices[0].give = ["zzz"];
  assert.ok(N.check(d).some((e) => e.includes("«zzz» нет в items")));
  d = q(); delete d.nodes.a.choices[0].give;
  assert.ok(N.check(d).some((e) => e.includes("нигде не выдаётся")));
  // Второй предмет выдаётся только в концовке, а нужен раньше — вариант не показать.
  d = q(); d.items.key2 = { title: "Второй" }; d.nodes.e1.give = ["key2"]; d.nodes.b.choices[0].needs = ["key", "key2"];
  const errs = N.check(d);
  assert.ok(errs.some((e) => e.includes("предмет для этого варианта нельзя получить раньше")), errs.join("; "));
  const rt = N.create(q());
  assert.deepEqual(rt.inventory(), []);
  assert.equal(rt.choices().length, 2);
  rt.choose(0);
  assert.deepEqual(rt.inventory(), ["key"]);
  assert.deepEqual(rt.lastChange, { gained: ["key"], lost: [] });
  assert.equal(rt.choices().length, 2, "с ключом вариант «открыть» виден");
  rt.choose(0);
  assert.deepEqual(rt.inventory(), []);
  assert.deepEqual(rt.lastChange.lost, ["key"]);
  assert.equal(rt.ended().outcome, "open");
  const rt2 = N.create(q()); rt2.choose(1);
  assert.equal(rt2.choices().length, 1, "без ключа вариант скрыт");
  assert.deepEqual(Object.keys(N.paths(q())).sort(), ["left", "open"]);
});

test("content/quest.json: граф с предметами целиком, три концовки, все предметы выдаются", () => {
  const data = require("../content/quest.json");
  assert.deepEqual(N.check(data), []);
  assert.deepEqual(Object.keys(N.paths(data)).sort(), ["delivered", "late", "unpaid"]);
  const C = require("./content.js");
  assert.deepEqual(C.validate("quest", data), []);
  assert.ok(C.validate("quest", { start: "a", nodes: {} })[0].includes("хотя бы один предмет"));
});

test("items: needs на узле — ошибка; узел без видимых вариантов — адресная ошибка; снимок сбрасывает lastChange", () => {
  const q = () => ({
    start: "a",
    items: { key: { title: "Ключ" } },
    nodes: {
      a: { text: "А", choices: [{ text: "взять", goto: "b", give: ["key"] }, { text: "мимо", goto: "b" }] },
      b: { text: "Б", choices: [{ text: "открыть", goto: "e1", needs: ["key"] }, { text: "уйти", goto: "e2" }] },
      e1: { text: "К", end: { outcome: "open" } },
      e2: { text: "К", end: { outcome: "left" } }
    }
  });
  let d = q(); d.nodes.b.needs = ["key"];
  assert.ok(N.check(d).some((e) => e.includes("needs бывает только на варианте")));
  d = q(); d.nodes.b.choices[1].needs = ["key"];
  const errs = N.check(d);
  assert.ok(errs.some((e) => e.includes("не показывается ни один вариант")), errs.join("; "));
  assert.ok(!errs.some((e) => e.includes("ловушка")), "адресная ошибка вместо общей: " + errs.join("; "));
  // Имя переменной с двоеточием автору недоступно — только служебные из items.
  d = q(); d.vars = { "item:zzz": 1 };
  assert.ok(N.check(d).some((e) => e.includes("«item:zzz»")));
  const rt = N.create(q()); rt.choose(0);
  assert.deepEqual(rt.lastChange.gained, ["key"]);
  rt.load({ node: "b", vars: rt.vars });
  assert.deepEqual(rt.lastChange, { gained: [], lost: [] });
});

test("items: взрыв состояний — одна честная ошибка, а не ложные «недостижим»", () => {
  const items = {}, nodes = {};
  const n = 17;
  for (let i = 0; i < n; i++) {
    items["i" + i] = { title: "П" + i };
    const next = i + 1 < n ? "n" + (i + 1) : "fin";
    nodes["n" + i] = { text: "x", choices: [{ text: "взять", goto: next, give: ["i" + i] }, { text: "мимо", goto: next }] };
  }
  nodes.fin = { text: "f", choices: [{ text: "a", goto: "e1" }, { text: "b", goto: "e2" }] };
  nodes.e1 = { text: "e", end: { outcome: "win" } };
  nodes.e2 = { text: "e", end: { outcome: "lose" } };
  const errs = N.check({ start: "n0", items, nodes });
  // 17 предметов режется лимитом; с лимитом на сами предметы ошибка одна.
  assert.ok(errs.length >= 1 && errs.every((e) => e.includes("не больше") || e.includes("ветвист")), errs.join("; "));
  // Переменные-счётчики без предметов: та же защита от взрыва.
  const vars = {}, nodes2 = {};
  for (let i = 0; i < 17; i++) {
    vars["v" + i] = false;
    const next = i + 1 < 17 ? "m" + (i + 1) : "fin";
    nodes2["m" + i] = { text: "x", choices: [{ text: "да", goto: next, set: { ["v" + i]: true } }, { text: "нет", goto: next }] };
  }
  nodes2.fin = nodes.fin; nodes2.e1 = nodes.e1; nodes2.e2 = nodes.e2;
  const errs2 = N.check({ start: "m0", vars, nodes: nodes2 });
  assert.equal(errs2.length, 1, errs2.join("; "));
  assert.ok(errs2[0].includes("ветвист") && errs2[0].includes("17 переменных"));
});

// --- узел мини-игры (мост «сюжет ↔ мини-игра», week4) -------------------------

// Сюжет с одним узлом play: победа ведёт к одной концовке, проигрыш — к другой.
const withPlay = () => ({
  start: "a",
  vars: { pts: 0 },
  nodes: {
    a: { text: "А", choices: [{ text: "играть", goto: "p" }, { text: "мимо", goto: "e2" }] },
    p: {
      text: "Игра",
      play: {
        kit: "catch", params: { duration: 6000 }, score: "pts",
        startLabel: "Начать", rules: "Лови хорошее",
        outcomes: [{ if: { won: true }, goto: "e1", set: { pts: 5 } }, { goto: "e2" }]
      }
    },
    e1: { text: "К", end: { outcome: "win", won: true } },
    e2: { text: "К", end: { outcome: "lose", won: false } }
  }
});

test("play: узел мини-игры — четвёртый выход, проверяются кит, счёт, параметры и ветки", () => {
  assert.deepEqual(N.check(withPlay()), []);
  // Четвёртый выход: play вместе с goto — это уже два выхода.
  let d = withPlay(); d.nodes.p.goto = "e1";
  assert.ok(N.check(d).some((e) => e.includes("ровно одно из choices, goto, end, play")));
  // Кит вне белого списка (сюжет внутри сюжета в том числе).
  d = withPlay(); d.nodes.p.play.kit = "novel";
  assert.ok(N.check(d).some((e) => e.includes("нельзя запускать из сюжета") && e.includes("catch")));
  d = withPlay(); d.nodes.p.play.kit = "нетакого";
  assert.ok(N.check(d).some((e) => e.includes("нельзя запускать из сюжета")));
  // Счёт: имя объявленной ЧИСЛОВОЙ переменной.
  d = withPlay(); d.nodes.p.play.score = "zzz";
  assert.ok(N.check(d).some((e) => e.includes("«zzz» не объявлена в vars")));
  d = withPlay(); d.vars.flag = false; d.nodes.p.play.score = "flag";
  assert.ok(N.check(d).some((e) => e.includes("должна быть числом")));
  // Параметры узла — только простые значения.
  d = withPlay(); d.nodes.p.play.params = { duration: { ms: 1 } };
  assert.ok(N.check(d).some((e) => e.includes("params.duration")));
  // goto ветки — на существующий узел.
  d = withPlay(); d.nodes.p.play.outcomes[1].goto = "нет";
  assert.ok(N.check(d).some((e) => e.includes("outcomes[1].goto")));
  // Число веток.
  d = withPlay(); d.nodes.p.play.outcomes = [];
  assert.ok(N.check(d).some((e) => e.includes("от 1 до 4 исходов")));
});

test("play: последняя ветка outcomes обязана быть без if", () => {
  const d = withPlay();
  d.nodes.p.play.outcomes = [
    { if: { won: true }, goto: "e1" },
    { if: { won: false }, goto: "e2" }
  ];
  const errs = N.check(d);
  assert.ok(errs.some((e) => e.includes("последняя ветка outcomes обязана быть без")), errs.join("; "));
  assert.ok(errs.some((e) => e.includes('{ "goto": "…" }')), "в тексте нет подсказки, что дописать");
});

test("play: перекрытая ветка ловится фаззингом по решётке won × счёт", () => {
  const d = withPlay();
  // Первая ветка срабатывает всегда (условия нет) — вторая недостижима.
  d.nodes.p.play.outcomes = [{ goto: "e1" }, { goto: "e2" }];
  let errs = N.check(d);
  assert.ok(errs.some((e) => e.includes("outcomes[1]") && e.includes("недостижима")), errs.join("; "));
  // Порог из числа: score ≥ 3 и score ≥ 1 — вторая всё ещё достижима.
  const ok = withPlay();
  ok.nodes.p.play.outcomes = [
    { if: { score: { gte: 3 } }, goto: "e1" },
    { if: { score: { gte: 1 } }, goto: "e1" },
    { goto: "e2" }
  ];
  assert.deepEqual(N.check(ok), []);
  // Без условий по счёту в тексте появляется подсказка про порог.
  const noGate = withPlay();
  noGate.nodes.p.play.outcomes = [{ if: { won: true }, goto: "e1" }, { if: { won: true }, goto: "e1" }, { goto: "e2" }];
  errs = N.check(noGate);
  assert.ok(errs.some((e) => e.includes("outcomes[1]") && e.includes("score: {gte: N}")), errs.join("; "));
});

test("play: не больше maxPlayNodes узлов мини-игры на сюжет", () => {
  const d = withPlay();
  const one = () => JSON.parse(JSON.stringify(d.nodes.p));
  for (let i = 0; i < N.LIMITS.maxPlayNodes; i++) d.nodes["p" + i] = one();
  const errs = N.check(d);
  assert.ok(errs.some((e) => e.includes("мини-игр в сюжете") && e.includes(String(N.LIMITS.maxPlayNodes))), errs.join("; "));
});

test("resolvePlay: чистая, разбирает ветки сверху вниз и никогда не возвращает null", () => {
  const play = withPlay().nodes.p.play;
  assert.equal(N.resolvePlay(play, { won: true, score: 9 }, { pts: 0 }).goto, "e1");
  assert.equal(N.resolvePlay(play, { won: false, score: 9 }, { pts: 0 }).goto, "e2");
  // Мусор на входе не роняет сюжет: отдаётся последняя ветка.
  assert.equal(N.resolvePlay(play, null, null).goto, "e2");
  assert.equal(N.resolvePlay(play, {}, {}).goto, "e2");
  // Переменные сюжета видны в условии наравне с won/score.
  const byVar = { outcomes: [{ if: { pts: 5 }, goto: "e1" }, { goto: "e2" }] };
  assert.equal(N.resolvePlay(byVar, { won: false, score: 0 }, { pts: 5 }).goto, "e1");
  assert.equal(N.resolvePlay(byVar, { won: false, score: 0 }, { pts: 4 }).goto, "e2");
  // Функция чистая: переданные переменные не меняются.
  const vars = { pts: 4 };
  N.resolvePlay(play, { won: true, score: 7 }, vars);
  assert.deepEqual(vars, { pts: 4 });
});

test("explore: счёт огрубляется до порогов — обе ветки после мини-игры достижимы", () => {
  const d = withPlay();
  d.nodes.p.play.outcomes = [{ if: { score: { gte: 10 } }, goto: "e1" }, { goto: "e2" }];
  const ex = N.explore(d);
  // Оба исхода дошли до своих концовок, состояний немного (счёт не взорвал обход).
  assert.deepEqual(Object.keys(ex.endings).sort(), ["lose", "win"]);
  assert.ok(ex.states < 40, "состояний слишком много: " + ex.states);
  assert.equal(ex.overflow, false);
  // Порог виден и дальше по сюжету, а не только в самих outcomes.
  assert.deepEqual(N.scoreGates(d.nodes.p.play, d.nodes).sort((a, b) => a - b), [10]);
  const far = withPlay();
  far.nodes.e1 = { text: "К", choices: [{ text: "да", goto: "e2", if: { pts: 7 } }, { text: "нет", goto: "e3" }] };
  far.nodes.e3 = { text: "К", end: { outcome: "third", won: false } };
  assert.deepEqual(N.scoreGates(far.nodes.p.play, far.nodes), [7]);
});

test("paths: путь через мини-игру несёт шаг {kind:play, won, score}", () => {
  const d = withPlay();
  d.nodes.p.play.outcomes = [{ if: { score: { gte: 10 } }, goto: "e1" }, { goto: "e2" }];
  const p = N.paths(d);
  assert.deepEqual(Object.keys(p).sort(), ["lose", "win"]);
  const win = p.win;
  assert.equal(win[0], 0, "первый шаг — выбор «играть»");
  const step = win[1];
  assert.equal(step.kind, "play");
  assert.equal(step.won, true);
  assert.ok(step.score >= 10, "счёт шага обязан брать порог: " + step.score);
});

test("рантайм: playDone кладёт счёт в переменную, применяет ветку и переходит", () => {
  const rt = N.create(withPlay());
  rt.choose(0);
  assert.equal(rt.id(), "p");
  assert.ok(rt.play(), "узел мини-игры виден рантайму");
  assert.equal(rt.linear(), false);
  assert.equal(rt.ended(), null);
  const res = rt.playDone({ won: true, score: 12 });
  assert.equal(res.goto, "e1");
  assert.equal(rt.id(), "e1");
  // set ветки применён ПОСЛЕ записи счёта — в переменной значение ветки.
  assert.equal(rt.vars.pts, 5);
  assert.equal(rt.ended().outcome, "win");
  // Проигрыш — другая концовка, счёт остаётся тем, что дала партия.
  const rt2 = N.create(withPlay());
  rt2.choose(0);
  rt2.playDone({ won: false, score: 2 });
  assert.equal(rt2.vars.pts, 2);
  assert.equal(rt2.ended().outcome, "lose");
  // Вне узла play playDone ничего не делает.
  assert.equal(N.create(withPlay()).playDone({ won: true, score: 1 }), null);
});

test("фикстура tests/fixtures/hybrid.json проходит граф-чек, у каждой концовки свой путь", () => {
  const data = require("../tests/fixtures/hybrid.json");
  assert.deepEqual(N.check(data), []);
  const p = N.paths(data);
  assert.ok(Object.keys(p).length >= 3, "три концовки: " + Object.keys(p).join(", "));
  // Каждый путь исполняется рантаймом до своей концовки.
  for (const outcome of Object.keys(p)) {
    const rt = N.create(data);
    const steps = p[outcome].slice();
    for (let guard = 0; guard < 60 && !rt.ended(); guard++) {
      if (rt.linear()) { rt.next(); continue; }
      const s = steps.shift();
      if (s && s.kind === "play") rt.playDone({ won: s.won, score: s.score });
      else assert.ok(rt.choose(s), outcome);
    }
    assert.equal(rt.ended().outcome, outcome);
    assert.equal(steps.length, 0);
  }
  // Проигрыш мини-игры — ветка, а не конец: другая концовка, партия жива.
  const rt = N.create(data);
  rt.choose(0);
  assert.ok(rt.play(), "узел lift_puzzle — мини-игра");
  rt.playDone({ won: false, score: 0 });
  assert.ok(!rt.ended(), "проигрыш мини-игры не заканчивает сюжет");
  while (!rt.ended() && rt.linear()) rt.next();
  assert.equal(rt.choices().length, 1, "после проигрыша остаётся один вариант");
  rt.choose(0);
  assert.equal(rt.ended().outcome, "late");
});

test("PLAYABLE: сюжетные киты в список не входят, остальные — да", () => {
  assert.ok(Array.isArray(N.PLAYABLE) && N.PLAYABLE.length >= 6);
  assert.ok(N.PLAYABLE.indexOf("novel") < 0 && N.PLAYABLE.indexOf("quest") < 0);
  assert.ok(N.PLAYABLE.indexOf("catch") >= 0);
});
