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
    }
    // week4 bots
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
      return { frames: state.frames, violations: state.violations.slice(), jumps: state.jumps, seed: global.ZV ? global.ZV.seed : null };
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
    }
  };
})(window);
