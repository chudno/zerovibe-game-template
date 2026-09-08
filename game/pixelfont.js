// Пиксельный шрифт в Phaser: атлас из game/fontdata.js → BitmapText.
// Почему не canvas-текст: браузер даже на точной сетке оставляет серые
// полупиксели по краям глифов и требует дождаться загрузки шрифта; атлас
// рисуется попиксельно, одинаков на любом устройстве и готов до первого
// экрана. Кегль — только целый множитель k (10·k px): fontSize 10, 20, 30, 40.
(function (global) {
  "use strict";

  var KEY = "zv-font";

  // Раскладка глифов по сетке ячеек и рисование битов в canvas.
  function buildAtlas(data) {
    var names = Object.keys(data.glyphs);
    var cellW = 0, cellH = 0, i, g;
    for (i = 0; i < names.length; i++) {
      g = data.glyphs[names[i]];
      if (g.length > 1) { cellW = Math.max(cellW, g[3]); cellH = Math.max(cellH, g[4]); }
    }
    cellW += 1; cellH += 1;   // зазор: NEAREST-фильтр не подтянет соседа
    var cols = Math.ceil(Math.sqrt(names.length));
    var rows = Math.ceil(names.length / cols);
    var canvas = document.createElement("canvas");
    canvas.width = cols * cellW;
    canvas.height = rows * cellH;
    var ctx = canvas.getContext("2d");
    var img = ctx.createImageData(canvas.width, canvas.height);
    var px = img.data;
    var chars = {};
    for (i = 0; i < names.length; i++) {
      var ch = names[i];
      g = data.glyphs[ch];
      var cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
      var entry = {
        x: cx, y: cy, width: 0, height: 0, centerX: 0, centerY: 0,
        xOffset: 0, yOffset: 0, xAdvance: g[0], data: {}, kerning: {}
      };
      if (g.length > 1) {
        var w = g[3], h = g[4], hexRows = g[5].split("|");
        for (var r = 0; r < h; r++) {
          var bits = hexRows[r];
          for (var c = 0; c < w; c++) {
            var nib = parseInt(bits[c >> 2], 16);
            if (nib & (8 >> (c & 3))) {
              var o = ((cy + r) * canvas.width + (cx + c)) * 4;
              px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = 255;
            }
          }
        }
        entry.width = w; entry.height = h;
        entry.centerX = Math.floor(w / 2); entry.centerY = Math.floor(h / 2);
        entry.xOffset = g[1];
        entry.yOffset = data.ascent - g[2];   // от верха строки до верха глифа
      }
      chars[ch.charCodeAt(0)] = entry;
    }
    ctx.putImageData(img, 0, 0);
    // UV глифов Phaser берёт из данных шрифта, а не считает сам (как после
    // ParseXMLBitmapFont): без них каждый глиф рисуется одним пикселем
    // атласа — сплошным прямоугольником.
    Object.keys(chars).forEach(function (code) {
      var e = chars[code];
      e.u0 = e.x / canvas.width;
      e.v0 = e.y / canvas.height;
      e.u1 = (e.x + e.width) / canvas.width;
      e.v1 = (e.y + e.height) / canvas.height;
    });
    return { canvas: canvas, chars: chars };
  }

  // Регистрация шрифта в игре: текстура из canvas + данные BitmapFont.
  // Зовётся один раз из загрузочной сцены оболочки. Идемпотентно.
  function install(scene) {
    if (scene.cache.bitmapFont.has(KEY)) return KEY;
    var data = global.ZV_FONTDATA;
    var atlas = buildAtlas(data);
    scene.textures.addCanvas(KEY, atlas.canvas);
    var fontData = {
      font: data.family,
      size: data.unit,
      lineHeight: data.line,
      retroFont: false,
      chars: atlas.chars
    };
    scene.cache.bitmapFont.add(KEY, { data: fontData, texture: KEY, frame: null });
    return KEY;
  }

  global.ZV_PIXELFONT = { KEY: KEY, install: install, buildAtlas: buildAtlas };
})(window);
