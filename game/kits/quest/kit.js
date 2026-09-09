// Кит «Квест»: новелла с инвентарём. Сюжет — content/quest.json (тот же
// граф, что у новеллы, плюс items: предметы выдаются give, тратятся take,
// открывают варианты needs). Граф и рантайм — game/novel.js (предметы там —
// сахар над булевыми переменными), сцена — game/stage.js; здесь ход сюжета
// и полка предметов: иконки сверху, тост при получении/трате, тап по иконке
// показывает название.
(function (global) {
  "use strict";

  var N = global.ZV_NOVEL;
  var STAGE = global.ZV_STAGE;

  // Настройки по умолчанию; правятся в config.params (те же ключи).
  var DEFAULTS = {
    typeMs: 22,          // мс на букву при печати реплики; 0 — сразу целиком
    tapReveals: true,    // тап во время печати показывает реплику целиком
    autoNextMs: 0,       // линейный узел сам идёт дальше через столько мс после печати; 0 — по тапу
    startNode: "",       // с какого узла начинать (отладка); пусто — start из файла
    showEmptySlots: true // рисовать пустые ячейки под ещё не найденные предметы
  };
  var S = DEFAULTS;

  // Полка предметов: ячейки 28×28 с шагом 34 от левого верхнего угла; до 8
  // предметов (LIMITS.maxItems) — девятая ячейка легла бы на счётчик справа.
  var SHELF = { x: 16, y: 16, size: 28, step: 34 };
  var PALETTE = [0xffd23f, 0x4f7cff, 0x2e9e5b, 0xff5f6d, 0x9b59b6, 0x1abc9c];

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    STAGE.preload(this, [
      { assets: "backgrounds", prefix: "bg:" }, { assets: "portraits", prefix: "pt:" }, { assets: "items", prefix: "it:" }
    ]);
    global.ZV.loadContent(this, "quest");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    S = ZV.params(DEFAULTS);
    this.over = false;
    var c = ZV.content(this, "quest");
    if (c.errors.length) {
      this.over = true;
      ZV.ui.fail(this, "Ошибки в content/quest.json", c.errors);
      return;
    }
    this.data = c.data;
    this.rt = N.create(c.data);
    if (S.startNode && c.data.nodes[S.startNode]) this.rt.load({ node: S.startNode, vars: this.rt.vars });
    this.chaptersSeen = {};
    this.stage = STAGE.create(this, {
      typeMs: S.typeMs,
      onPanelTap: function () { tapPanel(self); },
      onPick: function (i) { pick(self, i); }
    });
    // configurable: сцена переиспользуется («Ещё раз» → create() снова).
    Object.defineProperty(this, "typing", { configurable: true, get: function () { return self.stage.typing; } });
    this.waitNext = 0;
    this.itemKeys = Object.keys(c.data.items);
    this.slots = {};
    makeShelf(this);
    show(this);
  };

  PlayScene.prototype.update = function (time, delta) {
    if (this.over) return;
    if (this.stage.tick(delta)) typed(this);
    if (this.stage.typing) return;
    if (this.waitNext && time >= this.waitNext) { this.waitNext = 0; advance(this); }
  };

  // --- полка предметов ---------------------------------------------------------
  function makeShelf(scene) {
    var ZV = global.ZV;
    scene.itemKeys.forEach(function (key, i) {
      var it = scene.data.items[key];
      var x = SHELF.x + i * SHELF.step + SHELF.size / 2, y = SHELF.y + SHELF.size / 2;
      var box = scene.add.rectangle(x, y, SHELF.size, SHELF.size, 0x1b1f33, 0.9).setDepth(20)
        .setInteractive({ useHandCursor: true });
      box.setStrokeStyle(2, 0xffffff, 0.12);
      var iconKey = "it:" + (it.icon || key);
      var icon = null, letter = null;
      if (STAGE.hasTexture(scene, iconKey)) {
        icon = scene.add.image(x, y, iconKey).setDepth(21);
        var src = scene.textures.get(iconKey).getSourceImage();
        // Иконка не крупнее ячейки: масштаб ровно 1/n (прореживание пикселей), не округлённый размер.
        var down = Math.max(1, Math.ceil(Math.max(src.width, src.height) / SHELF.size));
        if (down > 1) icon.setScale(1 / down);
      } else {
        letter = ZV.ui.text(scene, x, y, firstLetter(it.title), { size: 1, color: "#101018" }).setOrigin(0.5).setDepth(21);
      }
      var color = PALETTE[STAGE.hash(key) % PALETTE.length];
      box.on("pointerup", function () {
        if (scene.rt.inventory().indexOf(key) >= 0) scene.stage.toast(it.title, 1200);
      });
      scene.slots[key] = { box: box, icon: icon, letter: letter, color: color };
    });
    scene.itemsText = ZV.ui.text(scene, ZV.WIDTH - 16, SHELF.y + SHELF.size / 2, "", { size: 1, color: "#9aa0b5" })
      .setOrigin(1, 0.5).setDepth(20);
    drawShelf(scene);
  }

  function drawShelf(scene) {
    var have = scene.rt.inventory();
    scene.itemKeys.forEach(function (key) {
      var s = scene.slots[key], on = have.indexOf(key) >= 0;
      s.box.setVisible(on || S.showEmptySlots);
      s.box.setFillStyle(on ? s.color : 0x1b1f33, on ? 1 : 0.9);
      if (s.icon) s.icon.setVisible(on).setAlpha(1);
      if (s.letter) s.letter.setVisible(on);
    });
    scene.itemsText.setText(have.length + "/" + scene.itemKeys.length);
  }

  function firstLetter(title) {
    var t = String(title || "").trim();
    return t ? t[0].toUpperCase() : "?";
  }

  // Тост о полученных и потраченных предметах после перехода.
  function announce(scene) {
    var ch = scene.rt.lastChange || { gained: [], lost: [] };
    var parts = [];
    ch.gained.forEach(function (k) { parts.push("Получено: " + scene.rt.item(k).title); });
    ch.lost.forEach(function (k) { parts.push("Использовано: " + scene.rt.item(k).title); });
    if (parts.length) scene.stage.toast(parts.join("\n"), 1600);   // каждый предмет своей строкой
  }

  // --- ход сюжета (как в новелле) ---------------------------------------------
  function show(scene) {
    var n = scene.rt.node();
    var id = scene.rt.id();
    scene.stage.setBackground(n.bg);
    scene.stage.setPortrait(n.portrait);
    scene.stage.say(n.speaker, n.text);
    scene.waitNext = 0;
    drawShelf(scene);
    announce(scene);
    var ch = scene.data.chapters || [];
    var ci = ch.indexOf(id);
    if (ci >= 0 && !scene.chaptersSeen[id]) {
      scene.chaptersSeen[id] = true;
      global.ZV.progress(scene, { step: ci + 1, total: ch.length, meta: { node: id, items: scene.rt.inventory() } });
    }
  }

  function typed(scene) {
    var rt = scene.rt;
    if (rt.ended()) { scene.stage.showNext(true); return; }
    if (rt.linear()) {
      scene.stage.showNext(true);
      if (S.autoNextMs > 0) scene.waitNext = scene.time.now + S.autoNextMs;
      return;
    }
    scene.stage.showChoices(rt.choices().map(function (c) { return c.text; }));
  }

  function tapPanel(scene) {
    if (scene.over) return;
    if (scene.stage.typing) {
      if (S.tapReveals) { scene.stage.reveal(); typed(scene); }
      return;
    }
    if (scene.rt.ended()) { finish(scene); return; }
    if (scene.rt.linear()) advance(scene);
  }

  function advance(scene) {
    if (scene.over || scene.stage.typing) return;
    if (scene.rt.next()) show(scene);
  }

  function pick(scene, i) {
    if (scene.over || scene.stage.typing) return;
    var list = scene.rt.choices();
    if (!list[i]) return;
    scene.stage.highlight(i);
    scene.stage.choices.enabled = false;
    scene.time.delayedCall(180, function () {
      scene.stage.choices.enabled = true;
      if (scene.rt.choose(i)) show(scene);
    });
  }

  function finish(scene) {
    var end = scene.rt.ended();
    if (!end) return;
    scene.over = true;
    global.ZV.finish(scene, {
      score: 0,
      hideScore: true,
      won: end.won !== false,
      title: end.title || "Конец",
      text: end.text || "",
      prize: end.prize || null,
      outcome: end.outcome,
      meta: { archetype: "quest", ending: end.outcome, steps: scene.rt.history.length, items: scene.rt.inventory(), vars: scene.rt.vars }
    });
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.quest = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
