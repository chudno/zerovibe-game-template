// Кит «Розыгрыш»: одно действие — и приз по весам из content/wheel.json.
// Три подачи одной механики (params.presentation):
//   wheel    — колесо секторов, по нему бежит подсветка и замирает на призе;
//   scratch  — скретч-карта: палец стирает серый слой, под ним приз;
//   lootbox  — коробка: тап, тряска, крышка открывается, приз всплывает.
// Колесо не вращается картинкой: произвольный угол мылит пиксель-арт и текст,
// а бегущая подсветка по неподвижным секторам читается так же и остаётся
// пиксельно ровной. Вес сектора = вероятность — его подтверждает человек.
(function (global) {
  "use strict";

  // Настройки по умолчанию; правятся в config.params (те же ключи).
  var DEFAULTS = {
    presentation: "wheel",  // "wheel" | "scratch" | "lootbox"
    spinMs: 3200,           // длительность розыгрыша (колесо, тряска коробки)
    scratchPercent: 55,     // сколько процентов карты стереть, чтобы открылось
    replay: false           // «Ещё раз» на экране результата: розыгрыш обычно один
  };
  var S = DEFAULTS;

  var PALETTE = [0x4f7cff, 0x2e9e5b, 0xffd23f, 0xff5f6d, 0xb56cff, 0x38bdf8, 0xf97316, 0x2a2f45];

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    global.ZV.loadContent(this, "wheel");
    var items = ((global.ZV_GAME && global.ZV_GAME.assets) || {}).items || {};
    if (items.box && items.box.url) this.load.image("box", items.box.url);
    if (items.boxOpen && items.boxOpen.url) this.load.image("boxOpen", items.boxOpen.url);
  };

  PlayScene.prototype.create = function () {
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;
    this.add.rectangle(W / 2, H / 2, W, H, 0x101018).setDepth(-20);

    S = ZV.params(DEFAULTS);
    var c = ZV.content(this, "wheel");
    this.over = false;
    this.busy = false;
    if (c.errors.length) {
      this.over = true;
      ZV.ui.fail(this, "Ошибки в content/wheel.json", c.errors);
      return;
    }
    this.items = c.data.items;

    var mode = S.presentation;
    if (mode === "scratch") setupScratch(this);
    else if (mode === "lootbox") setupLootbox(this);
    else setupWheel(this);
  };

  PlayScene.prototype.update = function () {
    if (this.tick) this.tick();
  };

  // --- колесо ---------------------------------------------------------------
  function sectorColor(item, i) {
    if (item.color) return Phaser.Display.Color.HexStringToColor(item.color).color;
    return PALETTE[i % PALETTE.length];
  }

  function setupWheel(scene) {
    var ZV = global.ZV;
    var W = ZV.WIDTH;
    var cx = W / 2, cy = 300, r = 132;
    var n = scene.items.length;
    var step = 360 / n;

    ZV.ui.hint(scene, W / 2, 80, "Крути и забирай приз");

    var g = scene.add.graphics();
    scene.items.forEach(function (it, i) {
      var a0 = Phaser.Math.DegToRad(-90 + i * step), a1 = Phaser.Math.DegToRad(-90 + (i + 1) * step);
      g.fillStyle(sectorColor(it, i), 1);
      g.beginPath();
      g.slice(cx, cy, r, a0, a1, false);
      g.fillPath();
      g.lineStyle(3, 0x101018, 1);
      g.strokePath();
      var mid = (a0 + a1) / 2;
      ZV.ui.text(scene, Math.round(cx + Math.cos(mid) * r * 0.64), Math.round(cy + Math.sin(mid) * r * 0.64), it.title, {
        size: 1, align: "center",
        wordWrap: { width: n > 8 ? 56 : 76 }
      }).setOrigin(0.5).setDepth(2);
    });
    // Ступица и обод.
    g.fillStyle(0x101018, 1); g.fillCircle(cx, cy, 22);
    g.lineStyle(4, 0xffffff, 0.18); g.strokeCircle(cx, cy, r + 2);

    // Подсветка текущего сектора — отдельный слой, перерисовывается на смене.
    scene.hl = scene.add.graphics().setDepth(1);
    scene.hlIndex = -1;
    function highlight(i) {
      if (i === scene.hlIndex) return;
      scene.hlIndex = i;
      scene.hl.clear();
      if (i < 0) return;
      var a0 = Phaser.Math.DegToRad(-90 + i * step), a1 = Phaser.Math.DegToRad(-90 + (i + 1) * step);
      scene.hl.fillStyle(0xffffff, 0.38);
      scene.hl.beginPath();
      scene.hl.slice(cx, cy, r, a0, a1, false);
      scene.hl.fillPath();
      scene.hl.lineStyle(4, 0xffffff, 0.9);
      scene.hl.strokePath();
    }
    scene.highlight = highlight;
    highlight(0);

    scene.spinBtn = ZV.ui.button(scene, W / 2, 520, "Крутить", function () { spin(scene); });
  }

  // Приз выбран ДО анимации — подсветка лишь доезжает до него. Пробег:
  // 3 полных круга плюс расстояние до цели, замедление кубическое.
  function spin(scene) {
    if (scene.over || scene.busy) return;
    scene.busy = true;
    scene.spinBtn.box.disableInteractive().setAlpha(0.5);
    var n = scene.items.length;
    var prize = global.ZV.prizes.pick(scene.items);
    var target = scene.items.indexOf(prize);
    var start = Math.max(0, scene.hlIndex);
    var steps = 3 * n + ((target - start) % n + n) % n;
    var counter = { v: 0 };
    scene.tweens.add({
      targets: counter, v: steps, duration: S.spinMs, ease: "Cubic.easeOut",
      onUpdate: function () { scene.highlight((start + Math.floor(counter.v)) % n); },
      onComplete: function () {
        scene.highlight(target);
        blink(scene, scene.hl, 3, function () { finish(scene, prize); });
      }
    });
  }

  // Мигание слоя: целое число вспышек, без дробных масштабов.
  function blink(scene, obj, times, done) {
    var left = times * 2;
    scene.time.addEvent({
      delay: 130, repeat: left - 1,
      callback: function () {
        left -= 1;
        obj.setVisible(left % 2 === 0);
        if (left === 0) { obj.setVisible(true); done(); }
      }
    });
  }

  // --- скретч-карта ---------------------------------------------------------
  // Приз решён при выдаче карты (как у настоящей), стирание его только
  // показывает. Стёртость считаем по сетке клеток 20×20 — точнее, чем на глаз,
  // дешевле, чем читать пиксели.
  function setupScratch(scene) {
    var ZV = global.ZV;
    var W = ZV.WIDTH;
    var cw = 280, ch = 180, x0 = (W - cw) / 2, y0 = 210;
    var prize = ZV.prizes.pick(scene.items);
    scene.prize = prize;

    ZV.ui.hint(scene, W / 2, 120, "Потри карту пальцем");

    // Подложка с призом.
    scene.add.rectangle(W / 2, y0 + ch / 2, cw, ch, 0x1b1f33).setStrokeStyle(2, 0xffffff, 0.18);
    ZV.ui.text(scene, W / 2, y0 + 62, prize.title, {
      size: 2, align: "center", wordWrap: { width: cw - 30 }
    }).setOrigin(0.5);
    if (prize.code) {
      ZV.ui.text(scene, W / 2, y0 + 112, prize.code, {
        size: 2, color: ZV.SECONDARY
      }).setOrigin(0.5);
    }

    // Стираемый слой: RenderTexture, кисть — квадрат 28×28.
    if (!scene.textures.exists("zv-brush")) {
      var g = scene.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 28, 28);
      g.generateTexture("zv-brush", 28, 28); g.destroy();
    }
    var rt = scene.add.renderTexture(x0, y0, cw, ch).setOrigin(0, 0).setDepth(3);
    rt.fill(0x6b7390, 1);
    scene.cover = rt;
    var hint = ZV.ui.text(scene, W / 2, y0 + ch / 2, "потри здесь", { size: 1, color: "#101018" })
      .setOrigin(0.5).setDepth(4);

    var cols = cw / 20, rows = ch / 20, cells = {}, touched = 0;
    function rub(p) {
      if (scene.over || scene.busy || !p.isDown) return;
      var lx = p.x - x0, ly = p.y - y0;
      if (lx < -14 || ly < -14 || lx > cw + 14 || ly > ch + 14) return;
      hint.setVisible(false);
      rt.erase("zv-brush", Math.round(lx) - 14, Math.round(ly) - 14);
      var cxi = Math.floor(lx / 20), cyi = Math.floor(ly / 20);
      for (var dx = -1; dx <= 0; dx++) {
        for (var dy = -1; dy <= 0; dy++) {
          var i = cxi + dx, j = cyi + dy;
          if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
          var key = i + ":" + j;
          if (!cells[key]) { cells[key] = true; touched++; }
        }
      }
      scene.scratched = Math.round(100 * touched / (cols * rows));
      if (scene.scratched >= S.scratchPercent) reveal();
    }
    function reveal() {
      scene.busy = true;
      rt.clear();
      scene.time.delayedCall(700, function () { finish(scene, prize); });
    }
    scene.input.on("pointermove", rub);
    scene.input.on("pointerdown", rub);
  }

  // --- коробка --------------------------------------------------------------
  function setupLootbox(scene) {
    var ZV = global.ZV;
    var W = ZV.WIDTH;
    var bx = W / 2, by = 360;
    ZV.ui.hint(scene, W / 2, 120, "Тапни по коробке");
    if (!scene.textures.exists("box")) makeBox(scene, "box", false);
    if (!scene.textures.exists("boxOpen")) makeBox(scene, "boxOpen", true);
    var box = scene.add.image(bx, by, "box").setOrigin(0.5, 1).setDepth(2).setInteractive({ useHandCursor: true });
    scene.box = box;
    box.on("pointerup", function () { openBox(scene, box, bx, by); });
  }

  // Тряска — сдвиги на целые пиксели по таймеру, потом смена картинки на
  // открытую и приз, всплывающий из коробки.
  function openBox(scene, box, bx, by) {
    if (scene.over || scene.busy) return;
    scene.busy = true;
    var prize = global.ZV.prizes.pick(scene.items);
    var shakes = Math.max(6, Math.round(S.spinMs / 70));
    var i = 0;
    scene.time.addEvent({
      delay: 70, repeat: shakes - 1,
      callback: function () {
        i += 1;
        box.x = bx + (i % 2 ? 3 : -3);
        if (i === shakes) {
          box.x = bx;
          box.setTexture("boxOpen");
          var t = global.ZV.ui.text(scene, bx, by - 40, prize.title, {
            size: 2, color: global.ZV.SECONDARY, align: "center", wordWrap: { width: 260 }
          }).setOrigin(0.5).setDepth(1).setAlpha(0);
          scene.tweens.add({
            targets: t, y: by - 160, alpha: 1, duration: 600, ease: "Back.easeOut",
            onUpdate: function () { t.y = Math.round(t.y); },
            onComplete: function () { scene.time.delayedCall(700, function () { finish(scene, prize); }); }
          });
        }
      }
    });
  }

  // Заглушка коробки 120×100: корпус и крышка; открытая — крышка приподнята.
  function makeBox(scene, key, open) {
    var g = scene.make.graphics({ x: 0, y: 0, add: false });
    var w = 120, h = 100;
    g.fillStyle(0x4f7cff, 1); g.fillRect(10, 40, w - 20, h - 40);
    g.fillStyle(0xffd23f, 1); g.fillRect(w / 2 - 8, 40, 16, h - 40);
    if (open) {
      g.fillStyle(0x3a5fd0, 1); g.fillRect(4, 0, w - 8, 22);
      g.fillStyle(0xffd23f, 1); g.fillRect(w / 2 - 8, 0, 16, 22);
    } else {
      g.fillStyle(0x3a5fd0, 1); g.fillRect(4, 26, w - 8, 22);
      g.fillStyle(0xffd23f, 1); g.fillRect(w / 2 - 8, 26, 16, 22);
    }
    g.generateTexture(key, w, h);
    g.destroy();
  }

  // --- итог -----------------------------------------------------------------
  function finish(scene, prize) {
    if (scene.over) return;
    scene.over = true;
    global.ZV.finish(scene, {
      score: 0,
      hideScore: true,
      won: true,
      title: "Поздравляем!",
      text: "",
      prize: prize,
      outcome: prize.id,
      replay: S.replay,
      meta: { archetype: "wheel", presentation: S.presentation, prize: prize.id }
    });
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.wheel = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
