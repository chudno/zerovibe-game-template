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

// week4: memory
test("memory: пары, виды, сетка, ходы, подписи и повторы — каждая строка таблицы", () => {
  const base = () => ({
    rounds: [{ name: "Разминка", hint: "Найди пары", pairs: 4 }],
    cards: [
      { id: "box", title: "Коробка", color: "#4f7cff" },
      { id: "stamp", title: "Печать" },
      { id: "letter", title: "Письмо" },
      { id: "keys", title: "Ключи" }
    ]
  });
  assert.deepEqual(C.validate("memory", base()), []);
  // Валидатор обязан работать и без opts (дефолты кита).
  assert.deepEqual(C.validate("memory", base(), undefined), []);
  assert.ok(C.validate("memory", { rounds: [], cards: base().cards })[0].includes("от 1 до 10"));
  assert.ok(C.validate("memory", { rounds: base().rounds, cards: [{ id: "a", title: "А" }] })[0].includes("от 2 до 24"));

  let d = base(); d.rounds[0].pairs = 0;
  assert.ok(C.validate("memory", d).some((e) => e.includes("pairs: целое от 2 до 12 (сейчас 0)")), JSON.stringify(C.validate("memory", d)));
  d = base(); d.rounds[0].pairs = 8;
  assert.ok(C.validate("memory", d).some((e) => e.includes("8 пар, а в cards только 4 вида")), JSON.stringify(C.validate("memory", d)));
  // Ход тратится на пару: 8 ходов на 4 пары — непроходимо, нужно 2·4 + 2.
  d = base(); d.rounds[0].moves = 8;
  assert.ok(C.validate("memory", d).some((e) => e.includes("8 ходов на 4 пары — партия непроходима, нужно минимум 10")), JSON.stringify(C.validate("memory", d)));
  d = base(); d.rounds[0].moves = 10;
  assert.deepEqual(C.validate("memory", d), []);
  d = base(); d.rounds[0].moves = 0;
  assert.ok(C.validate("memory", d).some((e) => e.includes("moves: целое больше нуля")));

  d = base(); d.cards[1].id = "box";
  assert.ok(C.validate("memory", d).some((e) => e.includes("id «box» повторяется")));
  d = base(); d.cards[1].id = "Box 1";
  assert.ok(C.validate("memory", d).some((e) => e.includes("id — латиница")));
  d = base(); d.cards[0].color = "red";
  assert.ok(C.validate("memory", d).some((e) => e.includes("color — #rrggbb")));
  d = base(); d.cards[0].icon = "нет";
  assert.ok(C.validate("memory", d).some((e) => e.includes("ключ картинки")));
  // Одинаковые подписи неотличимы на заглушках.
  d = base(); d.cards[1].title = "Коробка";
  assert.ok(C.validate("memory", d).some((e) => e.includes("не различить")));
  // Подпись на карточке — 2 строки по ~9 знаков: длинное слово не влезает.
  d = base(); d.cards[0].title = "Двенадцатьбукв";
  assert.ok(C.validate("memory", d).some((e) => e.includes("не влезает")));
  d = base(); d.rounds[0].name = "Слово ".repeat(30).trim();
  assert.ok(C.validate("memory", d).some((e) => e.includes("name не влезает")));

  // Больше 8 пар без иконок — предупреждение про различимость.
  d = { rounds: [{ name: "Финал", pairs: 10 }], cards: [] };
  for (let i = 0; i < 10; i++) d.cards.push({ id: "c" + i, title: "Вид " + i });
  assert.ok(C.validate("memory", d).some((e) => e.includes("различаются только цветом")), JSON.stringify(C.validate("memory", d)));
});
