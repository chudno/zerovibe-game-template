// Инвариант «точного тапа»: маркер обязан ходить детерминированно, зона —
// сужаться до дна и не ниже, а на самом тяжёлом раунде в неё обязано быть
// физически возможно попасть. Дефолты кита проверяются отдельно: игра, в
// которую нельзя попасть, ощущается сломанной, а не сложной.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("./timing.js");
const LIMITS_MAX = T.LIMITS.maxBarWidth;

// Дефолты кита (game/kits/timing/kit.js). Расходятся — красный тест, и это
// правильно: честность партии меняется вместе с ними.
const DEFAULTS = {
  rounds: 10, speedStart: 180, speedStep: 16, speedMax: 300,
  zoneStart: 120, zoneMin: 84, zoneStep: 4, barWidth: 300
};

// --- движение маркера --------------------------------------------------------

test("маркер — функция времени: один t даёт одну позицию, накопления нет", () => {
  // Считаем два раза в разбивку на разные шаги: сумма шагов не влияет.
  const at = (t) => T.markerPos(t, 200, 300);
  assert.equal(at(700), at(700));
  assert.equal(at(0), 0);
  // Через полпериода маркер у дальнего края, через период — снова в начале.
  const period = 2 * 300 * 1000 / 200;   // 3000 мс
  assert.equal(Math.round(at(period / 2)), 300);
  assert.equal(Math.round(at(period)), 0);
  assert.equal(Math.round(at(period * 3 + 250)), Math.round(at(250)), "волна не повторяется по периоду");
});

test("треугольная волна: назад идёт зеркально, за край не выходит", () => {
  const speed = 240, width = 300, period = 2 * width * 1000 / speed;
  for (let t = 0; t <= period * 2; t += 37) {
    const p = T.markerPos(t, speed, width);
    assert.ok(p >= 0 && p <= width, `t=${t} → ${p} вне шкалы`);
  }
  // Зеркальность: t и (период − t) дают одно и то же.
  for (const t of [120, 480, 900, 1150]) {
    assert.ok(Math.abs(T.markerPos(t, speed, width) - T.markerPos(period - t, speed, width)) < 1e-9, "волна несимметрична в t=" + t);
  }
});

test("отрицательное и битое время волну не ломают", () => {
  assert.ok(T.markerPos(-500, 200, 300) >= 0);
  assert.equal(T.markerPos(100, 0, 300), 0, "нулевая скорость — маркер стоит в начале");
  assert.equal(T.markerPos(100, 200, 0), 0, "нулевая шкала — позиции нет");
});

// --- раунды: разгон и сужение ------------------------------------------------

test("зона сужается до zoneMin и НЕ ниже, скорость растёт до speedMax и не выше", () => {
  let prevZone = Infinity, prevSpeed = 0;
  for (let r = 0; r < 40; r++) {
    const z = T.zoneWidthFor(r, DEFAULTS), v = T.speedFor(r, DEFAULTS);
    assert.ok(z >= DEFAULTS.zoneMin, `раунд ${r}: зона ${z} уже дна ${DEFAULTS.zoneMin}`);
    assert.ok(v <= DEFAULTS.speedMax, `раунд ${r}: скорость ${v} выше потолка`);
    assert.ok(z <= prevZone && v >= prevSpeed, `раунд ${r}: зона расширилась или скорость упала`);
    prevZone = z; prevSpeed = v;
  }
  // Первый раунд — ровно стартовые числа, к сороковому всё упёрлось в пределы.
  assert.equal(T.zoneWidthFor(0, DEFAULTS), DEFAULTS.zoneStart);
  assert.equal(T.speedFor(0, DEFAULTS), DEFAULTS.speedStart);
  assert.equal(T.zoneWidthFor(39, DEFAULTS), DEFAULTS.zoneMin);
  assert.equal(T.speedFor(39, DEFAULTS), DEFAULTS.speedMax);
});

test("zoneFor: ширина от раунда, положение от rng и целиком внутри шкалы", () => {
  // Подставной rng: крайние значения диапазона — зона обязана влезать в шкалу.
  const low = { between: () => 0 };
  const high = { between: (a, b) => b };
  for (let r = 0; r < 12; r++) {
    const a = T.zoneFor(r, DEFAULTS, low), b = T.zoneFor(r, DEFAULTS, high);
    assert.equal(a.w, b.w, "ширина зоны не должна зависеть от случайности");
    assert.equal(a.w, T.zoneWidthFor(r, DEFAULTS));
    assert.equal(a.x, 0);
    assert.equal(b.x + b.w, DEFAULTS.barWidth, `раунд ${r}: правый край зоны за шкалой`);
    assert.ok(Number.isInteger(a.x) && Number.isInteger(a.w), "координаты зоны целые");
  }
  // Без rng зона встаёт по центру — детерминированный запасной путь.
  const mid = T.zoneFor(0, DEFAULTS, null);
  assert.equal(mid.x, Math.round((DEFAULTS.barWidth - mid.w) / 2));
});

// --- попадание ---------------------------------------------------------------

test("hit: вне зоны none, у края hit, в центре perfect", () => {
  const zone = { x: 100, w: 80 };   // центр 140, идеально при |p−140| ≤ 20
  assert.equal(T.hit(99, zone), "none");
  assert.equal(T.hit(181, zone), "none");
  assert.equal(T.hit(100, zone), "hit", "левая граница засчитывается");
  assert.equal(T.hit(180, zone), "hit", "правая граница засчитывается");
  assert.equal(T.hit(140, zone), "perfect");
  assert.equal(T.hit(120, zone), "perfect", "ровно на границе центра — ещё идеально");
  assert.equal(T.hit(160, zone), "perfect");
  assert.equal(T.hit(119, zone), "hit");
  assert.equal(T.hit(161, zone), "hit");
  assert.equal(T.hit(140, { x: 0, w: 0 }), "none", "нулевая зона ничего не засчитывает");
  assert.equal(T.hit(140, null), "none");
});

