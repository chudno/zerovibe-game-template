// Кит «Бегун»: герой бежит по дорожке, тап — прыжок, препятствия набегают
// всё быстрее. Картинки подставляются только через ZV.sprite.apply — он один
// знает, как вернуть телу размер после смены текстуры или кадра анимации.
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

  var GROUND_Y = 980;    // верх дорожки на канве 720×1280

  // Тело героя в единицах текстуры заглушки (84×110). Меняя картинку,
  // меняй эти числа — и только их: остальное сделает ZV.sprite.apply.
  var HERO_BODY = { bodyW: 64, bodyH: 100, scale: 1 };

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  // Заглушки. Чтобы поставить настоящие картинки — см. README кита.
  PlayScene.prototype.preload = function () {
    makeHeroSheet(this, "hero", 84, 110, 0x4f7cff);
    makeRect(this, "block", 70, 72, 0xff5f6d);      // низкое препятствие
    makeRect(this, "blockTall", 70, 132, 0xff5f6d); // высокое
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var W = global.ZV.WIDTH, H = global.ZV.HEIGHT;
    var ZV = global.ZV;

    this.score = 0;
    this.lives = S.lives;
    this.speed = S.speedStart;
    this.spawnDelay = S.spawnStart;
    this.over = false;
    this.airborne = false;

    this.add.rectangle(W / 2, H / 2, W, H, 0x101018);
    this.add.rectangle(W / 2, GROUND_Y + 120, W, 240, 0x1b1f33);

    makeAnims(this);

    // Пол: видимая полоска 28 px, тело уходит вниз на ZV.FLOOR_DEPTH.
    this.floor = ZV.floor(this, W / 2, GROUND_Y, W, 28, 0x2a2f45);

    this.hero = this.physics.add.sprite(160, GROUND_Y, "hero").setDepth(3);
    ZV.sprite.apply(this.hero, { anim: "run", bodyW: HERO_BODY.bodyW, bodyH: HERO_BODY.bodyH, scale: HERO_BODY.scale });
    this.hero.body.setGravityY(S.gravity);
    this.hero.setCollideWorldBounds(true);
    // Дорожка тёмная — чёрная тень на ней не читается, берём светлое пятно.
    this.shadow = ZV.juice.shadow(this, this.hero, GROUND_Y + 8, 96, { color: 0x000000, alpha: 0.45 });
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
    ZV.ui.hint(this, W / 2, 220, "Тап — прыжок");

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

    if (this.shadow && this.shadow.zvFollow) this.shadow.zvFollow();

    var onGround = this.hero.body.blocked.down || this.hero.body.touching.down;
    if (onGround && this.airborne) land(this);
    this.airborne = !onGround;

    // Наклон в полёте: вперёд на взлёте, назад на падении.
    var target = onGround ? 0 : Phaser.Math.Clamp(this.hero.body.velocity.y / 220, -8, 10);
    this.hero.setAngle(Phaser.Math.Linear(this.hero.angle, target, 0.2));

    updateAnim(this, onGround);
  };

  // Темп ног привязан к скорости мира: медленный мир — медленный бег.
  function updateAnim(scene, onGround) {
    var key = onGround ? "run" : "jump";
    global.ZV.sprite.playAnim(scene.hero, key, true);
    var a = scene.hero.anims;
    if (onGround && a && a.currentAnim) {
      a.msPerFrame = 1000 / Phaser.Math.Clamp(scene.speed / 40, 6, 16);
    }
  }

  function jump(scene) {
    if (scene.over) return;
    if (scene.hero.body.blocked.down || scene.hero.body.touching.down) {
      scene.hero.setVelocityY(-S.jump);
      global.ZV.juice.stretch(scene, scene.hero, 0.14, 90);
      global.ZV.sprite.playAnim(scene.hero, "jump", false);
    }
  }

  function land(scene) {
    global.ZV.juice.squash(scene, scene.hero, 0.18, 80);
    global.ZV.juice.dust(scene, scene.hero.x - 10, GROUND_Y, 0x6b7390);
  }

  function spawn(scene) {
    if (scene.over) return;
    // Две готовые текстуры вместо растягивания одной: масштаб спрайта
    // множится на размер тела, и хитбокс перестаёт совпадать с картинкой.
    var tall = Math.random() < 0.3;
    var b = scene.blocks.create(global.ZV.WIDTH + 80, GROUND_Y, tall ? "blockTall" : "block");
    global.ZV.sprite.apply(b, {});   // якорь по низу + тело по кадру
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

  // Анимации есть с самого начала: агенту остаётся заменить кадры, а не
  // изобретать анимацию. Ключи run/jump/idle менять не нужно.
  function makeAnims(scene) {
    if (!scene.anims.exists("run")) {
      scene.anims.create({
        key: "run",
        frames: scene.anims.generateFrameNumbers("hero", { start: 0, end: 1 }),
        frameRate: 10, repeat: -1
      });
    }
    if (!scene.anims.exists("idle")) {
      scene.anims.create({ key: "idle", frames: [{ key: "hero", frame: 0 }], frameRate: 1, repeat: -1 });
    }
    if (!scene.anims.exists("jump")) {
      scene.anims.create({ key: "jump", frames: [{ key: "hero", frame: 1 }], frameRate: 1, repeat: -1 });
    }
  }

  // Заглушка-спрайтлист героя: два кадра, второй чуть присел и сдвинут —
  // этого хватает, чтобы бег читался ещё до настоящих картинок.
  function makeHeroSheet(scene, key, w, h, color) {
    if (scene.textures.exists(key)) return;
    var g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRoundedRect(0, 0, w, h, 12);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(w * 0.62, h * 0.26, 7);
    g.fillStyle(color, 1);
    g.fillRoundedRect(w + 3, 6, w - 6, h - 6, 12);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(w + 3 + (w - 6) * 0.62, 6 + (h - 6) * 0.26, 7);
    g.generateTexture(key, w * 2, h);
    g.destroy();
    var tex = scene.textures.get(key);
    tex.add(0, 0, 0, 0, w, h);
    tex.add(1, 0, w, 0, w, h);
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
