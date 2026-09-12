// Новелла числами, без Phaser: сюжет — граф узлов в content/novel.json
// (узел = реплика с фоном/портретом, ссылка = вариант ответа), переменные с
// условиями на вариантах, концовки с исходом. Здесь: разбор и ПРОВЕРКА ГРАФА
// по состояниям (узел × значения переменных): каждый узел и каждая концовка
// достижимы, из любого состояния есть путь к концовке (нет ловушек), условная
// реплика хоть где-то видна; рантайм с состоянием и снимком; пути до каждой
// концовки для автопрогона. Модуль чистый — гоняется node --test и китом.
(function (root) {
  "use strict";

  // maxItems 8 — столько ячеек влезает в полку квеста рядом со счётчиком;
  // maxStates — потолок обхода узел × переменные (у 8 предметов 256 наборов).
  var LIMITS = { maxNodes: 300, choicesMin: 2, choicesMax: 4, maxStates: 60000, maxHistory: 500, maxItems: 8, maxPlayNodes: 3, outcomesMax: 4 };
  var ID_RE = /^[a-z0-9_-]{1,32}$/;

  // Киты, которые можно запустить из сюжета узлом play. novel и quest сюда не
  // входят: сюжет внутри сюжета — второй граф в том же рантайме. Каталог
  // game/kits/* сверяется с этим списком линтом (tests/kits.test.js), иначе
  // новый кит молча не запускается из сюжета.
  var PLAYABLE = ["runner", "catch", "quiz", "persona", "wheel", "platformer", "memory", "clicker", "sort",
    // week5: match3
    "match3"];

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // --- переменные и эффекты --------------------------------------------------
  // vars: { name: number|boolean }. Эффекты на узле и на варианте: set {name: value},
  // add {name: delta}. Условие варианта if: {name: value} — булево равно,
  // число «не меньше»; или {name: {eq|gte|lte|gt|lt: n}}.
  function applyEffects(vars, owner) {
    var k;
    if (isObj(owner.set)) for (k in owner.set) if (has(owner.set, k) && has(vars, k)) vars[k] = owner.set[k];
    if (isObj(owner.add)) for (k in owner.add) if (has(owner.add, k) && typeof vars[k] === "number") vars[k] += owner.add[k];
    return vars;
  }

  function holds(vars, cond) {
    if (!isObj(cond)) return true;
    for (var k in cond) {
      if (!has(cond, k)) continue;
      var v = vars[k], want = cond[k];
      if (typeof want === "boolean") { if (v !== want) return false; }
      else if (typeof want === "number") { if (!(v >= want)) return false; }
      else if (isObj(want)) {
        if (has(want, "eq") && !(v === want.eq)) return false;
        if (has(want, "gte") && !(v >= want.gte)) return false;
        if (has(want, "lte") && !(v <= want.lte)) return false;
        if (has(want, "gt") && !(v > want.gt)) return false;
        if (has(want, "lt") && !(v < want.lt)) return false;
      }
    }
    return true;
  }

  function copyVars(vars) {
    var out = {};
    for (var k in vars) if (has(vars, k)) out[k] = vars[k];
    return out;
  }

  // --- предметы (квест) --------------------------------------------------------
  // items: { key: { title, icon? } } — инвентарь. На узле и варианте give/take
  // [key…], на варианте needs [key…] (у узла ворот нет — needs там ошибка).
  // Это сахар над булевыми переменными «item:<key>»: withItems переписывает
  // данные в set/if, и весь граф-чек, обход и рантайм работают без изменений.
  // Автору такие имена недоступны: ID_RE без двоеточия.
  var ITEM_PREFIX = "item:";
  function itemVar(key) { return ITEM_PREFIX + key; }
  function itemVars(data) {
    var out = {};
    if (isObj(data) && isObj(data.items)) Object.keys(data.items).forEach(function (k) { out[itemVar(k)] = true; });
    return out;
  }

  function checkItems(data) {
    var errs = [];
    if (data.items === undefined) return errs;
    if (!isObj(data.items)) return ["items: объект {ключ: {title}}"];
    var keys = Object.keys(data.items);
    if (keys.length > LIMITS.maxItems) errs.push("items: не больше " + LIMITS.maxItems + " предметов — больше не влезает в полку");
    keys.forEach(function (k) {
      var it = data.items[k];
      if (!ID_RE.test(k)) errs.push("items: ключ «" + k + "» — латиница/цифры/-/_ до 32");
      if (!isObj(it)) { errs.push("items." + k + ": объект {title}"); return; }
      if (it.icon !== undefined && !/^[a-z0-9_:-]{1,32}$/.test(String(it.icon))) errs.push("items." + k + ".icon: ключ картинки — латиница/цифры/-/_/: до 32");
    });
    var given = {};
    function checkRefs(owner, where, isChoice) {
      if (!isChoice && owner.needs !== undefined) errs.push(where + ".needs: needs бывает только на варианте — у узла ворот нет");
      ["give", "take", "needs"].forEach(function (f) {
        if (owner[f] === undefined) return;
        if (!Array.isArray(owner[f])) { errs.push(where + "." + f + ": массив ключей предметов"); return; }
        owner[f].forEach(function (k) {
          if (!has(data.items, k)) errs.push(where + "." + f + ": предмета «" + k + "» нет в items");
          else if (f === "give") given[k] = true;
        });
      });
    }
    if (isObj(data.nodes)) {
      Object.keys(data.nodes).forEach(function (id) {
        var n = data.nodes[id];
        if (!isObj(n)) return;
        checkRefs(n, "nodes." + id, false);
        if (Array.isArray(n.choices)) n.choices.forEach(function (c, i) { if (isObj(c)) checkRefs(c, "nodes." + id + ".choices[" + i + "]", true); });
      });
    }
    keys.forEach(function (k) { if (!given[k]) errs.push("items." + k + ": предмет нигде не выдаётся (нет give)"); });
    return errs;
  }

  // Копия данных, где предметы стали переменными: give → set true,
  // take → set false, needs (только на варианте) → if true. Без items
  // возвращает данные как есть.
  function withItems(data) {
    if (!isObj(data) || !isObj(data.items) || !isObj(data.nodes)) return data;
    var out = { start: data.start, chapters: data.chapters, items: data.items, vars: copyVars(isObj(data.vars) ? data.vars : {}), nodes: {} };
    Object.keys(data.items).forEach(function (k) { out.vars[itemVar(k)] = false; });
    function fold(owner, isChoice) {
      var o = {};
      for (var k in owner) if (has(owner, k)) o[k] = owner[k];
      if (Array.isArray(owner.give) || Array.isArray(owner.take)) {
        o.set = isObj(owner.set) ? copyVars(owner.set) : {};
        (owner.give || []).forEach(function (k) { o.set[itemVar(k)] = true; });
        (owner.take || []).forEach(function (k) { o.set[itemVar(k)] = false; });
      }
      if (isChoice && Array.isArray(owner.needs)) {
        o["if"] = isObj(owner["if"]) ? copyVars(owner["if"]) : {};
        owner.needs.forEach(function (k) { o["if"][itemVar(k)] = true; });
      }
      return o;
    }
    Object.keys(data.nodes).forEach(function (id) {
      var n = data.nodes[id];
      if (!isObj(n)) { out.nodes[id] = n; return; }
      var m = fold(n, false);
      if (Array.isArray(n.choices)) m.choices = n.choices.map(function (c) { return isObj(c) ? fold(c, true) : c; });
      out.nodes[id] = m;
    });
    return out;
  }

  // --- проверка формы ----------------------------------------------------------
  // Тексты (длины под канву) проверяет content.js; здесь структура и граф.
  // synthetic — служебные переменные предметов, добавленные withItems: только
  // им разрешено имя с двоеточием.
  function checkShape(data, synthetic) {
    synthetic = synthetic || {};
    var errs = [];
    if (!isObj(data)) return ["novel: ожидается объект {start, nodes}"];
    var nodes = data.nodes;
    if (!isObj(nodes)) return ["nodes: объект {id: узел}"];
    var ids = Object.keys(nodes);
    if (ids.length < 2 || ids.length > LIMITS.maxNodes) errs.push("nodes: от 2 до " + LIMITS.maxNodes + " узлов");
    if (typeof data.start !== "string" || !has(nodes, data.start)) errs.push("start: id существующего узла");
    var vars = isObj(data.vars) ? data.vars : {};
    if (data.vars !== undefined && !isObj(data.vars)) errs.push("vars: объект {имя: число|булево}");
    for (var vk in vars) {
      if (!has(vars, vk)) continue;
      if (synthetic[vk]) continue;
      if (!ID_RE.test(vk)) errs.push("vars: имя «" + vk + "» — латиница/цифры/-/_ до 32");
      if (typeof vars[vk] !== "number" && typeof vars[vk] !== "boolean") errs.push("vars." + vk + ": число или булево");
    }
    if (data.chapters !== undefined) {
      if (!Array.isArray(data.chapters)) errs.push("chapters: массив id узлов");
      else {
        var seen = {};
        data.chapters.forEach(function (c, i) {
          if (!has(nodes, c)) errs.push("chapters[" + i + "]: узла «" + c + "» нет");
          else if (seen[c]) errs.push("chapters[" + i + "]: «" + c + "» повторяется");
          seen[c] = true;
        });
      }
    }
    // extra — служебные переменные условия, которых нет в vars: у ветки
    // outcomes это won (булево) и score (число) прошедшей мини-игры.
    function checkEffects(owner, where, extra) {
      var cvars = vars;
      if (extra) {
        cvars = copyVars(vars);
        for (var ek in extra) if (has(extra, ek)) cvars[ek] = extra[ek];
      }
      ["set", "add"].forEach(function (key) {
        if (owner[key] === undefined) return;
        if (!isObj(owner[key])) { errs.push(where + "." + key + ": объект {переменная: значение}"); return; }
        for (var k in owner[key]) {
          if (!has(owner[key], k)) continue;
          if (!has(vars, k)) { errs.push(where + "." + key + ": переменная «" + k + "» не объявлена в vars"); continue; }
          var v = owner[key][k];
          if (key === "set" && typeof v !== typeof vars[k]) errs.push(where + ".set." + k + ": ожидается " + typeof vars[k]);
          if (key === "add" && (typeof v !== "number" || typeof vars[k] !== "number")) errs.push(where + ".add." + k + ": число к числовой переменной");
        }
      });
      if (owner["if"] !== undefined) {
        if (!isObj(owner["if"])) { errs.push(where + ".if: объект {переменная: условие}"); return; }
        for (var ck in owner["if"]) {
          if (!has(owner["if"], ck)) continue;
          if (!has(cvars, ck)) { errs.push(where + ".if: переменная «" + ck + "» не объявлена в vars"); continue; }
          var c = owner["if"][ck];
          var okType = typeof c === typeof cvars[ck] || (isObj(c) && typeof cvars[ck] === "number");
          if (!okType) errs.push(where + ".if." + ck + ": " + (typeof cvars[ck] === "number" ? "число или {gte|lte|eq|gt|lt}" : "булево"));
        }
      }
    }
    // Узел мини-игры: играем кит, исход разбирается сверху вниз по outcomes.
    // Последняя ветка без if — гарантия «исход есть всегда» (см. resolvePlay).
    function checkPlay(n, w) {
      var p = n.play, wp = w + ".play";
      if (!isObj(p)) { errs.push(wp + ": объект {kit, outcomes}"); return; }
      if (typeof p.kit !== "string" || PLAYABLE.indexOf(p.kit) < 0) {
        errs.push(wp + ".kit: «" + p.kit + "» нельзя запускать из сюжета — доступны: " + PLAYABLE.join(", "));
      }
      if (p.params !== undefined) {
        if (!isObj(p.params)) errs.push(wp + ".params: объект {параметр: число|строка|булево}");
        else for (var pk in p.params) {
          if (!has(p.params, pk)) continue;
          var pt = typeof p.params[pk];
          if (pt !== "number" && pt !== "string" && pt !== "boolean") errs.push(wp + ".params." + pk + ": число, строка или булево");
        }
      }
      if (p.score !== undefined) {
        if (typeof p.score !== "string") errs.push(wp + ".score: имя числовой переменной из vars");
        else if (!has(vars, p.score)) errs.push(wp + ".score: переменная «" + p.score + "» не объявлена в vars");
        else if (typeof vars[p.score] !== "number") errs.push(wp + ".score: переменная «" + p.score + "» должна быть числом");
      }
      if (p.startLabel !== undefined && typeof p.startLabel !== "string") errs.push(wp + ".startLabel: подпись кнопки — строка");
      if (p.rules !== undefined && typeof p.rules !== "string") errs.push(wp + ".rules: одна фраза-правило — строка");
      if (!Array.isArray(p.outcomes) || p.outcomes.length < 1 || p.outcomes.length > LIMITS.outcomesMax) {
        errs.push(wp + ".outcomes: от 1 до " + LIMITS.outcomesMax + " исходов");
        return;
      }
      p.outcomes.forEach(function (o, i) {
        var wo = wp + ".outcomes[" + i + "]";
        if (!isObj(o)) { errs.push(wo + ": объект {goto}"); return; }
        if (typeof o.goto !== "string" || !has(nodes, o.goto)) errs.push(wo + ".goto: узла «" + o.goto + "» нет");
        checkEffects(o, wo, { won: true, score: 0 });
      });
      var last = p.outcomes[p.outcomes.length - 1];
      if (isObj(last) && last["if"] !== undefined) {
        errs.push(wp + ": последняя ветка outcomes обязана быть без `if` — иначе после мини-игры некуда идти. Добавь ветку `{ \"goto\": \"…\" }` в конец");
      }
    }
    var playCount = 0;
    ids.forEach(function (id) {
      var n = nodes[id], w = "nodes." + id;
      if (!ID_RE.test(id)) errs.push("nodes: id «" + id + "» — латиница/цифры/-/_ до 32");
      if (!isObj(n)) { errs.push(w + ": объект {text, choices|goto|end}"); return; }
      var exits = (Array.isArray(n.choices) ? 1 : 0) + (typeof n.goto === "string" ? 1 : 0) + (isObj(n.end) ? 1 : 0) + (n.play !== undefined ? 1 : 0);
      if (exits !== 1) errs.push(w + ": ровно одно из choices, goto, end, play");
      if (n.play !== undefined) { playCount++; checkPlay(n, w); }
      if (typeof n.goto === "string" && !has(nodes, n.goto)) errs.push(w + ".goto: узла «" + n.goto + "» нет");
      if (Array.isArray(n.choices)) {
        if (n.choices.length < LIMITS.choicesMin || n.choices.length > LIMITS.choicesMax) errs.push(w + ".choices: от " + LIMITS.choicesMin + " до " + LIMITS.choicesMax + " вариантов");
        n.choices.forEach(function (c, i) {
          var wc = w + ".choices[" + i + "]";
          if (!isObj(c)) { errs.push(wc + ": объект {text, goto}"); return; }
          if (typeof c.goto !== "string" || !has(nodes, c.goto)) errs.push(wc + ".goto: узла «" + c.goto + "» нет");
          checkEffects(c, wc);
        });
      }
      if (isObj(n.end)) {
        if (!ID_RE.test(String(n.end.outcome))) errs.push(w + ".end.outcome: латиница/цифры/-/_ до 32");
        if (n.end.won !== undefined && typeof n.end.won !== "boolean") errs.push(w + ".end.won: булево");
      }
      checkEffects(n, w);
    });
    // Мини-игра — эпизод, а не игра, к которой прикручен текст.
    if (playCount > LIMITS.maxPlayNodes) {
      errs.push("nodes: мини-игр в сюжете " + playCount + ", а можно не больше " + LIMITS.maxPlayNodes + " — сюжет перестаёт быть сюжетом; убери лишние узлы play");
    }
    return errs;
  }

  // Разбор исхода мини-игры: первая подошедшая ветка сверху вниз. Условие
  // считается по переменным сюжета плюс служебные won/score партии.
  // Валидатор гарантирует последнюю ветку без if, поэтому null не бывает:
  // если данные всё же битые, отдаётся последняя ветка (сюжет не встанет).
  function resolvePlay(play, result, vars) {
    var outs = (isObj(play) && Array.isArray(play.outcomes)) ? play.outcomes : [];
    if (!outs.length) return { goto: null };
    var r = isObj(result) ? result : {};
    var probe = copyVars(isObj(vars) ? vars : {});
    probe.won = !!r.won;
    probe.score = typeof r.score === "number" ? r.score : 0;
    for (var i = 0; i < outs.length; i++) {
      var o = outs[i];
      if (isObj(o) && holds(probe, o["if"])) return o;
    }
    return outs[outs.length - 1];
  }

  // Условие по счёту задано ТОЧНЫМ числом: `{eq: N}`. Голое число — это
  // «не меньше», диапазон, а не точка; из-за точки решётка порогов может
  // промахнуться мимо значения, и ветка ложно объявляется недостижимой.
  function isExactGate(want) {
    return isObj(want) && has(want, "eq") && typeof want.eq === "number";
  }

  // Порог из одного условия: число само по себе («не меньше») или {gte|…}.
  function gateOf(want) {
    if (typeof want === "number") return want;
    if (!isObj(want)) return null;
    var ops = ["eq", "gte", "gt", "lte", "lt"];
    for (var i = 0; i < ops.length; i++) {
      if (has(want, ops[i]) && typeof want[ops[i]] === "number") return want[ops[i]];
    }
    return null;
  }

  // Пороги счёта: обход подставляет только их, иначе счёт (любое число)
  // взрывает пространство состояний. Берём и условия самих outcomes, и
  // условия по переменной-счёту дальше по сюжету (`if: {score_var: N}` на
  // варианте через два узла) — иначе ветка после мини-игры ложно объявляется
  // недостижимой: счёт в обходе так и остался бы нулём.
  function scoreGates(play, nodes) {
    var out = [];
    function add(n) { if (n !== null && out.indexOf(n) < 0) out.push(n); }
    if (!isObj(play) || !Array.isArray(play.outcomes)) return out;
    play.outcomes.forEach(function (o) {
      if (isObj(o) && isObj(o["if"]) && has(o["if"], "score")) add(gateOf(o["if"].score));
    });
    var name = play.score;
    if (typeof name === "string" && isObj(nodes)) {
      Object.keys(nodes).forEach(function (id) {
        var n = nodes[id];
        if (!isObj(n)) return;
        var owners = [n].concat(Array.isArray(n.choices) ? n.choices : [],
          (isObj(n.play) && Array.isArray(n.play.outcomes)) ? n.play.outcomes : []);
        owners.forEach(function (o) {
          if (isObj(o) && isObj(o["if"]) && has(o["if"], name)) add(gateOf(o["if"][name]));
        });
      });
    }
    return out;
  }

  // --- обход по состояниям -----------------------------------------------------
  // Состояние = узел + значения переменных. Возвращает достижимые узлы,
  // концовки, показанные условные варианты, узлы без единого видимого варианта
  // (blank) и ловушки (состояния без пути к концовке). При взрыве состояний
  // (> maxStates) обход обрывается и результат неполон: check сообщает только
  // об этом.
  function explore(data) {
    var nodes = data.nodes;
    var initVars = copyVars(isObj(data.vars) ? data.vars : {});
    var keyOf = function (id, vars) { return id + "|" + JSON.stringify(vars); };
    var seen = {}, order = [], edges = {}, parents = {};
    var queue = [];
    var reachedNodes = {}, endings = {}, shownChoices = {}, blank = {}, overflow = false;
    // Какие ветки outcomes хоть раз сработали: перекрытую видно по пропуску.
    var playedOutcomes = {};

    // choiceIdx: индекс видимого варианта, −1 у линейного узла, −2 у исхода
    // мини-игры (тогда заданы outcome/won/score — из них paths() строит шаг).
    function enter(id, vars, from, choiceIdx, outcome, won, score) {
      var v = applyEffects(copyVars(vars), nodes[id]);
      var key = keyOf(id, v);
      if (!seen[key]) {
        if (order.length >= LIMITS.maxStates) { overflow = true; return; }
        seen[key] = { id: id, vars: v };
        order.push(key);
        parents[key] = from === null ? null : { from: from, choice: choiceIdx, outcome: outcome, won: won, score: score };
        queue.push(key);
      }
      if (from !== null) { edges[from] = edges[from] || []; edges[from].push(key); }
    }
    enter(data.start, initVars, null, -1);
    while (queue.length && !overflow) {
      var key = queue.shift();
      var st = seen[key], n = nodes[st.id];
      reachedNodes[st.id] = true;
      if (isObj(n.end)) { endings[n.end.outcome] = endings[n.end.outcome] || key; continue; }
      if (typeof n.goto === "string") { enter(n.goto, st.vars, key, -1); continue; }
      // Узел мини-игры ветвится по всем исходам: won обе стороны, счёт
      // огрублён до 0 и порогов из условий (иначе состояний бесконечно).
      if (isObj(n.play)) {
        var gates = scoreGates(n.play, nodes);
        var scores = [0];
        gates.forEach(function (g) { if (scores.indexOf(g) < 0) scores.push(g); });
        var playedAny = false;
        // Порядок пар (won, счёт) не случаен: первым в parents ложится тот,
        // по которому paths() потом построит шаг для автопрогона. Сначала
        // согласованные пары — «выиграл с порогом» и «проиграл с нулём»,
        // иначе тест получил бы «won: true при счёте 0».
        [[true, "max"], [false, "min"], [true, "min"], [false, "max"]].forEach(function (mode) {
          var won = mode[0];
          var ordered = scores.slice().sort(function (a, b) { return mode[1] === "max" ? b - a : a - b; });
          ordered.forEach(function (sc) {
            var res = resolvePlay(n.play, { won: won, score: sc }, st.vars);
            var oi = n.play.outcomes.indexOf(res);
            if (!res || typeof res.goto !== "string" || !has(nodes, res.goto)) return;
            var v3 = copyVars(st.vars);
            if (typeof n.play.score === "string" && typeof v3[n.play.score] === "number") v3[n.play.score] = sc;
            applyEffects(v3, res);
            playedOutcomes[st.id + ":" + oi] = true;
            enter(res.goto, v3, key, -2, oi, won, sc);
            playedAny = true;
          });
        });
        if (!playedAny) blank[st.id] = true;
        continue;
      }
      var visibleIdx = 0;
      for (var i = 0; i < n.choices.length; i++) {
        var c = n.choices[i];
        if (!holds(st.vars, c["if"])) continue;
        shownChoices[st.id + ":" + i] = true;
        var v2 = applyEffects(copyVars(st.vars), c);
        enter(c.goto, v2, key, visibleIdx);
        visibleIdx++;
      }
      if (visibleIdx === 0) blank[st.id] = true;   // игрок увидит узел без кнопок
    }
    // Ловушки: состояния, из которых концовка недостижима (обратный обход).
    var traps = [];
    if (!overflow) {
      var canEnd = {};
      var rev = {};
      for (var from in edges) if (has(edges, from)) edges[from].forEach(function (to) { (rev[to] = rev[to] || []).push(from); });
      var q2 = [];
      for (var k2 in seen) if (has(seen, k2) && isObj(nodes[seen[k2].id].end)) { canEnd[k2] = true; q2.push(k2); }
      while (q2.length) {
        var cur = q2.shift();
        (rev[cur] || []).forEach(function (p) { if (!canEnd[p]) { canEnd[p] = true; q2.push(p); } });
      }
      var trapNodes = {};
      order.forEach(function (k3) { if (!canEnd[k3] && !trapNodes[seen[k3].id]) { trapNodes[seen[k3].id] = true; traps.push(seen[k3].id); } });
    }
    return { nodes: reachedNodes, endings: endings, shown: shownChoices, blank: blank, traps: traps, overflow: overflow, states: order.length, seen: seen, parents: parents, played: playedOutcomes };
  }

  // Полная проверка: предметы, форма, граф. Возвращает массив строк-ошибок.
  function check(raw) {
    var errs = checkItems(raw);
    if (errs.length) return errs;
    var data = withItems(raw);
    errs = checkShape(data, itemVars(raw));
    if (errs.length) return errs;
    var ex = explore(data);
    var nodes = data.nodes;
    if (ex.overflow) {
      // Обход неполон — выводы о достижимости были бы ложью.
      var nItems = isObj(raw.items) ? Object.keys(raw.items).length : 0;
      var nVars = Object.keys(isObj(raw.vars) ? raw.vars : {}).length;
      return ["сюжет слишком ветвист по переменным (больше " + LIMITS.maxStates + " состояний: " +
        nItems + " предметов, " + nVars + " переменных) — упрости: меньше независимых предметов и счётчиков"];
    }
    Object.keys(nodes).forEach(function (id) {
      if (!ex.nodes[id]) errs.push("nodes." + id + ": недостижим от start");
    });
    Object.keys(ex.blank).forEach(function (id) {
      errs.push("nodes." + id + ": при каком-то наборе предметов/переменных не показывается ни один вариант — оставь вариант без needs/if");
    });
    if (Object.keys(ex.endings).length < 2) errs.push("концовок меньше двух — это не новелла (нужно ≥ 2 разных end.outcome, достижимых от start)");
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      if (!Array.isArray(n.choices) || !ex.nodes[id]) return;
      n.choices.forEach(function (c, i) {
        if (c["if"] !== undefined && !ex.shown[id + ":" + i]) {
          var rawC = raw.nodes[id].choices[i];
          errs.push("nodes." + id + ".choices[" + i + "]: " + (Array.isArray(rawC.needs)
            ? "предмет для этого варианта нельзя получить раньше — вариант не показывается"
            : "условие никогда не выполняется — вариант не показывается"));
        }
      });
    });
    // Перекрытые ветки мини-игры: конечный перебор по решётке won × счёт
    // (0, порог−1, порог, порог+1) — ветка, которую ни разу не выбрал
    // resolvePlay, недостижима, потому что верхняя срабатывает всегда.
    var playTraps = {};
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      if (!isObj(n.play) || !Array.isArray(n.play.outcomes) || !ex.nodes[id]) return;
      var gates = scoreGates(n.play, nodes), grid = [0];
      gates.forEach(function (g) {
        [g - 1, g, g + 1].forEach(function (s) { if (grid.indexOf(s) < 0) grid.push(s); });
      });
      var hit = {};
      [true, false].forEach(function (won) {
        grid.forEach(function (sc) {
          var probe = copyVars(isObj(data.vars) ? data.vars : {});
          if (typeof n.play.score === "string" && typeof probe[n.play.score] === "number") probe[n.play.score] = sc;
          var res = resolvePlay(n.play, { won: won, score: sc }, probe);
          hit[n.play.outcomes.indexOf(res)] = true;
        });
      });
      // Точное число по счёту — частая причина ЛОЖНОГО «недостижимо»:
      // решётка перебирает пороги, а не все значения. Тогда подсказываем
      // заменить точку на порог.
      var exact = n.play.outcomes.some(function (o) {
        return isObj(o) && isObj(o["if"]) && isExactGate(o["if"].score);
      });
      n.play.outcomes.forEach(function (o, i) {
        if (hit[i] || !isObj(o)) return;
        errs.push("nodes." + id + ".play.outcomes[" + i + "]: эта ветка недостижима — предыдущая ветка срабатывает всегда" +
          (exact ? "; сравнивай счёт с порогом (`score: {gte: N}`), а не с точным числом" : ""));
      });
      // Узел мини-игры оказался ловушкой: куда бы ни увела ветка, концовки
      // оттуда не видно. Общая «ловушка» тут туманна — говорим про исходы.
      if (ex.traps.indexOf(id) >= 0) {
        playTraps[id] = true;
        errs.push("nodes." + id + ".play: ни один исход не ведёт к концовке");
      }
    });
    ex.traps.forEach(function (id) {
      if (!ex.blank[id] && !playTraps[id]) errs.push("nodes." + id + ": из него нет пути к концовке (ловушка)");
    });
    return errs;
  }

  // Пути до каждой концовки: { outcome: [шаг, …] }. Шаг выбора — число
  // (индекс видимого варианта), шаг мини-игры — { kind: "play", won, score }:
  // автопрогону нужно не только «что нажать», но и «чем кончить партию».
  // Линейные узлы проходятся «дальше» и шага не занимают.
  function paths(raw) {
    var ex = explore(withItems(raw)), out = {};
    Object.keys(ex.endings).forEach(function (outcome) {
      var steps = [], key = ex.endings[outcome];
      while (ex.parents[key]) {
        var p = ex.parents[key];
        if (p.choice >= 0) steps.unshift(p.choice);
        else if (p.choice === -2) steps.unshift({ kind: "play", won: !!p.won, score: p.score || 0, outcome: p.outcome });
        key = p.from;
      }
      out[outcome] = steps;
    });
    return out;
  }

  // --- рантайм -----------------------------------------------------------------
  // create(data) → { id(), node(), choices() [{index, text, goto}], choose(i),
  // next(), ended(), vars, history, state(), load(state) }. Эффекты узла
  // применяются при входе, варианта — при выборе.
  function create(raw) {
    var data = withItems(raw);
    var nodes = data.nodes;
    var rt = { vars: copyVars(isObj(data.vars) ? data.vars : {}), history: [], current: null, items: null };
    var itemKeys = isObj(raw.items) ? Object.keys(raw.items) : [];
    // Предметы в руках — по служебным переменным; порядок как в items.
    rt.inventory = function () {
      return itemKeys.filter(function (k) { return rt.vars[itemVar(k)] === true; });
    };
    rt.item = function (k) { return isObj(raw.items) ? raw.items[k] : undefined; };
    // Что выдал/забрал вход в узел или выбор (для тоста): разница инвентаря.
    function diff(before) {
      var after = rt.inventory();
      return {
        gained: after.filter(function (k) { return before.indexOf(k) < 0; }),
        lost: before.filter(function (k) { return after.indexOf(k) < 0; })
      };
    }
    function enter(id) {
      rt.current = id;
      applyEffects(rt.vars, nodes[id]);
      rt.history.push(id);
      if (rt.history.length > LIMITS.maxHistory) rt.history.shift();
      return rt;
    }
    rt.id = function () { return rt.current; };
    rt.node = function () { return nodes[rt.current]; };
    rt.ended = function () { var n = rt.node(); return isObj(n.end) ? n.end : null; };
    rt.linear = function () { return typeof rt.node().goto === "string"; };
    // Узел мини-игры: кит показывает кнопку и зовёт ZV.play, потом playDone.
    rt.play = function () { var n = rt.node(); return isObj(n.play) ? n.play : null; };
    // Итог партии → ветка сюжета: счёт в переменную, эффекты ветки, переход.
    rt.playDone = function (result) {
      var p = rt.play();
      if (!p) return null;
      var res = resolvePlay(p, result, rt.vars);
      if (typeof p.score === "string" && has(rt.vars, p.score)) {
        rt.vars[p.score] = (result && typeof result.score === "number") ? result.score : 0;
      }
      applyEffects(rt.vars, res);
      var before = rt.inventory();
      enter(res.goto);
      rt.lastChange = diff(before);
      return res;
    };
    rt.choices = function () {
      var n = rt.node(), out = [];
      if (!Array.isArray(n.choices)) return out;
      n.choices.forEach(function (c, i) { if (holds(rt.vars, c["if"])) out.push({ index: i, text: c.text, goto: c.goto }); });
      return out;
    };
    // i — индекс среди ВИДИМЫХ вариантов.
    rt.choose = function (i) {
      var list = rt.choices();
      var c = list[i];
      if (!c) return false;
      var before = rt.inventory();
      applyEffects(rt.vars, nodes[rt.current].choices[c.index]);
      enter(c.goto);
      rt.lastChange = diff(before);
      return true;
    };
    rt.next = function () {
      var n = rt.node();
      if (typeof n.goto !== "string") return false;
      var before = rt.inventory();
      enter(n.goto);
      rt.lastChange = diff(before);
      return true;
    };
    rt.state = function () { return { node: rt.current, vars: copyVars(rt.vars), history: rt.history.slice() }; };
    rt.load = function (s) {
      if (!isObj(s) || !has(nodes, s.node)) return false;
      rt.current = s.node;
      rt.vars = copyVars(isObj(s.vars) ? s.vars : rt.vars);
      rt.history = Array.isArray(s.history) ? s.history.slice() : [];
      rt.lastChange = { gained: [], lost: [] };   // восстановление — не переход
      return true;
    };
    var before0 = rt.inventory();
    enter(data.start);
    rt.lastChange = diff(before0);
    return rt;
  }

  var api = { LIMITS: LIMITS, PLAYABLE: PLAYABLE, holds: holds, applyEffects: applyEffects, checkShape: checkShape, checkItems: checkItems, withItems: withItems, itemVars: itemVars, explore: explore, check: check, paths: paths, create: create, resolvePlay: resolvePlay, scoreGates: scoreGates };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_NOVEL = api;
})(typeof window !== "undefined" ? window : null);
