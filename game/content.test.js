// Валидаторы контента и слияние параметров: на файлах репозитория (они обязаны
// проходить) и на заведомо битых данных (обязаны падать понятной строкой).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("./content.js");

const contentDir = path.join(__dirname, "..", "content");
const load = (name) => JSON.parse(fs.readFileSync(path.join(contentDir, name), "utf8"));

test("каждый content/*.json проходит валидатор своего вида", () => {
  const files = fs.readdirSync(contentDir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 3, "в content/ меньше трёх файлов");
  for (const f of files) {
    const kind = f.replace(/\.json$/, "");
    assert.ok(C.kinds.includes(kind), `${f}: нет валидатора для вида «${kind}»`);
    assert.deepEqual(C.validate(kind, load(f)), [], f);
  }
});

test("quiz: длина по метрикам шрифта, число вариантов, индекс верного, повторы", () => {
  const ok = { questions: [{ q: "В?", answers: ["а", "б"], correct: 1 }] };
  assert.deepEqual(C.validate("quiz", ok), []);
  assert.ok(C.validate("quiz", {}).length);
  // Вопрос: 4 строки по 300 px при кегле 2 (~18 знаков в строке) — 5 длинных слов не влезают.
  const long = Array(5).fill("тринадцатьбукв").join(" ");
  assert.ok(C.validate("quiz", { questions: [{ q: long, answers: ["а", "б"], correct: 0 }] })[0].includes("не влезает"));
  // Ответ: 2 строки в кнопке; при кегле 1 это ~33 знака в строке — 70 знаков не влезают.
  assert.ok(C.validate("quiz", { questions: [{ q: "В?", answers: ["слово ".repeat(12).trim(), "б"], correct: 0 }] })[0].includes("не влезает"));
  // Символ без глифа после замен — ошибка с подсказкой.
  assert.ok(C.validate("quiz", { questions: [{ q: "Что тут ☃?", answers: ["а", "б"], correct: 0 }] })[0].includes("нет таких символов"));
  // Многоточие и рубль заменяются, это не ошибка.
  assert.deepEqual(C.validate("quiz", { questions: [{ q: "Цена… 100 ₽?", answers: ["а", "б"], correct: 0 }] }), []);
  assert.ok(C.validate("quiz", { questions: [{ q: "В?", answers: ["а"], correct: 0 }] })[0].includes("от 2 до 4"));
  assert.ok(C.validate("quiz", { questions: [{ q: "В?", answers: ["а", "б"], correct: 2 }] })[0].includes("correct"));
  assert.ok(C.validate("quiz", { questions: [{ q: "В?", answers: ["а", "а"], correct: 0 }] })[0].includes("повторяются"));
  assert.ok(C.validate("quiz", { questions: [{ q: "В?", answers: ["а", "б"], correct: "1" }] }).length);
});

test("persona: неизвестный тип в весах, недостижимый тип, ответ без баллов, битый приз", () => {
  const base = () => ({
    types: [{ id: "a", title: "А" }, { id: "b", title: "Б" }],
    questions: [{ q: "В?", answers: [{ text: "1", weights: { a: 1 } }, { text: "2", weights: { b: 1 } }] }]
  });
  assert.deepEqual(C.validate("persona", base()), []);
  let d = base(); d.questions[0].answers[1].weights = { zzz: 1 };
  const errs = C.validate("persona", d);
  assert.ok(errs.some((e) => e.includes("неизвестный тип")), errs.join("; "));
  assert.ok(errs.some((e) => e.includes("«b» не получает баллов")), errs.join("; "));
  d = base(); d.questions[0].answers[0].weights = { a: 0 };
  assert.ok(C.validate("persona", d).some((e) => e.includes("ни одного балла")));
  d = base(); d.types[0].prize = { title: "" };
  assert.ok(C.validate("persona", d).some((e) => e.includes("prize")));
  d = base(); d.types[1].id = "a";
  assert.ok(C.validate("persona", d).some((e) => e.includes("повторяется")));
  assert.ok(C.validate("persona", { types: [{ id: "a", title: "А" }], questions: [] }).length === 2);
});

