// Инварианты расстановки «найди предмет»: одна и та же партия при том же
// сиде, предметы не налезают друг на друга, не ближе minDistance, целиком в
// области поля, а невместимость объясняется ЧИСЛОМ «сколько влезет» — по нему
// автор игры правит params, а не гадает.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./hidden.js");
const RND = require("./random.js");

// Поле кита (game/kits/hidden/kit.js). Расходятся — красный тест, и это
// правильно: вместимость поля меняется вместе с ним.
const FIELD = { x: 8, y: 120, w: 344, h: 300 };
const DEFAULTS = { targets: 5, decoys: 2, size: 40, minDistance: 56 };

const place = (over) => H.place(Object.assign({
  count: DEFAULTS.targets + DEFAULTS.decoys, area: FIELD,
  size: DEFAULTS.size, minDistance: DEFAULTS.minDistance, decoys: DEFAULTS.decoys,
  rng: RND.create(7)
}, over || {}));

test("дефолты кита раскладываются, целей и отвлечений ровно столько, сколько просили", () => {
  const r = place();
  assert.equal(r.fits, true, r.reason);
  assert.equal(r.spots.length, DEFAULTS.targets + DEFAULTS.decoys);
  assert.equal(r.spots.filter((s) => s.decoy).length, DEFAULTS.decoys);
  assert.equal(r.spots.filter((s) => !s.decoy).length, DEFAULTS.targets);
  // Отвлечения — ХВОСТ списка: кит раздаёт им предметы, не перебирая цели.
  assert.deepEqual(r.spots.map((s) => s.decoy).slice(0, DEFAULTS.targets), new Array(DEFAULTS.targets).fill(false));
});

test("один сид — одна расстановка, разные сиды — разные", () => {
  const a = place({ rng: RND.create(7) });
  const b = place({ rng: RND.create(7) });
  const c = place({ rng: RND.create(8) });
  assert.deepEqual(a.spots, b.spots);
  assert.notDeepEqual(a.spots.map((s) => [s.x, s.y]), c.spots.map((s) => [s.x, s.y]));
  // Расстановка без rng тоже работает (валидатор зовёт её без случайности).
  assert.equal(place({ rng: null }).fits, true);
});

test("на 200 сидах: целые координаты, дистанция держится, всё внутри области", () => {
  const half = DEFAULTS.size / 2;
  for (let seed = 1; seed <= 200; seed++) {
    const r = place({ rng: RND.create(seed) });
    assert.equal(r.fits, true, `сид ${seed}: ${r.reason}`);
    for (const s of r.spots) {
      assert.ok(Number.isInteger(s.x) && Number.isInteger(s.y), `сид ${seed}: дробная координата ${s.x},${s.y}`);
      assert.ok(s.x - half >= FIELD.x && s.x + half <= FIELD.x + FIELD.w, `сид ${seed}: предмет вышел по x: ${s.x}`);
      assert.ok(s.y - half >= FIELD.y && s.y + half <= FIELD.y + FIELD.h, `сид ${seed}: предмет вышел по y: ${s.y}`);
    }
    // Наложение — частный случай слипания: minDistance ≥ size по построению.
    assert.ok(H.closest(r.spots) >= DEFAULTS.minDistance,
      `сид ${seed}: предметы ближе ${DEFAULTS.minDistance}: ${H.closest(r.spots).toFixed(1)}`);
  }
});

test("джиттер живой: расстановка не таблица и не одна на все сиды", () => {
  const seen = new Set();
  const xs = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const r = place({ rng: RND.create(seed) });
    seen.add(r.spots.map((s) => s.x + "," + s.y).join("|"));
    r.spots.forEach((s) => xs.add(s.x));
  }
  assert.ok(seen.size >= 45, "расстановки повторяются: вариантов " + seen.size);
  // Узлы сетки дали бы 5–6 значений x на все сиды; джиттер обязан их размыть.
  assert.ok(xs.size > 20, "координаты x ложатся строго по столбцам: " + xs.size);
});

test("невместимость: fits false и число, сколько влезет — оно само проходит", () => {
  const cap = H.capacity(FIELD, DEFAULTS.size, DEFAULTS.minDistance);
  assert.ok(cap > 0 && cap <= H.LIMITS.maxItems, "вместимость поля: " + cap);
  const r = place({ count: cap + 1, decoys: 0 });
  assert.equal(r.fits, false);
  assert.equal(r.capacity, cap);
  assert.match(r.reason, /влезает \d+ предметов, а просят \d+/);
  // Подсказанное число само раскладывается — иначе автор игры чинит по кругу.
  assert.equal(place({ count: cap, decoys: 0 }).fits, true);
});

