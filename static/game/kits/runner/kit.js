// Кит «Бегун»: герой бежит по дорожке, тап — прыжок, препятствия набегают
// всё быстрее. Всё рисуется фигурами — вместо них подставляются спрайты.
(function (global) {
  "use strict";

  // Настройки раунда: здесь крутится сложность.
  var S = {
    gravity: 5200,       // притяжение (выше — падение резче и прыжок короче)
    jump: 1700,          // прыжок: высота ~280 px, полёт ~0,65 с
    speedStart: 380,     // стартовая скорость препятствий, px/с
    speedMax: 1000,      // потолок скорости
    speedStep: 18,       // прибавка скорости за каждое пройденное препятствие
    spawnStart: 1500,    // пауза между препятствиями, мс
    spawnMin: 620,       // минимальная пауза
    spawnStep: 45,       // на сколько сокращается пауза за препятствие
    lives: 1             // столкновений до конца раунда
  };

  var GROUND_Y = 980;    // высота дорожки на канве 720×1280

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  // Заглушки. Чтобы поставить настоящие картинки — заменить на
  // this.load.image("hero", "<url файла проекта>") и убрать генерацию.
  PlayScene.prototype.preload = function () {
    makeRect(this, "hero", 84, 110, 0x4f7cff);
    makeRect(this, "block", 70, 72, 0xff5f6d);      // низкое препятствие
    makeRect(this, "blockTall", 70, 132, 0xff5f6d); // высокое
    makeRect(this, "ground", 8, 8, 0x2a2f45);
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var W = global.ZV.WIDTH, H = global.ZV.HEIGHT;

    this.score = 0;
    this.lives = S.lives;
    this.speed = S.speedStart;
    this.spawnDelay = S.spawnStart;
    this.over = false;

    this.add.rectangle(W / 2, H / 2, W, H, 0x101018);
    this.add.rectangle(W / 2, GROUND_Y + 60, W, 240, 0x1b1f33);

    this.hero = this.physics.add.sprite(160, GROUND_Y - 60, "hero");
    this.hero.body.setGravityY(S.gravity);
    this.hero.setCollideWorldBounds(true);

    // Пол — невидимая статичная полоса под героем.
    this.floor = this.physics.add.staticImage(W / 2, GROUND_Y + 14, "ground");
    this.floor.setDisplaySize(W, 28).refreshBody();
    this.physics.add.collider(this.hero, this.floor);

    this.blocks = this.physics.add.group({ allowGravity: false });
    this.physics.add.overlap(this.hero, this.blocks, function (hero, block) {
      block.destroy();
      self.lives -= 1;
      self.cameras.main.shake(160, 0.008);
      if (self.lives <= 0) finish(self);
    });

    this.scoreText = this.add.text(W / 2, 120, "0", {
      fontFamily: "system-ui, sans-serif", fontSize: "88px", color: "#ffffff", fontStyle: "bold"
    }).setOrigin(0.5).setDepth(5);
    global.ZV.ui.hint(this, W / 2, 220, "Тап — прыжок");

    this.input.on("pointerup", function () { jump(self); });

    this.timer = this.time.addEvent({ delay: this.spawnDelay, callback: function () { spawn(self); }, loop: true });
  };

  PlayScene.prototype.update = function () {
    var self = this;
    if (this.over) return;
    this.blocks.getChildren().forEach(function (b) {
      if (b.x < -100) {
        b.destroy();
        self.score += 1;
        self.scoreText.setText(String(self.score));
        // Нарастающая сложность: быстрее и чаще.
        self.speed = Math.min(S.speedMax, self.speed + S.speedStep);
        self.spawnDelay = Math.max(S.spawnMin, self.spawnDelay - S.spawnStep);
        self.timer.delay = self.spawnDelay;
      }
    });
  };

  function jump(scene) {
    if (scene.over) return;
    if (scene.hero.body.blocked.down || scene.hero.body.touching.down) {
      scene.hero.setVelocityY(-S.jump);
    }
  }

  function spawn(scene) {
    if (scene.over) return;
    // Две готовые текстуры вместо растягивания одной: масштаб спрайта
    // множится на размер тела, и хитбокс перестаёт совпадать с картинкой.
    var tall = Math.random() < 0.3;
    var h = tall ? 132 : 72;
    var b = scene.blocks.create(global.ZV.WIDTH + 80, GROUND_Y - h / 2, tall ? "blockTall" : "block");
    b.setVelocityX(-scene.speed);
  }

  function finish(scene) {
    scene.over = true;
    scene.timer.remove();
    scene.physics.pause();
    global.ZV.finish(scene, {
      score: scene.score,
      won: scene.score >= 15,
      text: "препятствий пройдено",
      meta: { archetype: "runner" }
    });
  }

  // Заглушка-прямоугольник как текстура: убирается вместе с приходом спрайтов.
  function makeRect(scene, key, w, h, color) {
    if (scene.textures.exists(key)) return;
    var g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRoundedRect(0, 0, w, h, 10);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.runner = {
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
