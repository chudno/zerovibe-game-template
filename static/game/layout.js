// Геометрия китов без Phaser: подгонка фона под канву, сетка кадров листа,
// выбор анимации героя. Вынесена отдельно, потому что именно здесь были три
// дефекта, которые тесты на заглушках не ловили (фон 720×1280 показывал только
// центр, лист кадров считался «на глаз», герой залипал в прыжке). Модуль чистый:
// его гоняет node --test на размерах НАСТОЯЩИХ сгенерированных картинок
// (см. layout.test.js), а киты только применяют результат к объектам сцены.
(function (root) {
  "use strict";

  function isPOT(v) {
    return v > 0 && (v & (v - 1)) === 0;
  }

  // Общий целый делитель: картинка ровно в n раз больше канвы по обеим сторонам.
  function fitDivisor(sw, sh, W, H) {
    if (!sw || !sh || sw % W || sh % H) return 0;
    var n = sw / W;
    return n === sh / H && n >= 1 ? n : 0;
  }

  // Как положить картинку sw×sh на канву W×H, не ломая пиксельную сетку:
  //   tile     — tile:true и стороны степени двойки: tileSprite на всю канву;
  //   divisor  — картинка ровно в n раз крупнее (720×1280 → 360×640): scale 1/n,
  //              ровное прореживание пикселей;
  //   upscale  — картинка мельче: целый апскейл ×n (Math.floor);
  //   cover    — иначе: заполнить канву целиком, лишнее за край (setDisplaySize).
  // Возвращает null, если размеров нет (текстура не загрузилась).
  function fitBackground(sw, sh, W, H, tile) {
    if (!sw || !sh || !W || !H) return null;
    if (tile && isPOT(sw) && isPOT(sh)) {
      return { mode: "tile", scale: 1, width: W, height: H };
    }
    var down = fitDivisor(sw, sh, W, H);
    if (down > 1) {
      return { mode: "divisor", scale: 1 / down, width: W, height: H };
    }
    var up = Math.floor(Math.min(W / sw, H / sh));
    if (up >= 1) {
      return { mode: "upscale", scale: up, width: sw * up, height: sh * up };
    }
    var cover = Math.max(W / sw, H / sh);
    return { mode: "cover", scale: cover, width: Math.ceil(sw * cover), height: Math.ceil(sh * cover) };
  }

  // Сетка кадров листа: сколько кадров реально помещается. null — лист не
  // делится на кадры ровно (frameWidth/frameHeight в config не от этого листа).
  function sheetGrid(sheetW, sheetH, frameW, frameH) {
    if (!sheetW || !sheetH || !frameW || !frameH) return null;
    if (sheetW % frameW || sheetH % frameH) return null;
    var cols = sheetW / frameW, rows = sheetH / frameH;
    return { cols: cols, rows: rows, frames: cols * rows };
  }

  // Сколько кадров анимировать: не больше, чем есть в листе. Конфиг может
  // просить 8 при листе на 6 — Phaser тогда молча показывает пустые кадры.
  function animFrames(requested, grid) {
    var have = grid ? grid.frames : 0;
    var want = requested > 0 ? requested : have;
    if (!have) return Math.max(1, want || 1);
    return Math.max(1, Math.min(want, have));
  }

  // Анимация героя-бегуна по факту полёта. Флаг airborne ставит прыжок, а не
  // blocked.down: контакт с полом мигает на стыке кадров, и по нему герой
  // залипал в позе прыжка, стоя на земле.
  function runnerAnim(airborne) {
    return airborne ? "jump" : "run";
  }

  // Хитбокс бегуна уже силуэта: касание плечом — не столкновение. Ширина
  // целая, не меньше 8, смещение — по центру.
  function narrowBody(width, offsetX) {
    var narrow = Math.max(8, Math.round(width * 0.7));
    var inset = Math.round((width - narrow) / 2);
    return { width: narrow, offsetX: offsetX + inset };
  }

  var layout = {
    isPOT: isPOT,
    fitDivisor: fitDivisor,
    fitBackground: fitBackground,
    sheetGrid: sheetGrid,
    animFrames: animFrames,
    runnerAnim: runnerAnim,
    narrowBody: narrowBody
  };

  if (typeof module !== "undefined" && module.exports) module.exports = layout;
  if (root) root.ZV_LAYOUT = layout;
})(typeof window !== "undefined" ? window : null);
