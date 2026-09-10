// Пул предметов с весами и категориями: что едет по ленте, что падает
// сверху. Общий слой вместо «случайности россыпью по киту» — и сразу с двумя
// правилами честности: предмет не выпадает третий раз подряд (maxRepeat),
// а deal(n, {spread}) не даёт трёх подряд из одной категории. Веса берутся
// через ZV.random.weighted, поэтому сходимость к весам уже покрыта тестом
// сида. Модуль чистый — гоняется node --test.
(function (root) {
  "use strict";

  var DEFAULT_MAX_REPEAT = 2;   // третий раз подряд один и тот же предмет — уже не случайность на глаз

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function weightOf(item) {
    if (!isObj(item)) return 0;
    var w = item.weight === undefined ? 1 : Number(item.weight);
    return isFinite(w) ? w : 0;
  }

  // Форма пула для валидатора кита: зовётся из game/content.js.
  function checkShape(items, opts) {
    opts = isObj(opts) ? opts : {};
    var where = opts.where || "items";
    var errors = [], seen = {}, positive = 0, i, it;
    if (!Array.isArray(items) || !items.length) return [where + ": массив предметов, хотя бы один"];
    var min = typeof opts.min === "number" ? opts.min : 1;
    var max = typeof opts.max === "number" ? opts.max : 40;
    if (items.length < min || items.length > max) errors.push(where + ": предметов от " + min + " до " + max + " (сейчас " + items.length + ")");
    for (i = 0; i < items.length; i++) {
      it = items[i];
      var at = where + "[" + i + "]";
      if (!isObj(it)) { errors.push(at + ": объект предмета"); continue; }
      if (typeof it.id !== "string" || !it.id) errors.push(at + ": нужен id строкой");
      else if (seen[it.id]) errors.push(at + ": id «" + it.id + "» уже занят");
      else seen[it.id] = true;
      if (it.weight !== undefined && (typeof it.weight !== "number" || !isFinite(it.weight) || it.weight < 0)) {
        errors.push(at + ": weight — неотрицательное число (сейчас " + it.weight + ")");
      }
      if (opts.categories && typeof it.category !== "string") errors.push(at + ": нужна category строкой");
      if (weightOf(it) > 0) positive++;
    }
    if (!positive) errors.push(where + ": ни одного предмета с весом больше нуля — выбирать не из чего");
    return errors;
  }

  function create(items, rng) {
    items = Array.isArray(items) ? items.slice() : [];
    var last = null, streak = 0;

    // Кандидаты с положительным весом, минус исключения и минус предмет,
    // который уже выпал maxRepeat раз подряд (если есть из чего выбирать).
    function candidates(opts) {
      opts = isObj(opts) ? opts : {};
      var maxRepeat = typeof opts.maxRepeat === "number" ? opts.maxRepeat : DEFAULT_MAX_REPEAT;
      var exclude = opts.exclude, list = [], i, it;
      for (i = 0; i < items.length; i++) {
        it = items[i];
        if (weightOf(it) <= 0) continue;
        if (opts.category !== undefined && it.category !== opts.category) continue;
        if (exclude && indexOfId(exclude, it.id) >= 0) continue;
        list.push(it);
      }
      if (maxRepeat > 0 && last && streak >= maxRepeat && list.length > 1) {
        var thinned = [];
        for (i = 0; i < list.length; i++) if (list[i].id !== last.id) thinned.push(list[i]);
        if (thinned.length) list = thinned;
      }
      return list;
    }

    function indexOfId(list, id) {
      for (var i = 0; i < list.length; i++) if (list[i] === id) return i;
      return -1;
    }

    var pool = {
      items: function () { return items.slice(); },
      weightOf: weightOf,

      // Взвешенный выбор. Никогда не вернёт предмет с весом ≤ 0 и никогда
      // undefined, если положительный вес в пуле есть.
      pick: function (opts) {
        var list = candidates(opts);
        if (!list.length) {
          throw new Error("в пуле нет предметов с весом больше нуля" +
            (isObj(opts) && opts.category !== undefined ? " в категории «" + opts.category + "»" : ""));
        }
        var it = rng && rng.weighted ? rng.weighted(list, weightOf) : list[0];
        if (!it) it = list[0];
        if (last && it.id === last.id) streak++;
        else { last = it; streak = 1; }
        return it;
      },

      // Категории в порядке первого появления — стабильный порядок корзин.
      categories: function () {
        var out = [], seen = {};
        for (var i = 0; i < items.length; i++) {
          var c = items[i] && items[i].category;
          if (typeof c !== "string" || seen[c]) continue;
          seen[c] = true; out.push(c);
        }
        return out;
      },
      byCategory: function (cat) {
        var out = [];
        for (var i = 0; i < items.length; i++) if (items[i] && items[i].category === cat) out.push(items[i]);
        return out;
      },

      // n предметов подряд. opts.spread — не больше двух подряд из одной
      // категории, если есть выбор (иначе «собери заказ» выдаёт 12 подряд
      // в одну корзину и игрок думает, что игра сломалась).
      deal: function (n, opts) {
        opts = isObj(opts) ? opts : {};
        n = Math.max(0, Math.round(Number(n) || 0));
        var out = [], catRun = { cat: null, count: 0 };
        for (var i = 0; i < n; i++) {
          var o = { category: opts.category, exclude: opts.exclude, maxRepeat: opts.maxRepeat };
          if (opts.spread && catRun.count >= 2 && catRun.cat !== null && opts.category === undefined) {
            var others = [];
            for (var j = 0; j < items.length; j++) {
              if (weightOf(items[j]) > 0 && items[j].category !== catRun.cat) others.push(items[j]);
            }
            if (others.length) {
              var alt = rng && rng.weighted ? rng.weighted(others, weightOf) : others[0];
              if (alt) {
                out.push(alt);
                if (last && alt.id === last.id) streak++; else { last = alt; streak = 1; }
                catRun = { cat: alt.category, count: 1 };
                continue;
              }
            }
          }
          var it = pool.pick(o);
          out.push(it);
          if (it.category === catRun.cat) catRun.count++;
          else catRun = { cat: it.category, count: 1 };
        }
        return out;
      },

      // Сброс антиповтора: новая партия на той же сцене начинается набело.
      reset: function () { last = null; streak = 0; return pool; }
    };
    return pool;
  }

  // Сколько мс предмет виден, пока едет distance px со скоростью speed px/с.
  // Общая формула окна реакции: ею меряют честность темпа и sort, и ловилка.
  function visibleMs(speedPxPerSec, distancePx) {
    var v = Number(speedPxPerSec), d = Number(distancePx);
    if (!isFinite(v) || v <= 0 || !isFinite(d) || d <= 0) return 0;
    return Math.round((d / v) * 1000);
  }

  var api = { DEFAULT_MAX_REPEAT: DEFAULT_MAX_REPEAT, create: create, checkShape: checkShape, weightOf: weightOf, visibleMs: visibleMs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_POOL = api;
})(typeof window !== "undefined" ? window : null);
