// Сейв как удобство: ядро требования — пустое, битое или бросающее хранилище
// НЕ ломает партию. Хранилище подсовывается фабрикой, поэтому все беды
// (приватное окно, квота, чужая форма, отказ на самом доступе к свойству)
// проверяются без браузера.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./save.js");

// Фальшивое localStorage: те же getItem/setItem/removeItem/key/length.
function fakeStore(init) {
  const map = new Map(Object.entries(init || {}));
  return {
    map,
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i]; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}
const from = (store) => () => store;
const DEF = { best: 0, stages: 0, hero: "cat", loud: false };

test("обычный цикл: set → get, значения переживают повторный open", () => {
  const store = fakeStore();
  const v = S.version(["content", { a: 1 }]);
  const slot = S.open("clicker", v, DEF, from(store));
  assert.equal(slot.ok, true);
  assert.deepEqual(slot.get(), DEF, "пустое хранилище — дефолты");
  slot.set({ best: 120 });
  assert.equal(slot.get().best, 120);
  assert.equal(slot.get().stages, 0, "непереданное поле осталось дефолтным");

  const again = S.open("clicker", v, DEF, from(store));
  assert.equal(again.get().best, 120);
});

test("геттер хранилища бросает (srcdoc-кадр, выключенные куки): ok = false и ни одного исключения", () => {
  const boom = () => { throw new Error("SecurityError: доступ к localStorage запрещён"); };
  let slot;
  assert.doesNotThrow(() => { slot = S.open("memory", "s1", DEF, boom); }, "open бросил наружу");
  assert.equal(slot.ok, false);
  assert.doesNotThrow(() => assert.deepEqual(slot.get(), DEF));
  assert.doesNotThrow(() => slot.set({ best: 7 }));
  assert.equal(slot.get().best, 7, "без хранилища значение живёт в памяти — партия идёт");
  assert.doesNotThrow(() => slot.reset());
  assert.doesNotThrow(() => S.wipe("memory", boom));
});

test("getItem бросает (приватное окно iOS): get даёт дефолты, ok = false", () => {
  const store = fakeStore();
  store.getItem = () => { throw new Error("QuotaExceededError"); };
  const slot = S.open("memory", "s1", DEF, from(store));
  assert.deepEqual(slot.get(), DEF);
  assert.equal(slot.ok, false);
});

test("setItem бросает (квота): set не бросает, значение живёт в памяти", () => {
  const store = fakeStore();
  store.setItem = () => { throw new Error("QuotaExceededError"); };
  const slot = S.open("memory", "s1", DEF, from(store));
  assert.doesNotThrow(() => slot.set({ best: 42 }));
  assert.equal(slot.get().best, 42);
  assert.equal(slot.ok, false);
});

test("битый JSON и чужая форма дают дефолты, а не поломку", () => {
  const v = "s1";
  const key = "zv:memory:" + v;
  let slot = S.open("memory", v, DEF, from(fakeStore({ [key]: "{не json" })));
  assert.deepEqual(slot.get(), DEF);

  slot = S.open("memory", v, DEF, from(fakeStore({ [key]: JSON.stringify({ best: "много", stages: 3, чужое: 1 }) })));
  const got = slot.get();
  assert.equal(got.best, 0, "строка вместо числа обязана отброситься");
  assert.equal(got.stages, 3, "поле верного типа читается");
  assert.ok(!("чужое" in got), "чужой ключ пролез в состояние");

  slot = S.open("memory", v, DEF, from(fakeStore({ [key]: JSON.stringify([1, 2, 3]) })));
  assert.deepEqual(slot.get(), DEF, "массив вместо объекта");
});

test("смена версии: старое не читается, старый ключ подчищен", () => {
  const store = fakeStore();
  const v1 = S.version([{ goal: 100 }]);
  S.open("clicker", v1, DEF, from(store)).set({ best: 500 });
  assert.equal(store.map.size, 1);

  const v2 = S.version([{ goal: 200 }]);
  assert.notEqual(v1, v2, "версия не изменилась от смены контента");
  const slot = S.open("clicker", v2, DEF, from(store));
  assert.equal(slot.get().best, 0, "прогресс от другого баланса подхвачен");
  assert.equal(store.map.size, 0, "старый ключ той же игры не подчищен");
});

test("ключ: zv: + имя кита + версия, имени проекта в нём нет", () => {
  const store = fakeStore();
  const slot = S.open("memory", S.version([1]), DEF, from(store));
  slot.set({ best: 1 });
  const key = Array.from(store.map.keys())[0];
  assert.ok(/^zv:memory:s[0-9a-z]+$/.test(key), key);
  // Ключ виден в чужом браузере: имя проекта и платформы туда не попадают.
  assert.ok(!/proj|project|zerovibe/i.test(key), key);
});

test("version: считается по стабильной сериализации — порядок ключей не важен", () => {
  assert.equal(S.version([{ a: 1, b: 2 }]), S.version([{ b: 2, a: 1 }]), "переформатирование content стёрло бы прогресс");
  assert.notEqual(S.version([{ a: 1 }]), S.version([{ a: 2 }]));
  assert.ok(/^s[0-9a-z]+$/.test(S.version(["что угодно", 1, true])));
  assert.equal(S.stable({ b: 1, a: [2, { d: 4, c: 3 }] }), '{"a":[2,{"c":3,"d":4}],"b":1}', "стабильная сериализация сортирует ключи на всех уровнях");
});

test("слишком большой слот не пишется в хранилище, но живёт в памяти", () => {
  const store = fakeStore();
  const defaults = { note: "" };
  const slot = S.open("memory", "s1", defaults, from(store));
  slot.set({ note: "x".repeat(S.LIMITS.maxBytes + 100) });
  assert.equal(store.map.size, 0, "переполненный слот выбьет чужие ключи квотой");
  assert.equal(slot.get().note.length, S.LIMITS.maxBytes + 100);
});

test("reset и wipe стирают слот, дальше игра идёт с дефолтов", () => {
  const store = fakeStore();
  const v = "s1";
  const slot = S.open("memory", v, DEF, from(store));
  slot.set({ best: 10 });
  assert.deepEqual(slot.reset(), DEF);
  assert.equal(store.map.size, 0);

  slot.set({ best: 11 });
  assert.equal(S.wipe("memory", from(store)), true);
  assert.equal(store.map.size, 0);
  assert.equal(S.wipe("memory", () => { throw new Error("нет хранилища"); }), false);
});

test("хранилища нет вовсе (getStore вернул null) — всё работает от дефолтов", () => {
  const slot = S.open("memory", "s1", DEF, () => null);
  assert.equal(slot.ok, false);
  assert.deepEqual(slot.get(), DEF);
  slot.set({ stages: 2 });
  assert.equal(slot.get().stages, 2);
});
