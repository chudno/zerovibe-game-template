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
    question:    { width: 300, lines: 4, k: 2 }, // вопрос квиза / теста, кегль 2
    answer:      { width: 270, lines: 2, k: 2, kMin: 1 }, // кнопка-вариант 64 px; кегль 1 — запас
    typeTitle:   { width: 300, lines: 2, k: 2, prefix: "Ты — " },
    typeText:    { width: 290, lines: 4, k: 1 },
    prizeTitle:  { width: 284, lines: 2, k: 2, kMin: 1 },
    prizeCode:   { width: 200, lines: 1, k: 2, kMin: 1 },
    prizeText:   { width: 284, lines: 3, k: 1 },
    prizeButton: { width: 224, lines: 1, k: 2, kMin: 1 },
    sector:      { width: 76,  lines: 2, k: 1 }, // сектор колеса (≤8 секторов)
    sectorSmall: { width: 56,  lines: 2, k: 1 }, // сектор колеса (9–12 секторов)
    levelName:   { width: 300, lines: 2, k: 2, kMin: 1 }, // заставка уровня (заголовок)
    levelHint:   { width: 290, lines: 2, k: 1 }, // подсказка под ней
    novelSpeaker:{ width: 200, lines: 1, k: 1 }, // имя говорящего над репликой
    novelText:   { width: 312, lines: 5, k: 1 }, // реплика в панели новеллы
    novelChoice: { width: 270, lines: 2, k: 1 }, // вариант ответа (кнопка 40 px: 1 строка кеглем 2 или 2 кеглем 1)
    endTitle:    { width: 300, lines: 2, k: 2 }, // заголовок концовки
    endText:     { width: 290, lines: 4, k: 1 }, // описание концовки
    itemTitle:   { width: 260, lines: 1, k: 1 }, // название предмета в инвентаре и тосте
    // week4 areas: новая область — своя строка, в алфавитном порядке
    memoryCard:  { width: 54,  lines: 2, k: 1 }, // подпись на карточке «памяти»: самая узкая ячейка (60 px минус поля)
    novelRules:  { width: 300, lines: 1, k: 1 }, // строка-правило под кнопкой мини-игры
    // week4: clicker
    careTitle:   { width: 64,  lines: 1, k: 1 }, // подпись кнопки ухода 72×72 у кликера
    stageText:   { width: 290, lines: 2, k: 1 }, // строка стадии кликера под заголовком
    stageTitle:  { width: 200, lines: 1, k: 2, kMin: 1 } // название стадии кликера (надпись и результат)
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
      // Узел мини-игры: подпись кнопки и строка-правило под ней (week4).
      if (n.play && typeof n.play === "object") {
        if (n.play.startLabel) fitErr(errs, w + ".play", n.play.startLabel, "startLabel", "novelChoice");
        if (n.play.rules) fitErr(errs, w + ".play", n.play.rules, "rules", "novelRules");
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

  // Память-пары: раунды (сколько пар) и словарь видов карточек. Сколько
  // карточек на поле — считает game/memory.js как 2·pairs, автор это число не
  // задаёт. Здесь проверяется, что пар хватает видов, что поле физически
  // влезает в сетку тач-целей и что ходов хватает на проходимую партию.
  var GRID = (typeof module !== "undefined" && module.exports) ? require("./grid.js") : root.ZV_GRID;
  var MEMORY = (typeof module !== "undefined" && module.exports) ? require("./memory.js") : root.ZV_MEMORY;
  // Игровое поле кита: те же числа, что в game/kits/memory/kit.js (BOARD).
  var MEMORY_BOARD = { area: { x: 12, y: 150, w: 336, h: 400 }, gap: 8, maxCols: 5, min: { w: 24, h: 24 } };
  // «4 пары», а не «4 пар»: текст ошибки читает человек, а не парсер.
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    return b === 1 ? one : many;
  }
  // Подпись переносится по фактической ширине ячейки (кит: cell.w - 6), а
  // ячейка тем уже, чем больше пар. Мерить по константе нельзя: контент прошёл
  // бы проверку и обрезался на поле у автора с 11–12 парами.
  function memoryCardWrap(pairs) {
    var lay = GRID.best(pairs * 2, MEMORY_BOARD.area, { min: MEMORY_BOARD.min, gap: MEMORY_BOARD.gap, aspect: 1, maxCols: MEMORY_BOARD.maxCols });
    return lay.fits ? lay.cell.w - 6 : 0;
  }
  function memoryTitleErr(errs, where, v, wrap, pairs) {
    if (!isStr(v, 1, MAX_LEN)) { errs.push(where + ": title — непустая строка до " + MAX_LEN + " символов"); return; }
    var miss = FONT.missing(v);
    if (miss.length) { errs.push(where + ": title — нет таких символов в шрифте: " + miss.join(" ")); return; }
    var a = AREAS.memoryCard;
    if (FONT.fit(v, wrap, a.lines, a.k) >= a.k) return;
    errs.push(where + ": title не влезает — не больше " + a.lines + " строк по ~" + Math.floor(wrap / (8 * a.k)) +
      " знаков при " + pairs + " " + plural(pairs, "паре", "парах", "парах") + " (ячейка тем уже, чем больше пар)");
  }
  function validateMemory(data, opts) {
    var errs = [];
    var rounds = data && data.rounds, cards = data && data.cards;
    if (!Array.isArray(rounds) || rounds.length < 1 || rounds.length > 10) errs.push("rounds: массив от 1 до 10 раскладов");
    if (!Array.isArray(cards) || cards.length < 2 || cards.length > 24) errs.push("cards: массив от 2 до 24 видов карточек");
    if (errs.length) return errs;

    // Самый тесный раунд задаёт ширину подписи для всех карточек: одна и та же
    // карточка выпадает в любом раскладе.
    var tight = 0;
    rounds.forEach(function (r) {
      if (r && Number.isInteger(r.pairs) && r.pairs > tight && r.pairs <= MEMORY.LIMITS.maxPairs) tight = r.pairs;
    });
    if (tight < MEMORY.LIMITS.minPairs) tight = MEMORY.LIMITS.minPairs;
    var wrap = memoryCardWrap(tight) || AREAS.memoryCard.width;

    var ids = {}, withIcon = 0;
    cards.forEach(function (c, i) {
      var w = "cards[" + i + "]";
      if (!c || typeof c !== "object") { errs.push(w + ": объект {id, title}"); return; }
      if (!/^[a-z0-9_-]{1,32}$/.test(String(c.id))) errs.push(w + ": id — латиница/цифры/-/_ до 32");
      else if (ids[c.id]) errs.push(w + ": id «" + c.id + "» повторяется");
      ids[c.id] = true;
      memoryTitleErr(errs, w, c.title, wrap, tight);
      if (c.icon !== undefined && !/^[a-z0-9_:-]{1,32}$/.test(String(c.icon))) errs.push(w + ".icon: ключ картинки — латиница/цифры/-/_/: до 32");
      else if (c.icon) withIcon++;
      if (c.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(c.color))) errs.push(w + ": color — #rrggbb");
    });
    // Две карточки с одинаковой подписью на заглушках неотличимы: игрок видит
    // «пару», которой нет, и обвиняет игру, а не данные.
    var titles = {};
    cards.forEach(function (c, i) {
      if (!c || typeof c.title !== "string" || !c.title) return;
      if (titles[c.title]) errs.push("cards[" + i + "]: подпись «" + c.title + "» уже у cards[" + titles[c.title].i + "] — одинаковые карточки не различить");
      else titles[c.title] = { i: i };
    });

    // Лимит из config.params действует на все раунды, где своего moves нет, —
    // и должен проверяться тем же порогом: иначе params.moves: 6 молча делает
    // партию непроходимой, а автор не получает ни слова.
    var paramMoves = (opts && Number.isInteger(opts.moves) && opts.moves > 0) ? opts.moves : 0;
    rounds.forEach(function (r, i) {
      var w = "rounds[" + i + "]";
      if (!r || typeof r !== "object") { errs.push(w + ": объект {name, pairs}"); return; }
      textErr(errs, w, r.name, "name", "levelName");
      if (r.hint !== undefined && typeof r.hint !== "string") errs.push(w + ": hint — строка");
      else if (r.hint) fitErr(errs, w, r.hint, "hint", "levelHint");
      var pairs = r.pairs;
      if (!(Number.isInteger(pairs) && pairs >= MEMORY.LIMITS.minPairs && pairs <= MEMORY.LIMITS.maxPairs)) {
        errs.push(w + ".pairs: целое от " + MEMORY.LIMITS.minPairs + " до " + MEMORY.LIMITS.maxPairs + " (сейчас " + pairs + ")");
        return;
      }
      if (pairs > cards.length) {
        errs.push(w + ".pairs: " + pairs + " " + plural(pairs, "пара", "пары", "пар") + ", а в cards только " + cards.length +
          " " + plural(cards.length, "вид", "вида", "видов") + " — добавь ещё " + (pairs - cards.length) + " или уменьши pairs");
      }
      // Сетка: 2·pairs карточек в поле кита при тач-цели 24 px.
      var lay = GRID.best(pairs * 2, MEMORY_BOARD.area, { min: MEMORY_BOARD.min, gap: MEMORY_BOARD.gap, aspect: 1, maxCols: MEMORY_BOARD.maxCols });
      if (!lay.fits) {
        errs.push(w + ".pairs: " + pairs + " пар = " + (pairs * 2) + " карточек не влезают в поле — " + lay.reason);
      }
      // Ход тратится на ПАРУ: идеальная игра требует 2·pairs ходов, запас +2.
      var need = MEMORY.minMoves(pairs) + 2;
      if (r.moves !== undefined) {
        if (!(Number.isInteger(r.moves) && r.moves > 0)) errs.push(w + ".moves: целое больше нуля (сейчас " + r.moves + ")");
        else if (r.moves < need) {
          errs.push(w + ".moves: " + r.moves + " ходов на " + pairs + " " + plural(pairs, "пару", "пары", "пар") +
            " — партия непроходима, нужно минимум " + need);
        }
      } else if (paramMoves > 0 && paramMoves < need) {
        errs.push(w + ".pairs: " + paramMoves + " ходов из params.moves на " + pairs + " " + plural(pairs, "пару", "пары", "пар") +
          " — партия непроходима, нужно минимум " + need);
      }
    });
    // Больше восьми видов на заглушках различаются только цветом — это про
    // играбельность, и лучше сказать до публикации.
    var maxPairs = 0;
    rounds.forEach(function (r) { if (r && Number.isInteger(r.pairs) && r.pairs > maxPairs) maxPairs = r.pairs; });
    if (maxPairs > 8 && withIcon < maxPairs) {
      errs.push("cards: при " + maxPairs + " парах без icon карточки различаются только цветом — добавь иконки или уменьши pairs");
    }
    return errs;
  }

  // По ключу на строку: новый кит дописывает СВОЮ строку под маркером и не
  // трогает чужие — иначе параллельные ветки дерутся за одну длинную строку.
  // Кликер: форма данных здесь, ДОСТИЖИМОСТЬ цели — солвером экономики
  // (game/clicker.js), тем же, что отдаёт план боту. Валидатор обязан
  // работать и без opts: тогда берутся дефолты кита (CLICKER.PARAMS).
  var CLICKER = (typeof module !== "undefined" && module.exports) ? require("./clicker.js") : root.ZV_CLICKER;
  function validateClicker(data, opts) {
    var errs = [];
    var P = CLICKER.withDefaults(opts && opts.params);

    var goal = data && data.goal;
    if (!goal || typeof goal !== "object") errs.push("goal: объект {score, title, text}");
    else {
      if (!(Number.isInteger(goal.score) && goal.score >= 10)) errs.push("goal.score: целое не меньше 10");
      textErr(errs, "goal", goal.title, "title", "endTitle");
      if (goal.text !== undefined && typeof goal.text !== "string") errs.push("goal: text — строка");
      else if (goal.text) fitErr(errs, "goal", goal.text, "text", "endText");
    }

    var stages = data && data.stages;
    if (!Array.isArray(stages) || stages.length < 1 || stages.length > 6) {
      errs.push("stages: массив от 1 до 6 стадий");
    } else {
      stages.forEach(function (st, i) {
        var w = "stages[" + i + "]";
        if (!st || typeof st !== "object") { errs.push(w + ": объект {at, title}"); return; }
        if (!Number.isInteger(st.at) || st.at < 0) errs.push(w + ".at: целое не меньше 0");
        else if (i === 0 && st.at !== 0) errs.push(w + ".at: первая стадия начинается с 0");
        else if (i > 0 && Number.isInteger(stages[i - 1].at) && st.at <= stages[i - 1].at) {
          errs.push(w + ".at: " + st.at + " не больше предыдущего " + stages[i - 1].at + " — стадии идут по возрастанию");
        }
        textErr(errs, w, st.title, "title", "stageTitle");
        if (st.text !== undefined && typeof st.text !== "string") errs.push(w + ": text — строка");
        else if (st.text) fitErr(errs, w, st.text, "text", "stageText");
        if (st.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(st.color))) errs.push(w + ".color: цвет вида #2e9e5b");
        if (st.art !== undefined && !/^[a-z0-9_-]{1,32}$/i.test(String(st.art))) errs.push(w + ".art: ключ картинки — латиница/цифры/-/_ до 32");
      });
      var last = stages[stages.length - 1];
      if (goal && Number.isInteger(goal.score) && last && Number.isInteger(last.at) && last.at >= goal.score) {
        errs.push("stages[" + (stages.length - 1) + "].at: " + last.at + " не меньше goal.score " + goal.score + " — последняя стадия никогда не покажется");
      }
    }

    if (data && data.care !== undefined) {
      if (!data.care || typeof data.care !== "object") errs.push("care: объект {title}");
      else textErr(errs, "care", data.care.title, "title", "careTitle");
    }

    var ups = data && data.upgrades;
    if (ups !== undefined && (!Array.isArray(ups) || ups.length > 6)) errs.push("upgrades: массив от 0 до 6 апгрейдов");
    else if (Array.isArray(ups)) {
      var ids = {};
      ups.forEach(function (u, i) {
        var w = "upgrades[" + i + "]";
        if (!u || typeof u !== "object") { errs.push(w + ": объект {id, title, cost}"); return; }
        if (!/^[a-z0-9_-]{1,24}$/i.test(String(u.id))) errs.push(w + ".id: латиница/цифры/-/_ до 24");
        else if (ids[u.id] !== undefined) errs.push(w + ".id: «" + u.id + "» повторяется");
        else ids[u.id] = i;
        textErr(errs, w, u.title, "title", "itemTitle");
        if (!(Number.isInteger(u.cost) && u.cost >= 1)) errs.push(w + ".cost — целое не меньше 1");
        if (!(Number.isInteger(u.max) && u.max >= 1 && u.max <= 99)) errs.push(w + ".max: целое от 1 до 99");
        var perTap = Number(u.perTap) || 0, perSec = Number(u.perSec) || 0;
        if (!(perTap > 0 || perSec > 0)) errs.push(w + ": ни perTap, ни perSec — апгрейд ничего не делает");
      });
      ups.forEach(function (u, i) {
        if (!u || typeof u !== "object" || u.needs === undefined) return;
        var w = "upgrades[" + i + "]";
        if (typeof u.needs !== "string" || ids[u.needs] === undefined) { errs.push(w + ".needs: апгрейда «" + u.needs + "» нет"); return; }
        if (u.needs === u.id) { errs.push(w + ".needs: кольцо зависимостей " + u.id + " → " + u.id); return; }
        // Кольцо: идём по needs, пока не упрёмся в конец или не вернёмся к началу.
        var seen = [String(u.id)], cur = u.needs;
        for (var g = 0; g < ups.length + 1 && cur !== undefined; g++) {
          if (seen.indexOf(String(cur)) >= 0) { errs.push(w + ".needs: кольцо зависимостей " + seen.join(" → ") + " → " + cur); return; }
          seen.push(String(cur));
          var next = ups[ids[cur]];
          cur = next && typeof next.needs === "string" ? next.needs : undefined;
        }
      });
    }

    if (errs.length) return errs;

    // Солвер считает все апгрейды доступными, а карточек на экране столько,
    // сколько showUpgrades: при нуле покупать физически нечем, и «цель
    // достижима» стало бы враньём. Ловим это словами, а не моделью.
    // showUpgrades в PARAMS солвера нет (экономику он не меняет), поэтому
    // берём его из сырых opts, а не из P.
    var raw = opts && opts.params ? opts.params.showUpgrades : undefined;
    var show = typeof raw === "number" && isFinite(raw) ? Math.round(raw) : 3;
    if (Array.isArray(ups) && ups.length > 0 && show < 1) {
      errs.push("showUpgrades: 0 — карточек апгрейдов на экране нет, покупать нечем");
      return errs;
    }

    // Достижимость: солвер на том же темпе, что и бот-эксперт. Обе стороны
    // важны — недостижимая цель это тупик, а достижимая простыми тапами
    // означает, что апгрейды и уход в игре лишние.
    var best = CLICKER.best(data, P);
    if (!best.reachable) {
      errs.push("goal.score: " + data.goal.score + " не набирается за duration " + Math.round(P.duration / 1000) +
        " с — при лучшей игре выходит " + best.score + ". Уменьши goal.score или удешеви апгрейды");
      return errs;
    }
    var nov = CLICKER.novice(data, P);
    if (nov.reached) {
      errs.push("goal.score: " + data.goal.score + " набирается простыми тапами без апгрейдов (темп botTapsPerSec/4) — " +
        "апгрейды не нужны, подними цель или удорожи стадии");
    }
    return errs;
  }

  // По ключу на строку: новый кит дописывает СВОЮ строку под маркером и не
  // трогает чужие — иначе параллельные ветки дерутся за одну длинную строку.
  var validators = {
    quiz: validateQuiz,
    persona: validatePersona,
    wheel: validateWheel,
    levels: validateLevels,
    novel: validateNovel,
    quest: validateQuest,
    // week4
    memory: validateMemory,
    clicker: validateClicker
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
