// Кит «Новелла»: сюжет — граф узлов в content/novel.json (фон, портрет,
// реплика, варианты ответа или «дальше»), переменные с условиями, концовки с
// исходом. Граф, проверка и рантайм — game/novel.js; сцена (фон, портрет,
// панель с печатью, варианты) — game/stage.js; здесь только ход сюжета.
(function (global) {
  "use strict";

  var N = global.ZV_NOVEL;
  var STAGE = global.ZV_STAGE;

  // Настройки по умолчанию; правятся в config.params (те же ключи).
  var DEFAULTS = {
    typeMs: 22,          // мс на букву при печати реплики; 0 — сразу целиком
    tapReveals: true,    // тап во время печати показывает реплику целиком
    autoNextMs: 0,       // линейный узел сам идёт дальше через столько мс после печати; 0 — по тапу
    startNode: ""        // с какого узла начинать (отладка); пусто — start из файла
  };
  var S = DEFAULTS;

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    STAGE.preload(this, [{ assets: "backgrounds", prefix: "bg:" }, { assets: "portraits", prefix: "pt:" }]);
    global.ZV.loadContent(this, "novel");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    S = ZV.params(DEFAULTS);
    this.over = false;
    var c = ZV.content(this, "novel");
    if (c.errors.length) {
      this.over = true;
      ZV.ui.fail(this, "Ошибки в content/novel.json", c.errors);
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
    // Печать — поле сцены (автопрогон); configurable: сцена переиспользуется
    // («Ещё раз» → create() снова), иначе второй defineProperty падает.
    Object.defineProperty(this, "typing", { configurable: true, get: function () { return self.stage.typing; } });
    this.waitNext = 0;
    show(this);
  };

  PlayScene.prototype.update = function (time, delta) {
    if (this.over) return;
    if (this.stage.tick(delta)) typed(this);
    if (this.stage.typing) return;
    if (this.waitNext && time >= this.waitNext) { this.waitNext = 0; advance(this); }
  };

  // Показать текущий узел: фон, портрет, говорящий, реплика с печатью.
  function show(scene) {
    var n = scene.rt.node();
    var id = scene.rt.id();
    scene.stage.setBackground(n.bg);
    scene.stage.setPortrait(n.portrait);
    scene.stage.say(n.speaker, n.text);
    scene.waitNext = 0;
    // Глава — событие progress один раз на вход в узел-начало главы.
    var ch = scene.data.chapters || [];
    var ci = ch.indexOf(id);
    if (ci >= 0 && !scene.chaptersSeen[id]) {
      scene.chaptersSeen[id] = true;
      global.ZV.progress(scene, { step: ci + 1, total: ch.length, meta: { node: id } });
    }
  }

  // Реплика напечатана: показать варианты или подсказку «дальше».
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
      meta: { archetype: "novel", ending: end.outcome, steps: scene.rt.history.length, vars: scene.rt.vars }
    });
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.novel = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
