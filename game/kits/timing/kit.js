// Кит «Точный тап»: по горизонтальной шкале бегает маркер туда-обратно, на
// шкале зелёная зона. Тап в момент, когда маркер внутри — попадание, в центре
// зоны — «идеально» и двойные очки. После попадания зона сужается и маркер
// ускоряется; промах снимает жизнь, зона не меняется. Партия кончается по
// раундам или по жизням. Тач-цель — ВСЯ канва: целиться надо во время, а не
// пальцем, и попадание в маленький маркер убивало бы саму механику.
//
// Движение маркера — чистая функция модельного времени (game/timing.js,
// треугольная волна), а не накопленная координата: просадка кадров не должна
// смещать партию. Случайность только в положении зоны и только ZV.random.
// Канва 360×640, координаты целые, масштаб спрайтов 1.
(function (global) {
  "use strict";

  var TM = global.ZV_TIMING;

  // Настройки по умолчанию; правятся в config.params (те же ключи).
  // Числа держат инвариант честности game/timing.js: на последнем раунде
  // маркер проходит зону за 280 мс при пороге 250.
  var DEFAULTS = {
    rounds: 10,          // раундов в партии
    lives: 3,            // промахов до конца партии
    speedStart: 180,     // скорость маркера в первом раунде, px/с
    speedStep: 16,       // прибавка скорости за каждое попадание
    speedMax: 300,       // потолок скорости (выше — game/timing.js ругается числом)
    zoneStart: 120,      // ширина зоны в первом раунде, px
    zoneMin: 84,         // дно ширины зоны (уже — попасть нельзя)
    zoneStep: 4,         // насколько зона сужается за каждое попадание
    hitPoints: 10,       // очки за попадание
    perfectBonus: 10,    // сколько добавляется за попадание в центр зоны
    passScore: 80,       // очков для победы
    barWidth: 300        // ширина шкалы, px
  };
  var S = DEFAULTS;

  // Раскладка. barWidth из параметров, остальное здесь: шкала высокая (56 px)
  // — по требованию «≥40», чтобы зона читалась на телефоне с руки.
  var BAR = { y: 320, h: 56, edge: 3 };
  // Маркер заметно выше шкалы: иначе на тёмном фоне его край путается с краем
  // зоны, и в последних раундах непонятно, попал ты или нет.
  var MARKER = { w: 8, h: 96 };
  var HUD = { score: 60, round: 96, lives: 130 };
  var COLOR = {
    bar: 0x2a2f45, frame: 0x3a4160,
    zone: 0x2e9e5b, core: 0x6ee7a0,      // зона и её центр («идеально»)
    marker: 0xffffff, hit: 0xffd23f, miss: 0xff5f6d
  };

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var bg = a.background || {};
    this.bgTile = !!bg.tile;
    this.bgFailed = false;
    if (bg.url) this.load.image("bg", bg.url);
    this.load.on("loaderror", function (file) {
      if (file.key === "bg") this.bgFailed = true;
    }, this);
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;

    S = ZV.params(DEFAULTS);
    this.over = true;   // до проверки честности сцена ничего не делает

    // Честность параметров ZV.params не проверяет — она про типы, а не про
    // физику. Зона, которую маркер проскакивает за 60 мс, формально
    // «правильное число», а играть в это нельзя: отсюда своя проверка и
    // экран ошибки со списком (наружу уходит событие error).
    var fair = TM.check(S);
    if (!fair.ok) {
      ZV.ui.fail(this, "Нечестные параметры «Точного тапа»", [fair.reason]);
      return;
    }
    this.over = false;
    this.fair = fair;

    this.tl = ZV.timeline.create();
    this.events.once("shutdown", function () { self.tl.clear(); });

    this.score = 0;
    this.lives = S.lives;
    this.round = 0;          // номер текущего раунда с нуля
    this.hits = 0;
    this.perfects = 0;
    this.misses = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.clock = 0;          // модельное время партии, мс — только оно двигает маркер
    this.locked = false;     // пауза между раундами: тап не считается
    // Числа партии полями сцены: S — модульная переменная, и проба автопрогона
    // (как и любой читатель снаружи) обязана видеть параметры ИМЕННО этой
    // сцены, а не те, что записал туда последний созданный кит.
    this.barWidth = S.barWidth;
    this.zoneMin = S.zoneMin;
    this.roundsTotal = S.rounds;

    this.add.rectangle(W / 2, H / 2, W, H, 0x101018).setDepth(-20);
    drawBackground(this, W, H);
    buildBar(this, W);

    this.scoreText = ZV.ui.text(this, W / 2, HUD.score, "0", { size: 3 }).setOrigin(0.5).setDepth(5);
    this.roundText = ZV.ui.text(this, W / 2, HUD.round, "", { size: 1, color: "#9aa0b5" }).setOrigin(0.5).setDepth(5);
    this.livesText = ZV.ui.text(this, W / 2, HUD.lives, "", { size: 1, color: "#9aa0b5" }).setOrigin(0.5).setDepth(5);
    this.flash = ZV.ui.text(this, W / 2, 216, "", { size: 2, color: ZV.SECONDARY, align: "center" })
      .setOrigin(0.5).setDepth(9);
    ZV.ui.hint(this, W / 2, 470, "Тапни в любом месте, когда маркер в зелёной зоне");

    // Тач-цель — вся канва: механика про момент, а не про меткость пальца.
    this.input.on("pointerup", function () { tap(self); });

    startRound(this);
    updateHud(this);
  };

  PlayScene.prototype.update = function (time, delta) {
    if (this.over) return;
    var d = Math.max(0, delta);
    this.clock += d;
    this.tl.update(d);
    if (this.locked) return;
    placeMarker(this, markerNow(this));
  };

  // --- шкала ------------------------------------------------------------------

  function buildBar(scene, W) {
    var left = barLeft();
    // Рамка шкалы: сама полоса плюс две линии краёв — видно, где маркер
    // разворачивается.
    scene.add.rectangle(left, BAR.y, S.barWidth, BAR.h, COLOR.bar).setOrigin(0, 0.5).setDepth(1);
    scene.add.rectangle(left, BAR.y, BAR.edge, BAR.h, COLOR.frame).setOrigin(0, 0.5).setDepth(2);
    scene.add.rectangle(left + S.barWidth - BAR.edge, BAR.y, BAR.edge, BAR.h, COLOR.frame).setOrigin(0, 0.5).setDepth(2);

    // Зона и её центр: ширина и положение ставятся в startRound.
    scene.zoneBox = scene.add.rectangle(left, BAR.y, 10, BAR.h - 8, COLOR.zone).setOrigin(0, 0.5).setDepth(3);
    scene.zoneCore = scene.add.rectangle(left, BAR.y, 10, BAR.h - 8, COLOR.core).setOrigin(0, 0.5).setDepth(4);
    scene.marker = scene.add.rectangle(left, BAR.y, MARKER.w, MARKER.h, COLOR.marker).setOrigin(0.5).setDepth(6);
  }

  // Шкала по центру канвы, левый край — целое число.
  function barLeft() {
    return Math.round((global.ZV.WIDTH - S.barWidth) / 2);
  }

  // Позиция маркера сейчас: чистая функция модельного времени и скорости
  // раунда. Время раунда отсчитывается от его начала — новый раунд всегда
  // начинается с левого края, и партия читается одинаково при любом сиде.
  function markerNow(scene) {
    return TM.markerPos(scene.clock - scene.roundStart, scene.speed, S.barWidth);
  }

  function placeMarker(scene, pos) {
    scene.marker.x = barLeft() + Math.round(pos);
  }

  // --- раунд -------------------------------------------------------------------

  function startRound(scene) {
    var ZV = global.ZV;
    scene.speed = TM.speedFor(scene.round, S);
    scene.zone = TM.zoneFor(scene.round, S, ZV.random);
    scene.roundStart = scene.clock;

    var left = barLeft();
    scene.zoneBox.x = left + scene.zone.x;
    scene.zoneBox.width = scene.zone.w;
    // Центр зоны («идеально») — половина её ширины вокруг середины.
    var coreW = Math.max(2, Math.round(scene.zone.w * TM.LIMITS.perfectRatio * 2));
    scene.zoneCore.x = left + scene.zone.x + Math.round((scene.zone.w - coreW) / 2);
    scene.zoneCore.width = coreW;
    scene.zoneBox.setFillStyle(COLOR.zone);

    scene.locked = false;
    placeMarker(scene, markerNow(scene));
    updateHud(scene);
  }

  // --- ход игрока --------------------------------------------------------------

  function tap(scene) {
    if (scene.over || scene.locked) return;
    var pos = markerNow(scene);
    var kind = TM.hit(pos, scene.zone);
    if (kind === "none") miss(scene, pos);
    else score(scene, pos, kind === "perfect");
  }

  function score(scene, pos, perfect) {
    var ZV = global.ZV;
    var gain = S.hitPoints + (perfect ? S.perfectBonus : 0);
    scene.score += gain;
    scene.hits++;
    if (perfect) scene.perfects++;
    scene.streak++;
    if (scene.streak > scene.bestStreak) scene.bestStreak = scene.streak;

    scene.zoneBox.setFillStyle(COLOR.hit);
    scene.cameras.main.shake(80, 0.003);
    ZV.juice.dust(scene, scene.marker.x, BAR.y, perfect ? COLOR.hit : COLOR.zone);
    popup(scene, scene.marker.x, BAR.y - 60, "+" + gain);
    say(scene, perfect ? "Идеально!" : "Попал", 500);
    // Счёт обновляем СРАЗУ: «+20» над шкалой при нуле в HUD читается как
    // «очки не засчитали» — до следующего раунда ещё 420 мс паузы.
    updateHud(scene);
    nextRound(scene);
  }

  function miss(scene, pos) {
    scene.misses++;
    scene.streak = 0;
    scene.lives--;
    scene.zoneBox.setFillStyle(COLOR.miss);
    scene.cameras.main.shake(140, 0.007);
    // «Рано» или «поздно» считается по НАПРАВЛЕНИЮ движения, а не по тому, с
    // какой стороны шкалы маркер: на обратном ходе левее зоны — это уже
    // «поздно», и подсказка наоборот учила бы двигать тап не в ту сторону.
    var ahead = TM.markerPos(scene.clock - scene.roundStart + 16, scene.speed, S.barWidth);
    var toRight = ahead >= pos;                    // куда идёт маркер сейчас
    var before = toRight ? pos < scene.zone.x : pos > scene.zone.x + scene.zone.w;
    say(scene, "Мимо: " + (before ? "рано" : "поздно"), 600);
    updateHud(scene);
    if (scene.lives <= 0) { finish(scene, false); return; }
    nextRound(scene);
  }

  // Пауза 420 мс между раундами: игрок успевает увидеть исход, а рефлекторный
  // второй тап не улетает в уже новую зону.
  function nextRound(scene) {
    scene.locked = true;
    scene.round++;
    var handled = scene.hits + scene.misses;
    global.ZV.progress(scene, {
      step: handled, total: S.rounds,
      meta: { score: scene.score, streak: scene.streak }
    });
    if (scene.round >= S.rounds) { scene.tl.add(420, function () { finish(scene, true); }); return; }
    scene.tl.add(420, function () { if (!scene.over) startRound(scene); });
  }

  // --- отрисовка ---------------------------------------------------------------

  function updateHud(scene) {
    scene.scoreText.setText(String(scene.score));
    scene.roundText.setText("раунд " + Math.min(scene.round + 1, S.rounds) + "/" + S.rounds);
    scene.livesText.setText("жизни: " + Math.max(0, scene.lives) + "/" + S.lives);
  }

  // «+N» вверх шагами ленты: без твинов, координаты остаются целыми.
  function popup(scene, x, y, text) {
    var t = global.ZV.ui.text(scene, Math.round(x), Math.round(y), text, {
      size: 2, color: global.ZV.SECONDARY
    }).setOrigin(0.5).setDepth(10);
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        scene.tl.add(n * 60, function () {
          if (!t.scene) return;
          t.y = Math.round(y - n * 4);
          if (n === 5) t.destroy();
        });
      })(i);
    }
  }

  // Кегль подбирается под ширину канвы — длинная подпись иначе уезжает за край.
  function say(scene, text, ms) {
    scene.flash.setFontSize(global.ZV.font.UNIT * (global.ZV.font.fit(text, global.ZV.WIDTH - 40, 1, 2) || 1));
    scene.flash.setText(text);
    scene.tl.add(ms, function () { if (scene.flash.scene) scene.flash.setText(""); });
  }

  // --- конец партии ------------------------------------------------------------

  function finish(scene, survived) {
    if (scene.over) return;
    scene.over = true;
    scene.tl.clear();
    var won = survived && scene.score >= S.passScore;
    global.ZV.finish(scene, {
      score: scene.score,
      won: won,
      text: "очков",
      meta: {
        archetype: "timing", hits: scene.hits, perfects: scene.perfects,
        misses: scene.misses, rounds: Math.min(scene.round, S.rounds),
        bestStreak: scene.bestStreak, windowMs: scene.fair.windowMs
      }
    });
  }

  // Фон подгоняется под канву общим правилом layout.js (fitBackground).
  function drawBackground(scene, W, H) {
    if (!scene.textures.exists("bg") || scene.bgFailed) return false;
    var src = scene.textures.get("bg").getSourceImage();
    var fit = global.ZV_LAYOUT.fitBackground(src.width, src.height, W, H, scene.bgTile);
    if (!fit) return false;
    if (fit.mode === "tile") {
      scene.add.tileSprite(0, 0, W, H, "bg").setOrigin(0, 0).setDepth(-10);
      return true;
    }
    var img = scene.add.image(W / 2, H / 2, "bg").setDepth(-10);
    if (fit.mode === "cover") img.setDisplaySize(fit.width, fit.height);
    else img.setScale(fit.scale);
    return true;
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.timing = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
