// Оболочка игры: экраны Играть → Игра → Результат, мобильный контур,
// события родительскому окну. Киты о ней знают через ZV.finish/ZV.ui —
// свои экраны меню и результата им рисовать не нужно.
(function (global) {
  "use strict";

  var WIDTH = 720;   // дизайн-канва: портрет, Scale.FIT подгонит под экран
  var HEIGHT = 1280;

  var config = global.ZV_GAME || {};
  var brand = config.brand || {};
  var PRIMARY = brand.primary || "#4f7cff";
  var SECONDARY = brand.secondary || "#ffd23f";

  var lastResult = { score: 0, won: false, meta: {} };

  // --- события родителю (контракт встраивания) ---------------------------
  function post(type, payload) {
    var msg = { source: "zv-game", type: type };
    if (payload) {
      for (var k in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
      }
    }
    try {
      if (global.parent && global.parent !== global) global.parent.postMessage(msg, "*");
    } catch (e) { /* родитель на другом origin и закрыт — не мешаем игре */ }
  }

  // --- звук: браузер разрешает WebAudio только после жеста ---------------
  function unlockAudio(scene) {
    var snd = scene.sound;
    if (snd && snd.locked && typeof snd.unlock === "function") snd.unlock();
    if (snd && snd.context && snd.context.state === "suspended") {
      snd.context.resume().catch(function () {});
    }
  }

  // --- общие элементы интерфейса ----------------------------------------
  var ui = {
    // Кнопка с тач-целью не меньше 48px в экранных пикселях.
    button: function (scene, x, y, label, onTap, opts) {
      opts = opts || {};
      var w = opts.width || 420;
      var h = opts.height || 128;
      var color = opts.color || PRIMARY;
      var box = scene.add.rectangle(x, y, w, h, Phaser.Display.Color.HexStringToColor(color).color)
        .setOrigin(0.5).setInteractive({ useHandCursor: true });
      box.setStrokeStyle(4, 0xffffff, 0.18);
      var text = scene.add.text(x, y, label, {
        fontFamily: "system-ui, sans-serif", fontSize: "44px", color: "#ffffff", fontStyle: "bold"
      }).setOrigin(0.5);
      // Тап засчитываем по pointerup — это ближе к ожиданиям на телефоне.
      box.on("pointerdown", function () { box.setAlpha(0.75); });
      box.on("pointerout", function () { box.setAlpha(1); });
      box.on("pointerup", function () {
        box.setAlpha(1);
        onTap();
      });
      return { box: box, text: text };
    },

    title: function (scene, x, y, label, size) {
      return scene.add.text(x, y, label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: (size || 72) + "px",
        color: "#ffffff",
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: WIDTH - 120 }
      }).setOrigin(0.5);
    },

    hint: function (scene, x, y, label) {
      return scene.add.text(x, y, label, {
        fontFamily: "system-ui, sans-serif", fontSize: "34px", color: "#9aa0b5",
        align: "center", wordWrap: { width: WIDTH - 140 }
      }).setOrigin(0.5);
    },

    // Фон экрана: заглушка вместо оформления — подставляется картинкой кита.
    backdrop: function (scene) {
      scene.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101018).setOrigin(0.5);
    }
  };

  // --- подстановка картинок и анимаций ------------------------------------
  // Единственная точка, через которую кит меняет текстуру/анимацию у спрайта.
  // Смысл: setTexture() и play() внутри зовут setSizeToFrame(), то есть
  // сбрасывают тело под размер нового кадра и обнуляют offset. Если тело
  // задать один раз в create, после подстановки настоящего спрайта герой
  // «повисает» над полом или проваливается в него. Хелпер запоминает
  // желаемое тело на спрайте и переприменяет его после каждой смены кадра.
  var sprite = {
    // opts: { texture, frame, anim, bodyW, bodyH, offsetX, offsetY, scale }
    // Размеры тела — в единицах ТЕКСТУРЫ (масштаб Arcade учитывает сам).
    // Якорь спрайта ставим по низу ног (0.5, 1): при смене картинки другого
    // размера точка опоры остаётся на земле, герой не уезжает вверх/вниз.
    apply: function (obj, opts) {
      opts = opts || {};
      // Подстановка может прийти посреди твина сплющивания — снимаем его и
      // возвращаем базовый масштаб, иначе за базу примется искажённый.
      if (obj.zvSquash) { obj.zvSquash.remove(); obj.zvSquash = null; }
      var baseX = obj.getData("zvScaleX"), baseY = obj.getData("zvScaleY");
      if (typeof baseX === "number") obj.setScale(baseX, baseY);
      if (typeof opts.scale === "number") obj.setScale(opts.scale);
      if (opts.origin !== false) obj.setOrigin(0.5, 1);
      // Базовый масштаб — точка отсчёта для «сока»: сплющивание временное.
      obj.setData("zvScaleX", obj.scaleX);
      obj.setData("zvScaleY", obj.scaleY);

      var spec = obj.getData("zvBody") || {};
      ["bodyW", "bodyH", "offsetX", "offsetY"].forEach(function (k) {
        if (typeof opts[k] === "number") spec[k] = opts[k];
      });
      obj.setData("zvBody", spec);

      sprite.watch(obj);

      if (opts.texture) obj.setTexture(opts.texture, opts.frame);
      else if (typeof opts.frame !== "undefined") obj.setFrame(opts.frame);
      if (opts.anim) sprite.playAnim(obj, opts.anim, opts.animIgnoreIfPlaying !== false);

      sprite.refresh(obj);
      return obj;
    },

    // Проигрывание анимации с тем же переприменением тела.
    playAnim: function (obj, key, ignoreIfPlaying) {
      if (!obj.anims || !obj.scene || !obj.scene.anims.exists(key)) return obj;
      obj.anims.play(key, ignoreIfPlaying !== false);
      sprite.refresh(obj);
      return obj;
    },

    // Возвращает телу размер и смещение, записанные в zvBody.
    // Смещение считаем от низа кадра: ноги должны совпадать с низом картинки.
    // Размеры делим на текущий масштаб: Arcade множит их обратно, поэтому
    // сплющивание в твине не должно менять хитбокс.
    refresh: function (obj) {
      var body = obj.body;
      var spec = obj.getData("zvBody");
      if (!body || !spec) return obj;
      var fw = obj.frame ? obj.frame.realWidth : obj.width;
      var fh = obj.frame ? obj.frame.realHeight : obj.height;
      var base = { x: obj.getData("zvScaleX") || obj.scaleX, y: obj.getData("zvScaleY") || obj.scaleY };
      var kx = (obj.scaleX || 1) / (base.x || 1);
      var ky = (obj.scaleY || 1) / (base.y || 1);
      var w = (spec.bodyW || fw) / (kx || 1);
      var h = (spec.bodyH || fh) / (ky || 1);
      var ox = typeof spec.offsetX === "number" ? spec.offsetX : (fw - w) / 2;
      var oy = typeof spec.offsetY === "number" ? spec.offsetY : (fh - h);
      body.setSize(w, h, false);
      body.setOffset(ox, oy);
      return obj;
    },

    // Подписка на события анимации: они меняют кадр, а значит и тело.
    watch: function (obj) {
      if (obj.getData("zvWatched")) return obj;
      obj.setData("zvWatched", true);
      var again = function () { sprite.refresh(obj); };
      obj.on(Phaser.Animations.Events.ANIMATION_START, again);
      obj.on(Phaser.Animations.Events.ANIMATION_UPDATE, again);
      obj.on(Phaser.Animations.Events.ANIMATION_REPEAT, again);
      return obj;
    }
  };

  // --- пол и «сок» ---------------------------------------------------------
  // Пол статическим телом БОЛЬШОЙ глубины: видно полоску, а тело уходит вниз.
  // Расчёт: герой падает со скоростью до v = jump (≈1700 px/с). При просадке
  // до 30 fps кадр длится 33 мс — тело проходит 1700/30 ≈ 57 px за кадр, при
  // 10 fps уже 170 px. Полоса 28 px пробивается уже на 30 fps, поэтому тело
  // делаем глубиной DEPTH = 400 px: даже без fixedStep запас четырёхкратный,
  // а с ним (шаг всегда 1/60) фактический ход за тик ≈ 28 px.
  var FLOOR_DEPTH = 400;

  function floor(scene, x, yTop, width, visibleH, color) {
    var vis = typeof visibleH === "number" ? visibleH : 28;
    scene.add.rectangle(x, yTop + vis / 2, width, vis,
      typeof color === "number" ? color : 0x2a2f45).setOrigin(0.5);
    var body = scene.add.rectangle(x, yTop + FLOOR_DEPTH / 2, width, FLOOR_DEPTH, 0x000000, 0);
    scene.physics.add.existing(body, true);
    return body;
  }

  // Приземление: сплющивание с возвратом, тень и пыль. Только твины и
  // частицы Phaser, ничего внешнего.
  var juice = {
    // Сплющить и вернуть. По низу ног (origin 0.5,1) спрайт не «ныряет».
    squash: function (scene, obj, power, ms) {
      var p = typeof power === "number" ? power : 0.18;
      var d = typeof ms === "number" ? ms : 80;
      var sx = obj.getData("zvScaleX") || obj.scaleX;
      var sy = obj.getData("zvScaleY") || obj.scaleY;
      obj.setData("zvScaleX", sx);
      obj.setData("zvScaleY", sy);
      if (obj.zvSquash) obj.zvSquash.remove();
      obj.setScale(sx * (1 + p), sy * (1 - p));
      sprite.refresh(obj);
      obj.zvSquash = scene.tweens.add({
        targets: obj, scaleX: sx, scaleY: sy, duration: d, ease: "Quad.easeOut",
        // Тело следует за масштабом весь твин, иначе хитбокс застревает
        // в сплющенном состоянии.
        onUpdate: function () { sprite.refresh(obj); },
        onComplete: function () { sprite.refresh(obj); }
      });
    },

    // Растянуть в прыжке — обратная сторона того же приёма.
    stretch: function (scene, obj, power, ms) {
      juice.squash(scene, obj, -(typeof power === "number" ? power : 0.14), ms || 90);
    },

    // Тень-овал: следует за ногами, сжимается, когда объект высоко.
    // opts: { color, alpha } — на светлой дорожке нужен чёрный, на тёмной
    // тень читается только светлым пятном.
    shadow: function (scene, obj, groundY, maxW, opts) {
      opts = opts || {};
      var w = maxW || 90;
      var base = typeof opts.alpha === "number" ? opts.alpha : 0.3;
      var sh = scene.add.ellipse(obj.x, groundY, w, w * 0.28,
        typeof opts.color === "number" ? opts.color : 0x000000, base)
        .setOrigin(0.5).setDepth((obj.depth || 0) - 1);
      sh.zvFollow = function () {
        var h = Phaser.Math.Clamp((groundY - obj.y) / 320, 0, 1);
        sh.x = obj.x;
        sh.setScale(1 - h * 0.45, 1 - h * 0.45);
        sh.setAlpha(base * (1 - h * 0.6));
      };
      return sh;
    },

    // Пара пылинок под ногами. Одноразовый эмиттер, сам себя убирает.
    dust: function (scene, x, y, color) {
      if (!scene.textures.exists("zv-dust")) {
        var g = scene.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.fillCircle(6, 6, 6);
        g.generateTexture("zv-dust", 12, 12);
        g.destroy();
      }
      var em = scene.add.particles(x, y, "zv-dust", {
        speed: { min: 60, max: 170 },
        angle: { min: 195, max: 345 },
        gravityY: 900,
        scale: { start: 0.7, end: 0 },
        alpha: { start: 0.55, end: 0 },
        lifespan: 320,
        tint: typeof color === "number" ? color : 0x9aa0b5,
        quantity: 3,
        emitting: false
      }).setDepth(2);
      em.explode(3);
      scene.time.delayedCall(400, function () { em.destroy(); });
      return em;
    }
  };

  // --- экран «Играть» ----------------------------------------------------
  function MenuScene() {
    Phaser.Scene.call(this, { key: "zv-menu" });
  }
  MenuScene.prototype = Object.create(Phaser.Scene.prototype);
  MenuScene.prototype.constructor = MenuScene;
  MenuScene.prototype.create = function () {
    var self = this;
    ui.backdrop(this);
    if (brand.name) {
      this.add.text(WIDTH / 2, 200, brand.name, {
        fontFamily: "system-ui, sans-serif", fontSize: "38px", color: SECONDARY
      }).setOrigin(0.5);
    }
    ui.title(this, WIDTH / 2, 380, config.title || "Игра", 76);
    ui.hint(this, WIDTH / 2, 520, "Одно касание — одно действие");

    ui.button(this, WIDTH / 2, HEIGHT / 2 + 120, "Играть", function () {
      unlockAudio(self);
      post("start");
      self.scene.start("zv-play");
    });

    if (!config.embed) {
      ui.button(this, WIDTH / 2, HEIGHT - 220, "Во весь экран", function () {
        unlockAudio(self);
        if (self.scale.isFullscreen) self.scale.stopFullscreen();
        else self.scale.startFullscreen();
      }, { width: 380, height: 100, color: "#2a2f45" });
    }

    post("ready");
  };

  // --- экран «Результат» -------------------------------------------------
  function ResultScene() {
    Phaser.Scene.call(this, { key: "zv-result" });
  }
  ResultScene.prototype = Object.create(Phaser.Scene.prototype);
  ResultScene.prototype.constructor = ResultScene;
  ResultScene.prototype.init = function (data) {
    this.result = data || lastResult;
  };
  ResultScene.prototype.create = function () {
    var self = this;
    var r = this.result || {};
    ui.backdrop(this);
    ui.title(this, WIDTH / 2, 380, r.won ? "Победа" : "Раунд окончен", 68);
    this.add.text(WIDTH / 2, 520, String(r.score || 0), {
      fontFamily: "system-ui, sans-serif", fontSize: "140px", color: SECONDARY, fontStyle: "bold"
    }).setOrigin(0.5);
    ui.hint(this, WIDTH / 2, 640, r.text || "очков");

    ui.button(this, WIDTH / 2, HEIGHT / 2 + 220, "Ещё раз", function () {
      post("start");
      self.scene.start("zv-play");
    });
    ui.button(this, WIDTH / 2, HEIGHT / 2 + 380, "В меню", function () {
      self.scene.start("zv-menu");
    }, { width: 380, height: 100, color: "#2a2f45" });
  };

  // --- сборка игры -------------------------------------------------------
  var game = null;

  function boot(kit) {
    var scenes = [MenuScene].concat(kit.createScenes(config) || []).concat([ResultScene]);
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game",
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: "#101018",
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      // fixedStep: физический шаг всегда 1/60 с, даже когда кадры проседают.
      // Без него на слабом телефоне шаг равен длине кадра, и быстрое тело
      // пролетает сквозь пол за один тик (туннелирование).
      physics: {
        default: "arcade",
        arcade: { gravity: { y: 0 }, debug: false, fixedStep: true, fps: 60, timeScale: 1 }
      },
      input: { activePointers: 2 },
      scene: scenes
    });
    global.ZV.game = game; // ссылка для отладки из консоли
    return game;
  }

  // Родитель просит перезапуск: возвращаемся на игровой экран.
  global.addEventListener("message", function (ev) {
    var d = ev && ev.data;
    if (!d || d.source !== "zv-host") return;
    if (d.type === "restart" && game) {
      post("start");
      // Гасим то, что сейчас на экране: иначе результат остаётся поверх игры.
      game.scene.stop("zv-result");
      game.scene.stop("zv-menu");
      game.scene.start("zv-play");
    }
  });

  global.ZV = {
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    PRIMARY: PRIMARY,
    SECONDARY: SECONDARY,
    ui: ui,
    sprite: sprite,
    juice: juice,
    floor: floor,
    FLOOR_DEPTH: FLOOR_DEPTH,
    boot: boot,

    // Кит зовёт это в конце раунда: событие родителю + экран результата.
    finish: function (scene, result) {
      var r = result || {};
      lastResult = { score: r.score || 0, won: !!r.won, meta: r.meta || {}, text: r.text || "очков" };
      post("finish", { score: lastResult.score, won: lastResult.won, meta: lastResult.meta });
      scene.scene.start("zv-result", lastResult);
    }
  };
})(window);
