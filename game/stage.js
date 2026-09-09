// Сцена сюжетных китов (новелла, квест): фон и портрет по ключам, панель
// реплики с печатью по буквам, подсказка «дальше», столбик вариантов, тост.
// Кит держит граф (ZV.novel) и решает, что показать; сцена только рисует.
// Канва 360×640: портрет над панелью, панель 316..448, варианты ниже.
(function (global) {
  "use strict";

  var PANEL = { x: 12, y: 316, w: 336, h: 132 };
  var PORTRAIT = { x: 180, y: 302, w: 96, h: 128 };
  var CHOICES = { y: 468, step: 44, height: 40, width: 300 };
  var TEXT_W = 312;
  // Цвета заглушек по ключу картинки: у каждого персонажа/места свой.
  var PALETTE = [0x4f7cff, 0xff5f6d, 0x2e9e5b, 0xd9a100, 0x9b59b6, 0x1abc9c];
  var BG_PALETTE = [0x1b1f33, 0x1f2a1b, 0x2a1b1f, 0x1b2a2a, 0x262238, 0x2a2a1b];

  function hash(s) {
    var h = 7;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // Картинки по ключам из config.assets (backgrounds, portraits, items —
  // группы с префиксами). Ключи узлов сюжета в preload ещё не известны (JSON
  // грузится тут же), поэтому грузим все. Ошибка загрузки — заглушка.
  function preload(scene, groups) {
    scene.stageFailed = scene.stageFailed || {};
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    groups.forEach(function (g) {
      var map = a[g.assets] || {};
      for (var k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k) && map[k] && map[k].url) scene.load.image(g.prefix + k, map[k].url);
      }
    });
    scene.load.on("loaderror", function (file) { scene.stageFailed[file.key] = true; }, scene);
  }

  function hasTexture(scene, key) {
    return !!key && scene.textures.exists(key) && !(scene.stageFailed && scene.stageFailed[key]);
  }

  // opts: { onPanelTap(), onPick(i), typeMs, tapReveals }.
  function create(scene, opts) {
    opts = opts || {};
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;
    var st = { typing: false, typed: 0, full: "", acc: 0, typeMs: opts.typeMs || 0 };

    st.bgRect = scene.add.rectangle(W / 2, H / 2, W, H, 0x101018).setDepth(-20);
    st.bgImage = scene.add.image(W / 2, H / 2, "__DEFAULT").setDepth(-10).setVisible(false);

    st.portraitRect = scene.add.rectangle(PORTRAIT.x, PORTRAIT.y, PORTRAIT.w, PORTRAIT.h, PALETTE[0]).setOrigin(0.5, 1).setDepth(1);
    st.portraitRect.setStrokeStyle(2, 0xffffff, 0.15);
    st.portraitLabel = ZV.ui.text(scene, PORTRAIT.x, PORTRAIT.y - 20, "", { size: 1, color: "#e6e8f0" }).setOrigin(0.5).setDepth(2);
    st.portraitImage = scene.add.image(PORTRAIT.x, PORTRAIT.y, "__DEFAULT").setOrigin(0.5, 1).setDepth(1).setVisible(false);

    st.panel = scene.add.rectangle(PANEL.x + PANEL.w / 2, PANEL.y + PANEL.h / 2, PANEL.w, PANEL.h, 0x101018, 0.92)
      .setDepth(5).setInteractive({ useHandCursor: true });
    st.panel.setStrokeStyle(2, 0xffffff, 0.14);
    st.panel.on("pointerup", function () { if (opts.onPanelTap) opts.onPanelTap(); });
    st.speakerText = ZV.ui.text(scene, PANEL.x + 12, PANEL.y + 12, "", { size: 1, color: ZV.SECONDARY }).setDepth(6);
    st.bodyText = ZV.ui.text(scene, PANEL.x + 12, PANEL.y + 32, "", { size: 1, color: "#e6e8f0", lineSpacing: 0 }).setDepth(6);
    st.nextHint = ZV.ui.text(scene, PANEL.x + PANEL.w - 14, PANEL.y + PANEL.h - 14, "v", { size: 1, color: "#9aa0b5" })
      .setOrigin(1, 1).setDepth(6).setVisible(false);

    st.choices = ZV.ui.choices(scene, {
      y: CHOICES.y, step: CHOICES.step, height: CHOICES.height, width: CHOICES.width,
      onPick: function (i) { if (opts.onPick) opts.onPick(i); }
    }).setDepth(5);

    // Клавиатура для десктопа: пробел/Enter — дальше, 1–4 — вариант.
    if (scene.input.keyboard) {
      scene.input.keyboard.on("keydown-SPACE", function () { if (opts.onPanelTap) opts.onPanelTap(); });
      scene.input.keyboard.on("keydown-ENTER", function () { if (opts.onPanelTap) opts.onPanelTap(); });
      ["ONE", "TWO", "THREE", "FOUR"].forEach(function (name, i) {
        scene.input.keyboard.on("keydown-" + name, function () { if (opts.onPick) opts.onPick(i); });
      });
    }

    // Фон по ключу: картинка, если загружена, иначе цвет из палитры.
    st.setBackground = function (key) {
      var tex = key ? "bg:" + key : "";
      if (hasTexture(scene, tex)) {
        var src = scene.textures.get(tex).getSourceImage();
        var fit = global.ZV_LAYOUT.fitBackground(src.width, src.height, W, H, false);
        ZV.sprite.apply(st.bgImage, { texture: tex, origin: false, scale: 1 });
        st.bgImage.setVisible(true);
        if (fit && fit.mode === "cover") st.bgImage.setDisplaySize(fit.width, fit.height);
        else if (fit) st.bgImage.setScale(fit.scale);
        return;
      }
      st.bgImage.setVisible(false);
      st.bgRect.setFillStyle(key ? BG_PALETTE[hash(key) % BG_PALETTE.length] : 0x101018);
    };

    // Портрет по ключу: картинка целым масштабом или прямоугольник с подписью.
    st.setPortrait = function (key) {
      var tex = key ? "pt:" + key : "";
      if (!key) {
        st.portraitRect.setVisible(false); st.portraitLabel.setVisible(false); st.portraitImage.setVisible(false);
        return;
      }
      if (hasTexture(scene, tex)) {
        var src = scene.textures.get(tex).getSourceImage();
        var up = Math.max(1, Math.floor(Math.min(200 / src.width, 240 / src.height)));
        ZV.sprite.apply(st.portraitImage, { texture: tex, scale: up });
        st.portraitImage.setVisible(true);
        st.portraitRect.setVisible(false); st.portraitLabel.setVisible(false);
        return;
      }
      st.portraitImage.setVisible(false);
      st.portraitRect.setVisible(true).setFillStyle(PALETTE[hash(key) % PALETTE.length]);
      st.portraitLabel.setVisible(true).setText(String(key).toUpperCase());
    };

    // Реплика с печатью по буквам. Переносы считаем заранее по метрикам
    // шрифта: печать не перескакивает строками, когда слово дописывается.
    st.say = function (speaker, text) {
      st.speakerText.setText(speaker || "");
      st.full = ZV.font.wrap(text || "", TEXT_W, 1).join("\n");
      st.typed = 0;
      st.acc = 0;
      st.typing = true;
      st.bodyText.setText("");
      st.nextHint.setVisible(false);
      st.choices.set([]);
    };
    st.reveal = function () {
      st.typed = st.full.length;
      st.bodyText.setText(st.full);
      st.typing = false;
    };
    // Зовётся из update; true — печать закончилась на этом кадре.
    st.tick = function (delta) {
      if (!st.typing) return false;
      if (st.typeMs <= 0) st.typed = st.full.length;
      else {
        st.acc += delta;
        while (st.acc >= st.typeMs && st.typed < st.full.length) { st.acc -= st.typeMs; st.typed++; }
      }
      st.bodyText.setText(st.full.slice(0, st.typed));
      if (st.typed >= st.full.length) { st.typing = false; return true; }
      return false;
    };
    st.showNext = function (on) { st.nextHint.setVisible(!!on); };
    st.showChoices = function (labels) { st.choices.set(labels); };
    st.highlight = function (i) {
      st.choices.color(i, Phaser.Display.Color.HexStringToColor(ZV.PRIMARY).color);
    };

    // Короткое сообщение поверх портрета (получен предмет и т.п.): перенос по
    // метрикам шрифта в 296 px, рамка по числу строк, целые координаты.
    st.toast = function (text, ms) {
      if (st.toastObj) { st.toastObj.box.destroy(); st.toastObj.text.destroy(); st.toastObj = null; }
      var lines = [];
      String(text).split("\n").forEach(function (part) { lines = lines.concat(ZV.font.wrap(part, 296, 1)); });
      var widest = 0;
      lines.forEach(function (l) { widest = Math.max(widest, ZV.font.width(l, 1)); });
      var w = Math.min(320, widest + 24), h = lines.length * 16 + 12;
      var box = scene.add.rectangle(W / 2, 96, Math.round(w / 2) * 2, Math.round(h / 2) * 2, 0x1b1f33, 0.95).setDepth(40);
      box.setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(ZV.SECONDARY).color, 0.7);
      var t = ZV.ui.text(scene, W / 2, 96, lines.join("\n"), { size: 1, color: ZV.SECONDARY, align: "center" }).setOrigin(0.5).setDepth(41);
      st.toastObj = { box: box, text: t };
      scene.time.delayedCall(ms || 1400, function () {
        if (st.toastObj && st.toastObj.box === box) { box.destroy(); t.destroy(); st.toastObj = null; }
      });
    };

    return st;
  }

  global.ZV_STAGE = { PANEL: PANEL, PORTRAIT: PORTRAIT, CHOICES: CHOICES, preload: preload, create: create, hash: hash, hasTexture: hasTexture };
})(window);
