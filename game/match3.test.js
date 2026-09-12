// Ядро «три в ряд»: инварианты, которые нельзя проверить глазами на телефоне —
// раздача без готовых троек и всегда с ходом, каскад, который сходится и
// оставляет поле полным, перемешивание без подмены фишек. Гоняется на сотнях
// сидов: один плохой сид у живого игрока выглядит как «игра сломалась».
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("./match3.js");
const RANDOM = require("./random.js");

const rng = (seed) => RANDOM.create(seed);

// Поле из строк цифр — читаемая фикстура: "112\n233" это 2 строки по 3 клетки.
function board(text) {
  const rows = text.trim().split("\n").map((s) => s.trim());
  const cols = rows[0].length;
  const cells = [];
  for (const r of rows) {
    assert.equal(r.length, cols, "строки поля разной длины");
    for (const ch of r) cells.push(Number(ch));
  }
  return M.make(cols, rows.length, cells);
}
const full = (b) => b.cells.every((k) => k >= 1);

test("deal: поле полное, без готовых совпадений и хотя бы с одним ходом — 200 сидов", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const b = M.deal(6, 7, 5, rng(seed));
    assert.equal(b.cols, 6);
    assert.equal(b.rows, 7);
    assert.equal(b.cells.length, 42, "сид " + seed);
    assert.ok(full(b), "в раздаче есть пустая клетка, сид " + seed);
    assert.ok(b.cells.every((k) => k >= 1 && k <= 5), "вид вне 1..kinds, сид " + seed);
    assert.equal(M.matches(b).cleared.length, 0, "раздача с готовой тройкой, сид " + seed);
    assert.ok(M.moves(b).length > 0, "раздача без единого хода, сид " + seed);
  }
});

test("deal: один сид — одно поле; размеры и kinds зажимаются по LIMITS", () => {
  assert.deepEqual(M.deal(6, 7, 5, rng(9)).cells, M.deal(6, 7, 5, rng(9)).cells);
  let same = 0;
  const a = M.deal(6, 7, 5, rng(1));
  for (let seed = 2; seed <= 40; seed++) {
    if (M.deal(6, 7, 5, rng(seed)).cells.join("") === a.cells.join("")) same++;
  }
  assert.equal(same, 0, "поля не зависят от сида");
  const tiny = M.deal(1, 1, 1, rng(3));
  assert.equal(tiny.cols, M.LIMITS.minCols);
  assert.equal(tiny.rows, M.LIMITS.minRows);
  assert.ok(tiny.cells.every((k) => k >= 1 && k <= M.LIMITS.minKinds));
  const huge = M.deal(99, 99, 99, rng(3));
  assert.equal(huge.cols, M.LIMITS.maxCols);
  assert.equal(huge.rows, M.LIMITS.maxRows);
});

test("deal: узкие настройки (3 вида, минимальное поле) всё равно дают ход", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const b = M.deal(4, 4, 3, rng(seed));
    assert.equal(M.matches(b).cleared.length, 0, "сид " + seed);
    assert.ok(M.moves(b).length > 0, "поле без ходов на минимальных настройках, сид " + seed);
  }
});

test("matches: горизонтали, вертикали и линии длиннее трёх", () => {
  const h = board(`
    1112
    2321
    3233
  `);
  const mh = M.matches(h);
  assert.deepEqual(mh.cleared, [0, 1, 2]);
  assert.equal(mh.lines.length, 1);
  assert.equal(mh.lines[0].kind, 1);
  assert.equal(mh.lines[0].dir, "h");

  const v = board(`
    1232
    1321
    1233
  `);
  assert.deepEqual(M.matches(v).cleared, [0, 4, 8]);

  const four = board(`
    11112
    23231
    32323
  `);
  const m4 = M.matches(four);
  assert.deepEqual(m4.cleared, [0, 1, 2, 3]);
  assert.equal(m4.lines[0].cells.length, 4);
});

test("matches: пересечение (крест) — клетка убирается один раз, но линий две", () => {
  // Вертикальная тройка двоек в столбце 1 и горизонтальная в строке 1.
  const b = board(`
    3213
    2221
    3213
  `);
  const m = M.matches(b);
  assert.equal(m.lines.length, 2, JSON.stringify(m.lines));
  const uniq = new Set(m.cleared);
  assert.equal(uniq.size, m.cleared.length, "клетка на пересечении попала дважды");
  assert.deepEqual(m.cleared, [1, 4, 5, 6, 9]);
});

