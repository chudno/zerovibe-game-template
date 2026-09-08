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
  // Лимиты длины — под канву 360×640 с текущим шрифтом: длиннее не влезает.
  var LIMITS = {
    question: 90, answer: 40, typeTitle: 40, typeText: 240,
    prizeTitle: 60, prizeCode: 32, prizeText: 200, prizeButton: 24, sector: 24
  };

  function isStr(v, min, max) {
    return typeof v === "string" && v.length >= min && v.length <= max;
  }
  function strErr(errs, where, v, name, max) {
    if (!isStr(v, 1, max)) errs.push(where + ": " + name + " — строка от 1 до " + max + " символов");
  }

  // Приз: заголовок обязателен, остальное по желанию. url — только абсолютный
  // https/http адрес сайта бренда или путь.
  function validatePrize(p, where, errs) {
    where = where || "prize";
    errs = errs || [];
    if (!p || typeof p !== "object") { errs.push(where + ": объект с полем title"); return errs; }
    strErr(errs, where, p.title, "title", LIMITS.prizeTitle);
    if (p.code !== undefined && !isStr(p.code, 0, LIMITS.prizeCode)) errs.push(where + ": code — строка до " + LIMITS.prizeCode);
    if (p.text !== undefined && !isStr(p.text, 0, LIMITS.prizeText)) errs.push(where + ": text — строка до " + LIMITS.prizeText);
    if (p.button !== undefined && !isStr(p.button, 0, LIMITS.prizeButton)) errs.push(where + ": button — строка до " + LIMITS.prizeButton);
    if (p.url !== undefined && p.url !== "" && !/^(https?:\/\/[^\s]+|\/[^\s]*)$/.test(String(p.url))) {
      errs.push(where + ": url — адрес с https:// или путь");
    }
    return errs;
  }

  // Пустой приз (title пуст или объекта нет) — «приза нет», это не ошибка.
  function hasPrize(p) {
    return !!(p && typeof p === "object" && isStr(p.title, 1, LIMITS.prizeTitle));
  }

  function validateQuiz(data) {
    var errs = [];
    var qs = data && data.questions;
    if (!Array.isArray(qs) || qs.length < 1 || qs.length > 50) return ["questions: массив от 1 до 50 вопросов"];
    qs.forEach(function (it, i) {
      var w = "questions[" + i + "]";
      if (!it || typeof it !== "object") { errs.push(w + ": объект {q, answers, correct}"); return; }
      strErr(errs, w, it.q, "q", LIMITS.question);
      if (!Array.isArray(it.answers) || it.answers.length < 2 || it.answers.length > 4) {
        errs.push(w + ": answers — от 2 до 4 вариантов");
      } else {
        it.answers.forEach(function (a, j) { strErr(errs, w + ".answers[" + j + "]", a, "ответ", LIMITS.answer); });
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
      strErr(errs, w, t.title, "title", LIMITS.typeTitle);
      if (t.text !== undefined && !isStr(t.text, 0, LIMITS.typeText)) errs.push(w + ": text — строка до " + LIMITS.typeText);
      if (t.prize !== undefined && t.prize !== null) validatePrize(t.prize, w + ".prize", errs);
    });
    qs.forEach(function (it, i) {
      var w = "questions[" + i + "]";
      if (!it || typeof it !== "object") { errs.push(w + ": объект {q, answers}"); return; }
      strErr(errs, w, it.q, "q", LIMITS.question);
      if (!Array.isArray(it.answers) || it.answers.length < 2 || it.answers.length > 4) {
        errs.push(w + ": answers — от 2 до 4 вариантов"); return;
      }
      it.answers.forEach(function (a, j) {
        var wa = w + ".answers[" + j + "]";
        if (!a || typeof a !== "object") { errs.push(wa + ": объект {text, weights}"); return; }
        strErr(errs, wa, a.text, "text", LIMITS.answer);
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
    items.forEach(function (it, i) {
      var w = "items[" + i + "]";
      if (!it || typeof it !== "object") { errs.push(w + ": объект {id, title, weight}"); return; }
      if (!/^[a-z0-9_-]{1,32}$/.test(String(it.id))) errs.push(w + ": id — латиница/цифры/-/_ до 32");
      else if (ids[it.id]) errs.push(w + ": id «" + it.id + "» повторяется");
      ids[it.id] = true;
      strErr(errs, w, it.title, "title", LIMITS.sector);
      if (!(typeof it.weight === "number" && it.weight >= 0 && isFinite(it.weight))) errs.push(w + ": weight — число ≥ 0");
      else { total += it.weight; if (it.weight > 0) positive++; }
      if (it.code !== undefined && !isStr(it.code, 0, LIMITS.prizeCode)) errs.push(w + ": code — строка до " + LIMITS.prizeCode);
      if (it.text !== undefined && !isStr(it.text, 0, LIMITS.prizeText)) errs.push(w + ": text — строка до " + LIMITS.prizeText);
      if (it.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(it.color))) errs.push(w + ": color — #rrggbb");
    });
    if (!(total > 0)) errs.push("сумма весов должна быть больше нуля");
    else if (positive < 2) errs.push("призов с ненулевым весом меньше двух — это не розыгрыш");
    return errs;
  }

  var validators = { quiz: validateQuiz, persona: validatePersona, wheel: validateWheel };

  function validate(kind, data) {
    var fn = validators[kind];
    if (!fn) return ["неизвестный вид контента «" + kind + "»"];
    if (!data || typeof data !== "object") return [kind + ": ожидается объект JSON"];
    return fn(data);
  }

  var api = {
    LIMITS: LIMITS,
    mergeParams: mergeParams,
    validate: validate,
    validatePrize: validatePrize,
    hasPrize: hasPrize,
    kinds: Object.keys(validators)
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_CONTENT = api;
})(typeof window !== "undefined" ? window : null);
