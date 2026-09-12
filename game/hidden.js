// Расстановка спрятанных предметов числами, без Phaser. Кит не расставляет
// цели «по фону» (агент фона не видит и координаты по картинке не проставит) —
// он просит place() разложить их так, чтобы предметы не наложились друг на
// друга, не слиплись ближе minDistance и целиком лежали в области поля.
// Кандидаты — узлы сетки с шагом не меньше minDistance (потолки те же, что у
// ZV.grid), узел сдвигается джиттером на ЦЕЛЫЕ пиксели: без сдвига предметы
// читаются как таблица, а дробная координата рвёт пиксельную сетку. Джиттер
// ограничен запасом шага над дистанцией — расстановка честна ПО ПОСТРОЕНИЮ,
// а не «разложили и проверили, повезло».
// Невместимость не молчит: возвращается fits:false и число «сколько влезет» —
// автор игры правит targets/size/minDistance по нему, а не гадает.
// Модуль чистый — гоняется node --test и зовётся валидатором content.js.
(function (root) {
  "use strict";

  var GRID = (typeof module !== "undefined" && module.exports) ? require("./grid.js") : root.ZV_GRID;

  var LIMITS = {
    minTouch: 24,    // тач-цель: предмет меньше — палец мажет (та же цифра, что у ZV.grid)
    maxItems: 24     // больше целей на 360×640 не разложить так, чтобы их искали, а не находили
  };

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }

  function area(spec) {
    var a = isObj(spec) ? spec : {};
    return {
      x: Math.round(num(a.x, 0)), y: Math.round(num(a.y, 0)),
      w: Math.round(num(a.w, 0)), h: Math.round(num(a.h, 0))
    };
  }

  function fail(reason, capacity) {
    return { fits: false, reason: reason, capacity: capacity || 0, spots: [] };
  }

  // Сетка кандидатов: ZV.grid.layout раскладывает count ячеек в области, а
  // нам нужно обратное — сколько ячеек с шагом не меньше minDistance туда
  // влезает. Считаем столбцы и строки сами, ячейку строим квадратной со
  // стороной cell: шаг сетки и есть дистанция между соседями.
  function meshOf(ar, size, minDistance) {
    var cell = Math.max(size, minDistance);
    if (!(ar.w > 0) || !(ar.h > 0) || !(cell > 0)) return { cols: 0, rows: 0, cell: cell, count: 0 };
    var cols = Math.min(Math.floor(ar.w / cell), GRID.LIMITS.maxCols);
    var rows = Math.floor(ar.h / cell);
    if (cols < 1 || rows < 1) return { cols: 0, rows: 0, cell: cell, count: 0 };
    // Потолок ZV.grid по ячейкам — граница возможного и для нас: сетку строит
    // он же, просить у него больше 30 ячеек бессмысленно.
    while (cols * rows > Math.min(GRID.LIMITS.maxCells, LIMITS.maxItems)) {
      if (rows > cols) rows -= 1; else cols -= 1;
    }
    return { cols: cols, rows: rows, cell: cell, count: cols * rows };
  }

  // Сколько целей размера size с дистанцией minDistance РЕАЛЬНО влезает.
  // Считается по той же сетке, что и раскладывает place(), иначе число в
  // тексте ошибки врёт — «влезает 24», а расставилось 19.
  function capacityOf(ar, size, minDistance) {
    return meshOf(ar, size, Math.max(size, minDistance)).count;
  }

  // Расстановка. spec: { count, area, size, minDistance, rng, decoys }
  // -> { fits, reason, capacity, spots: [{ i, x, y, size, decoy }] }
  // x/y — ЦЕНТР предмета целыми пикселями. Первые count − decoys точек —
  // цели, хвост — отвлечения: кит раздаёт им предметы сам, расстановке
  // безразлично, кто из них кто, важно лишь, что они не налезают.
  function place(spec) {
    spec = isObj(spec) ? spec : {};
    var count = Math.round(num(spec.count, 0));
    var ar = area(spec.area);
    var size = Math.round(num(spec.size, 40));
    var minDistance = Math.round(num(spec.minDistance, size + 16));
    var decoys = Math.max(0, Math.round(num(spec.decoys, 0)));
    var rng = spec.rng;

    if (!(count > 0)) return fail("нечего прятать: count = " + count, 0);
    if (count > LIMITS.maxItems) return fail("предметов не больше " + LIMITS.maxItems + " (сейчас " + count + ")", LIMITS.maxItems);
    if (size < LIMITS.minTouch) return fail("size " + size + ": предмет меньше " + LIMITS.minTouch + " px — в него не попасть пальцем", 0);
    if (!(ar.w > 0) || !(ar.h > 0)) return fail("область пустая: " + ar.w + "×" + ar.h, 0);
    if (size > ar.w || size > ar.h) return fail("предмет " + size + " px не влезает в область " + ar.w + "×" + ar.h, 0);
    if (minDistance < size) minDistance = size;   // ближе собственной ширины предметы просто налезут

    var capacity = capacityOf(ar, size, minDistance);
    if (count > capacity) {
      return fail("в область " + ar.w + "×" + ar.h + " при size " + size + " и minDistance " + minDistance +
        " влезает " + capacity + " предметов, а просят " + count +
        ": уменьши targets/decoys, size или minDistance", capacity);
    }

    // Кандидаты — узлы сетки. Их берём ВСЕ (capacity), а не count: лишние —
    // запас, из которого выбирает случайность, иначе при count = capacity
    // расстановка была бы одна на все сиды. Узлы центрируются в области, шаг
    // берётся по её реальной ширине/высоте — так остаток уходит в поля, а не
    // прижимает предметы к левому краю.
    var mesh = meshOf(ar, size, minDistance);
    var pitchX = mesh.cols > 1 ? Math.floor((ar.w - size) / (mesh.cols - 1)) : 0;
    var pitchY = mesh.rows > 1 ? Math.floor((ar.h - size) / (mesh.rows - 1)) : 0;
    var half = Math.floor(size / 2);
    var blockW = pitchX * (mesh.cols - 1), blockH = pitchY * (mesh.rows - 1);
    var x0 = ar.x + half + Math.floor((ar.w - size - blockW) / 2);
    var y0 = ar.y + half + Math.floor((ar.h - size - blockH) / 2);

    // Джиттер ограничен ЗАПАСОМ шага над дистанцией: сдвинув два соседних
    // узла навстречу на j каждый, мы обязаны оставить между ними minDistance.
    // Отсюда j ≤ (шаг − minDistance) / 2 — расстановка честна по построению,
    // а не «проверили и повезло».
    var jx = Math.max(0, Math.floor((pitchX - minDistance) / 2));
    var jy = Math.max(0, Math.floor((pitchY - minDistance) / 2));

    var nodes = [];
    for (var r = 0; r < mesh.rows; r++) {
      for (var cN = 0; cN < mesh.cols; cN++) nodes.push({ x: x0 + cN * pitchX, y: y0 + r * pitchY });
    }
    if (rng && typeof rng.shuffle === "function") rng.shuffle(nodes);

    var spots = [];
    for (var k = 0; k < nodes.length && spots.length < count; k++) {
      var dx = jx && rng && rng.between ? rng.between(-jx, jx) : 0;
      var dy = jy && rng && rng.between ? rng.between(-jy, jy) : 0;
      spots.push({
        i: spots.length,
        x: clamp(nodes[k].x + dx, ar.x + half, ar.x + ar.w - half),
        y: clamp(nodes[k].y + dy, ar.y + half, ar.y + ar.h - half),
        size: size, decoy: false
      });
    }

    // Отвлечения — хвост списка: кит сам решает, какими предметами их занять.
    for (var d = spots.length - Math.min(decoys, spots.length); d < spots.length; d++) spots[d].decoy = true;
    return { fits: true, reason: "", capacity: capacity, spots: spots };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

  // Наименьшая дистанция между центрами расстановки: по ней тест и проверяет,
  // что предметы не слиплись. Дистанция меряется по центрам — квадраты одного
  // размера не налезают, пока центры дальше стороны, а minDistance ≥ size.
  function closest(spots) {
    var best = Infinity;
    for (var i = 0; i < (spots || []).length; i++) {
      for (var j = i + 1; j < spots.length; j++) {
        var dx = spots[i].x - spots[j].x, dy = spots[i].y - spots[j].y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) best = d;
      }
    }
    return best;
  }

  // Попадание тапа в предмет: квадрат size вокруг центра, но не уже тач-цели
  // (маленькая картинка не должна делать промахи «честными»).
  function hit(spot, x, y) {
    if (!spot) return false;
    var half = Math.max(spot.size, LIMITS.minTouch) / 2;
    return x >= spot.x - half && x <= spot.x + half && y >= spot.y - half && y <= spot.y + half;
  }

  // Ближайший к точке ненайденный предмет списка или -1: тап в область, где
  // перекрываются тач-цели, должен уходить ближайшему, а не первому по списку.
  function pick(spots, x, y, isDone) {
    var best = -1, bestD = Infinity;
    for (var i = 0; i < (spots || []).length; i++) {
      if (isDone && isDone(spots[i], i)) continue;
      if (!hit(spots[i], x, y)) continue;
      var dx = spots[i].x - x, dy = spots[i].y - y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  var api = { LIMITS: LIMITS, place: place, capacity: capacityOf, closest: closest, hit: hit, pick: pick };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_HIDDEN = api;
})(typeof window !== "undefined" ? window : null);