test("matches: поле без троек даёт пустой список, пары не считаются", () => {
  const b = board(`
    1212
    2121
    1212
  `);
  assert.deepEqual(M.matches(b).cleared, []);
  assert.deepEqual(M.matches(b).lines, []);
});

test("moves: находит ровно те пары соседей, что дают совпадение; пара не дублируется", () => {
  // Обмен (0,1)↔(1,1) — единицы в строку 1 не собираются; смотрим на ход,
  // который реально есть: два вниз в столбце 0 и двойка сбоку.
  const b = board(`
    2133
    2311
    1223
  `);
  const list = M.moves(b);
  assert.ok(list.length > 0);
  const keys = list.map((m) => m.a + ":" + m.b);
  assert.equal(new Set(keys).size, keys.length, "ход встречается дважды: " + keys.join(", "));
  for (const m of list) {
    assert.ok(M.adjacent(b, m.a, m.b), "ход между не-соседями: " + JSON.stringify(m));
    const t = M.clone(b);
    M.swap(t, m.a, m.b);
    assert.ok(M.matches(t).cleared.length > 0, "заявленный ход ничего не собирает: " + JSON.stringify(m));
    assert.equal(M.matches(t).cleared.length, m.cleared, "обещанный сбор не совпал");
  }
  // И наоборот: любой соседний обмен, который собирает линию, обязан быть в списке.
  for (let i = 0; i < b.cells.length; i++) {
    for (const j of [i + 1, i + b.cols]) {
      if (j >= b.cells.length) continue;
      if (!M.adjacent(b, i, j)) continue;
      const t = M.clone(b);
      M.swap(t, i, j);
      if (!M.matches(t).cleared.length) continue;
      assert.ok(keys.includes(i + ":" + j), `ход ${i}↔${j} собирает линию, но не в moves()`);
    }
  }
});

test("moves: запертое поле даёт пустой список", () => {
  // Настоящий тупик: ни одного соседнего обмена, собирающего линию. Шахматка
  // из ДВУХ видов тупиком не является — там обмен собирает целую строку.
  const b = board(`
    1321
    2331
    1122
    3132
  `);
  assert.equal(M.matches(b).cleared.length, 0);
  assert.deepEqual(M.moves(b), []);
  assert.equal(M.best(b), null);
});

test("best: берёт ход с наибольшим сбором, при равенстве — устойчиво", () => {
  const b = board(`
    12111
    21232
    13212
    22133
  `);
  const top = M.best(b);
  const all = M.moves(b);
  assert.ok(top);
  assert.equal(top.cleared, Math.max(...all.map((m) => m.cleared)));
  assert.deepEqual(M.best(M.clone(b)), top, "выбор неустойчив между вызовами");
});

test("score: база, бонус за длину и множитель каскада", () => {
  const P = { base: 10, cascadeStep: 1, lineBonus: 20 };
  assert.equal(M.score(3, 0, P), 30);                 // три фишки, первый шаг
  assert.equal(M.score(4, 0, P), 60);                 // +1 сверх трёх = +20
  assert.equal(M.score(3, 1, P), 60);                 // второй шаг каскада ×2
  assert.equal(M.score(5, 2, P), 3 * (5 * 10 + 2 * 20));
  assert.equal(M.score([1, 2, 3], 0, P), 30, "список клеток считается по длине");
  // Ручки правда работают: без бонуса и без каскада счёт линейный.
  assert.equal(M.score(5, 3, { base: 1, cascadeStep: 0, lineBonus: 0 }), 5);
});

test("resolve: после разбора поле полное и без совпадений — 200 сидов", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed);
    const b = M.deal(6, 7, 5, r);
    const mv = M.best(b);
    assert.ok(mv, "нет хода на раздаче, сид " + seed);
    M.swap(b, mv.a, mv.b);
    const res = M.resolve(b, r, { kinds: 5, base: 10, cascadeStep: 1, lineBonus: 20 });
    assert.ok(res.steps.length >= 1, "ход не собрал ничего, сид " + seed);
    assert.ok(res.score > 0, "сбор без очков, сид " + seed);
    assert.ok(full(b), "после resolve есть пустая клетка, сид " + seed);
    assert.equal(M.matches(b).cleared.length, 0, "после resolve остались совпадения, сид " + seed);
    assert.ok(b.cells.every((k) => k >= 1 && k <= 5), "вид вне 1..kinds после досыпки, сид " + seed);
    assert.equal(b.cells.length, 42);
  }
});

