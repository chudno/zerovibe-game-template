// Боты внутри страницы: подписка на poststep движка, ввод и инварианты в том
// же кадре, что и физика. Два режима: expert (обязан выиграть — ловит
// непроходимость) и novice (случайные тапы, обязан проиграть — ловит игру,
// которая проходится сама). Список нарушений инвариантов читает тест.
(function (global) {
  "use strict";
  var state = { kind: "", mode: "", frames: 0, violations: [], groundTs: 0, jumps: 0, stopped: false, inMini: false };

  function violation(msg) {
    if (state.violations.length < 20 && state.violations.indexOf(msg) < 0) state.violations.push(msg);
  }
  function finite(v) { return typeof v === "number" && isFinite(v); }
  // Игровая сцена: обычно zv-play, но мини-игра сюжета (узел play) живёт под
  // ключом zv-mini, пока zv-play спит — бот кита обязан видеть именно её.
  // Кончилась мини-игра — сцена снимается, и бот кита обязан замолчать: иначе
  // он лезет в поля снятой сцены и ломает ввод вернувшегося сюжета.
  function play(game) {
    var mini = game.scene.getScene("zv-mini");
    if (state.inMini && !mini) { state.stopped = true; return null; }
    if (mini) state.inMini = true;
    var sc = mini || game.scene.getScene("zv-play");
    return sc && sc.sys.isActive() && !sc.over ? sc : null;
  }

  // Общие инварианты сцены с героем и телами.
  function checkBodies(sc, now) {
    if (sc.hero) {
      if (!finite(sc.hero.x) || !finite(sc.hero.y)) violation("координаты героя не число");
      if (sc.hero.x < 0 || sc.hero.x > 360 || sc.hero.y < -40 || sc.hero.y > 700) violation("герой вне канвы");
      var b = sc.hero.body;
      if (b && (b.blocked.down || b.touching.down)) state.groundTs = now;
      else if (state.groundTs && now - state.groundTs > 1500) violation("герой 1.5 с не касался земли — висит или провалился");
    }
    if (typeof sc.score === "number" && (!finite(sc.score) || sc.score < 0)) violation("счёт отрицательный или не число");
  }

  var bots = {
    runner: function (sc, now, game) {
      checkBodies(sc, now);
      var hero = sc.hero, body = hero && hero.body;
      if (!body) return;
      var onGround = body.blocked.down || body.touching.down;
      var v = sc.speed;
      if (state.mode === "novice") {
        // Случайные тапы примерно раз в 600 мс.
        if (global.ZV.random.chance(1 / 36)) sc.input.emit("pointerup", { x: 180, y: 320 });
        return;
      }
      // Эксперт: прыгает в окне, рассчитанном из физики (см. README и план):
      // над блоком высотой 60 герой выше 60 px при t ∈ [0.08, 0.57] с, блок
      // шириной 32 плюс тело 22 проходит под ним за 54/v. Ждём D ≥ 0.08·v.
      // Набрав stopAt (порог победы из теста), перестаёт прыгать — раунд
      // обязан закончиться победой.
      if (sc.score >= state.stopAt) return;
      var nearest = null, D = Infinity;
      sc.blocks.getChildren().forEach(function (b) {
        var d = (b.x - b.displayWidth / 2) - body.right;
        if (d > -10 && d < D) { D = d; nearest = b; }
      });
      if (nearest && onGround && D > 0.08 * v && D <= 0.08 * v + 25) {
        sc.input.emit("pointerup", { x: 180, y: 320 });
        state.jumps++;
      }
    },

    // Платформер: эксперт ведёт героя по плану солвера тем же исполнителем,
    // что и симулятор (ZV.levels.follower) — так проверяется, что физика
    // солвера и движка совпадают. Новичок жмёт случайно, greedy бежит вправо
    // и прыгает (для заведомо непроходимых уровней).
    platformer: function (sc, now) {
      var hero = sc.hero, body = hero && hero.body;
      if (!body || !sc.level) return;
      if (!finite(hero.x) || !finite(hero.y)) violation("координаты героя не число");
      if (hero.x < -5 || hero.x > sc.level.W + 5) violation("герой вне уровня по x");
      if (typeof sc.score === "number" && (!finite(sc.score) || sc.score < 0)) violation("счёт отрицательный или не число");
      var down = body.blocked.down || body.touching.down;
      if (sc.frozen || !body.enable) state.groundTs = now;
      else if (down) state.groundTs = now;
      else if (state.groundTs && now - state.groundTs > 1500) violation("герой 1.5 с не касался земли — висит или провалился");
      if (sc.frozen || !body.enable) { sc.botPad = { dir: 0, jump: false }; return; }
      var s = { x: body.x, y: body.y - sc.levelY0, vx: body.velocity.x, down: down };
      if (state.mode === "novice") {
        if (state.frames % 20 === 0) state.pad = { dir: global.ZV.random.between(-1, 1), jump: global.ZV.random.chance(0.3) };
        sc.botPad = state.pad;
        return;
      }
      if (state.mode === "greedy") {
        sc.botPad = { dir: 1, jump: down && (state.frames % 40 === 0 || (body.blocked.right && state.frames % 12 === 0)) };
        return;
      }
      // Эксперт: новый исполнитель на каждый уровень и каждое возрождение.
      var key = sc.levelIndex + ":" + sc.spawnCount;
      if (state.followKey !== key) {
        state.followKey = key;
        state.follower = global.ZV.levels.follower((state.plans || [])[sc.levelIndex] || []);
      }
      var d = state.follower.decide(s);
      if (d.jump) state.jumps++;
      sc.botPad = { dir: d.dir, jump: d.jump };
    },

    catch: function (sc, now) {
      checkBodies(sc, now);
      if (state.mode === "novice") return;   // корзина стоит — промахи копятся
      var basket = sc.basket, best = null;
      sc.items.getChildren().forEach(function (it) {
        if (!it.active || !it.getData("good") || it.y > 560) return;
        if (!best || it.y > best.y) best = it;
      });
      var target = best ? best.x : 180;
      // Плохой предмет над корзиной у цели — уходим в сторону.
      sc.items.getChildren().forEach(function (it) {
        if (!it.active || it.getData("good")) return;
        if (it.y > 420 && it.y < 570 && Math.abs(it.x - target) < 60) target += it.x > target ? -70 : 70;
      });
      target = Math.max(50, Math.min(310, target));
      if (Math.abs(basket.x - target) > 2) sc.input.emit("pointermove", { x: target, y: 560 });
    },

    // Сортировка: бот читает состояние сцены (текущий предмет и корзины) и
    // жмёт корзину событием — партию за 45 с мышью снаружи не отыграть, кадры
    // не поспевают. Тач-цели корзин проверяет отдельный сценарий живой мышью.
    // Эксперт знает верную корзину и мусор не трогает; новичок всегда жмёт
    // первую — при трёх корзинах две трети тапов ошибочны.
    sort: function (sc) {
      if (typeof sc.score === "number" && (!finite(sc.score) || sc.score < 0)) violation("счёт отрицательный или не число");
      if (sc.items && sc.items.length > 8) violation("предметы копятся на ленте: " + sc.items.length);
      if (sc.tl && sc.tl.pending() >= 50) violation("таймлайн течёт: " + sc.tl.pending() + " шагов");
      var cur = null, i;
      for (i = 0; sc.items && i < sc.items.length; i++) {
        var it = sc.items[i];
        if (it.done || !it.box) continue;
        if (!finite(it.x)) violation("координата предмета не число");
        if (it.x < -64) violation("предмет левее -64 px");
        if (!cur || it.x > cur.x) cur = it;
      }
      if (!cur || !sc.bins || !sc.bins.length) return;
      // Решаем в полосе перед линией сброса — там же, где её меряет
      // game/sort.js: раньше тапать нечестно, позже предмет уедет.
      if (cur.x < 232) return;
      if (state.mode === "novice") { sc.bins[0].box.emit("pointerup"); return; }
      if (cur.bin === "junk") return;
      for (i = 0; i < sc.bins.length; i++) {
        if (sc.bins[i].id === cur.bin) { sc.bins[i].box.emit("pointerup"); return; }
      }
    },
    // week4 bots
    // week5:hidden
    // Найди предмет: эксперт читает позиции ОСТАВШИХСЯ целей из пробы и тапает
    // по одной раз в ~300 мс настоящим pointerup сцены — быстрее человек не
    // ищет, а мгновенный перебор не проверил бы ни подсказку, ни бонус за
    // скорость. Отвлечения он не трогает. Новичок тапает наугад по полю.
    hidden: function (sc, now) {
      if (typeof sc.score === "number" && (!finite(sc.score) || sc.score < 0)) violation("счёт отрицательный или не число");
      if (sc.tl && sc.tl.pending() >= 50) violation("таймлайн течёт: " + sc.tl.pending() + " шагов");
      if (!sc.spots) return;
      for (var i = 0; i < sc.spots.length; i++) {
        var s = sc.spots[i];
        if (!finite(s.x) || !finite(s.y)) violation("координата предмета не число");
        if (s.x < 0 || s.x > 360 || s.y < 0 || s.y > 640) violation("предмет вне канвы");
      }
      if (now - (state.lastTapAt || 0) < 300) return;
      state.lastTapAt = now;
      state.taps++;
      if (state.mode === "novice") {
        // Наугад по всему полю: попасть в 5 целей за партию так почти нельзя.
        sc.input.emit("pointerup", { x: global.ZV.random.between(8, 352), y: global.ZV.random.between(120, 420) });
        return;
      }
      for (var k = 0; k < sc.spots.length; k++) {
        if (sc.spots[k].decoy || sc.spots[k].found) continue;
        sc.input.emit("pointerup", { x: sc.spots[k].x, y: sc.spots[k].y });
        return;
      }
    },
    // Память: эксперт ведёт карту «позиция → значение» из всего, что уже
    // видел (подглядка в начале раунда — тоже наблюдение), и открывает
    // известную пару, иначе новую позицию. Тапы — настоящей мышью снаружи,
    // здесь только выбор ячейки: бот отдаёт её тесту через memoryPick().
    memory: function (sc) {
      if (typeof sc.score === "number" && (!finite(sc.score) || sc.score < 0)) violation("счёт отрицательный или не число");
      if (sc.open && sc.open.length > 2) violation("открыто больше двух карточек");
      if (sc.tl && sc.tl.pending() > 50) violation("таймлайн течёт: шагов " + sc.tl.pending());
      if (!sc.cards) return;
      // Карта виденного пополняется каждый кадр: на подглядке видно всё.
      // Сбрасывается на смене раунда И на чистом поле (первый раунд после
      // «Ещё раз» — тот же roundIndex, но раздача уже другая).
      if (state.memoryRound !== sc.roundIndex || (sc.found === 0 && sc.movesUsed === 0 && !state.memoryFresh)) {
        state.memoryRound = sc.roundIndex; state.seen = {}; state.memoryFresh = true;
      }
      if (sc.found > 0 || sc.movesUsed > 0) state.memoryFresh = false;
      for (var i = 0; i < sc.cards.length; i++) {
        if (sc.cards[i].face || sc.cards[i].matched) state.seen[i] = sc.cards[i].id;
      }
    },
    // Кликер: эксперт тапает в темпе botTapsPerSec (лишнего движка не просим —
    // тап эмулируется тем же pointerdown, что и палец), гасит нужду ниже 40 %
    // и покупает по плану, который node посчитал солвером ДО запуска. Это
    // сверка модели с движком: модель сказала «за 39 с» — бот обязан набрать.
    // Новичок тапает вчетверо реже, ничего не покупает и не поливает.
    clicker: function (sc, now) {
      var st = global.__zvBot.clicker();
      if (!st || st.over) return;
      if (typeof sc.score === "number" && (!isFinite(sc.score) || sc.score < 0)) violation("счёт отрицательный или не число");
      if (sc.tl && sc.tl.pending() >= 50) violation("таймлайн течёт: больше 50 шагов в очереди");
      if (st.need < 0 || st.need > 100) violation("шкала нужды вне 0..100");

      var rate = state.mode === "novice" ? state.tapsPerSec / 4 : state.tapsPerSec;
      if (!state.lastTapAt) state.lastTapAt = 0;
      var gap = 1000 / Math.max(0.1, rate);

      if (state.mode !== "novice") {
        // Уход важнее очков: пустая шкала режет тап вдвое до конца партии.
        if (st.need < 40 && st.careReady) { sc.careBox.emit("pointerup"); return; }
        // Покупка по плану. Голова очереди, ещё закрытая по needs, на экране
        // не показана — её пропускаем и смотрим следующую позицию, ровно как
        // simulate() в солвере. Иначе план вида «дорогое раньше того, что его
        // открывает» встал бы навсегда, и бот перестал бы покупать вовсе.
        var plan = state.plan || [];
        for (var q = 0; q < plan.length; q++) {
          var card = null;
          for (var i = 0; i < st.upgrades.length; i++) {
            if (st.upgrades[i].id === plan[q]) { card = st.upgrades[i]; break; }
          }
          if (!card) continue;                                   // закрыт или выкуплен — дальше по плану
          if (card.level >= card.max) { plan.splice(q, 1); q -= 1; continue; }
          if (st.score >= card.cost) { sc.cards[card.slot].box.emit("pointerup"); plan.splice(q, 1); return; }
          break;                                                 // первая ВИДИМАЯ решает: копим на неё
        }
      }
      if (now - state.lastTapAt < gap) return;
      state.lastTapAt = now;
      state.taps++;
      sc.hero.emit("pointerdown");
    },
    // week5: match3 bot
    // Три в ряд: эксперт берёт лучший ход из ЯДРА по текущему полю сцены
    // (ZV_MATCH3.best) и отыгрывает его тап-тапом — двумя парами
    // pointerdown/pointerup по центрам клеток, ровно как палец. Новичок жмёт
    // случайную пару соседей: большинство таких обменов ничего не собирает, а
    // ход всё равно тратится. Инвариант каждого кадра — поле полное и без
    // готовых совпадений: это то, что человек видит на экране.
    match3: function (sc) {
      var M = global.ZV_MATCH3;
      if (typeof sc.score === "number" && (!finite(sc.score) || sc.score < 0)) violation("счёт отрицательный или не число");
      if (sc.tl && sc.tl.pending() >= 60) violation("таймлайн течёт: " + sc.tl.pending() + " шагов");
      if (!sc.board || !sc.layout) return;
      // Инвариант проверяем только в покое: посреди каскада поле законно
      // разобрано, и «пустая клетка» там — не ошибка, а кадр анимации.
      if (!sc.tl.busy()) {
        for (var q = 0; q < sc.board.cells.length; q++) {
          if (!(sc.board.cells[q] >= 1)) { violation("в поле пустая клетка вне каскада"); break; }
        }
        if (M.matches(sc.board).cleared.length) violation("на поле осталось готовое совпадение");
        if (sc.tiles && sc.tiles.length !== sc.board.cells.length) violation("фишек на сцене не столько, сколько клеток");
      }
      if (sc.tl.busy() || sc.over) return;
      // Пауза между ходами: ввод кита живёт на pointerdown/pointerup, и два
      // хода в одном кадре сложились бы в один свайп.
      if (state.frames - (state.m3At || 0) < 4) return;
      state.m3At = state.frames;

      var mv = null;
      if (state.mode === "novice") {
        var i = global.ZV.random.between(0, sc.board.cells.length - 1);
        var p = M.cell(sc.board, i);
        var right = global.ZV.random.chance(0.5);
        var j = global.ZV.grid.at(sc.layout, p.c + (right ? 1 : 0), p.r + (right ? 0 : 1));
        if (j < 0) return;
        mv = { a: i, b: j };
      } else {
        mv = M.best(sc.board);
        if (!mv) return;                       // тупик — кит перемешает сам
        state.m3Moves = (state.m3Moves || 0) + 1;
      }
      m3Tap(sc, mv.a);
      m3Tap(sc, mv.b);
    },
    // week5:timing — «Точный тап». Эксперт целится в ЦЕНТР зоны, а не просто в
    // зону: тапает в тот кадр, после которого маркер начнёт от центра
    // удаляться. Решение принимается по положению НА КАДР ВПЕРЁД
    // (pos(t + 1/60)) — сравнивать надо то, что будет, с тем, что есть, иначе
    // бот стреляет по входу в полосу и мажет на четверть зоны в сторону
    // подхода каждый раз. Новичок тапает случайно примерно раз в 500 мс и
    // обязан проиграть по жизням.
    timing: function (sc) {
      var st = global.__zvBot.timing();
      if (!st || st.over) return;
      if (!finite(st.pos) || st.pos < 0 || st.pos > st.barWidth) violation("маркер вне шкалы: " + st.pos);
      if (st.zone.x < 0 || st.zone.x + st.zone.w > st.barWidth) violation("зона вне шкалы: " + JSON.stringify(st.zone));
      if (st.zone.w < st.zoneMin) violation("зона уже дна zoneMin: " + st.zone.w);
      if (sc.tl && sc.tl.pending() >= 50) violation("таймлайн течёт: " + sc.tl.pending() + " шагов");
      if (st.locked) return;                       // пауза между раундами — тап не считается
        // Случайные тапы примерно раз в 500 мс (кадр 1/60 → шанс 1/30).
        if (global.ZV.random.chance(1 / 30)) sc.input.emit("pointerup", { x: 180, y: 320 });
        return;
      // Ближе всего к центру маркер будет в тот кадр, после которого расстояние
      // до центра начнёт расти. Сравниваем «сейчас» с «через кадр»: пик
      // пройден — тапаем. Страховка на случай, если пик проскочили внутри
      // одного кадра: тапаем и просто попав в центральную полосу ±w/4.
      var FRAME = 1000 / 60;
      var now = global.ZV_TIMING.markerPos(st.t, st.speed, st.barWidth);
      var ahead = global.ZV_TIMING.markerPos(st.t + FRAME, st.speed, st.barWidth);
      var dNow = Math.abs(now - st.center), dAhead = Math.abs(ahead - st.center);
      if (dAhead >= dNow && dNow <= st.zone.w / 4) {
        sc.input.emit("pointerup", { x: 180, y: 320 });
        state.taps++;
      }
    }
  };

  // Тап по центру клетки: pointerdown и pointerup в одной точке — свайпом кит
  // это не считает (сдвиг меньше swipeMin), значит идёт путь «тап-тап».
  function m3Tap(sc, i) {
    var c = sc.layout.cells[i];
    if (!c) return;
    sc.input.emit("pointerdown", { x: c.cx, y: c.cy });
    sc.input.emit("pointerup", { x: c.cx, y: c.cy });
  }

  function step(game) {
    if (state.stopped) return;
    var sc = play(game);
    if (!sc) return;
    state.frames++;
    var bot = bots[state.kind];
    if (bot) bot(sc, game.loop.now, game);
  }

  global.__zvBot = {
    start: function (kind, mode, opts) {
      opts = opts || {};
      state.kind = kind; state.mode = mode || "expert";
      state.stopAt = typeof opts.stopAt === "number" ? opts.stopAt : Infinity;
      state.plans = opts.plans || null;
      state.plan = (opts.plan || []).slice();
      state.tapsPerSec = typeof opts.tapsPerSec === "number" ? opts.tapsPerSec : 5;
      state.lastTapAt = 0; state.taps = 0;
      state.followKey = ""; state.follower = null; state.pad = { dir: 0, jump: false };
      state.frames = 0; state.violations = []; state.groundTs = 0; state.jumps = 0; state.stopped = false;
      state.inMini = false;
      var game = global.ZV && global.ZV.game;
      if (!game) throw new Error("ZV.game ещё нет");
      if (!state.hooked) {
        state.hooked = true;
        game.events.on("poststep", function () { step(game); });
      }
      return true;
    },
    stop: function () { state.stopped = true; },
    report: function () {
      return { frames: state.frames, violations: state.violations.slice(), jumps: state.jumps, taps: state.taps, planLeft: (state.plan || []).length, seed: global.ZV ? global.ZV.seed : null };
    },
    // Новелла: текущий узел, печать, видимые варианты — для управления мышью.
    novel: function () {
      var sc = global.ZV.game.scene.getScene("zv-play");
      if (!sc || !sc.sys.isActive() || !sc.rt) return null;
      return { id: sc.rt.id(), typing: sc.typing, linear: sc.rt.linear(), ended: !!sc.rt.ended(),
        choices: sc.typing ? 0 : sc.rt.choices().length, vars: sc.rt.vars, over: sc.over,
        items: sc.rt.inventory ? sc.rt.inventory() : [] };
    },

    // Состояние игровой сцены для тестов, которые управляют мышью снаружи.
    quiz: function () {
      var sc = global.ZV.game.scene.getScene("zv-play");
      if (!sc || !sc.sys.isActive() || !sc.order) return null;
      var item = sc.order[sc.index];
      // Между последним ответом и экраном результата (задержка 700 мс) индекс
      // уже за концом списка — вопроса нет, тест ждёт finish.
      if (!item) return null;
      return { index: sc.index, total: sc.order.length, locked: sc.locked, over: sc.over,
        correct: typeof item.correct === "number" ? item.correct : -1, answers: item.answers.length, score: sc.score };
    },

    // Сортировка: текущий предмет и корзины с координатами — тест тапает по
    // ним настоящей мышью и сверяет исход.
    sort: function () {
      var sc = global.ZV.game.scene.getScene("zv-play");
      if (!sc || !sc.sys.isActive() || !sc.bins) return null;
      var cur = null;
      for (var i = 0; sc.items && i < sc.items.length; i++) {
        var it = sc.items[i];
        if (it.done || !it.box) continue;
        if (!cur || it.x > cur.x) cur = it;
      }
      return {
        current: cur ? { id: cur.id, bin: cur.bin, x: Math.round(cur.x), y: Math.round(cur.box.y) } : null,
        bins: sc.bins.map(function (b) { return { id: b.id, x: b.x, y: b.y }; }),
        score: sc.score, lives: sc.lives, streak: sc.streak, sorted: sc.sorted, over: sc.over
      };
    },
    // week4 probes
    // week5:hidden
    // Найди предмет: оставшиеся цели с координатами (тест тапает по ним
    // настоящей мышью), состояние подсказки и счётчики раунда.
    hidden: function () {
      var sc = global.ZV.game.scene.getScene("zv-play");
      if (!sc || !sc.sys.isActive() || !sc.spots) return null;
      return {
        round: sc.roundIndex + 1,
        left: sc.targetsLeft,
        spots: sc.spots.filter(function (s) { return !s.found; }).map(function (s) {
          return { id: s.id, x: s.x, y: s.y, size: s.size, decoy: s.decoy };
        }),
        shelf: (sc.shelf || []).map(function (sl) { return { id: sl.spot.id, x: sl.x, y: sl.y, found: sl.spot.found }; }),
        hintOn: !!sc.hintOn,
        hintAt: sc.hintSpot ? { x: sc.hintSpot.x, y: sc.hintSpot.y } : null,
        score: sc.score, found: sc.foundTotal, decoyTaps: sc.decoyTaps,
        leftMs: Math.max(0, Math.round(sc.deadline - sc.time.now)),
        over: !!sc.over
      };
    },
    // Гибрид: где сейчас игрок — в сюжете или в мини-игре, видна ли кнопка
    // запуска. Сюжетная сцена во время мини-игры СПИТ, поэтому novel() её не
    // отдаёт: здесь смотрим на неё независимо от активности.
    hybrid: function () {
      var game = global.ZV.game;
      var story = game.scene.getScene("zv-play");
      var mini = game.scene.getScene("zv-mini");
      if (!story || !story.rt) return null;
      var st = story.stage || {};
      return {
        node: story.rt.id(),
        vars: story.rt.vars,
        plays: story.plays || [],
        storyAwake: story.sys.isActive(),
        storySleeping: story.sys.isSleeping(),
        mini: mini ? mini.sys.settings.key : null,
        start: st.startBtn ? { x: st.startBtn.box.x, y: st.startBtn.box.y, label: st.startBtn.text.text } : null,
        rules: st.rulesText ? st.rulesText.text : null,
        typing: !!st.typing,
        ended: !!story.rt.ended(),
        choices: st.typing ? 0 : story.rt.choices().length
      };
    },
    // Память: состояние поля для тестов, которые тапают мышью снаружи.
    // busy — занят ли таймлайн: бот ждёт его, а не спит peekMs.
    memory: function () {
      var sc = global.ZV.game.scene.getScene("zv-play");
      if (!sc || !sc.sys.isActive() || !sc.cards || !sc.layout) return null;
      return {
        round: sc.roundIndex + 1, rounds: sc.rounds.length,
        open: (sc.open || []).slice(), found: sc.found, pairs: sc.pairsTotal,
        moves: sc.movesLimit > 0 ? sc.movesLeft : -1,
        busy: sc.tl.busy() || !!sc.peeking, over: !!sc.over,
        cells: sc.layout.cells.map(function (c) {
          return { i: c.i, x: c.cx, y: c.cy, matched: sc.cards[c.i] ? sc.cards[c.i].matched : false,
            face: sc.cards[c.i] ? sc.cards[c.i].face : false };
        })
      };
    },
    // Что эксперт запомнил: позиция → значение. Тест выбирает ячейку по этой
    // карте и тапает её настоящей мышью — без чтения приватных полей сцены.
    memoryPick: function () {
      var sc = global.ZV.game.scene.getScene("zv-play");
      if (!sc || !sc.cards) return -1;
      var seen = state.seen || {}, open = sc.open || [], i;
      function closed(n) { return sc.cards[n] && !sc.cards[n].matched && !sc.cards[n].face; }
      // Уже открыта одна карточка — ищем её пару среди виденных закрытых.
      if (open.length === 1) {
        var want = sc.cards[open[0]].id;
        for (i = 0; i < sc.cards.length; i++) {
          if (closed(i) && seen[i] === want) return i;
        }
        // Пары не помним — открываем неизвестную позицию (дешёвая разведка).
        for (i = 0; i < sc.cards.length; i++) if (closed(i) && seen[i] === undefined) return i;
        for (i = 0; i < sc.cards.length; i++) if (closed(i)) return i;
        return -1;
      }
      // Ничего не открыто: если знаем пару целиком — берём её первую карточку.
      var byValue = {};
      for (i = 0; i < sc.cards.length; i++) {
        if (!closed(i) || seen[i] === undefined) continue;
        if (byValue[seen[i]] !== undefined) return byValue[seen[i]];
        byValue[seen[i]] = i;
      }
      for (i = 0; i < sc.cards.length; i++) if (closed(i) && seen[i] === undefined) return i;
      for (i = 0; i < sc.cards.length; i++) if (closed(i)) return i;
      return -1;
    },
    // week5: match3 probe
    // Три в ряд: поле, раскладка и счётчики — тест тапает мышью по центрам
    // клеток и сам считает лучший ход тем же ядром, что и игра.
    match3: function () {
      var sc = global.ZV.game.scene.getScene("zv-play");
      if (!sc || !sc.sys.isActive() || !sc.board || !sc.layout) return null;
      return {
        cols: sc.board.cols, rows: sc.board.rows, cells: sc.board.cells.slice(),
        layout: sc.layout.cells.map(function (c) { return { i: c.i, x: c.cx, y: c.cy, w: c.w, h: c.h }; }),
        score: sc.score, movesLeft: sc.movesLeft, movesUsed: sc.movesUsed,
        cleared: sc.cleared, shuffles: sc.shuffles, bestCascade: sc.bestCascade,
        picked: sc.picked, busy: sc.tl.busy(), over: !!sc.over
      };
    },
    // Кликер: счёт, темп, стадия, нужда, готовность ухода и КООРДИНАТЫ карточек
    // апгрейдов — бот тапает настоящей мышью, значит должен знать, куда.
    clicker: function () {
      var sc = global.ZV.game.scene.getScene("zv-play");
      if (!sc || !sc.sys.isActive() || !sc.stages) return null;
      var ups = [];
      for (var i = 0; i < sc.cards.length; i++) {
        var card = sc.cards[i];
        if (card.up < 0 || !card.box.visible) continue;
        var u = sc.ups[card.up];
        ups.push({ id: u.id, cost: global.ZV_CLICKER.costOf(u, sc.levels[card.up]),
          level: sc.levels[card.up], max: u.max, x: card.box.x, y: card.box.y, slot: i });
      }
      return {
        score: Math.floor(sc.score), perTap: sc.perTapNow, perSec: sc.perSecNow,
        stage: sc.stage, goal: sc.goal.score, need: Math.round(sc.need),
        careReady: sc.elapsed >= sc.careReady, upgrades: ups, over: sc.over
      };
    },
    // week5:timing — состояние шкалы: где маркер, где зона и её центр, сколько
    // модельного времени идёт текущий раунд. t отдаётся отдельно, чтобы бот и
    // тест считали положение на кадр вперёд той же функцией, что и кит.
    timing: function () {
      var game = global.ZV.game;
      var sc = game.scene.getScene("zv-mini") || game.scene.getScene("zv-play");
      if (!sc || !sc.sys.isActive() || !sc.zone) return null;
      var t = sc.clock - sc.roundStart;
      return {
        t: t, pos: global.ZV_TIMING.markerPos(t, sc.speed, sc.barWidth || 300),
        zone: { x: sc.zone.x, w: sc.zone.w },
        center: sc.zone.x + sc.zone.w / 2,
        speed: sc.speed, barWidth: sc.barWidth || 300, zoneMin: sc.zoneMin || 0,
        round: sc.round + 1, rounds: sc.roundsTotal,
        score: sc.score, lives: sc.lives, locked: !!sc.locked, over: !!sc.over
      };
    }
  };
})(window);
