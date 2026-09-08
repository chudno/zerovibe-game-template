// Баланс раннера числами, без Phaser: окно прыжка и время реакции при данных
// параметрах. Нужен, чтобы дефолты кита и правки агента проверялись тестом, а
// не ощущением «вроде проходимо». Реакция считается до ЗАКРЫТИЯ окна прыжка
// (последний момент, когда тап ещё спасает), а не до его открытия: план
// архетипов §0 мерил до открытия и получал «10 мс на скорости 500» — это
// время, которое надо ПОДОЖДАТЬ перед прыжком, оно не мешает игроку.
(function (root) {
  "use strict";

  // Геометрия кита (канва 360×640): герой стоит на x=80, тело ≈22 px шириной,
  // препятствие появляется центром на x=400 и видно, когда его левый край
  // пересёк правый край канвы.
  var GEO = { heroRight: 91, spawnX: 400, canvasW: 360, bodyW: 22 };

  // Время полёта при прыжке jump и притяжении gravity, с.
  function flight(p) {
    return 2 * p.jump / p.gravity;
  }

  // Интервал времени после отрыва, когда низ героя выше h: корни
  // jump·t − gravity/2·t² = h. null — прыжок ниже препятствия.
  function aboveInterval(p, h) {
    var a = p.gravity / 2, b = -p.jump, c = h;
    var d = b * b - 4 * a * c;
    if (d < 0) return null;
    var s = Math.sqrt(d);
    return { from: (-b - s) / (2 * a), to: (-b + s) / (2 * a) };
  }

  // Окно прыжка по расстоянию D от правого края тела до левого края
  // препятствия шириной w и высотой h при скорости v: препятствие проходит под
  // героем за (D..D+w+bodyW)/v, и всё это время герой обязан быть выше h.
  function jumpWindow(p, v, w, h) {
    var iv = aboveInterval(p, h);
    if (!iv) return null;
    var span = w + GEO.bodyW;
    var dMin = iv.from * v, dMax = iv.to * v - span;
    if (dMax <= dMin) return null;
    return { dMin: dMin, dMax: dMax, ms: (dMax - dMin) / v * 1000 };
  }

  // Время реакции: от момента, когда препятствие показалось на экране, до
  // последнего момента, когда ещё можно прыгнуть (окно закрывается на dMin).
  function reactionMs(p, v, w, h) {
    var win = jumpWindow(p, v, w, h);
    if (!win) return 0;
    var visibleD = (GEO.canvasW - w / 2) - GEO.heroRight;   // D в момент появления
    var spawnD = (GEO.spawnX - w / 2) - GEO.heroRight;
    var start = Math.min(visibleD, spawnD);
    return Math.max(0, (start - win.dMin) / v * 1000);
  }

  // Сводка по всему диапазону скоростей для набора препятствий
  // [{w, h}]: худшее время реакции, самое узкое окно, запас паузы спавна.
  function runnerReport(p, blocks) {
    var worstReaction = Infinity, narrowest = Infinity, atSpeed = p.speedStart;
    for (var v = p.speedStart; v <= p.speedMax + 1e-9; v += p.speedStep) {
      for (var i = 0; i < blocks.length; i++) {
        var r = reactionMs(p, v, blocks[i].w, blocks[i].h);
        var win = jumpWindow(p, v, blocks[i].w, blocks[i].h);
        if (r < worstReaction) { worstReaction = r; atSpeed = v; }
        if (!win) narrowest = 0; else if (win.ms < narrowest) narrowest = win.ms;
      }
    }
    var fl = flight(p) * 1000;
    return {
      flightMs: fl,
      worstReactionMs: worstReaction,
      worstReactionAtSpeed: atSpeed,
      narrowestWindowMs: narrowest,
      spawnMargin: p.spawnMin / fl
    };
  }

  var api = { GEO: GEO, flight: flight, aboveInterval: aboveInterval, jumpWindow: jumpWindow, reactionMs: reactionMs, runnerReport: runnerReport };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_BALANCE = api;
})(typeof window !== "undefined" ? window : null);
