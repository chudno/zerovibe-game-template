// Кит «Ловилка»: корзина ездит за пальцем внизу, сверху сыплются предметы.
// Хорошие ловим, плохие пропускаем. Раунд ограничен по времени.
(function (global) {
  "use strict";

  var S = {
    duration: 45000,     // длительность раунда, мс
    fallStart: 320,      // стартовая скорость падения, px/с
    fallMax: 820,        // потолок скорости
    fallStep: 12,        // прибавка за каждый пойманный предмет
    spawnStart: 900,     // пауза между предметами, мс
    spawnMin: 380,
    spawnStep: 20,
    badChance: 0.28,     // доля «плохих» предметов
    goodPoints: 1,       // очки за хороший
    badPenalty: 2,       // штраф за плохой
    misses: 5            // сколько хороших можно уронить
  };

  var BASKET_Y = 1120;

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  // Заглушки: заменяются на this.load.image("basket", "<url>") и т.д.
  PlayScene.prototype.preload = function () {
    makeRect(this, "basket", 180, 70, 0x4f7cff);
    makeCircle(this, "good", 44, 0xffd23f);
    makeCircle(this, "bad", 44, 0xff5f6d);
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var W = global.ZV.WIDTH, H = global.ZV.HEIGHT;

    this.score = 0;
    this.missed = 0;
    this.fall = S.fallStart;
    this.spawnDelay = S.spawnStart;
    this.over = false;

    this.add.rectangle(W / 2, H / 2, W, H, 0x101018);

    this.basket = this.physics.add.image(W / 2, BASKET_Y, "basket");
    this.basket.body.setAllowGravity(false);
    this.basket.setCollideWorldBounds(true);

    this.items = this.physics.add.group();
    this.physics.add.overlap(this.basket, this.items, function (basket, item) {
      catchItem(self, item);
    });

    this.scoreText = this.add.text(W / 2, 120, "0", {
      fontFamily: "system-ui, sans-serif", fontSize: "88px", color: "#ffffff", fontStyle: "bold"
    }).setOrigin(0.5).setDepth(5);
    this.livesText = this.add.text(W / 2, 210, "промахи: 0/" + S.misses, {
      fontFamily: "system-ui, sans-serif", fontSize: "34px", color: "#9aa0b5"
    }).setOrigin(0.5).setDepth(5);
    this.timeText = this.add.text(W - 40, 120, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "40px", color: "#9aa0b5"
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
      if (it.y > global.ZV.HEIGHT + 60) {
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

  function moveTo(scene, x) {
    if (scene.over) return;
    scene.basket.x = Phaser.Math.Clamp(x, 100, global.ZV.WIDTH - 100);
  }

  function spawn(scene) {
    if (scene.over) return;
    var good = Math.random() > S.badChance;
    var x = Phaser.Math.Between(90, global.ZV.WIDTH - 90);
    var it = scene.items.create(x, -60, good ? "good" : "bad");
    it.setData("good", good);
    it.body.setAllowGravity(false);
    it.setVelocityY(scene.fall);
  }

  function catchItem(scene, item) {
    if (scene.over) return;
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

  function makeRect(scene, key, w, h, color) {
    if (scene.textures.exists(key)) return;
    var g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRoundedRect(0, 0, w, h, 12);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  function makeCircle(scene, key, d, color) {
    if (scene.textures.exists(key)) return;
    var g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillCircle(d / 2, d / 2, d / 2);
    g.generateTexture(key, d, d);
    g.destroy();
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.catch = {
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
