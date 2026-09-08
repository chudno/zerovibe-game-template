// Пиксельный шрифт игры числами, без Phaser: ширины глифов из game/fontdata.js,
// перенос строк как у BitmapText (по словам) и подбор кегля, при котором текст
// влезает. Кегль — только целый множитель k: 10·k px (k=1 капитель 10 px).
// Регистра у шрифта нет: строчные — те же капители. Эти же функции гоняет
// node --test на content/*.json — «текст влезает» проверяется настоящими
// метриками, а не числом символов.
(function (root) {
  "use strict";

  var data = (typeof module !== "undefined" && module.exports) ? require("./fontdata.js") : root.ZV_FONTDATA;
  var UNIT = data.unit;      // px на k=1
  var DEFAULT_WIDTH = 8;     // ширина неизвестного символа (после sanitize таких нет)

  // Замены символов, которых в шрифте нет, на те, что есть: иначе BitmapText
  // пропустит символ, и слово слипнется.
  var REPLACE = { "…": "...", "₽": "р.", "№": "N", "€": "EUR", "$": "USD", "°": "*", " ": " ", "\t": " " };
  var REPLACE_RE = /[…₽№€$° \t]/g;

  function sanitize(text) {
    return String(text == null ? "" : text).replace(REPLACE_RE, function (ch) { return REPLACE[ch]; });
  }

  // Символы строки без глифа (после sanitize).
  function missing(text) {
    var out = [], s = sanitize(text);
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === "\n" || data.glyphs[ch]) continue;
      if (out.indexOf(ch) < 0) out.push(ch);
    }
    return out;
  }

  function unitWidth(text) {
    var s = sanitize(text), w = 0;
    for (var i = 0; i < s.length; i++) {
      var g = data.glyphs[s[i]];
      w += g ? g[0] : DEFAULT_WIDTH;
    }
    return w;
  }

  // Ширина строки без переносов в экранных px при кегле k.
  function width(text, k) {
    return unitWidth(text) * (k || 1);
  }

  // Перенос как в BitmapText с maxWidth: по пробелам, слово длиннее строки не
  // рвётся (вылезает). Явные \n — новые строки.
  function wrap(text, maxWidth, k) {
    k = k || 1;
    var lines = [];
    sanitize(text).split("\n").forEach(function (para) {
      var words = para.split(" "), line = "";
      for (var i = 0; i < words.length; i++) {
        var probe = line ? line + " " + words[i] : words[i];
        if (line && width(probe, k) > maxWidth) {
          lines.push(line);
          line = words[i];
        } else {
          line = probe;
        }
      }
      lines.push(line);
    });
    return lines;
  }

  // Влезает ли: не больше maxLines строк, ни одна не шире maxWidth.
  function fits(text, maxWidth, maxLines, k) {
    var lines = wrap(text, maxWidth, k);
    if (lines.length > maxLines) return false;
    for (var i = 0; i < lines.length; i++) if (width(lines[i], k) > maxWidth) return false;
    return true;
  }

  // Наибольший k ≤ kMax, при котором влезает; 0 — не влезает даже при k=1.
  function fit(text, maxWidth, maxLines, kMax) {
    for (var k = kMax || 2; k >= 1; k--) if (fits(text, maxWidth, maxLines, k)) return k;
    return 0;
  }

  // Высота блока текста в px: строк × высота строки × k (+ lineSpacing между строками).
  function height(lines, k, lineSpacing) {
    return lines * data.line * k + Math.max(0, lines - 1) * (lineSpacing || 0);
  }

  var api = {
    FAMILY: data.family, UNIT: UNIT, LINE: data.line, ASCENT: data.ascent, DESCENT: data.descent,
    px: function (k) { return (UNIT * k) + "px"; },
    sanitize: sanitize, missing: missing, width: width, wrap: wrap, fits: fits, fit: fit, height: height
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_FONT = api;
})(typeof window !== "undefined" ? window : null);
