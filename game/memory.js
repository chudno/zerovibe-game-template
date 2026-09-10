// Раздача карточек «памяти» без Phaser: автор задаёт число пар и словарь
// видов, а СКОЛЬКО карточек лежит на поле — считает эта функция как 2·pairs.
// Отсюда машинная гарантия чётности: нечётной раскладки не бывает в принципе,
// её неоткуда взять. Перестановка позиций — ZV_GRID.pairs (один сид → одна
// раскладка), выбор видов — по порядку словаря, без случайности: два вида с
// одинаковой подписью не должны меняться местами от прогона к прогону.
// Модуль чистый — гоняется node --test.
(function (root) {
  "use strict";

  var GRID = (typeof module !== "undefined" && module.exports) ? require("./grid.js") : (root ? root.ZV_GRID : null);

  var LIMITS = { minPairs: 2, maxPairs: 12 };

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clampPairs(v) {
    var n = Math.round(typeof v === "number" && isFinite(v) ? v : 0);
    return Math.max(0, Math.min(n, LIMITS.maxPairs));
  }

  // round: { pairs, moves? }, cards: [{ id, title, ... }], rng: ZV.random.
  // Возвращает { pairs, values: [id…] длиной 2·pairs (каждый ровно дважды),
  // order: [позиция…] той же длины, deck: [card…] выбранные виды }.
  function deal(round, cards, rng) {
    var pairs = clampPairs(isObj(round) ? round.pairs : 0);
    var list = Array.isArray(cards) ? cards.filter(isObj) : [];
    if (pairs > list.length) pairs = list.length;   // видов меньше, чем пар: валидатор уже сказал словами
    var deck = list.slice(0, pairs);
    // Позиции: перестановка 2·pairs индексов, где каждое значение ровно дважды.
    var order = GRID.pairs(pairs, rng);
    var values = [];
    for (var i = 0; i < order.length; i++) values.push(deck[order[i]].id);
    return { pairs: pairs, values: values, order: order, deck: deck };
  }

  // Минимум ходов при идеальной памяти: первая встреча каждого вида может
  // стоить промаха, дальше пара берётся наверняка. Отсюда и порог валидатора
  // «moves ниже минимума — раунд непроходим».
  function minMoves(pairs) {
    return clampPairs(pairs) * 2;
  }

  var api = { LIMITS: LIMITS, deal: deal, minMoves: minMoves };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_MEMORY = api;
})(typeof window !== "undefined" ? window : null);