test("resolve: шаги несут убранное, падения и досыпку; каскад множит очки", () => {
  // Поле без готовых совпадений; лучший ход собирает тройку, после падения
  // складывается вторая — каскад из двух шагов. Досыпка берётся из rng(77),
  // поэтому каскад детерминирован и повторяется.
  const P = { kinds: 4, base: 10, cascadeStep: 1, lineBonus: 20 };
  const b = board(`
    1342
    1414
    4213
    4141
    2123
  `);
  assert.equal(M.matches(b).cleared.length, 0, "фикстура должна быть без готовых троек");
  const mv = M.best(b);
  M.swap(b, mv.a, mv.b);
  const res = M.resolve(b, rng(77), P);
  assert.ok(res.steps.length >= 2, "каскад не случился: " + JSON.stringify(res.steps.map((s) => s.cleared)));
  assert.equal(res.cascades, res.steps.length);
  const s0 = res.steps[0], s1 = res.steps[1];
  assert.equal(s0.cascade, 0);
  assert.equal(s1.cascade, 1);
  assert.ok(s0.fell.length > 0, "гравитация не сдвинула ни одной фишки");
  assert.equal(s0.filled.length, s0.cleared.length, "досыпано не столько, сколько убрано");
  // Второй шаг той же длины стоит дороже первого — иначе каскад не награда.
  assert.ok(s1.gain > M.score(s1.cleared, 0, P), "каскад не дал множителя: " + s1.gain);
  assert.equal(res.score, res.steps.reduce((s, x) => s + x.gain, 0));
  assert.ok(full(b));
  assert.equal(M.matches(b).cleared.length, 0);
});

test("resolve: гравитация двигает фишки вниз в своём столбце, ничего не теряя", () => {
  // Единственное совпадение — нижняя горизонтальная тройка единиц.
  const b = board(`
    2341
    3412
    1114
  `);
  const before = b.cells.slice();
  const res = M.resolve(b, rng(2), { kinds: 4 });
  const s = res.steps[0];
  assert.deepEqual(s.cleared, [8, 9, 10], "убралась не нижняя тройка");
  for (const mv of s.fell) {
    const from = M.cell(b, mv.from), to = M.cell(b, mv.to);
    assert.equal(from.c, to.c, "фишка сменила столбец при падении");
    assert.ok(to.r > from.r, "фишка уехала вверх");
  }
  // Нижняя клетка столбца 0 получила то, что лежало над ней.
  assert.equal(b.cells[M.idx(b, 0, 2)], before[M.idx(b, 0, 1)], "нижняя клетка получила не ту фишку");
  // Досыпка только сверху: верхняя строка — новые фишки, и их ровно столько,
  // сколько убрали.
  assert.equal(s.filled.length, 3);
  assert.ok(s.filled.every((f) => M.cell(b, f.i).r === 0), "досыпали не в верхнюю строку");
  assert.ok(full(b));
});

test("resolve: поле без совпадений не меняется и очков не даёт", () => {
  const b = board(`
    1212
    2121
    1212
  `);
  const before = b.cells.join("");
  const res = M.resolve(b, rng(1), { kinds: 2 });
  assert.deepEqual(res.steps, []);
  assert.equal(res.score, 0);
  assert.equal(b.cells.join(""), before);
});

test("resolve: после каждого хода на живом поле снова есть ход либо помогает reshuffle", () => {
  // Партия на 40 ходов: инвариант «поле полное, без совпадений, и игрок не
  // заперт» держится весь прогон — ровно то, что видит человек.
  for (const seed of [3, 17, 64, 128]) {
    const r = rng(seed);
    const b = M.deal(6, 7, 5, r);
    for (let turn = 0; turn < 40; turn++) {
      let mv = M.best(b);
      if (!mv) {
        const was = M.counts(b);
        M.reshuffle(b, r);
        assert.deepEqual(M.counts(b), was, "перемешивание подменило фишки, сид " + seed);
        mv = M.best(b);
        assert.ok(mv, "после перемешивания ходов всё равно нет, сид " + seed);
      }
      M.swap(b, mv.a, mv.b);
      M.resolve(b, r, { kinds: 5 });
      assert.ok(full(b), `сид ${seed}, ход ${turn}: поле неполное`);
      assert.equal(M.matches(b).cleared.length, 0, `сид ${seed}, ход ${turn}: остались совпадения`);
    }
  }
});

