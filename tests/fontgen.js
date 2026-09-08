// Генератор game/fontdata.js из TTF пиксельного шрифта: растр каждого глифа
// на сетке шрифта (1 пиксель = gcd координат), ширины, метрики. Запуск:
//   node tests/fontgen.js            # перезаписать game/fontdata.js
//   node tests/fontgen.js --check    # только сравнить (это делает тест)
// Игра рисует текст спрайтами из этого атласа (BitmapText), а не через
// canvas-текст браузера: у того на любом кегле остаются серые полупиксели,
// и шрифт надо успеть загрузить до первого экрана.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseTTF, rasterize } = require("./ttf.js");

const SRC = path.join(__dirname, "fixtures", "fonts", "pixelcyr_normal.ttf");
const OUT = path.join(__dirname, "..", "game", "fontdata.js");

// Какие символы берём в атлас: ASCII, кириллица с украинскими/белорусскими
// буквами, типографика. Остальное (Latin-1 с диакритикой) игре не нужно.
const RANGES = [[0x20, 0x7E], [0x410, 0x44F], [0x401, 0x401], [0x451, 0x451],
  [0x404, 0x404], [0x454, 0x454], [0x406, 0x407], [0x456, 0x457], [0x408, 0x408], [0x458, 0x458],
  [0x490, 0x491], [0xAB, 0xAB], [0xBB, 0xBB], [0xA0, 0xA0], [0xB7, 0xB7],
  [0x2013, 0x2014], [0x2018, 0x2019], [0x201C, 0x201D], [0x2039, 0x203A], [0x2212, 0x2212]];

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function generate() {
  const font = parseTTF(fs.readFileSync(SRC));
  // Пиксель сетки — НОД всех координат: у Pixel Cyr это 70 единиц из 1000.
  let unit = 0;
  for (const [, gid] of font.cmap) {
    const g = font.contours(gid);
    for (const c of g.contours) for (const [x, y] of c) { unit = gcd(unit, Math.abs(x)); unit = gcd(unit, Math.abs(y)); }
  }
  if (!unit) throw new Error("не удалось определить сетку шрифта");
  const glyphs = {};
  let top = 0, bottom = 0;
  for (const [a, b] of RANGES) {
    for (let cp = a; cp <= b; cp++) {
      const gid = font.cmap.get(cp);
      if (!gid) continue;
      const ch = String.fromCharCode(cp);
      const adv = Math.round(font.advance(gid) / unit);
      const r = rasterize(font.contours(gid), unit);
      if (!r) { glyphs[ch] = [adv]; continue; }
      top = Math.max(top, r.top); bottom = Math.min(bottom, r.top - r.h);
      // Строки битов → hex по 4 бита, старший бит слева.
      const hex = r.rows.map((row) => {
        const padded = row + "0".repeat((4 - row.length % 4) % 4);
        let out = "";
        for (let i = 0; i < padded.length; i += 4) out += parseInt(padded.slice(i, i + 4), 2).toString(16);
        return out;
      }).join("|");
      glyphs[ch] = [adv, r.x, r.top, r.w, r.h, hex];
    }
  }
  const em = Math.round(font.unitsPerEm / unit * 10) / 10;   // 14.3 для Pixel Cyr — справочно
  const data = {
    family: "Pixel Cyr", em, unit: 10, ascent: top, descent: -bottom, line: top - bottom,
    glyphs
  };
  return data;
}

function render(data) {
  const lines = Object.entries(data.glyphs).map(([ch, g]) => `    ${JSON.stringify(ch)}: ${JSON.stringify(g)}`);
  return `// СГЕНЕРИРОВАНО tests/fontgen.js из tests/fixtures/fonts/pixelcyr_normal.ttf — руками не править.
// Пиксельный шрифт Pixel Cyr (Swamp Design & Dubina Nikolay, 2002) растром:
// глиф = [advance, xMin, top, w, h, строки hex], всё в пикселях сетки шрифта.
// unit — кегль k=1 в px (10 = высота капители); ascent/descent — от базовой линии.
(function (root) {
  "use strict";
  var data = {
    family: ${JSON.stringify(data.family)}, em: ${data.em}, unit: ${data.unit},
    ascent: ${data.ascent}, descent: ${data.descent}, line: ${data.line},
    glyphs: {
${lines.join(",\n")}
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = data;
  if (root) root.ZV_FONTDATA = data;
})(typeof window !== "undefined" ? window : null);
`;
}

if (require.main === module) {
  const text = render(generate());
  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (cur !== text) { console.error("game/fontdata.js устарел — запусти node tests/fontgen.js"); process.exit(1); }
    console.log("fontdata актуален");
  } else {
    fs.writeFileSync(OUT, text);
    console.log("записан", path.relative(process.cwd(), OUT), Object.keys(generate().glyphs).length, "глифов");
  }
}

module.exports = { generate, render, SRC, OUT };
