// Уровни платформера числами, без Phaser: текстовая карта → сетка, проверка
// формы и СОЛВЕР ПРОХОДИМОСТИ. Солвер повторяет физику Arcade тик в тик
// (шаг 1/60, v += g·dt, x += v·dt, разделение по тайлам с tileBias 16 и
// «интересными гранями» — как в World.update/SeparateTile вендорной сборки
// 3.90), поэтому его план исполняет бот в headless-прогоне: солвер сказал
// «проходим» — бот обязан пройти. Модуль чистый: гоняется node --test на
// content/levels.json и зовётся китом при старте уровня.
(function (root) {
  "use strict";

  var TILE = 32;
  // Габарит тела героя в px канвы. Кит ставит тело ровно таким (bodyW/bodyH в
  // ZV.sprite.apply), какой бы ни была картинка: карта рисуется под эти числа.
  var HERO = { w: 22, h: 48 };
  // Канва 640 = игровое поле 544 (17 рядов) + панель кнопок 96 внизу.
  var BAR = 96;
  var PLAY_H = 544;
  // Тела предметов внутри клетки (x, y от левого верхнего угла клетки).
  var BODIES = {
    coin: { x: 8, y: 8, w: 16, h: 16 },
    spike: { x: 4, y: 18, w: 24, h: 14 },   // ниже половины: задеть плечом нельзя
    exit: { x: 0, y: 0, w: 32, h: 32 }
  };
  // Пресет физики: дефолты кита platformer (те же ключи в config.params).
  // Высота прыжка jump²/(2g) ≈ 114 px (3,5 клетки), полёт 2·jump/g ≈ 0,71 с,
  // дальность ≈ 121 px — см. reach().
  var PHYSICS = { moveSpeed: 170, gravity: 1800, jump: 640, maxFall: 900 };
  var DT = 1 / 60;
  var TILE_BIAS = 16;      // World.TILE_BIAS: глубже — тайл не разделяет
  var LEGEND = { "#": "solid", ".": "empty", " ": "empty", "S": "start", "X": "exit", "o": "coin", "^": "spike" };
  var LIMITS = { minCols: 8, maxCols: 200, minRows: 4, maxRows: 40, maxLevels: 20 };

  // --- разбор карты --------------------------------------------------------
  // map — массив строк одинаковой длины из символов LEGEND. Возвращает
  // { level, errors }: level.solid[c + r·w], interesting (тайл с открытой
  // гранью — только такие участвуют в разделении), start, exits, coins, spikes.
  function parse(map, where) {
    where = where || "map";
    var errors = [];
    if (!Array.isArray(map) || !map.length) return { level: null, errors: [where + ": массив строк"] };
    var h = map.length, w = typeof map[0] === "string" ? map[0].length : 0;
    if (h < LIMITS.minRows || h > LIMITS.maxRows) errors.push(where + ": строк от " + LIMITS.minRows + " до " + LIMITS.maxRows + " (сейчас " + h + ")");
    if (w < LIMITS.minCols || w > LIMITS.maxCols) errors.push(where + ": столбцов от " + LIMITS.minCols + " до " + LIMITS.maxCols + " (сейчас " + w + ")");
    if (errors.length) return { level: null, errors: errors };
    var solid = new Uint8Array(w * h);
    var start = null, exits = [], coins = [], spikes = [], starts = 0;
    for (var r = 0; r < h; r++) {
      var line = map[r];
      if (typeof line !== "string" || line.length !== w) { errors.push(where + "[" + r + "]: строка длиной " + w); continue; }
      for (var c = 0; c < w; c++) {
        var ch = line[c], kind = LEGEND[ch];
        if (!kind) { errors.push(where + "[" + r + "]: символ «" + ch + "» в столбце " + c + " — только # . S X o ^"); continue; }
        if (kind === "solid") solid[c + r * w] = 1;
        else if (kind === "start") { starts++; start = { c: c, r: r }; }
        else if (kind === "exit") exits.push({ c: c, r: r });
        else if (kind === "coin") coins.push({ c: c, r: r });
        else if (kind === "spike") spikes.push({ c: c, r: r });
      }
    }
    if (starts !== 1) errors.push(where + ": ровно один старт S (сейчас " + starts + ")");
    if (!exits.length) errors.push(where + ": нет выхода X");
    if (errors.length) return { level: null, errors: errors };
    var level = { w: w, h: h, W: w * TILE, H: h * TILE, solid: solid, start: start, exits: exits, coins: coins, spikes: spikes, interesting: null, faces: null };
    computeFaces(level);
    return { level: level, errors: errors };
  }

  function isSolid(level, c, r) {
    if (c < 0 || r < 0 || c >= level.w || r >= level.h) return false;
    return level.solid[c + r * level.w] === 1;
  }

  // Грани как у Tilemap.CalculateFacesWithin: грань «интересна», если сосед
  // с той стороны не сплошной (или его нет). Внутренние стыки не разделяют —
  // иначе герой цеплялся бы за швы пола.
  function computeFaces(level) {
    var w = level.w, h = level.h;
    var faces = new Uint8Array(w * h);   // биты: 1 left, 2 right, 4 top, 8 bottom
    var interesting = new Uint8Array(w * h);
    for (var r = 0; r < h; r++) {
      for (var c = 0; c < w; c++) {
        if (!isSolid(level, c, r)) continue;
        var f = 0;
        if (!isSolid(level, c - 1, r)) f |= 1;
        if (!isSolid(level, c + 1, r)) f |= 2;
        if (!isSolid(level, c, r - 1)) f |= 4;
        if (!isSolid(level, c, r + 1)) f |= 8;
        faces[c + r * w] = f;
        interesting[c + r * w] = f ? 1 : 0;
      }
    }
    level.faces = faces;
    level.interesting = interesting;
  }

  // --- симулятор: один шаг физики Arcade -------------------------------------
  // s — тело героя {x, y (левый верх), vx, vy, down, up, left, right}. dir —
  // −1/0/1, скорость по x задаётся заново каждый тик (кит делает то же в update).
  function makeSim(level, phys) {
    var speed = phys.moveSpeed, g = phys.gravity, maxFall = phys.maxFall;
    var W = level.W;

    function intersects(s, t) {
      return !(s.x + HERO.w <= t.left || s.y + HERO.h <= t.top || s.x >= t.right || s.y >= t.bottom);
    }

    // TileCheckX + ProcessTileSeparationX
    function checkX(s, t, dx) {
      var ox = 0;
      if (dx < 0) {
        if (t.faceRight && s.x < t.right) { ox = s.x - t.right; if (ox < -TILE_BIAS) ox = 0; }
      } else if (dx > 0) {
        if (t.faceLeft && s.x + HERO.w > t.left) { ox = s.x + HERO.w - t.left; if (ox > TILE_BIAS) ox = 0; }
      }
      if (ox !== 0) {
        if (ox < 0) s.left = true; else s.right = true;
        s.x -= ox;
        s.vx = 0;
      }
      return ox;
    }

    function checkY(s, t, dy) {
      var oy = 0;
      if (dy < 0) {
        if (t.faceBottom && s.y < t.bottom) { oy = s.y - t.bottom; if (oy < -TILE_BIAS) oy = 0; }
      } else if (dy > 0) {
        if (t.faceTop && s.y + HERO.h > t.top) { oy = s.y + HERO.h - t.top; if (oy > TILE_BIAS) oy = 0; }
      }
      if (oy !== 0) {
        if (oy < 0) s.up = true; else s.down = true;
        s.y -= oy;
        s.vy = 0;
      }
      return oy;
    }

    // SeparateTile: сперва ось с меньшим проникновением (или доминирующая по
    // смещению), вторая — если тело всё ещё пересекает тайл.
    function separate(s, t, dx, dy) {
      var faceH = t.faceLeft || t.faceRight, faceV = t.faceTop || t.faceBottom;
      if (!faceH && !faceV) return;
      var ox = 0, oy = 0, minX = 0, minY = 1;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx > ady) minX = -1; else if (adx < ady) minY = -1;
      if (dx !== 0 && dy !== 0 && faceH && faceV) {
        minX = Math.min(Math.abs(s.x - t.right), Math.abs(s.x + HERO.w - t.left));
        minY = Math.min(Math.abs(s.y - t.bottom), Math.abs(s.y + HERO.h - t.top));
      }
      if (minX < minY) {
        if (faceH) { ox = checkX(s, t, dx); if (ox !== 0 && !intersects(s, t)) return; }
        if (faceV) oy = checkY(s, t, dy);
      } else {
        if (faceV) { oy = checkY(s, t, dy); if (oy !== 0 && !intersects(s, t)) return; }
        if (faceH) ox = checkX(s, t, dx);
      }
    }

    var tile = { left: 0, top: 0, right: 0, bottom: 0, faceLeft: false, faceRight: false, faceTop: false, faceBottom: false };

    function tick(s, dir) {
      s.vx = dir * speed;
      var vy = s.vy + g * DT;
      if (vy > maxFall) vy = maxFall; else if (vy < -maxFall) vy = -maxFall;
      s.vy = vy;
      var prevX = s.x, prevY = s.y;
      s.x = s.x + s.vx * DT;
      s.y = s.y + s.vy * DT;
      var dx = s.x - prevX, dy = s.y - prevY;
      s.down = false; s.up = false; s.left = false; s.right = false;
      // Границы мира: только слева и справа (вниз герой падает и гибнет).
      if (s.x < 0) { s.x = 0; s.vx = 0; s.left = true; }
      else if (s.x + HERO.w > W) { s.x = W - HERO.w; s.vx = 0; s.right = true; }
      // Тайлы в прямоугольнике тела, расширенном на клетку влево и вверх
      // (collideSpriteVsTilemapLayer), построчно.
      var xs = Math.max(0, Math.floor((s.x - TILE) / TILE));
      var ys = Math.max(0, Math.floor((s.y - TILE) / TILE));
      var xe = Math.min(level.w, Math.ceil((s.x + HERO.w) / TILE));
      var ye = Math.min(level.h, Math.ceil((s.y + HERO.h) / TILE));
      for (var r = ys; r < ye; r++) {
        for (var c = xs; c < xe; c++) {
          var i = c + r * level.w;
          if (!level.interesting[i]) continue;
          tile.left = c * TILE; tile.top = r * TILE; tile.right = tile.left + TILE; tile.bottom = tile.top + TILE;
          if (!intersects(s, tile)) continue;
          var f = level.faces[i];
          tile.faceLeft = !!(f & 1); tile.faceRight = !!(f & 2); tile.faceTop = !!(f & 4); tile.faceBottom = !!(f & 8);
          separate(s, tile, dx, dy);
        }
      }
    }

    function overlapsRect(s, rx, ry, rw, rh) {
      return !(s.x + HERO.w <= rx || s.y + HERO.h <= ry || s.x >= rx + rw || s.y >= ry + rh);
    }
    function touching(s, list, body) {
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (overlapsRect(s, it.c * TILE + body.x, it.r * TILE + body.y, body.w, body.h)) return it;
      }
      return null;
    }

    return { tick: tick, intersects: intersects, overlapsRect: overlapsRect, touching: touching };
  }

  // Прогон одного действия из стоячего состояния. kind: "jump" (прыжок с
  // удержанием dir весь полёт), "drop" (идти в dir до края и упасть), "fall"
  // (просто упасть — старт). Конец: land (стоим), death (шип), fall (за
  // низ карты), exit (коснулись выхода), stuck (не оторвались за 2 с).
  function runAction(level, phys, sim, x, y, action) {
    var s = { x: x, y: y, vx: 0, vy: 0, down: true, up: false, left: false, right: false };
    var dir = action.dir || 0;
    if (action.kind === "jump") s.vy = -phys.jump;
    var airborne = action.kind === "fall";
    var coins = [], trace = action.trace ? [] : null;
    for (var t = 0; t < 600; t++) {
      sim.tick(s, dir);
      if (trace) trace.push([s.x, s.y]);
      if (sim.touching(s, level.spikes, BODIES.spike)) return { end: "death", ticks: t + 1, coins: coins, trace: trace };
      var ex = sim.touching(s, level.exits, BODIES.exit);
      if (ex) return { end: "exit", ticks: t + 1, coins: coins, trace: trace, x: s.x, y: s.y };
      var coin = sim.touching(s, level.coins, BODIES.coin);
      if (coin && coins.indexOf(coin) < 0) coins.push(coin);
      if (s.y > level.H + 64) return { end: "fall", ticks: t + 1, coins: coins, trace: trace };
      if (!airborne) {
        if (!s.down) airborne = true;
        else if (t >= 120) return { end: "stuck", ticks: t + 1, coins: coins, trace: trace };
        continue;
      }
      if (s.down) return { end: "land", ticks: t + 1, coins: coins, trace: trace, x: s.x, y: s.y };
    }
    return { end: "stuck", ticks: 600, coins: coins, trace: trace };
  }

  // --- интервалы стояния -----------------------------------------------------
  // Стоять на x (левый край тела) с ногами на верхе ряда row можно, если тело
  // не пересекает сплошные тайлы и шипы, а под ногами есть хоть один тайл.
  // margin — отступ от шипов по горизонтали: бот и человек подходят к точке
  // взлёта с перелётом в пару пикселей, стоять вплотную к шипам нельзя.
  function freeAt(level, sim, x, y, margin) {
    if (x < 0 || x + HERO.w > level.W) return false;
    var c0 = Math.floor(x / TILE), c1 = Math.floor((x + HERO.w - 1e-9) / TILE);
    var r0 = Math.floor(y / TILE), r1 = Math.floor((y + HERO.h - 1e-9) / TILE);
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) if (isSolid(level, c, r)) return false;
    // Пересечение с шипами, расширенными на margin в обе стороны.
    var s = { x: x, y: y }, sp = BODIES.spike;
    for (var i = 0; i < level.spikes.length; i++) {
      var it = level.spikes[i];
      if (sim.overlapsRect(s, it.c * TILE + sp.x - margin, it.r * TILE + sp.y, sp.w + 2 * margin, sp.h)) return false;
    }
    return true;
  }
  function canStand(level, sim, x, row, margin) {
    var y = row * TILE - HERO.h;
    if (!freeAt(level, sim, x, y, margin || 0)) return false;
    var c0 = Math.floor(x / TILE), c1 = Math.floor((x + HERO.w - 1e-9) / TILE);
    for (var c = c0; c <= c1; c++) if (isSolid(level, c, row)) return true;
    return false;
  }

  // Интервал [lo, hi] позиций x, соединённых ходьбой, вокруг x0 на ряду row.
  function findInterval(level, sim, x0, row, cache, margin) {
    var lo = Math.floor(x0), hi = Math.floor(x0);
    if (!canStand(level, sim, lo, row, margin)) {
      // Приземление на дробный x: проверим сам x0 и ближайшие целые.
      if (canStand(level, sim, x0, row, margin)) { lo = hi = x0; }
      else if (canStand(level, sim, lo + 1, row, margin)) { lo = hi = lo + 1; }
      else return null;
    }
    while (lo - 1 >= 0 && canStand(level, sim, lo - 1, row, margin)) lo--;
    while (hi + 1 + HERO.w <= level.W && canStand(level, sim, hi + 1, row, margin)) hi++;
    var key = row + ":" + lo;
    if (cache[key]) return cache[key];
    var iv = { key: key, row: row, lo: lo, hi: hi, y: row * TILE - HERO.h };
    cache[key] = iv;
    return iv;
  }

  // Интервал по результату приземления (x дробный).
  function landingInterval(level, sim, res, cache, margin) {
    var row = Math.round((res.y + HERO.h) / TILE);
    return findInterval(level, sim, res.x, row, cache, margin);
  }

  // --- солвер ----------------------------------------------------------------
  // BFS по интервалам стояния. Из каждого интервала: прыжок с любого x (шаг
  // quantum) в трёх направлениях и сход с обоих краёв. Переход считается, если
  // он НАДЁЖЕН: те же действия с x±slack приводят в тот же интервал — у игрока
  // есть окно взлёта, а у бота — запас на кадр задержки. Возвращает план для
  // бота: [{kind, x, dir}…, {kind:"walk", x}] в координатах левого края тела.
  function solve(level, phys, opts) {
    opts = opts || {};
    phys = phys || PHYSICS;
    var slack = typeof opts.slack === "number" ? opts.slack : 6;
    var q = typeof opts.quantum === "number" ? opts.quantum : 2;
    var sim = makeSim(level, phys);
    var cache = {}, simCache = {};
    var sims = 0;

    function act(x, y, action) {
      var key = action.kind + action.dir + ":" + Math.round(x * 4) + ":" + y;
      var r = simCache[key];
      if (!r) { r = runAction(level, phys, sim, x, y, action); sims++; simCache[key] = r; }
      return r;
    }

    // Старт: ноги в низу клетки S, падаем до первой опоры.
    var sx = level.start.c * TILE + (TILE - HERO.w) / 2;
    var sy = (level.start.r + 1) * TILE - HERO.h;
    var startRes = act(sx, sy, { kind: "fall", dir: 0 });
    var result = { ok: false, reason: "", plan: [], coins: { total: level.coins.length, unreachable: [] }, intervals: 0, sims: 0 };
    if (startRes.end === "exit") { result.ok = true; result.plan = []; return finish(result); }
    if (startRes.end !== "land") { result.reason = "старт над пропастью или шипами"; return finish(result); }
    var first = landingInterval(level, sim, startRes, cache, slack);
    if (!first) { result.reason = "старт: некуда встать"; return finish(result); }

    var reached = {}, parent = {}, queue = [first];
    var coinsSeen = {};
    var markCoins = function (list) { for (var i = 0; i < list.length; i++) coinsSeen[list[i].c + "," + list[i].r] = true; };
    markCoins(startRes.coins);
    reached[first.key] = first;
    parent[first.key] = null;
    var exitHit = null;   // { iv, action } — выход задет в полёте
    var exitStand = null; // { iv, x } — выход рядом со стоячей позицией

    // Монеты на уровне ног: пересечение стоячим телом.
    function standCoins(iv) {
      for (var i = 0; i < level.coins.length; i++) {
        var cn = level.coins[i], rx = cn.c * TILE + BODIES.coin.x, ry = cn.r * TILE + BODIES.coin.y;
        if (ry + BODIES.coin.h <= iv.y || ry >= iv.y + HERO.h) continue;
        // есть ли x в интервале с пересечением по горизонтали
        var xa = Math.max(iv.lo, rx - HERO.w + 1), xb = Math.min(iv.hi, rx + BODIES.coin.w - 1);
        if (xa <= xb) coinsSeen[cn.c + "," + cn.r] = true;
      }
    }
    function standExit(iv) {
      var best = null;
      for (var i = 0; i < level.exits.length; i++) {
        var e = level.exits[i], rx = e.c * TILE + BODIES.exit.x, ry = e.r * TILE + BODIES.exit.y;
        if (ry + BODIES.exit.h <= iv.y || ry >= iv.y + HERO.h) continue;
        var xa = Math.max(iv.lo, rx - HERO.w + 1), xb = Math.min(iv.hi, rx + BODIES.exit.w - 1);
        if (xa > xb) continue;
        // Целимся в центр выхода: там запас с обеих сторон.
        var want = rx + BODIES.exit.w / 2 - HERO.w / 2;
        var x = Math.max(xa, Math.min(xb, Math.round(want)));
        if (!best) best = x;
      }
      return best;
    }

    function landsIn(res) {
      if (res.end !== "land") return null;
      return landingInterval(level, sim, res, cache, slack);
    }

    // Точка взлёта для проверки запаса: сосед по x за краем интервала — либо
    // стена (герой упрётся, взлёт с края), либо воздух над ямой (взлёт по
    // coyote-time с той же траектории, см. replay).
    function takeoff(iv, x) {
      if (x >= iv.lo && x <= iv.hi) return x;
      if (freeAt(level, sim, x, iv.y, slack)) return x;
      return x < iv.lo ? iv.lo : iv.hi;
    }

    var actions = [{ kind: "jump", dir: -1 }, { kind: "jump", dir: 0 }, { kind: "jump", dir: 1 }];

    // Обход не останавливается на первом выходе: достижимость монет считается
    // по всем интервалам, куда вообще можно попасть. План — по первому выходу.
    while (queue.length) {
      var iv = queue.shift();
      standCoins(iv);
      var ex = standExit(iv);
      if (ex !== null && !exitStand && !exitHit) exitStand = { iv: iv, x: ex };
      var xs = [];
      for (var x = iv.lo; x <= iv.hi; x += q) xs.push(x);
      if (xs[xs.length - 1] !== iv.hi) xs.push(iv.hi);
      var tries = [];
      for (var i = 0; i < xs.length; i++) for (var a = 0; a < actions.length; a++) tries.push({ x: xs[i], action: actions[a] });
      tries.push({ x: iv.lo, action: { kind: "drop", dir: -1 } });
      tries.push({ x: iv.hi, action: { kind: "drop", dir: 1 } });
      for (var t = 0; t < tries.length; t++) {
        var tx = tries[t].x, action = tries[t].action;
        var mid = act(tx, iv.y, action);
        markCoins(mid.coins);
        if (mid.end === "exit") {
          // Надёжность и для финального прыжка: сосед по x тоже обязан достать.
          var okE = true;
          var offsE = action.kind === "drop" ? [-1, -2] : [-slack, slack];
          for (var oe = 0; oe < offsE.length; oe++) {
            var xe = takeoff(iv, tx + offsE[oe]);
            var re = act(xe, iv.y, action);
            markCoins(re.coins);
            if (re.end !== "exit") { okE = false; break; }
          }
          if (okE && !exitHit && !exitStand) exitHit = { iv: iv, x: tx, action: action };
          continue;
        }
        var to = landsIn(mid);
        if (!to || reached[to.key]) continue;
        var ok = true;
        var offs = action.kind === "drop" ? [-1, -2] : [-slack, slack];
        for (var o = 0; o < offs.length; o++) {
          var xo = takeoff(iv, tx + offs[o]);
          var ro = act(xo, iv.y, action);
          markCoins(ro.coins);
          var too = landsIn(ro);
          if (!too || too.key !== to.key) { ok = false; break; }
        }
        if (!ok) continue;
        reached[to.key] = to;
        parent[to.key] = { from: iv.key, x: tx, action: action };
        queue.push(to);
      }
    }

    result.intervals = Object.keys(reached).length;
    result.sims = sims;
    // План: от финального интервала назад к старту.
    var last = exitHit ? exitHit.iv : (exitStand ? exitStand.iv : null);
    if (last) {
      var steps = [];
      var cur = last.key;
      while (parent[cur]) {
        var p = parent[cur];
        steps.unshift({ kind: p.action.kind, x: p.x, dir: p.action.dir });
        cur = p.from;
      }
      if (exitHit) steps.push({ kind: exitHit.action.kind, x: exitHit.x, dir: exitHit.action.dir });
      else steps.push({ kind: "walk", x: exitStand.x });
      result.ok = true;
      result.plan = steps;
    } else {
      result.reason = "выход недостижим";
    }
    // Недостижимые монеты — по всем прогонам из достигнутых интервалов.
    for (var ci = 0; ci < level.coins.length; ci++) {
      var cn = level.coins[ci];
      if (!coinsSeen[cn.c + "," + cn.r]) result.coins.unreachable.push({ c: cn.c, r: cn.r });
    }
    return finish(result);

    function finish(r) { r.sims = sims; return r; }
  }

  // Дальность и высота прыжка при данной физике (для README и тестов):
  // прыжок с ровного пола в пустоту, dir = 1.
  function reach(phys) {
    phys = phys || PHYSICS;
    var s = { x: 0, y: 0, vx: 0, vy: -phys.jump };
    var top = 0, t = 0;
    while (t < 600) {
      var vy = Math.min(phys.maxFall, s.vy + phys.gravity * DT);
      s.vy = vy; s.x += phys.moveSpeed * DT; s.y += vy * DT; t++;
      if (s.y < top) top = s.y;
      if (s.y >= 0) break;
    }
    return { heightPx: -top, distancePx: s.x, flightTicks: t, heightTiles: -top / TILE, distanceTiles: s.x / TILE };
  }

  // --- исполнитель плана -----------------------------------------------------
  // Одна и та же логика ведёт героя по плану и в симуляторе (replay), и в
  // браузере (бот tests/e2e/bots.js): наблюдает тело {x, y, vx, down} в
  // координатах карты и отдаёт ввод {dir, jump}. Решение принимается по
  // положению ЧЕРЕЗ тик (nx): в движке ввод, принятый после кадра k, доходит до
  // физики на кадре k+2, а кадр k+1 тело ещё идёт со старой скоростью.
  function follower(plan) {
    var i = 0, phase = "walk", wasAir = false;
    var f = {
      done: false, step: function () { return i; }, phase: function () { return phase; },
      decide: function (s) {
        if (i >= plan.length) { f.done = true; return { dir: 0, jump: false }; }
        var step = plan[i];
        if (phase === "walk") {
          var nx = s.x + s.vx * DT;
          var d = step.x - nx;
          var arrive = Math.abs(d) <= 2 || ((step.x - s.x) * d < 0);
          if (step.kind === "walk") {
            if (arrive) { i++; if (i >= plan.length) f.done = true; return { dir: 0, jump: false }; }
            return { dir: d > 0 ? 1 : -1, jump: false };
          }
          if (!arrive) return { dir: d > 0 ? 1 : -1, jump: false };
          wasAir = false;
          if (step.kind === "jump") { phase = "air"; return { dir: step.dir, jump: true }; }
          phase = "drop";
          return { dir: step.dir, jump: false };
        }
        if (phase === "drop") {
          if (!s.down) { phase = "air"; wasAir = true; }
          return { dir: step.dir, jump: false };
        }
        // air: ждём отрыва, затем приземления — и сразу решаем следующий шаг.
        if (!s.down) wasAir = true;
        else if (wasAir) { i++; phase = "walk"; return f.decide(s); }
        return { dir: step.dir, jump: false };
      }
    };
    return f;
  }

  // Прогон плана в симуляторе с задержкой ввода как в движке (решение после
  // тика k действует с тика k+2). Возвращает {end, ticks, trace}.
  function replay(level, phys, plan, opts) {
    opts = opts || {};
    phys = phys || PHYSICS;
    var sim = makeSim(level, phys);
    var sx = level.start.c * TILE + (TILE - HERO.w) / 2;
    var sy = (level.start.r + 1) * TILE - HERO.h;
    var s = { x: sx, y: sy, vx: 0, vy: 0, down: false, up: false, left: false, right: false };
    var f = follower(plan);
    var pending = { dir: 0, jump: false }, next = { dir: 0, jump: false };
    var trace = opts.trace ? [] : null;
    var landed = false, coins = [];
    var limit = opts.ticks || 3600;
    // Coyote-time как в ките: прыжок разрешён ещё coyote тиков после схода с
    // края, если с земли ещё не прыгали.
    var coyote = typeof opts.coyoteTicks === "number" ? opts.coyoteTicks : 4;
    var sinceDown = 0, jumped = false;
    for (var t = 0; t < limit; t++) {
      var pad = pending; pending = next;
      if (pad.jump && !jumped && (s.down || sinceDown <= coyote)) { s.vy = -phys.jump; jumped = true; }
      sim.tick(s, pad.dir);
      if (s.down) { sinceDown = 0; if (s.vy >= 0) jumped = false; } else sinceDown++;
      if (trace) trace.push([s.x, s.y, s.down ? 1 : 0]);
      if (sim.touching(s, level.spikes, BODIES.spike)) return { end: "death", ticks: t + 1, trace: trace, step: f.step() };
      if (sim.touching(s, level.exits, BODIES.exit)) return { end: "exit", ticks: t + 1, trace: trace, step: f.step(), coins: coins };
      var coin = sim.touching(s, level.coins, BODIES.coin);
      if (coin && coins.indexOf(coin) < 0) coins.push(coin);
      if (s.y > level.H + 64) return { end: "fall", ticks: t + 1, trace: trace, step: f.step() };
      if (!landed) { if (s.down) landed = true; else { next = { dir: 0, jump: false }; continue; } }
      next = f.decide({ x: s.x, y: s.y, vx: s.vx, down: s.down });
    }
    return { end: "timeout", ticks: limit, trace: trace, step: f.step() };
  }

  // --- валидатор уровня (форма + проходимость) --------------------------------
  // opts.unchecked — только форма, без солвера (автопрогон заведомо
  // непроходимых уровней; в игре флаг не используется).
  function validateLevel(map, phys, where, opts) {
    where = where || "map";
    var p = parse(map, where);
    if (p.errors.length) return { errors: p.errors, level: null, solved: null };
    if (opts && opts.unchecked) return { errors: [], level: p.level, solved: null };
    var solved = solve(p.level, phys || PHYSICS, opts);
    var errors = [];
    if (!solved.ok) errors.push(where + ": " + solved.reason);
    for (var i = 0; i < solved.coins.unreachable.length; i++) {
      var cn = solved.coins.unreachable[i];
      errors.push(where + ": монета в столбце " + cn.c + ", строке " + cn.r + " недостижима");
    }
    return { errors: errors, level: p.level, solved: solved };
  }

  var api = {
    TILE: TILE, HERO: HERO, BAR: BAR, PLAY_H: PLAY_H, BODIES: BODIES, PHYSICS: PHYSICS, DT: DT, LEGEND: LEGEND, LIMITS: LIMITS,
    parse: parse, isSolid: isSolid, makeSim: makeSim, runAction: runAction, canStand: canStand,
    solve: solve, reach: reach, validateLevel: validateLevel, follower: follower, replay: replay
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_LEVELS = api;
})(typeof window !== "undefined" ? window : null);
