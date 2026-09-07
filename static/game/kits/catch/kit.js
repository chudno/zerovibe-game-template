// Кит «Ловилка»: корзина ездит за пальцем внизу, сверху сыплются предметы.
// Хорошие ловим, плохие пропускаем. Раунд ограничен по времени.
// Картинки подставляются только через ZV.sprite.apply. Канва 360×640,
// пиксель-арт: масштаб спрайтов всегда 1.
(function (global) {
  "use strict";

  var S = {
    duration: 45000,     // длительность раунда, мс
    fallStart: 160,      // стартовая скорость падения, px/с
    fallMax: 410,        // потолок скорости
    fallStep: 6,         // прибавка за каждый пойманный предмет
    spawnStart: 900,     // пауза между предметами, мс
    spawnMin: 380,
    spawnStep: 20,
    badChance: 0.28,     // доля «плохих» предметов
    goodPoints: 1,       // очки за хороший
    badPenalty: 2,       // штраф за плохой
    misses: 5            // сколько хороших можно уронить
  };

  var BASKET_Y = 560;

  // Тела в единицах текстуры заглушек. Меняешь картинку — меняй эти числа.
  var BASKET_BODY = { bodyW: 84, bodyH: 28, offsetY: 4 };
  var ITEM_BODY = { bodyW: 20, bodyH: 20 };

  // Ловим предмет не только по overlap, но и по отрезку, пройденному за кадр:
  // при fallMax 410 px/с и просадке до 10 fps предмет проходит 41 px за кадр
  // и перепрыгивает корзину высотой 35 px. Отсюда «свип» в update.

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  // Картинки из config.assets, если они там есть; иначе заглушки-фигуры.
  PlayScene.prototype.preload = function () {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var items = a.items || {};
    var bg = a.background || {};

    loadOrStub(this, "basket", items.basket, 90, 32, 0x4f7cff);
    loadOrStub(this, "good", items.good, 22, 22, 0xffd23f);
    loadOrStub(this, "bad", items.bad, 22, 22, 0xff5f6d);

    this.bgTile = !!bg.tile;
    if (bg.url) this.load.image("bg", bg.url);
    this.load.on("loaderror", function (file) {
      if (file.key === "bg") this.bgFailed = true;
    }, this);
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var W = global.ZV.WIDTH, H = global.ZV.HEIGHT;
    var ZV = global.ZV;

    this.score = 0;
    this.missed = 0;
    this.fall = S.fallStart;
    this.spawnDelay = S.spawnStart;
    this.over = false;

    this.add.rectangle(W / 2, H / 2, W, H, 0x101018);
    drawBackground(this, W, H);

    this.basket = this.physics.add.sprite(W / 2, BASKET_Y, "basket");
    ZV.sprite.apply(this.basket, BASKET_BODY);
    this.basket.body.setAllowGravity(false);
    this.basket.setCollideWorldBounds(true);

    this.items = this.physics.add.group();
    this.physics.add.overlap(this.basket, this.items, function (basket, item) {
      catchItem(self, item);
    });

    this.scoreText = ZV.ui.text(this, W / 2, 60, "0", {
      fontSize: "40px", fontStyle: "bold"
    }).setOrigin(0.5).setDepth(5);
    this.livesText = ZV.ui.text(this, W / 2, 105, "промахи: 0/" + S.misses, {
      fontSize: "16px", color: "#9aa0b5"
    }).setOrigin(0.5).setDepth(5);
    this.timeText = ZV.ui.text(this, W - 20, 60, "", {
      fontSize: "16px", color: "#9aa0b5"
    }).setOrigin(1, 0.5).setDepth(5);

    // Корзина следует за пальцем; тап без движения тоже переставляет её.
    this.input.on("pointermove", function (p) { moveTo(self, p.x); });
    this.input.on("pointerdown", function (p) { moveTo(self, p.x); });

    this.timer = this.time.addEvent({ delay: this.spawnDelay, callback: function () { spawn(self); }, loop: true });
    this.deadline = this.time.now + S.duration;
  };

  PlayScene.prototype.update = function () {
    var self = this;
    if (this.over) return;

    var left = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.timeText.setText(left + " с");
    if (left <= 0) { finish(self, true); return; }

    this.items.getChildren().forEach(function (it) {
      if (sweptCatch(self, it)) return;
      if (it.y > global.ZV.HEIGHT + 30) {
        var wasGood = it.getData("good");
        it.destroy();
        if (wasGood) {
          self.missed += 1;
          self.livesText.setText("промахи: " + self.missed + "/" + S.misses);
          if (self.missed >= S.misses) finish(self, false);
        }
      }
    });
  };

  // Отрезок, пройденный предметом за кадр, против прямоугольника корзины:
  // ловит быстрый предмет, который overlap пропустил бы между кадрами.
  function sweptCatch(scene, it) {
    if (!it.active || !it.body) return false;
    var prev = it.getData("prevY");
    if (typeof prev !== "number") prev = it.y;
    it.setData("prevY", it.y);

    var box = scene.basket.body;
    var top = box.y, bottom = box.y + box.height;
    var crossed = (prev <= bottom && it.y >= top);
    if (!crossed) return false;
    var half = (it.body.width / 2) + box.width / 2;
    if (Math.abs(it.x - scene.basket.x) > half) return false;
    catchItem(scene, it);
    return true;
  }

  function moveTo(scene, x) {
    if (scene.over) return;
    // Целая координата: полпикселя мылит спрайт даже при pixelArt.
    scene.basket.x = Math.round(Phaser.Math.Clamp(x, 50, global.ZV.WIDTH - 50));
  }

  function spawn(scene) {
    if (scene.over) return;
    var good = Math.random() > S.badChance;
    var x = Phaser.Math.Between(45, global.ZV.WIDTH - 45);
    var it = scene.items.create(x, -30, good ? "good" : "bad");
    global.ZV.sprite.apply(it, { origin: false, bodyW: ITEM_BODY.bodyW, bodyH: ITEM_BODY.bodyH });
    it.setData("good", good);
    it.setData("prevY", it.y);
    it.body.setAllowGravity(false);
    it.setVelocityY(scene.fall);
  }

  function catchItem(scene, item) {
    if (scene.over) return;
    // Один предмет — одно начисление: overlap и свип могут совпасть в кадре.
    if (item.getData("taken")) return;
    item.setData("taken", true);
    var good = item.getData("good");
    item.destroy();
    if (good) {
      scene.score += S.goodPoints;
      scene.fall = Math.min(S.fallMax, scene.fall + S.fallStep);
      scene.spawnDelay = Math.max(S.spawnMin, scene.spawnDelay - S.spawnStep);
      scene.timer.delay = scene.spawnDelay;
    } else {
      scene.score = Math.max(0, scene.score - S.badPenalty);
      scene.cameras.main.shake(120, 0.006);
    }
    scene.scoreText.setText(String(scene.score));
  }

  function finish(scene, survived) {
    scene.over = true;
    scene.timer.remove();
    scene.physics.pause();
    global.ZV.finish(scene, {
      score: scene.score,
      won: survived && scene.score >= 20,
      text: "поймано",
      meta: { archetype: "catch", missed: scene.missed }
    });
  }

  // Фон: tileSprite только для текстуры со сторонами 64/128/256, иначе
  // обычная картинка с целым масштабом.
  function drawBackground(scene, W, H) {
    if (!scene.textures.exists("bg") || scene.bgFailed) return;
    var src = scene.textures.get("bg").getSourceImage();
    if (scene.bgTile && isPOT(src.width) && isPOT(src.height)) {
      scene.add.tileSprite(0, 0, W, H, "bg").setOrigin(0, 0).setDepth(-10);
    } else {
      var k = Math.max(1, Math.floor(Math.min(W / src.width, H / src.height)));
      scene.add.image(W / 2, H / 2, "bg").setScale(k).setDepth(-10);
    }
  }

  function isPOT(v) {
    return v > 0 && (v & (v - 1)) === 0;
  }

  function loadOrStub(scene, key, item, w, h, color) {
    if (item && item.url) {
      scene.load.image(key, item.url);
      return;
    }
    makeRect(scene, key, w, h, color);
  }

  function makeRect(scene, key, w, h, color) {
    if (scene.textures.exists(key)) return;
    var g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.catch = {
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
