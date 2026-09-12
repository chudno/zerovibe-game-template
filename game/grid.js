// Сетка тач-целей целыми пикселями, без Phaser: кит просит «разложи 12 ячеек
// в этом прямоугольнике» и получает числа, а не рисует по магическим
// координатам. Всё целое: центр ячейки дробный на полпикселя — мыло на
// спрайте и промах пальцем. Ячейка меньше 24 px — не тач-цель, поэтому
// раскладка честно возвращает fits:false с числом, сколько ячеек влезет.
// Модуль чистый — гоняется node --test.
(function (root) {
  "use strict";

  // week5: match3 — потолок ячеек поднят с 30 до 72 (поле «три в ряд» это
  // 8×9 клеток); он и был не про механику, а страховкой от «разложи тысячу
  // кнопок». Тач-цель по-прежнему держит minTouch: ячейка меньше 24 px
  // возвращает fits:false с числом, сколько влезет.
  var LIMITS = { minTouch: 24, maxCells: 72, maxCols: 6 };
  var DEFAULT_MIN = { w: 24, h: 24 };
  var DEFAULT_GAP = 8;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  // Чётный размер ячейки: половина ячейки — целое, значит центр целый при
  // целом левом крае.
  function even(v) { return Math.floor(v / 2) * 2; }

  function area(spec) {
    var a = isObj(spec.area) ? spec.area : {};
    return {
      x: Math.round(num(a.x, 0)), y: Math.round(num(a.y, 0)),
      w: Math.round(num(a.w, 0)), h: Math.round(num(a.h, 0))
    };
  }

  // Раскладка count ячеек в области с зазором. Число столбцов берётся из
  // spec.cols, иначе прикидывается по форме области и aspect.
  // spec: { count, area, min, gap, aspect, maxCols, cols }
  function layout(spec) {
    spec = isObj(spec) ? spec : {};
    var count = Math.round(num(spec.count, 0));
    var ar = area(spec);
    var min = isObj(spec.min) ? { w: num(spec.min.w, DEFAULT_MIN.w), h: num(spec.min.h, DEFAULT_MIN.h) } : { w: DEFAULT_MIN.w, h: DEFAULT_MIN.h };
    var gap = Math.max(0, Math.round(num(spec.gap, DEFAULT_GAP)));
    var aspect = num(spec.aspect, 1);
    var maxCols = Math.max(1, Math.round(num(spec.maxCols, LIMITS.maxCols)));
    var empty = { cols: 0, rows: 0, cell: { w: 0, h: 0 }, gap: gap, ox: ar.x, oy: ar.y, cells: [], fits: false, reason: "" };

    if (!(count > 0)) { empty.reason = "нечего раскладывать: count = " + count; return empty; }
    if (count > LIMITS.maxCells) { empty.reason = "ячеек не больше " + LIMITS.maxCells + " (сейчас " + count + ")"; return empty; }
    if (!(ar.w > 0) || !(ar.h > 0)) { empty.reason = "область пустая: " + ar.w + "×" + ar.h; return empty; }

    var cols = Math.round(num(spec.cols, 0));
    if (!(cols > 0)) cols = guessCols(count, ar, gap, aspect, maxCols);
    cols = Math.max(1, Math.min(cols, count, maxCols));
    var rows = Math.ceil(count / cols);

    var cw = even(Math.floor((ar.w - gap * (cols - 1)) / cols));
    var ch = even(Math.floor((ar.h - gap * (rows - 1)) / rows));
    // aspect — желаемое w/h: ужимаем большую сторону, чтобы не выйти за область.
    if (aspect > 0) {
      if (cw > ch * aspect) cw = even(Math.floor(ch * aspect));
      else ch = even(Math.floor(cw / aspect));
    }

    var res = {
      cols: cols, rows: rows, cell: { w: cw, h: ch }, gap: gap,
      ox: ar.x, oy: ar.y, cells: [], fits: true, reason: ""
    };
    if (!(cw >= min.w) || !(ch >= min.h)) {
      res.fits = false;
      res.cells = [];
      res.reason = "на " + count + " ячеек в области " + ar.w + "×" + ar.h + " при цели " + Math.max(min.w, min.h) +
        " px не хватает места: возьми не больше " + maxCount(ar, gap, min, aspect, maxCols) + " ячеек";
      return res;
    }

    // Остаток от деления уходит в поля: блок центрируется в области целыми.
    var blockW = cols * cw + gap * (cols - 1);
    var blockH = rows * ch + gap * (rows - 1);
    res.ox = ar.x + Math.floor((ar.w - blockW) / 2);
    res.oy = ar.y + Math.floor((ar.h - blockH) / 2);

    for (var i = 0; i < count; i++) {
      var c = i % cols, r = Math.floor(i / cols);
      var x = res.ox + c * (cw + gap), y = res.oy + r * (ch + gap);
      res.cells.push({ i: i, c: c, r: r, x: x, y: y, w: cw, h: ch, cx: x + cw / 2, cy: y + ch / 2 });
    }
    return res;
  }

  // Столбцы «на глаз»: у квадратной области — квадратная сетка, у широкой —
  // больше столбцов. Детерминированно, без rng.
  function guessCols(count, ar, gap, aspect, maxCols) {
    var best = 1, bestScore = -1;
    for (var cols = 1; cols <= Math.min(maxCols, count); cols++) {
      var rows = Math.ceil(count / cols);
      var cw = even(Math.floor((ar.w - gap * (cols - 1)) / cols));
      var ch = even(Math.floor((ar.h - gap * (rows - 1)) / rows));
      if (aspect > 0) { if (cw > ch * aspect) cw = even(Math.floor(ch * aspect)); else ch = even(Math.floor(cw / aspect)); }
      var score = cw * ch;
      if (score > bestScore) { bestScore = score; best = cols; }
    }
    return best;
  }

  // Сколько ячеек влезет в область при этой минимальной цели — число для
  // текста ошибки: агенту нужно «возьми не больше 12», а не «не влезло».
  function maxCount(ar, gap, min, aspect, maxCols) {
    var best = 0;
    for (var cols = 1; cols <= maxCols; cols++) {
      var cw = even(Math.floor((ar.w - gap * (cols - 1)) / cols));
      if (!(cw >= min.w)) break;
      for (var rows = 1; rows <= 60; rows++) {
        var ch = even(Math.floor((ar.h - gap * (rows - 1)) / rows));
        var w = cw, h = ch;
        if (aspect > 0) { if (w > h * aspect) w = even(Math.floor(h * aspect)); else h = even(Math.floor(w / aspect)); }
        if (!(w >= min.w) || !(h >= min.h)) break;
        if (cols * rows > best) best = cols * rows;
      }
    }
    return Math.min(best, LIMITS.maxCells);
  }

  // Наилучшая раскладка count ячеек: перебор столбцов, побеждает наибольшая
  // площадь ячейки; при равной площади — меньшее число столбцов (устойчиво).
  function best(count, ar, opts) {
    opts = isObj(opts) ? opts : {};
    var maxCols = Math.max(1, Math.round(num(opts.maxCols, LIMITS.maxCols)));
    var found = null;
    for (var cols = 1; cols <= Math.min(maxCols, Math.max(1, Math.round(num(count, 0)))); cols++) {
      var res = layout({ count: count, area: ar, min: opts.min, gap: opts.gap, aspect: opts.aspect, maxCols: maxCols, cols: cols });
      if (!res.fits) continue;
      var s = res.cell.w * res.cell.h;
      if (!found || s > found.cell.w * found.cell.h) found = res;
    }
    // Ничего не влезло — вернуть раскладку по прикидке ради текста ошибки.
    return found || layout({ count: count, area: ar, min: opts.min, gap: opts.gap, aspect: opts.aspect, maxCols: maxCols });
  }

  // Точка канвы → индекс ячейки или -1 (зазор и поля — промах).
  function hit(lay, x, y) {
    if (!lay || !lay.cells) return -1;
    for (var i = 0; i < lay.cells.length; i++) {
      var c = lay.cells[i];
      if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) return c.i;
    }
    return -1;
  }

  // Перестановка 2n индексов парами: значение j встречается РОВНО дважды.
  // Машинная гарантия чётности пар для «памяти» — кит не считает сам.
  function pairs(n, rng) {
    n = Math.max(0, Math.round(num(n, 0)));
    var list = [];
    for (var j = 0; j < n; j++) { list.push(j); list.push(j); }
    if (rng && typeof rng.shuffle === "function") rng.shuffle(list);
    else if (typeof rng === "function") {
      for (var i = list.length - 1; i > 0; i--) {
        var k = Math.floor(rng() * (i + 1));
        var t = list[i]; list[i] = list[k]; list[k] = t;
      }
    }
    return list;
  }

  // Соседи ячейки по сетке: 4 направления, с diagonal — 8. Пригодится match-3.
  function neighbours(lay, i, diagonal) {
    if (!lay || !lay.cells || !lay.cells[i]) return [];
    var c = lay.cells[i].c, r = lay.cells[i].r, out = [];
    var deltas = diagonal
      ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
      : [[0, -1], [-1, 0], [1, 0], [0, 1]];
    for (var k = 0; k < deltas.length; k++) {
      var j = at(lay, c + deltas[k][0], r + deltas[k][1]);
      if (j >= 0) out.push(j);
    }
    return out;
  }

  // Столбец и строка → индекс или -1 (за краем сетки или за концом списка).
  function at(lay, c, r) {
    if (!lay || !lay.cells || c < 0 || r < 0 || c >= lay.cols || r >= lay.rows) return -1;
    var i = r * lay.cols + c;
    return i < lay.cells.length ? i : -1;
  }

  var api = { LIMITS: LIMITS, layout: layout, best: best, hit: hit, pairs: pairs, neighbours: neighbours, at: at };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_GRID = api;
})(typeof window !== "undefined" ? window : null);
