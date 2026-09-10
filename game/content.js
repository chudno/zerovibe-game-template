// Слой данных игры без Phaser: слияние параметров кита с config.params и
// проверка контента (content/*.json). Одни и те же функции гоняет node --test
// на файлах репозитория и зовёт кит при старте: битый контент показывается
// списком ошибок на экране, а не белой страницей. Модуль чистый.
(function (root) {
  "use strict";

  // --- параметры кита ------------------------------------------------------
  // defaults — объект кита (числа, строки, булевы). overrides — config.params и
  // тестовые перекрытия. Неизвестный ключ и ключ другого типа не применяются,
  // а попадают в warnings: агент видит опечатку, игра остаётся рабочей.
  function mergeParams(defaults, overrides) {
    var out = {}, warnings = [], k;
    for (k in defaults) {
      if (Object.prototype.hasOwnProperty.call(defaults, k)) out[k] = defaults[k];
    }
    var list = Array.prototype.slice.call(arguments, 1);
    for (var i = 0; i < list.length; i++) {
      var src = list[i];
      if (!src || typeof src !== "object") continue;
      for (k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        if (!Object.prototype.hasOwnProperty.call(defaults, k)) {
          warnings.push("неизвестный параметр «" + k + "»");
          continue;
        }
        var want = typeof defaults[k], got = typeof src[k];
        if (want !== got || (want === "number" && !isFinite(src[k]))) {
          warnings.push("параметр «" + k + "»: ожидается " + want + ", получено " + got);
          continue;
        }
        out[k] = src[k];
      }
    }
    return { params: out, warnings: warnings };
  }

  // --- проверки контента ----------------------------------------------------
  // «Влезает» считается настоящими метриками пиксельного шрифта (game/font.js):
  // ширина области на канве 360×640, сколько строк допустимо и какой кегль k
  // (10·k px) там используется. Числа совпадают с раскладкой оболочки и китов.
  var FONT = (typeof module !== "undefined" && module.exports) ? require("./font.js") : root.ZV_FONT;
  var AREAS = {
    question:    { width: 300, lines: 4, k: 2 },          // вопрос квиза / теста, кегль 2
    answer:      { width: 270, lines: 2, k: 2, kMin: 1 }, // кнопка-вариант 64 px; кегль 1 — запас
    typeTitle:   { width: 300, lines: 2, k: 2, prefix: "Ты — " },
    typeText:    { width: 290, lines: 4, k: 1 },
    prizeTitle:  { width: 284, lines: 2, k: 2, kMin: 1 },
    prizeCode:   { width: 200, lines: 1, k: 2, kMin: 1 },
    prizeText:   { width: 284, lines: 3, k: 1 },
    prizeButton: { width: 224, lines: 1, k: 2, kMin: 1 },
    sector:      { width: 76,  lines: 2, k: 1 },          // сектор колеса (≤8 секторов)
    sectorSmall: { width: 56,  lines: 2, k: 1 },          // сектор колеса (9–12 секторов)
    levelName:   { width: 300, lines: 2, k: 2, kMin: 1 }, // заставка уровня (заголовок)
    levelHint:   { width: 290, lines: 2, k: 1 },          // подсказка под ней
    novelSpeaker:{ width: 200, lines: 1, k: 1 },          // имя говорящего над репликой
    novelText:   { width: 312, lines: 5, k: 1 },          // реплика в панели новеллы
    novelChoice: { width: 270, lines: 2, k: 1 },          // вариант ответа (кнопка 40 px: 1 строка кеглем 2 или 2 кеглем 1)
    endTitle:    { width: 300, lines: 2, k: 2 },          // заголовок концовки
    endText:     { width: 290, lines: 4, k: 1 },          // описание концовки
    itemTitle:   { width: 260, lines: 1, k: 1 }           // название предмета в инвентаре и тосте
  };
  var MAX_LEN = 240;   // страховка от абзацев там, где ждём строку

  function isStr(v, min, max) {
    return typeof v === "string" && v.length >= min && v.length <= max;
  }

  // Строка обязательна и влезает в область; иначе — понятная ошибка с числами.
  function textErr(errs, where, v, name, area) {
    if (!isStr(v, 1, MAX_LEN)) { errs.push(where + ": " + name + " — непустая строка до " + MAX_LEN + " символов"); return; }
    fitErr(errs, where, v, name, area);
  }
  function fitErr(errs, where, v, name, area) {
    var a = AREAS[area];
    var text = (a.prefix || "") + v;
    var miss = FONT.missing(text);
    if (miss.length) { errs.push(where + ": " + name + " — нет таких символов в шрифте: " + miss.join(" ")); return; }
    var k = FONT.fit(text, a.width, a.lines, a.k);
    if (k >= (a.kMin || a.k)) return;
    var perLine = Math.floor(a.width / (8 * (a.kMin || a.k)));
    errs.push(where + ": " + name + " не влезает — не больше " + a.lines + " строк по ~" + perLine + " знаков");
  }

  // Приз: заголовок обязателен, остальное по желанию. url — только абсолютный
  // https/http адрес сайта бренда или путь.
  function validatePrize(p, where, errs) {
    where = where || "prize";
    errs = errs || [];
    if (!p || typeof p !== "object") { errs.push(where + ": объект с полем title"); return errs; }
    textErr(errs, where, p.title, "title", "prizeTitle");
    if (p.code !== undefined && typeof p.code !== "string") errs.push(where + ": code — строка");
    else if (p.code) fitErr(errs, where, p.code, "code", "prizeCode");
    if (p.text !== undefined && typeof p.text !== "string") errs.push(where + ": text — строка");
    else if (p.text) fitErr(errs, where, p.text, "text", "prizeText");
    if (p.button !== undefined && typeof p.button !== "string") errs.push(where + ": button — строка");
    else if (p.button) fitErr(errs, where, p.button, "button", "prizeButton");
    if (p.url !== undefined && p.url !== "" && !/^(https?:\/\/[^\s]+|\/[^\s]*)$/.test(String(p.url))) {
      errs.push(where + ": url — адрес с https:// или путь");
    }
    return errs;
  }

  // Пустой приз (title пуст или объекта нет) — «приза нет», это не ошибка.
  function hasPrize(p) {
    return !!(p && typeof p === "object" && isStr(p.title, 1, MAX_LEN));
  }

  function validateQuiz(data) {
    var errs = [];
    var qs = data && data.questions;
    if (!Array.isArray(qs) || qs.length < 1 || qs.length > 50) return ["questions: массив от 1 до 50 вопросов"];
    qs.forEach(function (it, i) {
      var w = "questions[" + i + "]";
      if (!it || typeof it !== "object") { errs.push(w + ": объект {q, answers, correct}"); return; }
      textErr(errs, w, it.q, "q", "question");
      if (!Array.isArray(it.answers) || it.answers.length < 2 || it.answers.length > 4) {
        errs.push(w + ": answers — от 2 до 4 вариантов");
      } else {
        it.answers.forEach(function (a, j) { textErr(errs, w + ".answers[" + j + "]", a, "ответ", "answer"); });
        if (new Set(it.answers).size !== it.answers.length) errs.push(w + ": варианты повторяются");
        if (!(Number.isInteger(it.correct) && it.correct >= 0 && it.correct < it.answers.length)) {
          errs.push(w + ": correct — индекс верного ответа от 0 до " + (it.answers.length - 1));
        }
      }
    });
    return errs;
  }

  function validatePersona(data) {
    var errs = [];
    var types = data && data.types, qs = data && data.questions;
    if (!Array.isArray(types) || types.length < 2 || types.length > 8) errs.push("types: массив от 2 до 8 типов");
    if (!Array.isArray(qs) || qs.length < 1 || qs.length > 30) errs.push("questions: массив от 1 до 30 вопросов");
    if (errs.length) return errs;
    var ids = {}, reachable = {};
    types.forEach(function (t, i) {
      var w = "types[" + i + "]";
      if (!t || typeof t !== "object") { errs.push(w + ": объект {id, title, text}"); return; }
      if (!/^[a-z0-9_-]{1,32}$/.test(String(t.id))) errs.push(w + ": id — латиница/цифры/-/_ до 32");
      else if (ids[t.id]) errs.push(w + ": id «" + t.id + "» повторяется");
      ids[t.id] = true;
      textErr(errs, w, t.title, "title", "typeTitle");
      if (t.text !== undefined && typeof t.text !== "string") errs.push(w + ": text — строка");
      else if (t.text) fitErr(errs, w, t.text, "text", "typeText");
      if (t.prize !== undefined && t.prize !== null) validatePrize(t.prize, w + ".prize", errs);
    });
    qs.forEach(function (it, i) {
      var w = "questions[" + i + "]";
      if (!it || typeof it !== "object") { errs.push(w + ": объект {q, answers}"); return; }
      textErr(errs, w, it.q, "q", "question");
      if (!Array.isArray(it.answers) || it.answers.length < 2 || it.answers.length > 4) {
        errs.push(w + ": answers — от 2 до 4 вариантов"); return;
      }
      it.answers.forEach(function (a, j) {
        var wa = w + ".answers[" + j + "]";
        if (!a || typeof a !== "object") { errs.push(wa + ": объект {text, weights}"); return; }
        textErr(errs, wa, a.text, "text", "answer");
        var ws = a.weights, any = false, k;
        if (!ws || typeof ws !== "object") { errs.push(wa + ": weights — объект {тип: баллы}"); return; }
        for (k in ws) {
          if (!Object.prototype.hasOwnProperty.call(ws, k)) continue;
          if (!ids[k]) errs.push(wa + ": неизвестный тип «" + k + "» в weights");
          else if (!(typeof ws[k] === "number" && ws[k] >= 0 && isFinite(ws[k]))) errs.push(wa + ": weights." + k + " — число ≥ 0");
          else if (ws[k] > 0) { any = true; reachable[k] = true; }
        }
        if (!any) errs.push(wa + ": ни одного балла — ответ ничего не значит");
      });
    });
    types.forEach(function (t) {
      if (t && ids[t.id] && !reachable[t.id]) errs.push("тип «" + t.id + "» не получает баллов ни за один ответ — не выпадет никогда");
    });
    return errs;
  }

  // Призовые секторы колеса/скретча/лутбокса. Вес — вероятность в акции бренда,
  // его подтверждает человек; здесь только форма.
  function validateWheel(data) {
    var errs = [];
    var items = data && data.items;
    if (!Array.isArray(items) || items.length < 2 || items.length > 12) return ["items: массив от 2 до 12 призов"];
    var ids = {}, total = 0, positive = 0;
    var sectorArea = items.length > 8 ? "sectorSmall" : "sector";
    items.forEach(function (it, i) {
      var w = "items[" + i + "]";
      if (!it || typeof it !== "object") { errs.push(w + ": объект {id, title, weight}"); return; }
      if (!/^[a-z0-9_-]{1,32}$/.test(String(it.id))) errs.push(w + ": id — латиница/цифры/-/_ до 32");
      else if (ids[it.id]) errs.push(w + ": id «" + it.id + "» повторяется");
      ids[it.id] = true;
      // Заголовок и на секторе колеса, и на карточке приза.
      textErr(errs, w, it.title, "title", sectorArea);
      if (typeof it.title === "string" && it.title) fitErr(errs, w, it.title, "title", "prizeTitle");
      if (!(typeof it.weight === "number" && it.weight >= 0 && isFinite(it.weight))) errs.push(w + ": weight — число ≥ 0");
      else { total += it.weight; if (it.weight > 0) positive++; }
      if (it.code !== undefined && typeof it.code !== "string") errs.push(w + ": code — строка");
      else if (it.code) fitErr(errs, w, it.code, "code", "prizeCode");
      if (it.text !== undefined && typeof it.text !== "string") errs.push(w + ": text — строка");
      else if (it.text) fitErr(errs, w, it.text, "text", "prizeText");
      if (it.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(it.color))) errs.push(w + ": color — #rrggbb");
    });
    if (!(total > 0)) errs.push("сумма весов должна быть больше нуля");
    else if (positive < 2) errs.push("призов с ненулевым весом меньше двух — это не розыгрыш");
    return errs;
  }

  // Уровни платформера: форма и ПРОХОДИМОСТЬ каждой карты (солвер в
  // game/levels.js с физикой из opts.physics — кит передаёт свои params).
  var LEVELS = (typeof module !== "undefined" && module.exports) ? require("./levels.js") : root.ZV_LEVELS;
  function validateLevels(data, opts) {
    var errs = [];
    var list = data && data.levels;
    if (!Array.isArray(list) || list.length < 1 || list.length > LEVELS.LIMITS.maxLevels) return ["levels: массив от 1 до " + LEVELS.LIMITS.maxLevels + " уровней"];
    var phys = (opts && opts.physics) || LEVELS.PHYSICS;
    list.forEach(function (lv, i) {
      var w = "levels[" + i + "]";
      if (!lv || typeof lv !== "object") { errs.push(w + ": объект {name, map}"); return; }
      textErr(errs, w, lv.name, "name", "levelName");
      if (lv.hint !== undefined && typeof lv.hint !== "string") errs.push(w + ": hint — строка");
      else if (lv.hint) fitErr(errs, w, lv.hint, "hint", "levelHint");
      var v = LEVELS.validateLevel(lv.map, phys, w + ".map", { unchecked: !!(opts && opts.unchecked) });
      for (var k = 0; k < v.errors.length; k++) errs.push(v.errors[k]);
    });
    return errs;
  }

  // Новелла: тексты по метрикам шрифта здесь, граф (достижимость, концовки,
  // условия, ловушки) — game/novel.js.
  var NOVEL = (typeof module !== "undefined" && module.exports) ? require("./novel.js") : root.ZV_NOVEL;
  function validateNovel(data) {
    var errs = NOVEL.checkShape(data);
    if (errs.length) return errs;
    Object.keys(data.nodes).forEach(function (id) {
      var n = data.nodes[id], w = "nodes." + id;
      textErr(errs, w, n.text, "text", "novelText");
      if (n.speaker !== undefined && typeof n.speaker !== "string") errs.push(w + ": speaker — строка");
      else if (n.speaker) fitErr(errs, w, n.speaker, "speaker", "novelSpeaker");
      ["bg", "portrait"].forEach(function (k) {
        if (n[k] !== undefined && !/^[a-z0-9_:-]{1,32}$/.test(String(n[k]))) errs.push(w + "." + k + ": ключ картинки — латиница/цифры/-/_/: до 32");
      });
      if (Array.isArray(n.choices)) {
        n.choices.forEach(function (c, i) { if (c && typeof c === "object") textErr(errs, w + ".choices[" + i + "]", c.text, "text", "novelChoice"); });
      }
      if (n.end && typeof n.end === "object") {
        if (n.end.title !== undefined && typeof n.end.title !== "string") errs.push(w + ".end: title — строка");
        else if (n.end.title) fitErr(errs, w + ".end", n.end.title, "title", "endTitle");
        if (n.end.text !== undefined && typeof n.end.text !== "string") errs.push(w + ".end: text — строка");
        else if (n.end.text) fitErr(errs, w + ".end", n.end.text, "text", "endText");
        if (n.end.prize !== undefined && n.end.prize !== null) validatePrize(n.end.prize, w + ".end.prize", errs);
      }
    });
    if (errs.length) return errs;
    return NOVEL.check(data);
  }

  // Квест: новелла + предметы (items с названиями, give/take/needs).
  function validateQuest(data) {
    var errs = NOVEL.checkItems(data);
    if (errs.length) return errs;
    if (!data.items || !Object.keys(data.items).length) return ["items: у квеста должен быть хотя бы один предмет — иначе это новелла"];
    Object.keys(data.items).forEach(function (k) { textErr(errs, "items." + k, data.items[k].title, "title", "itemTitle"); });
    if (errs.length) return errs;
    return validateNovel(data);
  }

  // По ключу на строку: новый кит дописывает СВОЮ строку под маркером и не
  // трогает чужие — иначе параллельные ветки дерутся за одну длинную строку.
  var validators = {
    quiz: validateQuiz,
    persona: validatePersona,
    wheel: validateWheel,
    levels: validateLevels,
    novel: validateNovel,
    quest: validateQuest
    // week4
  };

  function validate(kind, data, opts) {
    var fn = validators[kind];
    if (!fn) return ["неизвестный вид контента «" + kind + "»"];
    if (!data || typeof data !== "object") return [kind + ": ожидается объект JSON"];
    return fn(data, opts);
  }

  var api = {
    AREAS: AREAS,
    mergeParams: mergeParams,
    validate: validate,
    validatePrize: validatePrize,
    hasPrize: hasPrize,
    kinds: Object.keys(validators)
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_CONTENT = api;
})(typeof window !== "undefined" ? window : null);
