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
    // week4 bots
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
    }
  };

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
    // week4 probes
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
    }
  };
})(window);
