// Ядро кита «Точный тап»: где маркер на шкале в момент t, какая зона у раунда
// и честно ли вообще успеть по ней тапнуть. Без Phaser — гоняется node --test
// и зовётся китом при create.
//
// Движение маркера — ЧИСТАЯ функция модельного времени (треугольная волна),
// а не накопленная в update координата: иначе просадка кадров сдвигала бы
// партию, и один сид перестал бы давать одну игру. Случайность только у
// положения зоны, и только через ZV.random.
//
// Тот же класс проверки, что окно реакции у game/sort.js и солвер
// проходимости у платформера: игра, в которой физически нельзя попасть, —
// не сложная, а сломанная. Меряется САМЫЙ ТЯЖЁЛЫЙ раунд (последний: зона уже
// сузилась до zoneMin, маркер разогнался до speedMax), а не первый.
(function (root) {
  "use strict";

  // Пороги честности.
  // windowMs — сколько маркер обязан пробыть в зоне на худшем раунде: 250 мс
  // это реакция ~200 мс плюс попадание пальцем. Ниже — «игра не засчитывает».
  // perfectRatio — какая доля зоны считается центром («идеально», ×2 очков):
  // четверть ширины по каждую сторону от центра, то есть половина зоны.
  // maxBarWidth — шкала обязана помещаться в канву 360 с полями: шкала шире
  // экрана рисуется за краями, и часть зоны просто не видна — попасть в неё
  // можно только вслепую.
  var LIMITS = { windowMs: 250, perfectRatio: 0.25, maxBarWidth: 340 };

  function num(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? n : dflt;
  }

  // Значения по умолчанию — те же, что DEFAULTS кита (расходятся — красный
  // тест game/timing.test.js).
  function read(p) {
    p = p || {};
    return {
      rounds: Math.round(num(p.rounds, 10)),
      speedStart: num(p.speedStart, 180),
      speedStep: num(p.speedStep, 16),
      speedMax: num(p.speedMax, 300),
      zoneStart: num(p.zoneStart, 120),
      zoneMin: num(p.zoneMin, 84),
      zoneStep: num(p.zoneStep, 4),
      barWidth: num(p.barWidth, 300)
    };
  }

  // --- движение маркера --------------------------------------------------------

  // markerPos(t, speed, width) -> позиция 0..width в момент t (мс).
  // Треугольная волна: маркер идёт вправо со скоростью speed px/с, доходит до
  // края, разворачивается. Период — 2·width/speed. Функция только от t:
  // одинаковый t даёт одинаковую позицию при любом раскладе кадров.
  function markerPos(t, speed, width) {
    speed = num(speed, 0);
    width = num(width, 0);
    if (!(width > 0)) return 0;
    if (!(speed > 0)) return 0;
    var period = 2 * width * 1000 / speed;         // полный цикл «туда и обратно», мс
    var x = num(t, 0) % period;
    if (x < 0) x += period;                        // отрицательное время не ломает волну
    var half = period / 2;
    var pos = x <= half ? (x / half) * width : (2 - x / half) * width;
    // Дробь наружу не отдаём: канва пиксельная, позиция маркера целая.
    return Math.max(0, Math.min(width, pos));
  }

  // --- раунды ------------------------------------------------------------------

  // Скорость и ширина зоны раунда (round с нуля). Обе меняются линейно и
  // упираются в потолок/дно — так же, как разгон ленты в sort.
  function speedFor(round, params) {
    var s = read(params);
    return Math.min(s.speedMax, s.speedStart + s.speedStep * Math.max(0, round));
  }
  function zoneWidthFor(round, params) {
    var s = read(params);
    return Math.max(s.zoneMin, s.zoneStart - s.zoneStep * Math.max(0, round));
  }

  // zoneFor(round, params, rng) -> { x, w } — левый край и ширина зоны в
  // координатах шкалы 0..barWidth. Случайно только положение: ширина —
  // функция номера раунда, иначе «повезло с широкой зоной» вместо умения.
  function zoneFor(round, params, rng) {
    var s = read(params);
    var w = zoneWidthFor(round, params);
    var span = Math.max(0, s.barWidth - w);
    var x = span > 0 && rng ? rng.between(0, span) : Math.round(span / 2);
    return { x: Math.max(0, Math.min(span, Math.round(x))), w: Math.round(w) };
  }

  // hit(pos, zone) -> "none" | "hit" | "perfect".
  // Центр зоны шириной perfectRatio·w в каждую сторону — «идеально».
  function hit(pos, zone) {
    if (!zone || !(zone.w > 0)) return "none";
    var p = num(pos, -1);
    if (p < zone.x || p > zone.x + zone.w) return "none";
    var center = zone.x + zone.w / 2;
    return Math.abs(p - center) <= zone.w * LIMITS.perfectRatio ? "perfect" : "hit";
  }

  // --- честность ---------------------------------------------------------------

  // fairWindowMs(params) -> сколько миллисекунд маркер проводит в зоне на
  // САМОМ ТЯЖЁЛОМ раунде партии: узкая зона (zoneMin к последнему раунду) и
  // высокая скорость (speedMax). Маркер идёт равномерно, значит время в
  // зоне — её ширина, делённая на скорость.
  function fairWindowMs(params) {
    var s = read(params);
    var last = Math.max(0, s.rounds - 1);
    var w = zoneWidthFor(last, params);
    var v = speedFor(last, params);
    if (!(v > 0)) return Infinity;
    return Math.round(w * 1000 / v);
  }

  // check(params) -> { ok, reason, windowMs, limits, worst }
  // reason ОБЯЗАН нести числа: автор игры правит config.params по ним, а не
  // угадывает. Кит зовёт это в create и на нечестных числах показывает
  // ZV.ui.fail со списком — экран ошибки вместо игры, в которую не попасть.
  function check(params) {
    var s = read(params);
    var last = Math.max(0, s.rounds - 1);
    var bad = [];
    if (!(s.rounds >= 1)) bad.push("params.rounds " + s.rounds + ": раундов должно быть хотя бы один");
    if (!(s.barWidth > 0)) bad.push("params.barWidth " + s.barWidth + ": ширина шкалы — число больше нуля");
    if (!(s.speedStart > 0)) bad.push("params.speedStart " + s.speedStart + ": скорость маркера — число больше нуля");
    if (s.speedMax < s.speedStart) {
      bad.push("params.speedMax " + s.speedMax + " меньше speedStart " + s.speedStart + ": потолок скорости ниже стартовой");
    }
    if (!(s.zoneMin > 0)) bad.push("params.zoneMin " + s.zoneMin + ": ширина зоны — число больше нуля");
    if (s.zoneStart < s.zoneMin) {
      bad.push("params.zoneStart " + s.zoneStart + " меньше zoneMin " + s.zoneMin + ": зона сужается вверх");
    }
    if (s.zoneMin > s.barWidth) {
      bad.push("params.zoneMin " + s.zoneMin + " шире шкалы " + s.barWidth + ": зона не помещается");
    }
    if (s.barWidth > LIMITS.maxBarWidth) {
      bad.push("params.barWidth " + s.barWidth + ": шкала не влезает в канву 360 — не больше " + LIMITS.maxBarWidth);
    }
    if (bad.length) return fail(bad[0], 0, s, last);

    var ms = fairWindowMs(params);
    if (ms < LIMITS.windowMs) {
      var v = speedFor(last, params), w = zoneWidthFor(last, params);
      // Готовые числа на выбор: либо шире зона, либо ниже потолок скорости.
      var needZone = Math.ceil(v * LIMITS.windowMs / 1000);
      var maxSpeed = Math.floor(w * 1000 / LIMITS.windowMs);
      return fail(
        "раунд " + (last + 1) + ": зона " + w + " px на скорости " + v + " px/с проходится за " + ms +
        " мс — попасть нельзя (нужно от " + LIMITS.windowMs + "). Либо zoneMin не меньше " + needZone +
        ", либо speedMax не больше " + maxSpeed,
        ms, s, last);
    }
    return { ok: true, reason: "", windowMs: ms, limits: LIMITS, worst: worstOf(s, last, params) };
  }

  function worstOf(s, last, params) {
    return { round: last + 1, speed: speedFor(last, params), zone: zoneWidthFor(last, params) };
  }
  function fail(reason, ms, s, last) {
    return { ok: false, reason: reason, windowMs: ms, limits: LIMITS, worst: { round: last + 1, speed: s.speedStart, zone: s.zoneMin } };
  }

  var api = {
    LIMITS: LIMITS,
    markerPos: markerPos,
    speedFor: speedFor,
    zoneWidthFor: zoneWidthFor,
    zoneFor: zoneFor,
    hit: hit,
    fairWindowMs: fairWindowMs,
    check: check
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_TIMING = api;
})(typeof window !== "undefined" ? window : null);
