// Инвариант темпа «собери заказ»: дефолты кита обязаны его держать, а
// слишком быстрая лента — падать строкой С ЧИСЛАМИ, по которым автор игры
// правит config.params.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./sort.js");

// Дефолты кита (game/kits/sort/kit.js). Расходятся — красный тест, и это
// правильно: темп меняется вместе с ними.
const DEFAULTS = { beltSpeed: 90, beltMax: 190, spacing: 150 };

test("дефолты кита проходят инвариант темпа на всём диапазоне скоростей", () => {
  const w = S.window(DEFAULTS);
  assert.equal(w.ok, true, w.reason);
  assert.equal(w.atSpeed[0].speed, 90);
  assert.equal(w.atSpeed[w.atSpeed.length - 1].speed, 190);
  for (const row of w.atSpeed) {
    assert.ok(row.visibleMs >= S.LIMITS.reactionMs, JSON.stringify(row));
    assert.ok(row.gapMs >= row.passMs * S.LIMITS.gapRatio, JSON.stringify(row));
  }
});

test("слишком быстрая лента: не ок, в reason скорость и число миллисекунд", () => {
  // Диапазон целиком за порогом — ругается первая же скорость, она и в тексте.
  const w = S.window({ beltSpeed: 260, beltMax: 260, spacing: 150 });
  assert.equal(w.ok, false);
  assert.ok(/beltMax 260/.test(w.reason), w.reason);
  assert.ok(/мс/.test(w.reason) && /\d+ мс/.test(w.reason), w.reason);
  // Подсказка «не больше N» — готовое значение для config.params.
  assert.ok(/Не больше \d+/.test(w.reason), w.reason);
  // Подсказанный потолок сам проходит проверку — иначе автор игры чинит по кругу.
  const fixed = Number(w.reason.match(/Не больше (\d+)/)[1]);
  assert.equal(S.window({ beltSpeed: 90, beltMax: fixed, spacing: 150 }).ok, true);
  // Дефолтные 190 остаются по эту сторону порога.
  assert.ok(fixed >= 190, "подсказка ниже дефолтного beltMax: " + fixed);
});

test("предметы идут слишком плотно: пауза меряется против проезда, оба числа в тексте", () => {
  const w = S.window({ beltSpeed: 90, beltMax: 190, spacing: 30 });
  assert.equal(w.ok, false);
  assert.ok(/spacing 30/.test(w.reason), w.reason);
  assert.ok(/пауза между предметами \d+ мс против проезда \d+ мс/.test(w.reason), w.reason);
  assert.ok(/Не меньше \d+/.test(w.reason), w.reason);
});

test("битые числа не роняют модуль, а объясняются словами", () => {
  assert.match(S.window({ beltSpeed: 0 }).reason, /больше нуля/);
  assert.match(S.window({ beltSpeed: 120, beltMax: 60 }).reason, /меньше beltSpeed/);
  assert.match(S.window({ beltSpeed: 90, beltMax: 190, spacing: 0 }).reason, /больше нуля/);
  // Без параметров вовсе — дефолты модуля, не исключение.
  assert.equal(S.window().ok, true);
  assert.equal(S.window(null).ok, true);
});

test("окно реакции считается ZV.pool.visibleMs: медленнее лента — больше времени", () => {
  const slow = S.window({ beltSpeed: 60, beltMax: 60, spacing: 150 }).atSpeed[0];
  const fast = S.window({ beltSpeed: 180, beltMax: 180, spacing: 150 }).atSpeed[0];
  assert.ok(slow.visibleMs > fast.visibleMs * 2.5, JSON.stringify({ slow, fast }));
  assert.equal(slow.passMs, Math.round((S.GEO.itemW / 60) * 1000));
});

// --- валидатор content/sort.json -------------------------------------------
// Негативный тест на каждую строку таблицы: сообщение проверяется подстрокой —
// автор игры читает его глазами, и переформулировка «мимоходом» обязана быть
// заметной. Тесты живут здесь, а не в content.test.js: общий файл на четыре
// параллельные ветки — гарантированный конфликт слияния.
const C = require("./content.js");
const fs = require("node:fs");
const path = require("node:path");

const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "sort.json"), "utf8"));
const copy = () => JSON.parse(JSON.stringify(REAL));
const first = (data, opts) => (C.validate("sort", data, opts)[0] || "");

test("боевой content/sort.json проходит валидатор и с параметрами кита", () => {
  assert.deepEqual(C.validate("sort", REAL), []);
  assert.deepEqual(C.validate("sort", REAL, { params: DEFAULTS }), []);
  // Тема «собери заказ»: 3 корзины и мусор, без которого игра — «тапай всё».
  assert.equal(REAL.bins.length, 3);
  assert.ok(REAL.items.filter((i) => i.bin === "junk").length >= 1);
  assert.ok(REAL.items.length >= 8 && REAL.items.length <= 10);
});

