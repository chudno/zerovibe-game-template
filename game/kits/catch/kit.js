// Кит «Ловилка»: корзина ездит за пальцем внизу, сверху сыплются предметы.
// Хорошие ловим, плохие пропускаем. Раунд ограничен по времени.
// Картинки подставляются только через ZV.sprite.apply. Канва 360×640,
// пиксель-арт: масштаб спрайтов всегда 1.
(function (global) {
  "use strict";

  // Настройки по умолчанию; правятся в config.params (те же ключи), S
  // собирается в create через ZV.params.
  var DEFAULTS = {
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
    misses: 5,           // сколько хороших можно уронить
    passScore: 20,       // очков для победы (если дожил до конца времени)
    maxRepeat: 2         // сколько раз подряд может выпасть один и тот же вид предмета
  };
  var S = DEFAULTS;

  var BASKET_Y = 560;

  // Размеры заглушек (когда картинки не заказаны). Тело считает
  // ZV.sprite.apply по непрозрачной области кадра, руками его не задаём:
  // точные числа, если они есть, приходят из config.assets.items[key].body.
  var STUB = { basket: { w: 90, h: 32, color: 0x4f7cff }, good: { w: 22, h: 22, color: 0xffd23f }, bad: { w: 22, h: 22, color: 0xff5f6d } };

  // Ключи предметов в config.assets.items: good/good2/good3 и bad/bad2/bad3.
  // Больше трёх хороших и трёх плохих игрок не читает на лету.
  var GOOD_KEYS = ["good", "good2", "good3"];
  var BAD_KEYS = ["bad", "bad2", "bad3"];

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

    // Корзина всегда одна; предметов — сколько заказано картинок, но хотя бы
    // по одному виду в каждой категории (дальше это заглушки).
    loadOrStub(this, "basket", items.basket, STUB.basket);
    var scene = this;
    GOOD_KEYS.concat(BAD_KEYS).forEach(function (key) {
      if (items[key] && items[key].url) scene.load.image(key, items[key].url);
    });
    // Ни одной картинки в категории — рисуем её заглушку (по одной на категорию).
    if (!ordered(items, GOOD_KEYS)) makeRect(this, "good", STUB.good.w, STUB.good.h, STUB.good.color);
    if (!ordered(items, BAD_KEYS)) makeRect(this, "bad", STUB.bad.w, STUB.bad.h, STUB.bad.color);

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

    S = ZV.params(DEFAULTS);
    this.score = 0;
    this.missed = 0;
    this.fall = S.fallStart;
    this.spawnDelay = S.spawnStart;
    this.over = false;

    // depth -20: у фона -10, без этого заливка рисуется поверх картинки.
    this.add.rectangle(W / 2, H / 2, W, H, 0x101018).setDepth(-20);
    drawBackground(this, W, H);

    // Пул предметов: вид предмета выбирается взвешенно и с антиповтором
    // (maxRepeat), а категорию — good или bad — по-прежнему решает badChance:
    // доля вредного должна оставаться ручкой баланса, а не производной весов.
    this.pool = ZV.pool.create(itemsFromAssets(this), ZV.random);

    if (!this.textures.exists("basket")) makeRect(this, "basket", STUB.basket.w, STUB.basket.h, STUB.basket.color);
    this.basket = this.physics.add.sprite(W / 2, BASKET_Y, "basket");
    ZV.sprite.apply(this.basket, { body: bodyOf("basket") });
    this.basket.body.setAllowGravity(false);
    this.basket.setCollideWorldBounds(true);

    this.items = this.physics.add.group();
    this.physics.add.overlap(this.basket, this.items, function (basket, item) {
      catchItem(self, item);
    });

    this.scoreText = ZV.ui.text(this, W / 2, 60, "0", {
      size: 3
    }).setOrigin(0.5).setDepth(5);
    this.livesText = ZV.ui.text(this, W / 2, 105, "промахи: 0/" + S.misses, {
      size: 1, color: "#9aa0b5"
    }).setOrigin(0.5).setDepth(5);
    this.timeText = ZV.ui.text(this, W - 20, 60, "", {
      size: 1, color: "#9aa0b5"
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
    var good = !global.ZV.random.chance(S.badChance);
    var data;
    try {
      data = scene.pool.pick({ category: good ? "good" : "bad", maxRepeat: S.maxRepeat });
    } catch (e) {
      return;   // категория пуста: заглушки это исключают, но партию не роняем
    }
    var x = global.ZV.random.between(45, global.ZV.WIDTH - 45);
    var it = scene.items.create(x, -30, data.id);
    global.ZV.sprite.apply(it, { origin: false, body: bodyOf(data.id) });
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
      won: survived && scene.score >= S.passScore,
      text: "поймано",
      meta: { archetype: "catch", missed: scene.missed }
    });
  }

  // Фон подгоняется под канву по общему правилу layout.js (fitBackground):
  // раньше картинка крупнее канвы показывала только центральный кусок.
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

  function loadOrStub(scene, key, item, stub) {
    if (item && item.url) {
      scene.load.image(key, item.url);
      return;
    }
    makeRect(scene, key, stub.w, stub.h, stub.color);
  }

  // Заказана ли хоть одна картинка из списка ключей.
  function ordered(items, keys) {
    for (var i = 0; i < keys.length; i++) if (items[keys[i]] && items[keys[i]].url) return true;
    return false;
  }

  // Непрозрачная область кадра из config.assets.items[key].body — числа
  // приходят из ответа asset_generate. Нет её — тело посчитает apply сам.
  function bodyOf(key) {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var it = (a.items || {})[key];
    return it && it.body ? it.body : undefined;
  }

  // Предметы пула по ключам картинок: вес и категория из config.assets.
  // Картинок нет — остаются две заглушки, по одной на категорию.
  function itemsFromAssets(scene) {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var items = a.items || {};
    var out = [];
    function add(keys, category) {
      var added = [], positive = 0;
      keys.forEach(function (key) {
        var it = items[key];
        if (!it || !it.url || !scene.textures.exists(key)) return;
        var w = typeof it.weight === "number" && isFinite(it.weight) && it.weight >= 0 ? it.weight : 1;
        if (w > 0) positive++;
        added.push({ id: key, category: category, weight: w });
      });
      // Картинки не заказаны или не загрузились — играем заглушкой.
      if (!added.length) {
        makeRect(scene, keys[0], STUB[category].w, STUB[category].h, STUB[category].color);
        added.push({ id: keys[0], category: category, weight: 1 });
        positive = 1;
      }
      // Все веса в категории нулевые — выбирать было бы не из чего, и партия
      // молча осталась бы без предметов. Возвращаем первому вид вес 1.
      if (!positive) added[0].weight = 1;
      out = out.concat(added);
    }
    add(GOOD_KEYS, "good");
    add(BAD_KEYS, "bad");
    return out;
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
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