test("wheel: сумма весов, минимум два ненулевых, id, цвет", () => {
  const ok = { items: [{ id: "a", title: "А", weight: 1 }, { id: "b", title: "Б", weight: 1 }] };
  assert.deepEqual(C.validate("wheel", ok), []);
  assert.ok(C.validate("wheel", { items: [{ id: "a", title: "А", weight: 0 }, { id: "b", title: "Б", weight: 0 }] })
    .some((e) => e.includes("сумма весов")));
  assert.ok(C.validate("wheel", { items: [{ id: "a", title: "А", weight: 1 }, { id: "b", title: "Б", weight: 0 }] })
    .some((e) => e.includes("меньше двух")));
  assert.ok(C.validate("wheel", { items: [{ id: "A B", title: "А", weight: 1 }, { id: "b", title: "Б", weight: 1, color: "red" }] }).length === 2);
  // Сектор 76 px, 2 строки кеглем 1: «Скидка 10%» влезает («Скидка» / «10%»), одно слово из 12 букв — нет.
  assert.deepEqual(C.validate("wheel", { items: [{ id: "a", title: "Скидка 10%", weight: 1 }, { id: "b", title: "Б", weight: 1 }] }), []);
  assert.ok(C.validate("wheel", { items: [{ id: "a", title: "Двенадцатьбу", weight: 1 }, { id: "b", title: "Б", weight: 1 }] })[0].includes("не влезает"));
});

test("приз: пустой — это «нет приза», битый — ошибка", () => {
  assert.equal(C.hasPrize(undefined), false);
  assert.equal(C.hasPrize({ title: "" }), false);
  assert.equal(C.hasPrize({ title: "Скидка" }), true);
  assert.deepEqual(C.validatePrize({ title: "Скидка", code: "X1", url: "https://brand.ru/promo" }), []);
  assert.ok(C.validatePrize({ title: "Скидка", url: "brand.ru" })[0].includes("url"));
  // Код — одна строка в рамке 200 px: кеглем 2 это 12 знаков, кеглем 1 — 25.
  assert.deepEqual(C.validatePrize({ title: "Скидка", code: "PROMO2026" }), []);
  assert.ok(C.validatePrize({ title: "Скидка", code: "X".repeat(26) })[0].includes("code"));
  assert.ok(C.validate("nope", {})[0].includes("неизвестный вид"));
});

test("mergeParams: перекрытие, неизвестный ключ и чужой тип — в warnings, дефолт остаётся", () => {
  const d = { speed: 10, title: "a", hard: false };
  const r = C.mergeParams(d, { speed: 20, sped: 1, title: 5 }, { hard: true });
  assert.deepEqual(r.params, { speed: 20, title: "a", hard: true });
  assert.equal(r.warnings.length, 2);
  assert.ok(r.warnings[0].includes("sped"));
  assert.ok(r.warnings[1].includes("title"));
  assert.deepEqual(C.mergeParams(d, null, undefined).params, d);
  assert.notEqual(C.mergeParams(d).params, d, "возвращается копия, дефолты кита не мутируют");
  assert.ok(C.mergeParams({ n: 1 }, { n: NaN }).warnings.length === 1);
});