// --- честность ---------------------------------------------------------------

test("дефолты кита проходят инвариант окна с запасом", () => {
  const r = T.check(DEFAULTS);
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.windowMs >= T.LIMITS.windowMs, JSON.stringify(r));
  // Самый тяжёлый раунд — последний, а не первый: партия ускоряется.
  assert.equal(r.worst.round, DEFAULTS.rounds);
  assert.equal(r.worst.speed, T.speedFor(DEFAULTS.rounds - 1, DEFAULTS));
  assert.equal(r.worst.zone, T.zoneWidthFor(DEFAULTS.rounds - 1, DEFAULTS));
  // Запас не нулевой: иначе автор игры не сдвинет ни один параметр.
  assert.ok(r.windowMs >= T.LIMITS.windowMs + 20, "окно впритык к порогу: " + r.windowMs);
});

test("fairWindowMs меряет ХУДШИЙ раунд, а не первый", () => {
  const ms = T.fairWindowMs(DEFAULTS);
  const first = Math.round(DEFAULTS.zoneStart * 1000 / DEFAULTS.speedStart);
  assert.ok(ms < first / 2, `окно ${ms} похоже на первый раунд ${first} — меряется не тот конец`);
  assert.equal(ms, Math.round(T.zoneWidthFor(9, DEFAULTS) * 1000 / T.speedFor(9, DEFAULTS)));
  // Партия из одного раунда — он же и худший.
  assert.equal(T.fairWindowMs({ ...DEFAULTS, rounds: 1 }), Math.round(DEFAULTS.zoneStart * 1000 / DEFAULTS.speedStart));
});

test("граница честности: на пороге ок, на шаг за ним — нет, и в тексте числа", () => {
  // Подбираем зону так, чтобы окно было ровно порогом: w = v·порог/1000.
  const v = 300, w = Math.ceil(v * T.LIMITS.windowMs / 1000);
  const edge = { rounds: 1, speedStart: v, speedStep: 0, speedMax: v, zoneStart: w, zoneMin: w, zoneStep: 0, barWidth: 300 };
  assert.equal(T.check(edge).ok, true, JSON.stringify(T.check(edge)));
  const over = T.check({ ...edge, zoneStart: w - 6, zoneMin: w - 6 });
  assert.equal(over.ok, false);
  assert.match(over.reason, /зона \d+ px на скорости \d+ px\/с проходится за \d+ мс/, over.reason);
  assert.match(over.reason, /zoneMin не меньше \d+/, over.reason);
  assert.match(over.reason, /speedMax не больше \d+/, over.reason);
  // Обе подсказки сами проходят проверку — иначе автор игры чинит по кругу.
  const needZone = Number(over.reason.match(/zoneMin не меньше (\d+)/)[1]);
  const maxSpeed = Number(over.reason.match(/speedMax не больше (\d+)/)[1]);
  assert.equal(T.check({ ...edge, zoneStart: needZone, zoneMin: needZone }).ok, true, "подсказка по зоне не лечит");
  assert.equal(T.check({ ...edge, zoneStart: w - 6, zoneMin: w - 6, speedStart: maxSpeed, speedMax: maxSpeed }).ok, true, "подсказка по скорости не лечит");
});

test("нечестные дефолты из плана ловятся именно этим порогом", () => {
  // Числа первой редакции плана: зона 28 px на 445 px/с — 63 мс, попасть нельзя.
  const planned = { rounds: 10, speedStart: 220, speedStep: 25, speedMax: 520, zoneStart: 96, zoneMin: 28, zoneStep: 8, barWidth: 300 };
  const r = T.check(planned);
  assert.equal(r.ok, false);
  assert.ok(r.windowMs < 100, JSON.stringify(r));
});

test("битые числа объясняются словами, а не падают", () => {
  assert.match(T.check({ rounds: 0 }).reason, /хотя бы один/);
  assert.match(T.check({ ...DEFAULTS, barWidth: 0 }).reason, /больше нуля/);
  assert.match(T.check({ ...DEFAULTS, speedStart: 0 }).reason, /больше нуля/);
  assert.match(T.check({ ...DEFAULTS, speedMax: 100 }).reason, /меньше speedStart/);
  assert.match(T.check({ ...DEFAULTS, zoneMin: 0 }).reason, /больше нуля/);
  assert.match(T.check({ ...DEFAULTS, zoneStart: 40, zoneMin: 84 }).reason, /сужается вверх/);
  assert.match(T.check({ ...DEFAULTS, zoneMin: 400, zoneStart: 400 }).reason, /шире шкалы/);
  // Шкала шире канвы 360: числа честные, а половина зоны за краем экрана.
  assert.match(T.check({ ...DEFAULTS, barWidth: 500 }).reason, /не влезает в канву 360 — не больше 340/);
  assert.equal(T.check({ ...DEFAULTS, barWidth: LIMITS_MAX }).ok, true, "ровно потолок ширины обязан проходить");
  // Без параметров вовсе — дефолты модуля, не исключение.
  assert.equal(T.check().ok, true);
  assert.equal(T.check(null).ok, true);
});
