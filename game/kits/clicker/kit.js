// Кит «Кликер»: тап по герою даёт очки, герой растёт по стадиям, апгрейды
// множат тап и дают доход в секунду, шкала нужды падает сама и гасится
// кнопкой ухода — тап приходится тратить не только на очки. Партия ВСЕГДА
// кончается: по duration или по достижению goal.score. Экономику (достижима
// ли цель) считает чистый модуль game/clicker.js — он же валидатор и он же
// отдаёт план боту. Канва 360×640, координаты целые, масштаб спрайтов 1.
(function (global) {
  "use strict";

  var CLK = global.ZV_CLICKER;

  // Настройки по умолчанию; правятся в config.params (те же ключи).
  var DEFAULTS = {
    duration: 75000,       // длительность партии, мс — партия обязана кончиться
    tapPoints: 1,          // базовые очки за тап
    tapCooldownMs: 30,     // минимальный интервал между засчитанными тапами
    autoTickMs: 1000,      // как часто начисляется perSec
    startScore: 0,         // стартовые очки
    showUpgrades: 3,       // сколько карточек апгрейдов на экране сразу
    decayPerSec: 6,        // сколько нужды уходит в секунду
    decayDelayMs: 12000,   // когда нужда НАЧИНАЕТ падать (первые 10 с без наказания)
    decayRamp: 1.8,        // во сколько раз быстрее нужда падает к концу партии
    hungryFactor: 0.5,     // множитель очков при пустой шкале нужды
    careCooldownMs: 4000,  // кулдаун кнопки ухода
    saveProgress: true,    // помнить лучший счёт и число открытых стадий
    botTapsPerSec: 5       // темп «эталонного игрока»: солвер и бот-эксперт
  };
  var S = DEFAULTS;

  // Геометрия (все числа целые, тач-цели с запасом над 24 px).
  var HERO = { x: 180, y: 250, size: 160 };     // зона героя 160×160 по центру
  var CARE = { x: 52, y: 552, size: 72 };       // кнопка ухода внизу слева
  var CARD = { x: 244, y: 430, w: 200, h: 54, step: 62 };  // карточки апгрейдов справа столбиком
  var NEED = { x: 60, y: 344, w: 240, h: 16 };  // шкала нужды 240×16
  var BAR_H = 6;                                // полоса таймера сверху
  var STAGE_COLORS = [0x2e9e5b, 0x38bdf8, 0xffd23f, 0xff5f6d, 0x9b59b6, 0x1abc9c];

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var items = a.items || {};
    // Картинка героя на стадию: items.<stage.art>. Нет — серая заглушка.
    this.artKeys = {};
    for (var k in items) {
      if (Object.prototype.hasOwnProperty.call(items, k) && items[k] && items[k].url) {
        this.load.image("clk:" + k, items[k].url);
        this.artKeys[k] = true;
      }
    }
    global.ZV.loadContent(this, "clicker");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;

    S = ZV.params(DEFAULTS);
    this.over = false;

    var c = ZV.content(this, "clicker", { params: S });
    if (c.errors.length) {
      this.over = true;
      ZV.ui.fail(this, "Ошибки в content/clicker.json", c.errors);
      return;
    }
    this.data = c.data;
    this.stages = c.data.stages;
    this.goal = c.data.goal;
    this.ups = CLK.upgradesOf(c.data);

    // Партия ВСЕГДА с нуля: в сейве только рекорд и число виденных стадий.
    this.slot = S.saveProgress
      ? ZV.save.open("clicker", ZV.save.version([c.data, S]), { best: 0, stages: 0 })
      : null;
    this.saved = this.slot ? this.slot.get() : { best: 0, stages: 0 };

    this.score = Math.max(0, Math.round(S.startScore));
    this.need = CLK.NEED_MAX;
    this.levels = [];
    for (var i = 0; i < this.ups.length; i++) this.levels.push(0);
    this.taps = 0;
    this.careUses = 0;
    this.bought = 0;
    this.stage = 0;
    this.lastTap = -99999;
    this.careReady = 0;
    this.autoAcc = 0;
    this.elapsed = 0;
    this.tl = ZV.timeline.create();

    // Хвост прошлой партии не должен выстрелить в новой («Ещё раз»
    // переиспользует сцену и зовёт create() снова).
    this.events.once("shutdown", function () { self.tl.clear(); });

    ZV.ui.backdrop(this);

    // Полоса таймера во всю ширину сверху, убывает целыми пикселями.
    this.timeBar = this.add.rectangle(0, 0, W, BAR_H, 0x4f7cff).setOrigin(0, 0).setDepth(6);

    this.scoreText = ZV.ui.text(this, W / 2, 44, "0", { size: 4 }).setOrigin(0.5).setDepth(5);
    this.rateText = ZV.ui.text(this, W / 2, 78, "", { size: 1, color: "#9aa0b5" }).setOrigin(0.5).setDepth(5);
    this.goalText = ZV.ui.text(this, W / 2, 100, "цель " + this.goal.score, { size: 1, color: "#9aa0b5" })
      .setOrigin(0.5).setDepth(5);

    makeHero(this);
    makeNeed(this);
    makeCare(this);
    makeCards(this);

    this.stageText = ZV.ui.text(this, W / 2, 150, "", { size: 2 }).setOrigin(0.5).setDepth(9).setVisible(false);
    applyStage(this, 0, true);
    // Первая стадия тоже событие: родитель видит прогресс с первой секунды.
    ZV.progress(this, { step: 1, total: this.stages.length, meta: { score: this.score } });
    redraw(this);
  };

  PlayScene.prototype.update = function (time, delta) {
    if (this.over) return;
    var d = Math.max(0, delta);
    this.elapsed += d;
    this.tl.update(d);

    // Жажда: падает только после decayDelayMs и ускоряется к концу партии.
    if (this.elapsed > S.decayDelayMs && this.need > 0) {
      var span = S.duration > 0 ? S.duration : 600000;
      var ramp = 1 + (S.decayRamp - 1) * Math.min(1, this.elapsed / span);
      this.need = Math.max(0, this.need - S.decayPerSec * ramp * (d / 1000));
    }

    // Автодоход тиками autoTickMs — так же, как считает солвер.
    this.autoAcc += d;
    var tick = Math.max(1, S.autoTickMs);
    while (this.autoAcc >= tick) {
      this.autoAcc -= tick;
      var add = perSec(this) * (tick / 1000);
      if (add > 0) gain(this, add, false);
    }

    redraw(this);
    if (this.score >= this.goal.score) { finish(this, true); return; }
    if (S.duration > 0 && this.elapsed >= S.duration) finish(this, false);
  };

  // --- герой ---------------------------------------------------------------
  function makeHero(scene) {
    var ZV = global.ZV;
    stub(scene, "clk:hero", HERO.size, HERO.size, 0x2a2f45);
    scene.hero = scene.add.sprite(HERO.x, HERO.y, "clk:hero").setDepth(2);
    // Зона тапа ровно 160×160: попасть пальцем нельзя не попасть.
    scene.hero.setInteractive(new Phaser.Geom.Rectangle(0, 0, HERO.size, HERO.size), Phaser.Geom.Rectangle.Contains);
    scene.hero.on("pointerdown", function () { tap(scene); });
    scene.heroLabel = ZV.ui.text(scene, HERO.x, HERO.y, "", { size: 2 }).setOrigin(0.5).setDepth(3);
  }

  // Стадия: цвет и картинка героя, подпись, тряска и надпись на 900 мс.
  function applyStage(scene, index, silent) {
    var ZV = global.ZV;
    var st = scene.stages[index] || {};
    scene.stage = index;
    var art = st.art && scene.artKeys[st.art] ? "clk:" + st.art : null;
    if (!art) {
      // Заглушка: своя текстура на стадию — меняются и цвет, и подпись.
      var color = st.color ? Phaser.Display.Color.HexStringToColor(st.color).color : STAGE_COLORS[index % STAGE_COLORS.length];
      art = "clk:stage" + index;
      stub(scene, art, HERO.size, HERO.size, color);
    }
    // origin false: герой стоит по ЦЕНТРУ зоны тапа, а не ногами на земле,
    // как у ходячих китов; тело физики ему не нужно вовсе.
    ZV.sprite.apply(scene.hero, { texture: art, origin: false });
    scene.hero.setOrigin(0.5, 0.5);
    scene.heroLabel.setText(st.art && scene.artKeys[st.art] ? "" : String(index + 1));
    if (silent) return;

    ZV.progress(scene, { step: index + 1, total: scene.stages.length, meta: { score: Math.floor(scene.score) } });
    scene.cameras.main.shake(160, 0.008);
    ZV.juice.dust(scene, HERO.x, HERO.y + HERO.size / 2, 0xffffff);
    scene.stageText.setText("Стадия " + (index + 1) + ": " + (st.title || ""));
    scene.stageText.setVisible(true);
    scene.tl.add(900, function () { scene.stageText.setVisible(false); });
  }

  function tap(scene) {
    if (scene.over) return;
    // Кулдаун: автокликер не быстрее живого пальца, дребезг не считается дважды.
    if (scene.elapsed - scene.lastTap < S.tapCooldownMs) return;
    scene.lastTap = scene.elapsed;
    scene.taps += 1;
    var add = perTap(scene);
    gain(scene, add, true);
    global.ZV.juice.squash(scene, scene.hero, null, 60);
    if (scene.taps % 10 === 0) global.ZV.juice.dust(scene, HERO.x, HERO.y + HERO.size / 2, 0xffffff);
  }

  // --- шкала нужды и уход --------------------------------------------------
  function makeNeed(scene) {
    scene.add.rectangle(NEED.x, NEED.y, NEED.w, NEED.h, 0x1b1f33).setOrigin(0, 0).setDepth(4)
      .setStrokeStyle(2, 0xffffff, 0.12);
    scene.needFill = scene.add.rectangle(NEED.x, NEED.y, NEED.w, NEED.h, 0x2e9e5b).setOrigin(0, 0).setDepth(5);
  }

  function makeCare(scene) {
    var ZV = global.ZV;
    var care = scene.data.care || {};
    scene.careBox = scene.add.rectangle(CARE.x, CARE.y, CARE.size, CARE.size, 0x4f7cff).setOrigin(0.5).setDepth(4)
      .setInteractive({ useHandCursor: true });
    scene.careBox.setStrokeStyle(2, 0xffffff, 0.18);
    scene.careLabel = ZV.ui.text(scene, CARE.x, CARE.y, care.title || "Уход", { size: 1 }).setOrigin(0.5).setDepth(5);
    scene.careBox.on("pointerup", function () { doCare(scene); });
  }

  function doCare(scene) {
    if (scene.over || scene.elapsed < scene.careReady) return;
    // Уход тратит тап: за один палец спорят очки и нужда.
    if (scene.elapsed - scene.lastTap < S.tapCooldownMs) return;
    scene.lastTap = scene.elapsed;
    scene.need = CLK.NEED_MAX;
    scene.careReady = scene.elapsed + S.careCooldownMs;
    scene.careUses += 1;
    global.ZV.juice.dust(scene, CARE.x, CARE.y - CARE.size / 2, 0x4f7cff);
  }

  // --- апгрейды ------------------------------------------------------------
  function makeCards(scene) {
    var ZV = global.ZV;
    scene.cards = [];
    var n = Math.max(0, Math.min(Math.round(S.showUpgrades), scene.ups.length));
    for (var i = 0; i < n; i++) {
      var y = CARD.y + i * CARD.step;
      var box = scene.add.rectangle(CARD.x, y, CARD.w, CARD.h, 0x2a2f45).setOrigin(0.5).setDepth(4)
        .setInteractive({ useHandCursor: true });
      box.setStrokeStyle(2, 0xffffff, 0.12);
      var title = ZV.ui.text(scene, CARD.x - CARD.w / 2 + 10, y - 12, "", { size: 1 }).setOrigin(0, 0.5).setDepth(5);
      var cost = ZV.ui.text(scene, CARD.x - CARD.w / 2 + 10, y + 12, "", { size: 1, color: "#9aa0b5" }).setOrigin(0, 0.5).setDepth(5);
      scene.cards.push({ box: box, title: title, cost: cost, slot: i, up: -1 });
      (function (card) {
        card.box.on("pointerup", function () { buy(scene, card.up); });
      })(scene.cards[i]);
    }
  }

  // Какие апгрейды показывать: первые showUpgrades из открытых и не купленных
  // до потолка — карточка не исчезает посреди партии без объяснения.
  function visibleUpgrades(scene) {
    var index = {}, out = [];
    for (var i = 0; i < scene.ups.length; i++) index[scene.ups[i].id] = i;
    for (i = 0; i < scene.ups.length && out.length < scene.cards.length; i++) {
      if (scene.levels[i] >= scene.ups[i].max) continue;
      if (!CLK.unlocked(scene.ups[i], scene.levels, index)) continue;
      out.push(i);
    }
    return out;
  }

  function buy(scene, i) {
    if (scene.over || i < 0 || i >= scene.ups.length) return;
    var u = scene.ups[i];
    if (scene.levels[i] >= u.max) return;
    var price = CLK.costOf(u, scene.levels[i]);
    if (scene.score < price) return;
    scene.score -= price;
    scene.levels[i] += 1;
    scene.bought += 1;
    global.ZV.juice.dust(scene, CARD.x, CARD.y, 0xffd23f);
    redraw(scene);
  }

  // --- счёт ----------------------------------------------------------------
  function perTap(scene) {
    var v = S.tapPoints;
    for (var i = 0; i < scene.ups.length; i++) v += scene.ups[i].perTap * scene.levels[i];
    return v * (scene.need <= 0 ? S.hungryFactor : 1);
  }
  function perSec(scene) {
    var v = 0;
    for (var i = 0; i < scene.ups.length; i++) v += scene.ups[i].perSec * scene.levels[i];
    return v;
  }

  function gain(scene, add, popup) {
    scene.score += add;
    if (popup) flyUp(scene, "+" + Math.round(add));
    // Стадия могла смениться сразу на несколько ступеней — показываем последнюю.
    var next = scene.stage;
    for (var i = scene.stage + 1; i < scene.stages.length; i++) {
      if (scene.score >= scene.stages[i].at) next = i;
    }
    if (next !== scene.stage) applyStage(scene, next, false);
  }

  // «+N» уходит вверх и гаснет: шаги ленты, а не твин — лента одна на сцену.
  // Разброс по x целыми пикселями: при пяти тапах в секунду надписи иначе
  // ложатся друг на друга и читаются как одна каша.
  function flyUp(scene, text) {
    var dx = global.ZV.random.between(-40, 40);
    var t = global.ZV.ui.text(scene, HERO.x + dx, HERO.y - HERO.size / 2 - 8, text, { size: 1, color: "#ffd23f" })
      .setOrigin(0.5).setDepth(8);
    scene.tl.add(120, function () { t.y = t.y - 8; });
    scene.tl.add(240, function () { t.y = t.y - 8; t.setAlpha(0.6); });
    scene.tl.add(380, function () { t.destroy(); });
  }

  // --- отрисовка -----------------------------------------------------------
  function redraw(scene) {
    var ZV = global.ZV;
    var W = ZV.WIDTH;
    scene.scoreText.setText(String(Math.floor(scene.score)));
    // Текущий темп держим полем: его читает и HUD, и проба автопрогона.
    scene.perTapNow = perTap(scene);
    scene.perSecNow = perSec(scene);
    var ps = scene.perSecNow;
    scene.rateText.setText("+" + round1(scene.perTapNow) + " за тап" + (ps > 0 ? ", +" + round1(ps) + "/сек" : ""));

    // Шкала нужды: ширина целая, ниже 25 % мигает (тревога, не наказание).
    var frac = Math.max(0, Math.min(1, scene.need / CLK.NEED_MAX));
    scene.needFill.width = Math.max(0, Math.round(NEED.w * frac));
    var low = frac < 0.25;
    scene.needFill.setFillStyle(low ? 0xff5f6d : (frac < 0.5 ? 0xffd23f : 0x2e9e5b));
    scene.needFill.setAlpha(low && Math.floor(scene.elapsed / 500) % 2 === 0 ? 0.45 : 1);

    // Кнопка ухода на кулдауне — тусклая и не нажимается.
    var ready = scene.elapsed >= scene.careReady;
    scene.careBox.setAlpha(ready ? 1 : 0.4);
    scene.careLabel.setAlpha(ready ? 1 : 0.4);

    var vis = visibleUpgrades(scene);
    for (var i = 0; i < scene.cards.length; i++) {
      var card = scene.cards[i];
      var ui = vis[i];
      if (ui === undefined) {
        card.up = -1;
        card.box.setVisible(false); card.title.setVisible(false); card.cost.setVisible(false);
        continue;
      }
      card.up = ui;
      var u = scene.ups[ui], price = CLK.costOf(u, scene.levels[ui]);
      var can = scene.score >= price;
      card.box.setVisible(true); card.title.setVisible(true); card.cost.setVisible(true);
      card.box.setFillStyle(can ? 0x4f7cff : 0x2a2f45);
      card.title.setText(cut(titleOf(scene, ui), 22));
      card.cost.setText(price + " · " + gainOf(u) + (u.max > 1 ? " · " + scene.levels[ui] + "/" + u.max : ""));
    }

    // Полоса таймера: целая ширина, последние 10 с краснеет.
    if (S.duration > 0) {
      var left = Math.max(0, S.duration - scene.elapsed);
      scene.timeBar.width = Math.max(0, Math.round(W * left / S.duration));
      scene.timeBar.setFillStyle(left <= 10000 ? 0xff5f6d : 0x4f7cff);
    }
  }

  function titleOf(scene, i) {
    var raw = (scene.data.upgrades && scene.data.upgrades[i] && scene.data.upgrades[i].title) || scene.ups[i].id;
    return String(raw);
  }
  function gainOf(u) {
    if (u.perTap > 0 && u.perSec > 0) return "+" + round1(u.perTap) + "/тап, +" + round1(u.perSec) + "/с";
    return u.perTap > 0 ? "+" + round1(u.perTap) + " за тап" : "+" + round1(u.perSec) + " в сек";
  }
  function round1(v) {
    return Math.round(v * 10) % 10 === 0 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  }
  function cut(s, n) {
    return s.length <= n ? s : s.slice(0, n - 1) + "…";
  }

  // --- конец партии --------------------------------------------------------
  function finish(scene, won) {
    if (scene.over) return;
    scene.over = true;
    scene.tl.clear();
    var score = Math.floor(scene.score);
    var st = scene.stages[scene.stage] || {};
    var record = false;
    if (scene.slot) {
      var seen = Math.max(scene.saved.stages, scene.stage + 1);
      scene.slot.set({ best: Math.max(scene.saved.best, score), stages: seen });
      // Рекорд объявляем только если хранилище живо: иначе «рекорд» будет
      // каждую партию (в приватном окне прошлый счёт всегда ноль).
      record = scene.slot.ok && score > scene.saved.best;
    }
    global.ZV.finish(scene, {
      score: score,
      won: won,
      text: won ? (scene.goal.text || "очков") : "очков",
      title: "Стадия " + (scene.stage + 1) + ": " + (st.title || ""),
      meta: {
        archetype: "clicker", stage: scene.stage, stages: scene.stages.length,
        taps: scene.taps, upgrades: scene.bought, careUses: scene.careUses,
        seconds: Math.round(scene.elapsed / 1000), record: record
      }
    });
  }

  function stub(scene, key, w, h, color) {
    if (scene.textures.exists(key)) return;
    var g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.clicker = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