test("bins: от 2 до 4, id не «junk», без повторов, подпись влезает в корзину", () => {
  let d = copy(); d.bins = d.bins.slice(0, 1);
  assert.match(first(d), /от 2 до 4 корзин/);
  d = copy(); d.bins.push({ id: "a", title: "А" }, { id: "b", title: "Б" });
  assert.match(first(d), /от 2 до 4 корзин/);
  d = copy(); d.bins[1].id = "junk";
  assert.match(first(d), /id «junk» занят мусором/);
  d = copy(); d.bins[1].id = "cold";
  assert.match(first(d), /id «cold» повторяется/);
  d = copy(); d.bins[0].title = "Очень длинное название корзины на весь экран";
  assert.match(first(d), /не влезает/);
  d = copy(); d.bins[0].color = "синий";
  assert.match(first(d), /color — #rrggbb/);
  // Корзина вовсе без id: без проверки типа String(undefined) прошёл бы
  // регулярку, а в игре тап по такой корзине всегда был бы ошибкой.
  d = copy(); delete d.bins[0].id;
  assert.match(first(d), /id — латиница\/цифры/);
});

test("подпись корзины меряется по числу корзин: две широкие, четыре узкие", () => {
  // Две корзины: кит даёт wordWrap 166 px, длинная пара подписей влезает.
  let d = copy();
  d.bins = [{ id: "yes", title: "Перерабатывается" }, { id: "no", title: "Не перерабатывается" }];
  d.items = d.items.map((i) => ({ ...i, bin: i.bin === "junk" ? "junk" : (i.bin === "cold" ? "yes" : "no") }));
  assert.deepEqual(C.validate("sort", d, {}), []);
  // Те же подписи при четырёх корзинах в 76 px уже не влезают.
  d.bins = d.bins.concat([{ id: "a", title: "А" }, { id: "b", title: "Б" }]);
  d.items[0].bin = "a"; d.items[1].bin = "b";
  assert.match(first(d), /не влезает/);
});

test("items: 4..40, уникальные id, вес — неотрицательное число", () => {
  let d = copy(); d.items = d.items.slice(0, 3);
  assert.match(first(d), /предметов от 4 до 40/);
  d = copy(); d.items[1].id = d.items[0].id;
  assert.match(first(d), /уже занят/);
  d = copy(); d.items[0].weight = -1;
  assert.match(first(d), /неотрицательное число/);
});

test("bin — ровно одна строка из bins или «junk», иначе имена доступных корзин", () => {
  let d = copy(); d.items[0].bin = ["cold", "hot"];
  assert.match(first(d), /одна корзина строкой; предмет с двумя верными ответами/);
  d = copy(); delete d.items[0].bin;
  assert.match(first(d), /одна корзина строкой/);
  d = copy(); d.items[0].bin = "warm";
  assert.match(first(d), /корзины «warm» нет — доступны: cold, hot, dry, junk/);
});

test("мусор проверяется как обычный предмет: подпись и значок", () => {
  // Кит рисует мусор той же подписью — длинная едет на ленту как есть.
  let d = copy(); d.items.find((i) => i.bin === "junk").title = "Очень длинное название мусора на весь экран";
  assert.match(first(d), /не влезает/);
  d = copy(); delete d.items.find((i) => i.bin === "junk").title;
  assert.match(first(d), /title — непустая строка/);
  d = copy(); d.items.find((i) => i.bin === "junk").icon = "плохой ключ!";
  assert.match(first(d), /icon — ключ картинки/);
});

test("мёртвая корзина: ни одного предмета с весом больше нуля", () => {
  let d = copy(); d.items = d.items.filter((i) => i.bin !== "hot");
  assert.match(first(d), /«Горячее»: ни одного предмета — корзина никогда не понадобится/);
  // Вес 0 — тот же случай: предмет есть, а на ленту не выедет.
  d = copy(); d.items.forEach((i) => { if (i.bin === "hot") i.weight = 0; });
  assert.match(first(d), /ни одного предмета — корзина никогда не понадобится/);
});

test("мусор и junkChance ходят парой в обе стороны", () => {
  let d = copy(); d.items = d.items.filter((i) => i.bin !== "junk");
  assert.match(first(d), /мусор пропускать нечего/);
  // Без params берётся дефолт кита junkChance 0.12 — та же ошибка.
  assert.match(first(d, { params: { junkChance: 0.2 } }), /мусор пропускать нечего/);
  assert.deepEqual(C.validate("sort", d, { params: { junkChance: 0, junkChanceMax: 0 } }), []);
  assert.match(first(copy(), { params: { junkChance: 0, junkChanceMax: 0 } }), /оба 0 — мусор никогда не выедет/);
  // Пик считается по ОБЕИМ ручкам: «в начале мусора нет, к концу появляется» —
  // законная настройка, а не ошибка контента.
  assert.deepEqual(C.validate("sort", copy(), { params: { junkChance: 0 } }), []);
  assert.deepEqual(C.validate("sort", copy(), { params: { junkChance: 0, junkChanceMax: 0.28 } }), []);
  // И наоборот: мусора в файле нет, а к концу партии он понадобится.
  assert.match(first(d, { params: { junkChance: 0, junkChanceMax: 0.28 } }), /мусор пропускать нечего/);
});

test("темп проверяется по params: слишком быстрая лента — ошибка контента", () => {
  const errs = C.validate("sort", REAL, { params: { beltSpeed: 90, beltMax: 400, spacing: 150 } });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /человек не успевает/);
});