test("тесная область и мелкий предмет объясняются словами, а не пустой раскладкой", () => {
  assert.match(place({ size: 20 }).reason, /меньше 24 px/);
  assert.match(place({ area: { x: 0, y: 0, w: 0, h: 0 } }).reason, /область пустая/);
  assert.match(place({ area: { x: 0, y: 0, w: 30, h: 300 } }).reason, /не влезает в область/);
  assert.match(place({ count: 0 }).reason, /нечего прятать/);
  assert.match(place({ count: H.LIMITS.maxItems + 1 }).reason, /не больше 24/);
  // Пустой вызов не бросает, а объясняется.
  assert.equal(H.place().fits, false);
  assert.equal(H.place(null).fits, false);
});

test("minDistance меньше предмета поднимается до его стороны: иначе предметы налезают", () => {
  const r = place({ minDistance: 10, count: 6, decoys: 0, rng: RND.create(3) });
  assert.equal(r.fits, true, r.reason);
  assert.ok(H.closest(r.spots) >= DEFAULTS.size, "предметы налезли: " + H.closest(r.spots).toFixed(1));
});

test("попадание тапа: квадрат предмета, но не уже тач-цели 24 px", () => {
  const spot = { x: 100, y: 200, size: 40 };
  assert.equal(H.hit(spot, 100, 200), true);
  assert.equal(H.hit(spot, 120, 220), true, "угол предмета — попадание");
  assert.equal(H.hit(spot, 121, 200), false);
  assert.equal(H.hit(null, 100, 200), false);
  // Мелкая картинка не делает промахи «честными»: цель всё равно 24 px.
  const tiny = { x: 100, y: 200, size: 16 };
  assert.equal(H.hit(tiny, 111, 200), true);
});

test("pick берёт ближайший ненайденный, найденные пропускает", () => {
  // Тач-цели соседей перекрываются: 115 попадает в оба квадрата.
  const spots = [{ x: 100, y: 100, size: 40 }, { x: 130, y: 100, size: 40 }];
  assert.equal(H.pick(spots, 115, 100), 0, "на равном расстоянии побеждает первый по списку");
  assert.equal(H.pick(spots, 118, 100), 1, "тап в перекрытии уходит ближайшему");
  assert.equal(H.pick(spots, 102, 100), 0);
  assert.equal(H.pick(spots, 118, 100, (s, i) => i === 1), 0, "найденный пропускается");
  assert.equal(H.pick(spots, 300, 300), -1);
  assert.equal(H.pick(null, 0, 0), -1);
});

// --- валидатор content/hidden.json ------------------------------------------
// Негативный тест на каждую строку таблицы: сообщение проверяется подстрокой —
// автор игры читает его глазами. Тесты живут здесь, а не в content.test.js:
// общий файл на четыре параллельные ветки — гарантированный конфликт слияния.
const C = require("./content.js");
const fs = require("node:fs");
const path = require("node:path");

const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "hidden.json"), "utf8"));
const copy = () => JSON.parse(JSON.stringify(REAL));
const first = (data, opts) => (C.validate("hidden", data, opts)[0] || "");

test("боевой content/hidden.json проходит валидатор и с параметрами кита", () => {
  assert.deepEqual(C.validate("hidden", REAL), []);
  assert.deepEqual(C.validate("hidden", REAL, { params: DEFAULTS }), []);
  assert.ok(REAL.items.length >= 8, "в образце меньше восьми предметов: " + REAL.items.length);
});

test("items: 4..40, уникальные id, подпись влезает на полку, icon — ключ картинки", () => {
  let d = copy(); d.items = d.items.slice(0, 3);
  assert.match(first(d), /предметов от 4 до 40/);
  d = copy(); d.items[1].id = d.items[0].id;
  assert.match(first(d), /уже занят/);
  d = copy(); delete d.items[0].title;
  assert.match(first(d), /title — непустая строка/);
  d = copy(); d.items[0].title = "Очень длинное название предмета на всю полку целиком";
  assert.match(first(d), /не влезает/);
  d = copy(); d.items[0].icon = "плохой ключ!";
  assert.match(first(d), /icon — ключ картинки/);
});

test("предметов должно хватать на цели и отвлечения, иначе — число, сколько нужно", () => {
  const need = { targets: 7, decoys: 3 };
  const d = copy();
  d.items = d.items.slice(0, 6);
  const msg = first(d, { params: need });
  assert.match(msg, /предметов 6, а на раскладку нужно 10/);
  // Столько же предметов, сколько просят, — уже достаточно.
  assert.deepEqual(C.validate("hidden", d, { params: { targets: 4, decoys: 2 } }), []);
});

test("непроходимая расстановка ловится валидатором, а не белым экраном", () => {
  // Предметов хватает, а на поле при такой дистанции они не помещаются:
  // проверяется именно расстановка, а не длина списка.
  const d = copy();
  const msg = first(d, { params: { targets: 8, decoys: 2, size: 48, minDistance: 120 } });
  assert.match(msg, /влезает \d+ предметов, а просят \d+/);
  // Та же раскладка при дефолтной дистанции проходит.
  assert.deepEqual(C.validate("hidden", d, { params: { targets: 8, decoys: 2, size: 40, minDistance: 56 } }), []);
});
