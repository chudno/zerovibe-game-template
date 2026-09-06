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
      physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
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
