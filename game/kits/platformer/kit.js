// Кит «Платформер»: герой ходит и прыгает по уровню из клеток, собирает
// монеты, обходит шипы, доходит до двери — следующий уровень. Уровни —
// текстовые карты в content/levels.json (разбор, проверка и солвер
// проходимости — game/levels.js). Физика: Arcade с fixedStep 1/60, тело героя
// всегда 22×48 — солвер считает ровно её. Канва 360×640: игровое поле 544 +
// панель кнопок 96 внизу; камера едет за героем целыми пикселями.
(function (global) {
  "use strict";

  var L = global.ZV_LEVELS;
  var TILE = L.TILE;

  // Настройки по умолчанию; правятся в config.params (те же ключи). Физика
  // берётся из пресета game/levels.js: солвер и кит обязаны считать одинаково.
  var DEFAULTS = {
    moveSpeed: L.PHYSICS.moveSpeed, // скорость бега, px/с
    gravity: L.PHYSICS.gravity,     // притяжение, px/с²
    jump: L.PHYSICS.jump,           // скорость прыжка (высота ≈ jump²/2g ≈ 114 px)
    maxFall: L.PHYSICS.maxFall,     // потолок падения; выше 900 тело пробивает тайл (tileBias 16 px/тик)
    coyoteMs: 80,                   // прыгнуть можно ещё столько мс после схода с края
    bufferMs: 100,                  // нажатие за столько мс до приземления сработает
    lives: 3,
    coinPoints: 10,
    levelBonus: 50,
    levelsPerRound: 0,              // 0 — все уровни файла
    startLevel: 1                   // с какого начинать (отладка)
  };
  var S = DEFAULTS;

  // Панель кнопок: три тач-цели 80×72 в нижних 96 px.
  var PAD = {
    left: { x: 16, y: 552, w: 84, h: 80 },
    right: { x: 108, y: 552, w: 84, h: 80 },
    jump: { x: 252, y: 552, w: 92, h: 80 }
  };

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  // Между уровнями сцена перезапускается с данными: уровень, счёт, жизни.
  PlayScene.prototype.init = function (data) {
    data = data || {};
    this.levelIndex = data.level || 0;
    this.score = data.score || 0;
    this.lives = typeof data.lives === "number" ? data.lives : -1;
    this.coinsGot = data.coins || 0;
    this.levelsDone = data.done || 0;
    this.fresh = typeof data.level !== "number";
  };

  PlayScene.prototype.preload = function () {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var hero = a.hero || {};
    var items = a.items || {};
    var bg = a.background || {};

    this.heroFrames = 2;
    if (hero.url && hero.frameWidth && hero.frameHeight) {
      this.load.spritesheet("hero", hero.url, { frameWidth: hero.frameWidth, frameHeight: hero.frameHeight });
      this.heroFrames = hero.frames || 1;
      this.heroFps = hero.fps || 10;
    } else {
      makeHeroSheet(this, "hero", L.HERO.w, L.HERO.h, 0x4f7cff);
    }
    loadOrStub(this, "ground", items.ground, makeGround);
    loadOrStub(this, "coin", items.coin, makeCoin);
    loadOrStub(this, "spike", items.spike, makeSpike);
    loadOrStub(this, "exit", items.exit, makeExit);
    makeArrows(this);

    this.bgTile = !!bg.tile;
    if (bg.url) this.load.image("bg", bg.url);
    this.load.on("loaderror", function (file) {
      if (file.key === "bg") this.bgFailed = true;
    }, this);

    global.ZV.loadContent(this, "levels");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;

    S = ZV.params(DEFAULTS);
    this.over = false;
    this.frozen = false;
    if (this.lives < 0) this.lives = S.lives;
    // Проверка данных с ТЕКУЩЕЙ физикой: параметры могли изменить прыжок.
    // levelsUnchecked — только автопрогон непроходимых уровней (tests/e2e).
    var TEST = global.ZV_TEST || {};
    var c = ZV.content(this, "levels", { physics: physics(), unchecked: !!TEST.levelsUnchecked });
    if (c.errors.length) {
      this.over = true;
      ZV.ui.fail(this, "Ошибки в content/levels.json", c.errors);
      return;
    }
    this.levels = c.data.levels.slice();
    if (S.levelsPerRound > 0) this.levels = this.levels.slice(0, S.levelsPerRound);
    if (this.fresh && S.startLevel > 1) this.levelIndex = Math.min(S.startLevel, this.levels.length) - 1;
    if (this.levelIndex >= this.levels.length) this.levelIndex = 0;

    var lv = this.levels[this.levelIndex];
    var parsed = L.parse(lv.map);
    this.level = parsed.level;
    var level = this.level;
    // Уровень ниже игрового поля прижимается к его низу; выше — камера едет.
    this.levelY0 = Math.max(0, L.PLAY_H - level.H);
    var y0 = this.levelY0;
    this.worldH = Math.max(H, y0 + level.H + L.BAR);

    this.add.rectangle(W / 2, H / 2, W, H, 0x101018).setScrollFactor(0).setDepth(-20);
    drawBackground(this, W, H);

    makeAnims(this);

    // Земля: тайловая карта из 2D-массива, индекс 1 = сплошная клетка
    // (firstgid 1 — тайлсет из одной картинки 32×32).
    var data = [];
    for (var r = 0; r < level.h; r++) {
      var row = [];
      for (var cc = 0; cc < level.w; cc++) row.push(level.solid[cc + r * level.w] ? 1 : -1);
      data.push(row);
    }
    this.map = this.make.tilemap({ data: data, tileWidth: TILE, tileHeight: TILE });
    var tiles = this.map.addTilesetImage("tiles", "ground", TILE, TILE, 0, 0, 1);
    this.layer = this.map.createLayer(0, tiles, 0, y0).setDepth(1);
    this.layer.setCollision(1);

    // Монеты, шипы, выход: невидимые зоны-тела точно по game/levels.js
    // (солвер считает те же прямоугольники) и картинки поверх.
    this.coins = this.physics.add.staticGroup();
    this.spikes = this.physics.add.staticGroup();
    this.exits = this.physics.add.staticGroup();
    level.coins.forEach(function (it) {
      var z = zone(self, it, L.BODIES.coin, y0);
      var sp = self.add.image(it.c * TILE + TILE / 2, y0 + it.r * TILE + TILE / 2, "coin").setDepth(2);
      z.setData("sprite", sp);
      self.coins.add(z);
    });
    level.spikes.forEach(function (it) {
      self.spikes.add(zone(self, it, L.BODIES.spike, y0));
      self.add.image(it.c * TILE + TILE / 2, y0 + (it.r + 1) * TILE, "spike").setOrigin(0.5, 1).setDepth(2);
    });
    level.exits.forEach(function (it) {
      self.exits.add(zone(self, it, L.BODIES.exit, y0));
      self.add.image(it.c * TILE + TILE / 2, y0 + (it.r + 1) * TILE, "exit").setOrigin(0.5, 1).setDepth(2);
    });

    // Герой: тело ровно 22×48 по ногам, какая бы картинка ни стояла.
    this.hero = this.physics.add.sprite(0, 0, "hero").setDepth(3);
    ZV.sprite.apply(this.hero, { anim: "idle", scale: 1, bodyW: L.HERO.w, bodyH: L.HERO.h });
    this.hero.body.setGravityY(S.gravity);
    this.hero.body.setMaxVelocityY(S.maxFall);
    this.physics.world.setBounds(0, 0, level.W, this.worldH + 400);
    this.physics.world.setBoundsCollision(true, true, false, false);
    this.hero.setCollideWorldBounds(true);
    this.spawnCount = 0;
    spawn(this);

    // Коллайдер с землёй раньше пересечений: так же упорядочен солвер.
    this.physics.add.collider(this.hero, this.layer);
    this.physics.add.overlap(this.hero, this.coins, function (hero, z) { collect(self, z); });
    this.physics.add.overlap(this.hero, this.spikes, function () { die(self); });
    this.physics.add.overlap(this.hero, this.exits, function () { levelDone(self); });

    // Камера: целые пиксели, герой в центре игрового поля (над панелью).
    var cam = this.cameras.main;
    cam.setBounds(0, 0, level.W, this.worldH);
    cam.startFollow(this.hero, true, 1, 1, 0, -(L.BAR / 2 - 24));

    // HUD и панель кнопок — прибиты к экрану.
    this.scoreText = ZV.ui.text(this, 20, 34, String(this.score), { size: 2 }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(20);
    this.lifeIcons = [];
    drawLives(this);
    ZV.ui.text(this, W / 2, 34, (this.levelIndex + 1) + "/" + this.levels.length, { size: 1, color: "#9aa0b5" })
      .setOrigin(0.5).setScrollFactor(0).setDepth(20);
    drawPad(this);
    banner(this, lv.name, lv.hint || "", 1400);

    this.pad = { dir: 0, jump: false };
    this.jumpHeld = false;
    this.lastGroundAt = -1e9;
    this.jumpPressedAt = -1e9;
    this.jumped = false;
    this.wasGrounded = true;
    this.keys = this.input.keyboard ? this.input.keyboard.addKeys("LEFT,RIGHT,UP,SPACE,A,D,W") : null;
  };

  PlayScene.prototype.update = function (time) {
    if (this.over || !this.hero) return;
    var ZV = global.ZV;
    var body = this.hero.body;
    if (this.frozen) { body.setVelocityX(0); return; }

    // Ввод: панель кнопок, клавиатура; бот автопрогона подменяет всё сразу.
    var pad = this.botPad || readPad(this);
    var grounded = body.blocked.down || body.touching.down;
    if (grounded) this.lastGroundAt = time;

    body.setVelocityX(pad.dir * S.moveSpeed);
    if (pad.dir) this.hero.setFlipX(pad.dir < 0);

    var pressed = pad.jump && !this.jumpHeld;
    this.jumpHeld = !!pad.jump;
    if (pressed) this.jumpPressedAt = time;
    var wantJump = time - this.jumpPressedAt <= S.bufferMs;
    var canJump = grounded || (!this.jumped && time - this.lastGroundAt <= S.coyoteMs);
    if (wantJump && canJump) {
      body.setVelocityY(-S.jump);
      this.jumped = true;
      this.jumpPressedAt = -1e9;
      ZV.sprite.playAnim(this.hero, "jump", false);
      ZV.juice.stretch(this, this.hero, null, 50);
    }
    if (grounded && !this.wasGrounded && body.velocity.y >= 0) {
      this.jumped = false;
      ZV.juice.squash(this, this.hero, null, 50);
      ZV.juice.dust(this, this.hero.x, this.hero.y, 0x6b7390);
    }
    this.wasGrounded = grounded;

    if (grounded) ZV.sprite.playAnim(this.hero, pad.dir ? "run" : "idle", true);
    else ZV.sprite.playAnim(this.hero, "jump", true);

    // Улетел за низ карты — гибель.
    if (body.y > this.levelY0 + this.level.H + 64) die(this);

    if (this.bgFar) this.bgFar.tilePositionX = Math.floor(this.cameras.main.scrollX * 0.3);
  };

  function physics() {
    return { moveSpeed: S.moveSpeed, gravity: S.gravity, jump: S.jump, maxFall: S.maxFall };
  }

  // Зона-тело клетки: центр по прямоугольнику из L.BODIES.
  function zone(scene, it, b, y0) {
    var z = scene.add.zone(it.c * TILE + b.x + b.w / 2, y0 + it.r * TILE + b.y + b.h / 2, b.w, b.h);
    scene.physics.add.existing(z, true);
    return z;
  }

  // Поставить тело героя левым верхом в точку карты (x, y).
  function placeBody(scene, x, y) {
    var h = scene.hero, b = h.body;
    b.reset(x + h.displayOriginX - b.offset.x, y + scene.levelY0 + h.displayOriginY - b.offset.y);
    b.setVelocity(0, 0);
  }

  function spawn(scene) {
    var st = scene.level.start;
    placeBody(scene, st.c * TILE + (TILE - L.HERO.w) / 2, (st.r + 1) * TILE - L.HERO.h);
    scene.hero.body.enable = true;
    scene.hero.setVisible(true);
    scene.jumped = false;
    scene.wasGrounded = true;
    scene.spawnCount++;
  }

  function collect(scene, z) {
    if (scene.over || scene.frozen || !z.active) return;
    var sp = z.getData("sprite");
    if (sp) sp.destroy();
    z.destroy();
    scene.score += S.coinPoints;
    scene.coinsGot += 1;
    scene.scoreText.setText(String(scene.score));
  }

  function die(scene) {
    if (scene.over || scene.frozen) return;
    scene.frozen = true;
    scene.lives -= 1;
    drawLives(scene);
    scene.cameras.main.shake(160, 0.008);
    scene.hero.body.enable = false;
    if (scene.lives <= 0) { finish(scene, false); return; }
    scene.hero.setVisible(false);
    scene.time.delayedCall(600, function () {
      if (scene.over) return;
      spawn(scene);
      scene.frozen = false;
    });
  }

  function levelDone(scene) {
    if (scene.over || scene.frozen) return;
    scene.frozen = true;
    scene.hero.body.enable = false;
    scene.score += S.levelBonus;
    scene.scoreText.setText(String(scene.score));
    scene.levelsDone += 1;
    global.ZV.progress(scene, { step: scene.levelsDone, total: scene.levels.length, meta: { level: scene.levelIndex + 1 } });
    var last = scene.levelIndex + 1 >= scene.levels.length;
    banner(scene, "Уровень пройден", "", 900);
    scene.time.delayedCall(900, function () {
      if (scene.over) return;
      if (last) { finish(scene, true); return; }
      scene.scene.restart({ level: scene.levelIndex + 1, score: scene.score, lives: scene.lives, coins: scene.coinsGot, done: scene.levelsDone });
    });
  }

  function finish(scene, won) {
    scene.over = true;
    scene.physics.pause();
    global.ZV.finish(scene, {
      score: scene.score,
      won: won,
      text: "очков",
      meta: { archetype: "platformer", levels: scene.levelsDone, total: scene.levels.length, coins: scene.coinsGot }
    });
  }

  // Жизни — квадратики 12×12 в правом верхнем углу (целые размеры).
  function drawLives(scene) {
    scene.lifeIcons.forEach(function (r) { r.destroy(); });
    scene.lifeIcons = [];
    for (var i = 0; i < Math.min(9, Math.max(0, scene.lives)); i++) {
      scene.lifeIcons.push(scene.add.rectangle(global.ZV.WIDTH - 26 - i * 18, 34, 12, 12, 0xff5f6d)
        .setScrollFactor(0).setDepth(20));
    }
  }

  // Ввод с панели кнопок (все активные указатели) и клавиатуры.
  function readPad(scene) {
    var dir = 0, jump = false;
    var ptrs = scene.input.manager.pointers;
    for (var i = 0; i < ptrs.length; i++) {
      var p = ptrs[i];
      if (!p || !p.isDown) continue;
      if (inside(p, PAD.left)) dir = -1;
      else if (inside(p, PAD.right)) dir = 1;
      else if (inside(p, PAD.jump)) jump = true;
    }
    var k = scene.keys;
    if (k) {
      if (k.LEFT.isDown || k.A.isDown) dir = -1;
      else if (k.RIGHT.isDown || k.D.isDown) dir = 1;
      if (k.UP.isDown || k.SPACE.isDown || k.W.isDown) jump = true;
    }
    return { dir: dir, jump: jump };
  }
  function inside(p, z) {
    return p.x >= z.x && p.x < z.x + z.w && p.y >= z.y && p.y < z.y + z.h;
  }

  // Панель: полупрозрачная полоса и три кнопки со стрелками (целые размеры).
  function drawPad(scene) {
    var W = global.ZV.WIDTH, H = global.ZV.HEIGHT;
    scene.add.rectangle(W / 2, H - L.BAR / 2, W, L.BAR, 0x101018, 0.6).setScrollFactor(0).setDepth(18);
    [["left", 0], ["right", 1], ["jump", 2]].forEach(function (it) {
      var z = PAD[it[0]];
      scene.add.rectangle(z.x + z.w / 2, z.y + z.h / 2, z.w, z.h, 0x2a2f45, 0.9)
        .setScrollFactor(0).setDepth(19).setStrokeStyle(2, 0xffffff, 0.12);
      scene.add.image(z.x + z.w / 2, z.y + z.h / 2, "arrows", it[1]).setScrollFactor(0).setDepth(20);
    });
  }

  // Подпись уровня поверх поля на ms миллисекунд.
  function banner(scene, title, hint, ms) {
    var ZV = global.ZV;
    var t = ZV.ui.title(scene, ZV.WIDTH / 2, 200, title, 32).setScrollFactor(0).setDepth(30);
    var h = hint ? ZV.ui.hint(scene, ZV.WIDTH / 2, 250, hint).setScrollFactor(0).setDepth(30) : null;
    scene.time.delayedCall(ms, function () { t.destroy(); if (h) h.destroy(); });
  }

  // Фон прибит к экрану; тайловый едет за камерой втрое медленнее.
  function drawBackground(scene, W, H) {
    if (!scene.textures.exists("bg") || scene.bgFailed) return false;
    var src = scene.textures.get("bg").getSourceImage();
    var fit = global.ZV_LAYOUT.fitBackground(src.width, src.height, W, H, scene.bgTile);
    if (!fit) return false;
    if (fit.mode === "tile") {
      scene.bgFar = scene.add.tileSprite(0, 0, W, H, "bg").setOrigin(0, 0).setScrollFactor(0).setDepth(-10);
      return true;
    }
    var img = scene.add.image(W / 2, H / 2, "bg").setScrollFactor(0).setDepth(-10);
    if (fit.mode === "cover") img.setDisplaySize(fit.width, fit.height);
    else img.setScale(fit.scale);
    return true;
  }

  function makeAnims(scene) {
    var tex = scene.textures.get("hero");
    var src = tex && tex.getSourceImage ? tex.getSourceImage() : null;
    var f0 = tex && tex.get ? tex.get(0) : null;
    var grid = (src && f0) ? global.ZV_LAYOUT.sheetGrid(src.width, src.height, f0.width, f0.height) : null;
    scene.heroFrames = global.ZV_LAYOUT.animFrames(scene.heroFrames, grid);
    var last = Math.max(0, scene.heroFrames - 1);
    if (!scene.anims.exists("run")) {
      scene.anims.create({
        key: "run",
        frames: scene.anims.generateFrameNumbers("hero", { start: 0, end: last }),
        frameRate: scene.heroFps || 10, repeat: -1
      });
    }
    if (!scene.anims.exists("idle")) {
      scene.anims.create({ key: "idle", frames: [{ key: "hero", frame: 0 }], frameRate: 1, repeat: -1 });
    }
    if (!scene.anims.exists("jump")) {
      scene.anims.create({ key: "jump", frames: [{ key: "hero", frame: Math.min(1, last) }], frameRate: 1, repeat: -1 });
    }
  }

  // --- заглушки ---------------------------------------------------------------
  function loadOrStub(scene, key, item, stub) {
    if (item && item.url) { scene.load.image(key, item.url); return; }
    stub(scene, key);
  }
  function gfx(scene) { return scene.make.graphics({ x: 0, y: 0, add: false }); }

  function makeHeroSheet(scene, key, w, h, color) {
    if (scene.textures.exists(key)) return;
    var g = gfx(scene);
    g.fillStyle(color, 1); g.fillRect(0, 0, w, h);
    g.fillStyle(0xffffff, 0.85); g.fillRect(Math.round(w * 0.6), Math.round(h * 0.2), 4, 4);
    g.fillStyle(color, 1); g.fillRect(w + 2, 4, w - 4, h - 4);
    g.fillStyle(0xffffff, 0.85); g.fillRect(w + 2 + Math.round((w - 4) * 0.6), 4 + Math.round((h - 4) * 0.2), 4, 4);
    g.generateTexture(key, w * 2, h);
    g.destroy();
    var tex = scene.textures.get(key);
    tex.add(0, 0, 0, 0, w, h);
    tex.add(1, 0, w, 0, w, h);
  }
  function makeGround(scene, key) {
    if (scene.textures.exists(key)) return;
    var g = gfx(scene);
    g.fillStyle(0x2a2f45, 1); g.fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x3c4360, 1); g.fillRect(0, 0, TILE, 3);
    g.fillStyle(0x1b1f33, 1); g.fillRect(6, 14, 6, 4); g.fillRect(20, 22, 6, 4);
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }
  function makeCoin(scene, key) {
    if (scene.textures.exists(key)) return;
    var g = gfx(scene);
    g.fillStyle(0xffd23f, 1); g.fillRect(2, 0, 12, 16); g.fillRect(0, 2, 16, 12);
    g.fillStyle(0xd9a100, 1); g.fillRect(6, 4, 4, 8);
    g.generateTexture(key, 16, 16);
    g.destroy();
  }
  function makeSpike(scene, key) {
    if (scene.textures.exists(key)) return;
    var g = gfx(scene);
    g.fillStyle(0xff5f6d, 1);
    for (var i = 0; i < 3; i++) g.fillTriangle(2 + i * 10, 32, 7 + i * 10, 14, 12 + i * 10, 32);
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }
  function makeExit(scene, key) {
    if (scene.textures.exists(key)) return;
    var g = gfx(scene);
    g.fillStyle(0x2e9e5b, 1); g.fillRect(4, 0, 24, 32);
    g.fillStyle(0x101018, 1); g.fillRect(10, 8, 12, 24);
    g.fillStyle(0xffd23f, 1); g.fillRect(18, 20, 3, 3);
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }
  // Стрелки кнопок: три кадра 24×24 — влево, вправо, вверх.
  function makeArrows(scene) {
    if (scene.textures.exists("arrows")) return;
    var g = gfx(scene);
    g.fillStyle(0xffffff, 0.9);
    g.fillTriangle(18, 2, 18, 22, 4, 12);
    g.fillTriangle(24 + 6, 2, 24 + 6, 22, 24 + 20, 12);
    g.fillTriangle(48 + 2, 18, 48 + 22, 18, 48 + 12, 4);
    g.generateTexture("arrows", 72, 24);
    g.destroy();
    var tex = scene.textures.get("arrows");
    tex.add(0, 0, 0, 0, 24, 24);
    tex.add(1, 0, 24, 0, 24, 24);
    tex.add(2, 0, 48, 0, 24, 24);
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.platformer = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
