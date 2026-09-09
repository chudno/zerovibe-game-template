// Кит «Новелла»: сюжет — граф узлов в content/novel.json (фон, портрет,
// реплика, варианты ответа или «дальше»), переменные с условиями, концовки с
// исходом. Граф, проверка и рантайм — game/novel.js; здесь только сцена:
// фон, портрет, панель реплики с печатью по буквам, столбик вариантов.
// Канва 360×640: портрет над панелью, панель 316..448, варианты ниже.
(function (global) {
  "use strict";

  var N = global.ZV_NOVEL;

  // Настройки по умолчанию; правятся в config.params (те же ключи).
  var DEFAULTS = {
    typeMs: 22,          // мс на букву при печати реплики; 0 — сразу целиком
    tapReveals: true,    // тап во время печати показывает реплику целиком
    autoNextMs: 0,       // линейный узел сам идёт дальше через столько мс после печати; 0 — по тапу
    startNode: ""        // с какого узла начинать (отладка); пусто — start из файла
  };
  var S = DEFAULTS;

  var PANEL = { x: 12, y: 316, w: 336, h: 132 };
  var PORTRAIT = { x: 180, y: 302, w: 96, h: 128 };
  var CHOICES = { y: 468, step: 44, height: 40, width: 300 };
  var TEXT_W = 312;
  // Цвета заглушек по ключу картинки: у каждого персонажа/места свой.
  var PALETTE = [0x4f7cff, 0xff5f6d, 0x2e9e5b, 0xd9a100, 0x9b59b6, 0x1abc9c];
  var BG_PALETTE = [0x1b1f33, 0x1f2a1b, 0x2a1b1f, 0x1b2a2a, 0x262238, 0x2a2a1b];

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  // Картинки по ключам из config.assets.backgrounds/portraits; ключи узлов
  // сюжета в preload ещё не известны (JSON грузится тут же), поэтому грузим все.
  PlayScene.prototype.preload = function () {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var self = this;
    this.failed = {};
    [["bg:", a.backgrounds], ["pt:", a.portraits]].forEach(function (pair) {
      var map = pair[1] || {};
      for (var k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k) && map[k] && map[k].url) self.load.image(pair[0] + k, map[k].url);
      }
    });
    this.load.on("loaderror", function (file) { self.failed[file.key] = true; }, this);
    global.ZV.loadContent(this, "novel");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;

    S = ZV.params(DEFAULTS);
    this.over = false;
    var c = ZV.content(this, "novel");
    if (c.errors.length) {
      this.over = true;
      ZV.ui.fail(this, "Ошибки в content/novel.json", c.errors);
      return;
    }
    this.data = c.data;
    this.rt = N.create(c.data);
    if (S.startNode && c.data.nodes[S.startNode]) this.rt.load({ node: S.startNode, vars: this.rt.vars });
    this.chaptersSeen = {};

    // Фон: цвет-заглушка и картинка поверх (видна, когда есть текстура).
    this.bgRect = this.add.rectangle(W / 2, H / 2, W, H, 0x101018).setDepth(-20);
    this.bgImage = this.add.image(W / 2, H / 2, "__DEFAULT").setDepth(-10).setVisible(false);

    // Портрет: заглушка-прямоугольник с подписью или картинка.
    this.portraitRect = this.add.rectangle(PORTRAIT.x, PORTRAIT.y, PORTRAIT.w, PORTRAIT.h, PALETTE[0]).setOrigin(0.5, 1).setDepth(1);
    this.portraitRect.setStrokeStyle(2, 0xffffff, 0.15);
    this.portraitLabel = ZV.ui.text(this, PORTRAIT.x, PORTRAIT.y - 20, "", { size: 1, color: "#e6e8f0" }).setOrigin(0.5).setDepth(2);
    this.portraitImage = this.add.image(PORTRAIT.x, PORTRAIT.y, "__DEFAULT").setOrigin(0.5, 1).setDepth(1).setVisible(false);

    // Панель реплики — тач-цель «дальше»/«показать целиком».
    this.panel = this.add.rectangle(PANEL.x + PANEL.w / 2, PANEL.y + PANEL.h / 2, PANEL.w, PANEL.h, 0x101018, 0.92)
      .setDepth(5).setInteractive({ useHandCursor: true });
    this.panel.setStrokeStyle(2, 0xffffff, 0.14);
    this.panel.on("pointerup", function () { tapPanel(self); });
    this.speakerText = ZV.ui.text(this, PANEL.x + 12, PANEL.y + 12, "", { size: 1, color: ZV.SECONDARY }).setDepth(6);
    this.bodyText = ZV.ui.text(this, PANEL.x + 12, PANEL.y + 32, "", { size: 1, color: "#e6e8f0", lineSpacing: 0 }).setDepth(6);
    this.nextHint = ZV.ui.text(this, PANEL.x + PANEL.w - 14, PANEL.y + PANEL.h - 14, "v", { size: 1, color: "#9aa0b5" })
      .setOrigin(1, 1).setDepth(6).setVisible(false);

    this.choices = ZV.ui.choices(this, {
      y: CHOICES.y, step: CHOICES.step, height: CHOICES.height, width: CHOICES.width,
      onPick: function (i) { pick(self, i); }
    }).setDepth(5);

    // Клавиатура для десктопа: пробел/Enter — дальше, 1–4 — вариант.
    if (this.input.keyboard) {
      this.input.keyboard.on("keydown-SPACE", function () { tapPanel(self); });
      this.input.keyboard.on("keydown-ENTER", function () { tapPanel(self); });
      [1, 2, 3, 4].forEach(function (n) {
        self.input.keyboard.on("keydown-" + (n === 1 ? "ONE" : n === 2 ? "TWO" : n === 3 ? "THREE" : "FOUR"), function () { pick(self, n - 1); });
      });
    }

    this.typing = false;
    this.typed = 0;
    this.full = "";
    this.typeAcc = 0;
    this.waitNext = 0;
    show(this);
  };

  PlayScene.prototype.update = function (time, delta) {
    if (this.over) return;
    if (this.typing) {
      if (S.typeMs <= 0) { this.typed = this.full.length; }
      else {
        this.typeAcc += delta;
        while (this.typeAcc >= S.typeMs && this.typed < this.full.length) { this.typeAcc -= S.typeMs; this.typed++; }
      }
      this.bodyText.setText(this.full.slice(0, this.typed));
      if (this.typed >= this.full.length) typed(this);
      return;
    }
    if (this.waitNext && time >= this.waitNext) { this.waitNext = 0; advance(this); }
  };

  // Показать текущий узел: фон, портрет, говорящий, реплика с печатью.
  function show(scene) {
    var ZV = global.ZV;
    var n = scene.rt.node();
    var id = scene.rt.id();
    setBackground(scene, n.bg);
    setPortrait(scene, n.portrait);
    scene.speakerText.setText(n.speaker || "");
    // Переносы считаем заранее по метрикам шрифта: печать по буквам не
    // перескакивает строками, когда слово дописывается.
    scene.full = ZV.font.wrap(n.text || "", TEXT_W, 1).join("\n");
    scene.typed = 0;
    scene.typeAcc = 0;
    scene.typing = true;
    scene.bodyText.setText("");
    scene.nextHint.setVisible(false);
    scene.choices.set([]);
    scene.waitNext = 0;
    // Глава — событие progress один раз на вход в узел-начало главы.
    var ch = scene.data.chapters || [];
    var ci = ch.indexOf(id);
    if (ci >= 0 && !scene.chaptersSeen[id]) {
      scene.chaptersSeen[id] = true;
      ZV.progress(scene, { step: ci + 1, total: ch.length, meta: { node: id } });
    }
  }

  // Реплика напечатана: показать варианты или подсказку «дальше».
  function typed(scene) {
    scene.typing = false;
    var rt = scene.rt;
    if (rt.ended()) { scene.nextHint.setVisible(true); return; }
    if (rt.linear()) {
      scene.nextHint.setVisible(true);
      if (S.autoNextMs > 0) scene.waitNext = scene.time.now + S.autoNextMs;
      return;
    }
    scene.choices.set(rt.choices().map(function (c) { return c.text; }));
  }

  function tapPanel(scene) {
    if (scene.over) return;
    if (scene.typing) {
      if (S.tapReveals) { scene.typed = scene.full.length; scene.bodyText.setText(scene.full); typed(scene); }
      return;
    }
    if (scene.rt.ended()) { finish(scene); return; }
    if (scene.rt.linear()) advance(scene);
  }

  function advance(scene) {
    if (scene.over || scene.typing) return;
    if (scene.rt.next()) show(scene);
  }

  function pick(scene, i) {
    if (scene.over || scene.typing) return;
    var list = scene.rt.choices();
    if (!list[i]) return;
    scene.choices.color(i, Phaser.Display.Color.HexStringToColor(global.ZV.PRIMARY).color);
    scene.choices.enabled = false;
    scene.time.delayedCall(180, function () {
      scene.choices.enabled = true;
      if (scene.rt.choose(i)) show(scene);
    });
  }

  function finish(scene) {
    var end = scene.rt.ended();
    if (!end) return;
    scene.over = true;
    global.ZV.finish(scene, {
      score: 0,
      hideScore: true,
      won: end.won !== false,
      title: end.title || "Конец",
      text: end.text || "",
      prize: end.prize || null,
      outcome: end.outcome,
      meta: { archetype: "novel", ending: end.outcome, steps: scene.rt.history.length, vars: scene.rt.vars }
    });
  }

  // Фон по ключу: картинка, если загружена, иначе цвет из палитры.
  function setBackground(scene, key) {
    var ZV = global.ZV, LAYOUT = global.ZV_LAYOUT;
    var tex = key ? "bg:" + key : "";
    if (tex && scene.textures.exists(tex) && !scene.failed[tex]) {
      var src = scene.textures.get(tex).getSourceImage();
      var fit = LAYOUT.fitBackground(src.width, src.height, ZV.WIDTH, ZV.HEIGHT, false);
      ZV.sprite.apply(scene.bgImage, { texture: tex, origin: false, scale: 1 });
      scene.bgImage.setVisible(true);
      if (fit && fit.mode === "cover") scene.bgImage.setDisplaySize(fit.width, fit.height);
      else if (fit) scene.bgImage.setScale(fit.scale);
      return;
    }
    scene.bgImage.setVisible(false);
    scene.bgRect.setFillStyle(key ? BG_PALETTE[hash(key) % BG_PALETTE.length] : 0x101018);
  }

  // Портрет по ключу: картинка целым масштабом или прямоугольник с подписью.
  function setPortrait(scene, key) {
    var tex = key ? "pt:" + key : "";
    if (!key) {
      scene.portraitRect.setVisible(false); scene.portraitLabel.setVisible(false); scene.portraitImage.setVisible(false);
      return;
    }
    if (scene.textures.exists(tex) && !scene.failed[tex]) {
      var src = scene.textures.get(tex).getSourceImage();
      var up = Math.max(1, Math.floor(Math.min(200 / src.width, 240 / src.height)));
      global.ZV.sprite.apply(scene.portraitImage, { texture: tex, scale: up });
      scene.portraitImage.setVisible(true);
      scene.portraitRect.setVisible(false); scene.portraitLabel.setVisible(false);
      return;
    }
    scene.portraitImage.setVisible(false);
    scene.portraitRect.setVisible(true).setFillStyle(PALETTE[hash(key) % PALETTE.length]);
    scene.portraitLabel.setVisible(true).setText(String(key).toUpperCase());
  }

  function hash(s) {
    var h = 7;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.novel = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
