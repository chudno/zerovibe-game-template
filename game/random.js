// Случайность игры с сидом: один сид — одна и та же партия. Нужен для
// воспроизводимых багрепортов («открой ?seed=42 — на третьем препятствии
// герой застревает») и для автопрогона: без сида порог «бот обязан
// выиграть» мигал бы от запуска к запуску. Math.random в китах запрещён
// (tests/kits.test.js), всё через ZV.random. Модуль чистый — гоняется node.
(function (root) {
  "use strict";

  // xmur3: строковый сид → 32-битное число. «курьер» и «Курьер» — разные партии.
  function hashString(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // Любое значение → целый сид. Пусто — сид со времени (обычная игра).
  function normalizeSeed(seed) {
    if (typeof seed === "number" && isFinite(seed)) return seed >>> 0;
    if (typeof seed === "string" && seed !== "") {
      if (/^-?\d+$/.test(seed)) return Number(seed) >>> 0;
      return hashString(seed);
    }
    return (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
  }

  // Сид из адреса страницы: ?seed=42 или ?seed=курьер.
  function seedFromSearch(search) {
    var m = /[?&]seed=([^&#]*)/.exec(search || "");
    if (!m) return undefined;
    var v = decodeURIComponent(m[1].replace(/\+/g, " "));
    return v === "" ? undefined : v;
  }

  // mulberry32: 32 бита состояния, период 2^32, ровное распределение —
  // для игры с запасом, а код в десять строк.
  function create(seed) {
    var state = normalizeSeed(seed);
    var rng = function next() {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.seed = state;

    // Целое от min до max включительно (как Phaser.Math.Between).
    rng.between = function (min, max) {
      return Math.floor(rng() * (max - min + 1)) + min;
    };
    rng.float = function (min, max) {
      return min + rng() * (max - min);
    };
    // Событие с вероятностью p (0..1).
    rng.chance = function (p) {
      return rng() < p;
    };
    rng.pick = function (list) {
      if (!list || !list.length) return undefined;
      return list[Math.floor(rng() * list.length)];
    };
    // Фишер–Йетс на месте; возвращает тот же массив.
    rng.shuffle = function (list) {
      for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = list[i]; list[i] = list[j]; list[j] = t;
      }
      return list;
    };
    // Взвешенный выбор: weightOf(item) → неотрицательное число, по умолчанию
    // item.weight. Нулевые и отрицательные веса не выпадают никогда.
    rng.weighted = function (items, weightOf) {
      weightOf = weightOf || function (it) { return it.weight; };
      var total = 0, i, w;
      for (i = 0; i < items.length; i++) {
        w = Number(weightOf(items[i]));
        if (w > 0) total += w;
      }
      if (!total) return undefined;
      var r = rng() * total;
      for (i = 0; i < items.length; i++) {
        w = Number(weightOf(items[i]));
        if (!(w > 0)) continue;
        r -= w;
        if (r < 0) return items[i];
      }
      return items[items.length - 1];
    };
    return rng;
  }

  var api = {
    hashString: hashString,
    normalizeSeed: normalizeSeed,
    seedFromSearch: seedFromSearch,
    create: create
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_RANDOM = api;
})(typeof window !== "undefined" ? window : null);