test("reshuffle: мультимножество фишек сохраняется, поле без совпадений и с ходом", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const r = rng(seed);
    const b = M.deal(6, 7, 5, r);
    const was = M.counts(b);
    M.reshuffle(b, r);
    assert.deepEqual(M.counts(b), was, "перемешивание изменило состав фишек, сид " + seed);
    assert.equal(M.matches(b).cleared.length, 0, "после перемешивания есть готовая тройка, сид " + seed);
    assert.ok(M.moves(b).length > 0, "после перемешивания нет ходов, сид " + seed);
  }
});

test("reshuffle: запертое поле расшивается, состав тот же", () => {
  const b = board(`
    1321
    2331
    1122
    3132
  `);
  assert.deepEqual(M.moves(b), [], "фикстура должна быть запертой");
  const was = M.counts(b);
  M.reshuffle(b, rng(7));
  assert.deepEqual(M.counts(b), was);
  assert.equal(b.cells.length, 16);
  assert.equal(M.matches(b).cleared.length, 0);
  assert.ok(M.moves(b).length > 0, "после перемешивания тупик остался");
});

test("swap и adjacent: обмен на месте, соседство по четырём сторонам", () => {
  const b = board(`
    123
    456
    789
  `);
  assert.ok(M.adjacent(b, 0, 1));
  assert.ok(M.adjacent(b, 0, 3));
  assert.ok(!M.adjacent(b, 0, 4), "диагональ соседством не считается");
  assert.ok(!M.adjacent(b, 2, 3), "край строки не сосед следующей строки");
  M.swap(b, 0, 1);
  assert.equal(b.cells[0], 2);
  assert.equal(b.cells[1], 1);
});

test("play: лучшая игра набирает кратно больше случайных тычков — 20 сидов", () => {
  const P = { cols: 6, rows: 7, kinds: 5, moves: 20, targetScore: 600, base: 10, cascadeStep: 1, lineBonus: 20 };
  let best = 0, random = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const a = M.play(P, rng(seed), "best");
    const b = M.play(P, rng(seed), "random");
    assert.equal(a.moves, 20, "лучшая игра не отыграла все ходы, сид " + seed);
    assert.equal(a.hits, 20, "у лучшей игры не каждый ход собирает, сид " + seed);
    assert.ok(b.hits <= a.hits, "случайные тычки удачливее выбора, сид " + seed);
    best += a.score;
    random += b.score;
  }
  // Разница на порядок — это и есть «выбор хода решает». Сойдись она к
  // единице, игра проходилась бы сама, и цель стало бы нечем мерить.
  assert.ok(best > random * 4, `лучшая игра ${best} против случайной ${random}`);
});

test("play: детерминирован по сиду; reached сверяется с targetScore", () => {
  const P = { cols: 6, rows: 7, kinds: 5, moves: 12, targetScore: 400, base: 10, cascadeStep: 1, lineBonus: 20 };
  const a = M.play(P, rng(33), "best");
  const b = M.play(P, rng(33), "best");
  assert.deepEqual(a, b);
  assert.equal(a.reached, a.score >= 400);
  assert.equal(M.play({ ...P, targetScore: a.score + 1 }, rng(33), "best").reached, false);
  assert.equal(M.play({ ...P, targetScore: 0 }, rng(33), "best").reached, true, "цели нет — партия всегда «дошла»");
  // Ходы правда ограничивают: вдвое меньше ходов — заметно меньше очков.
  assert.ok(M.play({ ...P, moves: 6 }, rng(33), "best").score < a.score);
});

test("play: партия не виснет на тупике — перемешивание внутри прогона", () => {
  // Три вида на маленьком поле запирают его часто: прогон обязан дойти до
  // конца, а не встать, и посчитать перемешивания.
  let shuffles = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = M.play({ cols: 4, rows: 4, kinds: 7, moves: 25, base: 10, cascadeStep: 1, lineBonus: 20 }, rng(seed), "best");
    assert.equal(r.moves, 25, "прогон встал на сиде " + seed);
    shuffles += r.shuffles;
  }
  assert.ok(shuffles > 0, "на тесном поле за 40 партий ни одного тупика — перемешивание не проверено");
});

test("cell и idx: индекс и координаты согласованы", () => {
  const b = M.make(6, 7, new Array(42).fill(1));
  for (let i = 0; i < 42; i++) {
    const p = M.cell(b, i);
    assert.equal(M.idx(b, p.c, p.r), i);
  }
  assert.equal(M.at(b, -1, 0), 0, "за краем поля — ноль, а не undefined");
  assert.equal(M.at(b, 0, 99), 0);
});