// week4: clicker
test("clicker: форма данных — цель, стадии, апгрейды, needs, подпись ухода", () => {
  const base = () => ({
    goal: { score: 400, title: "Вырос!", text: "Росток стал деревом" },
    stages: [{ at: 0, title: "Семечко" }, { at: 120, title: "Росток" }, { at: 380, title: "Деревце" }],
    care: { title: "Полить" },
    upgrades: [
      { id: "soil", title: "Хорошая почва", cost: 45, perTap: 2, max: 3 },
      { id: "sun", title: "Тёплый свет", cost: 120, perSec: 3, max: 2 },
      { id: "rain", title: "Тёплый дождь", cost: 200, perTap: 3, max: 2, needs: "sun" }
    ]
  });
  assert.deepEqual(C.validate("clicker", base()), []);
  const err = (mut) => { const d = base(); mut(d); return C.validate("clicker", d).join(" | "); };

  assert.ok(err((d) => { d.goal.score = 5; }).includes("goal.score: целое не меньше 10"));
  assert.ok(err((d) => { d.goal.score = 40.5; }).includes("goal.score: целое не меньше 10"));
  assert.ok(C.validate("clicker", { stages: [] }).some((e) => e.includes("goal")));
  // Стадии: первая с нуля, дальше строго вверх, не больше шести.
  assert.ok(err((d) => { d.stages[0].at = 20; }).includes("первая стадия начинается с 0"));
  assert.ok(err((d) => { d.stages[2].at = 100; }).includes("100 не больше предыдущего 120 — стадии идут по возрастанию"));
  assert.ok(err((d) => { d.stages = []; }).includes("stages: массив от 1 до 6 стадий"));
  assert.ok(err((d) => { d.stages[2].at = 400; }).includes("400 не меньше goal.score 400 — последняя стадия никогда не покажется"));
  assert.ok(err((d) => { d.stages[1].color = "зелёный"; }).includes("color: цвет вида"));
  // Апгрейды: цена, потолок, хоть какая-то польза, уникальный id.
  assert.ok(err((d) => { d.upgrades[1].cost = 0; }).includes("upgrades[1].cost — целое не меньше 1"));
  assert.ok(err((d) => { d.upgrades[1].max = 0; }).includes("upgrades[1].max: целое от 1 до 99"));
  assert.ok(err((d) => { delete d.upgrades[2].perTap; }).includes("upgrades[2]: ни perTap, ни perSec — апгрейд ничего не делает"));
  assert.ok(err((d) => { d.upgrades[1].id = "soil"; }).includes("«soil» повторяется"));
  assert.ok(err((d) => { d.upgrades[2].needs = "moon"; }).includes("upgrades[2].needs: апгрейда «moon» нет"));
  assert.ok(err((d) => { d.upgrades[1].needs = "rain"; }).includes("кольцо зависимостей"));
  assert.ok(err((d) => { d.upgrades = new Array(7).fill({ id: "a", title: "А", cost: 1, perTap: 1, max: 1 }); })
    .includes("upgrades: массив от 0 до 6 апгрейдов"));
  // Тексты по метрикам: подпись ухода живёт в кнопке 72 px.
  assert.ok(err((d) => { d.care.title = "Полить как следует и подкормить"; }).includes("не влезает"));
  assert.ok(err((d) => { d.stages[0].title = "Совсем крошечное семечко в земле"; }).includes("не влезает"));
});

test("clicker: достижимость цели считает солвер, обе границы — ошибка", () => {
  const base = () => JSON.parse(JSON.stringify(load("clicker.json")));
  // Цель дороже, чем можно набрать за duration.
  let d = base(); d.goal.score = 5000;
  let e = C.validate("clicker", d);
  assert.ok(e[0].includes("не набирается за duration") && e[0].includes("при лучшей игре выходит"), e.join(" | "));
  // Обратный знак: цель берётся вчетверо более медленным тапом без покупок.
  d = base(); d.goal.score = 50; d.stages = [{ at: 0, title: "Семечко" }];
  e = C.validate("clicker", d);
  assert.ok(e[0].includes("набирается простыми тапами без апгрейдов"), e.join(" | "));
  // Валидатор обязан работать и БЕЗ opts (тогда дефолты кита), и с ними.
  assert.deepEqual(C.validate("clicker", base()), []);
  assert.deepEqual(C.validate("clicker", base(), { params: { duration: 75000, botTapsPerSec: 5 } }), []);
  // Короткая партия ту же цель уже не берёт — ошибка про duration, а не молчание.
  assert.ok(C.validate("clicker", base(), { params: { duration: 20000 } })[0].includes("не набирается за duration 20 с"));
});
