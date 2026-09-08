// Кит «Бегун»: герой бежит по дорожке, тап — прыжок, препятствия набегают
// всё быстрее. Картинки подставляются только через ZV.sprite.apply — он один
// знает, как вернуть телу размер после смены текстуры или кадра анимации.
// Канва 360×640, пиксель-арт: масштаб спрайтов всегда 1.
(function (global) {
  "use strict";

  // Настройки раунда по умолчанию: здесь крутится сложность. Все числа — в
  // единицах канвы 360×640. Правятся НЕ здесь, а в config.params (те же
  // ключи); S собирается в create через ZV.params.
  var DEFAULTS = {
    gravity: 2600,       // притяжение (выше — падение резче и прыжок короче)
    jump: 850,           // прыжок: высота ~139 px, полёт ~0,65 с
    speedStart: 190,     // стартовая скорость препятствий, px/с
    speedMax: 500,       // потолок скорости (реакция ≥ 250 мс проверяется game/balance.test.js)
    speedStep: 9,        // прибавка скорости за каждое пройденное препятствие
    spawnStart: 1500,    // пауза между препятствиями, мс
    spawnMin: 900,       // минимальная пауза ≥ 1.35 полёта (0,65 с), иначе пары непроходимы
    spawnStep: 45,       // на сколько сокращается пауза за препятствие
    tallChance: 0.3,     // доля высоких препятствий
    lives: 1,            // столкновений до конца раунда
    passScore: 15        // препятствий для победы
  };
  var S = DEFAULTS;

  var GROUND_Y = 490;    // верх дорожки на канве 360×640
  var TILE = 32;         // тайл земли: сторона степень двойки — можно tileSprite

  // Тело героя. По умолчанию его считает ZV.sprite.apply по непрозрачной
  // области первого кадра — для пиксель-арта с прозрачными полями это
  // единственный способ поставить ноги на землю. Числа нужны только чтобы
  // сузить хитбокс: bodyW/bodyH/offsetY из config.assets.hero перебивают
  // автообрезку. Заглушка 32×50 полей не имеет — ей автообрезка не мешает.

  // Кадры анимации бега у заглушки; с настоящим листом их число берётся из
  // config.assets.hero.frames.
  var STUB_FRAMES = 2;

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  // Картинки из config.assets, если они там есть; иначе заглушки-фигуры.
  PlayScene.prototype.preload = function () {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var hero = a.hero || {};
    var items = a.items || {};
    var bg = a.background || {};

    this.heroFrames = STUB_FRAMES;
    if (hero.url && hero.frameWidth && hero.frameHeight) {
      // frameWidth/frameHeight — из ответа asset_generate, не на глаз.
      this.load.spritesheet("hero", hero.url,
        { frameWidth: hero.frameWidth, frameHeight: hero.frameHeight });
      this.heroFrames = hero.frames || 1;
      this.heroFps = hero.fps || 10;
    } else {
      makeHeroSheet(this, "hero", 32, 50, 0x4f7cff);
    }

    loadOrStub(this, "block", items.block, 32, 32, 0xff5f6d);
    loadOrStub(this, "blockTall", items.blockTall, 32, 60, 0xff5f6d);
    loadOrStub(this, "ground", items.ground, TILE, TILE, 0x2a2f45);

    this.bgTile = !!bg.tile;
    if (bg.url) this.load.image("bg", bg.url);

    // Картинка не загрузилась — играем на заглушке, а не на пустом экране.
    this.load.on("loaderror", function (file) {
      if (file.key === "bg") this.bgFailed = true;
    }, this);
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var W = global.ZV.WIDTH, H = global.ZV.HEIGHT;
    var ZV = global.ZV, ZV_LAYOUT = global.ZV_LAYOUT;

    S = ZV.params(DEFAULTS);
    this.score = 0;
    this.lives = S.lives;
    this.speed = S.speedStart;
    this.spawnDelay = S.spawnStart;
    this.over = false;
    this.airborne = false;

    // Заливка — подложка на случай, если фон не перекроет её целиком.
    // depth -20 обязателен: у фона -10, а без явной глубины заливка (depth 0)
    // рисуется ПОСЛЕ него и закрашивает картинку целиком.
    this.add.rectangle(W / 2, H / 2, W, H, 0x101018).setDepth(-20);
    var hasBg = drawBackground(this, W, H);
    // Заглушка земли идёт ТОЛЬКО без фона: поверх настоящей картинки она
    // закрывала нарисованную улицу глухим прямоугольником.
    if (!hasBg) this.add.rectangle(W / 2, GROUND_Y + 75, W, 150, 0x1b1f33);

    makeAnims(this);

    // Дорожка всегда во всю ширину канвы: tileSprite сам размножает тайл
    // 32 px, какого бы размера ни была текстура. Координаты целые.
    // С настоящим фоном дорога уже нарисована — своя полоска остаётся лишь
    // как еле заметный слой движения (или гасится ground:{visible:false}).
    var groundCfg = ((global.ZV_GAME && global.ZV_GAME.assets) || {}).ground || {};
    var showRoad = groundCfg.visible !== false;
    if (showRoad) {
      this.road = this.add.tileSprite(0, GROUND_Y, W, TILE, "ground")
        .setOrigin(0, 0).setDepth(1);
      if (hasBg) this.road.setAlpha(0.35);   // не перекрывать дорогу фона
    }
    this.roadX = 0;

    // Пол: тело уходит вниз на ZV.FLOOR_DEPTH, видимую полоску рисует дорожка.
    this.floor = ZV.floor(this, W / 2, GROUND_Y, W, 0, 0x2a2f45);

    // Стартуем стоя на земле — значит анимация бега, а не прыжка.
    this.hero = this.physics.add.sprite(80, GROUND_Y, "hero").setDepth(3);
    var heroCfg = ((global.ZV_GAME && global.ZV_GAME.assets) || {}).hero || {};
    ZV.sprite.apply(this.hero, {
      anim: "run", scale: 1,
      // Пусто — тело считается по непрозрачной области первого кадра.
      // bodyW/bodyH/offsetY в config.assets.hero перебивают автообрезку:
      // нужны, только если хочется хитбокс уже силуэта.
      bodyW: heroCfg.bodyW, bodyH: heroCfg.bodyH, offsetY: heroCfg.offsetY
    });
    // Хитбокс чуть уже силуэта: касание плечом не считается столкновением.
    // Высоту не трогаем — от неё зависит, что ноги стоят на земле.
    if (!heroCfg.bodyW) {
      var hb = this.hero.body;
      var nb = ZV_LAYOUT.narrowBody(hb.width, hb.offset.x);
      hb.setSize(nb.width, hb.height, false);
      hb.setOffset(nb.offsetX, hb.offset.y);
    }
    this.hero.body.setGravityY(S.gravity);
    this.hero.setCollideWorldBounds(true);
    // Дорожка тёмная — тень берём как отдельный спрайт с целыми размерами.
    this.shadow = ZV.juice.shadow(this, this.hero, GROUND_Y + 4, 48, { color: 0x000000, alpha: 0.45 });
    this.physics.add.collider(this.hero, this.floor);

    this.blocks = this.physics.add.group({ allowGravity: false });
    this.physics.add.overlap(this.hero, this.blocks, function (hero, block) {
      block.destroy();
      self.lives -= 1;
      self.cameras.main.shake(160, 0.008);
      if (self.lives <= 0) finish(self);
    });

    this.scoreText = ZV.ui.text(this, W / 2, 60, "0", {
      size: 3
    }).setOrigin(0.5).setDepth(5);
    ZV.ui.hint(this, W / 2, 110, "Тап — прыжок");

    this.input.on("pointerup", function () { jump(self); });
    // Клавиатура для десктопа: пробел/вверх/W. Тап остаётся основным вводом.
    if (this.input.keyboard) {
      this.input.keyboard.on("keydown-SPACE", function () { jump(self); });
      this.input.keyboard.on("keydown-UP", function () { jump(self); });
      this.input.keyboard.on("keydown-W", function () { jump(self); });
    }

    this.timer = this.time.addEvent({ delay: this.spawnDelay, callback: function () { spawn(self); }, loop: true });
  };

  PlayScene.prototype.update = function (time, delta) {
    var self = this;
    if (this.over) return;

    this.blocks.getChildren().forEach(function (b) {
      if (b.x < -50) {
        b.destroy();
        self.score += 1;
        self.scoreText.setText(String(self.score));
        // Нарастающая сложность: быстрее и чаще.
        self.speed = Math.min(S.speedMax, self.speed + S.speedStep);
        self.spawnDelay = Math.max(S.spawnMin, self.spawnDelay - S.spawnStep);
        self.timer.delay = self.spawnDelay;
      }
    });

    // Дробную позицию копим отдельно, в tilePosition кладём целое —
    // иначе текстура ползёт на полпикселя и мерцает.
    this.roadX += this.speed * (delta / 1000);
    if (this.road) this.road.tilePositionX = Math.floor(this.roadX);
    if (this.bgFar) {
      this.bgFarX += this.speed * 0.25 * (delta / 1000);
      this.bgFar.tilePositionX = Math.floor(this.bgFarX);
    }

    if (this.shadow && this.shadow.zvFollow) this.shadow.zvFollow();

    // «Приземление» засчитываем только после НАСТОЯЩЕГО отрыва: прыжок
    // ставит флаг сам. Ловить его по blocked.down нельзя — этот признак
    // мигает на стыке кадров, и «сок» приземления начинал сыпаться каждые
    // несколько кадров подряд, раскачивая героя.
    var onGround = this.hero.body.blocked.down || this.hero.body.touching.down;
    if (onGround && this.airborne) {
      this.airborne = false;
      land(this);
    }

    updateAnim(this);
  };

  // Кадр «прыжок» — только в НАСТОЯЩЕМ полёте (флаг airborne ставит jump()).
  // По blocked.down выбирать нельзя: на первых кадрах раунда контакт с полом
  // ещё не зарегистрирован, и герой, стоя на земле, залипал в позе прыжка.
  // Темп ног привязан к скорости мира; анимацию не пересоздаём, крутим timeScale.
  function updateAnim(scene) {
    var flying = scene.airborne;
    global.ZV.sprite.playAnim(scene.hero, global.ZV_LAYOUT.runnerAnim(flying), true);
    if (!flying && scene.hero.anims) {
      scene.hero.anims.timeScale = Phaser.Math.Clamp(scene.speed / S.speedStart, 0.6, 2);
    }
  }

  function jump(scene) {
    if (scene.over) return;
    if (scene.hero.body.blocked.down || scene.hero.body.touching.down) {
      scene.hero.setVelocityY(-S.jump);
      scene.airborne = true;   // отрыв — фактический, а не «показалось»
      global.ZV.sprite.playAnim(scene.hero, "jump", false);
    }
  }

  function land(scene) {
    // Сплющивание — просадкой на 2 px (и кадром «сплющен», если он есть),
    // никакого дробного масштаба.
    global.ZV.juice.squash(scene, scene.hero, null, 50);
    global.ZV.sprite.playAnim(scene.hero, "run", false);
    global.ZV.juice.dust(scene, scene.hero.x - 6, GROUND_Y, 0x6b7390);
  }

  function spawn(scene) {
    if (scene.over) return;
    // Две готовые текстуры вместо растягивания одной: масштаб спрайта
    // множится на размер тела, и хитбокс перестаёт совпадать с картинкой.
    var tall = global.ZV.random.chance(S.tallChance);
    var b = scene.blocks.create(global.ZV.WIDTH + 40, GROUND_Y, tall ? "blockTall" : "block");
    global.ZV.sprite.apply(b, {});   // якорь по низу + тело по кадру
    b.setVelocityX(-scene.speed);
  }

  function finish(scene) {
    scene.over = true;
    scene.timer.remove();
    scene.physics.pause();
    global.ZV.finish(scene, {
      score: scene.score,
      won: scene.score >= S.passScore,
      text: "препятствий пройдено",
      meta: { archetype: "runner" }
    });
  }

  // Фон подгоняется под канву, а не рисуется 1:1 (картинка крупнее канвы
  // раньше показывала только центральный кусок). Правило — в layout.js
  // (fitBackground), оно покрыто тестами на размерах настоящих фонов.
  // Возвращает true, если фон нарисован: тогда кит не кладёт поверх заглушки
  // неба и земли, которые перекрывали настоящую картинку.
  function drawBackground(scene, W, H) {
    if (!scene.textures.exists("bg") || scene.bgFailed) return false;
    var src = scene.textures.get("bg").getSourceImage();
    var fit = global.ZV_LAYOUT.fitBackground(src.width, src.height, W, H, scene.bgTile);
    if (!fit) return false;

    if (fit.mode === "tile") {
      scene.bgFar = scene.add.tileSprite(0, 0, W, H, "bg").setOrigin(0, 0).setDepth(-10);
      scene.bgFarX = 0;
      return true;
    }
    var img = scene.add.image(W / 2, H / 2, "bg").setDepth(-10);
    if (fit.mode === "cover") img.setDisplaySize(fit.width, fit.height);
    else img.setScale(fit.scale);
    return true;
  }

  // Анимации есть с самого начала: агенту остаётся заменить кадры, а не
  // изобретать анимацию. Ключи run/jump/idle менять не нужно.
  function makeAnims(scene) {
    // Кадров — не больше, чем есть в листе: конфиг мог насчитать лишних, и
    // Phaser показывал бы пустые кадры.
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
        frameRate: scene.heroFps || 10, repeat: -1   // персонаж 8–12, дефолт 24 не оставлять
      });
    }
    if (!scene.anims.exists("idle")) {
      scene.anims.create({ key: "idle", frames: [{ key: "hero", frame: 0 }], frameRate: 1, repeat: -1 });
    }
    if (!scene.anims.exists("jump")) {
      scene.anims.create({ key: "jump", frames: [{ key: "hero", frame: Math.min(1, last) }], frameRate: 1, repeat: -1 });
    }
  }

  // Картинка из config или фигура-заглушка того же размера.
  function loadOrStub(scene, key, item, w, h, color) {
    if (item && item.url) {
      scene.load.image(key, item.url);
      return;
    }
    makeRect(scene, key, w, h, color);
  }

  // Заглушка-спрайтлист героя: два кадра, второй чуть присел и сдвинут —
  // этого хватает, чтобы бег читался ещё до настоящих картинок.
  function makeHeroSheet(scene, key, w, h, color) {
    if (scene.textures.exists(key)) return;
    var g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.fillStyle(0xffffff, 0.85);
    g.fillRect(Math.round(w * 0.6), Math.round(h * 0.2), 4, 4);
    g.fillStyle(color, 1);
    g.fillRect(w + 2, 4, w - 4, h - 4);
    g.fillStyle(0xffffff, 0.85);
    g.fillRect(w + 2 + Math.round((w - 4) * 0.6), 4 + Math.round((h - 4) * 0.2), 4, 4);
    g.generateTexture(key, w * 2, h);
    g.destroy();
    var tex = scene.textures.get(key);
    tex.add(0, 0, 0, 0, w, h);
    tex.add(1, 0, w, 0, w, h);
  }

  // Заглушка-прямоугольник как текстура: убирается вместе с приходом спрайтов.
  // Углы прямые — скруглять нечего, пиксель-арт рисует форму сам.
  function makeRect(scene, key, w, h, color) {
    if (scene.textures.exists(key)) return;
    var g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.runner = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
