// Кит «Какой ты»: вопросы без правильных ответов — каждый вариант даёт баллы
// типам, в конце побеждает тип с максимумом. Результат — портрет типа и его
// приз. Данные — content/persona.json (game/content.js проверяет: все типы
// достижимы, веса на существующие типы). Ассетов не требует.
(function (global) {
  "use strict";

  // Настройки по умолчанию; правятся в config.params (те же ключи).
  var DEFAULTS = {
    timePerQuestion: 0,     // секунд на вопрос; 0 — без таймера (тесты «какой ты» не торопят)
    questionsPerRound: 0,   // сколько вопросов показать; 0 — все
    shuffleQuestions: true,
    shuffleAnswers: true
  };
  var S = DEFAULTS;

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    global.ZV.loadContent(this, "persona");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;
    this.add.rectangle(W / 2, H / 2, W, H, 0x101018);

    S = ZV.params(DEFAULTS);
    var c = ZV.content(this, "persona");
    this.over = false;
    this.deadline = 0;
    if (c.errors.length) {
      this.over = true;
      ZV.ui.fail(this, "Ошибки в content/persona.json", c.errors);
      return;
    }

    this.types = c.data.types;
    this.tally = {};
    this.types.forEach(function (t) { self.tally[t.id] = 0; });
    this.index = 0;
    this.order = c.data.questions.slice();
    if (S.shuffleQuestions) ZV.random.shuffle(this.order);
    if (S.questionsPerRound > 0) this.order = this.order.slice(0, S.questionsPerRound);
    if (S.shuffleAnswers) {
      this.order = this.order.map(function (q) {
        return { q: q.q, answers: ZV.random.shuffle(q.answers.slice()) };
      });
    }

    this.progressText = ZV.ui.text(this, W / 2, 55, "", {
      fontSize: "16px", color: "#9aa0b5"
    }).setOrigin(0.5).setDepth(5);
    this.timeText = ZV.ui.text(this, W - 20, 55, "", {
      fontSize: "24px", color: ZV.SECONDARY
    }).setOrigin(1, 0.5).setDepth(5);
    this.questionText = ZV.ui.text(this, W / 2, 170, "", {
      fontSize: "24px", align: "center", wordWrap: { width: W - 60 }
    }).setOrigin(0.5);

    this.choices = ZV.ui.choices(this, { y: 310, step: 75, onPick: function (i) { answer(self, i); } });
    ask(this);
  };

  PlayScene.prototype.update = function () {
    if (this.over || !this.deadline) return;
    var left = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.timeText.setText(left + " с");
    if (left <= 0) answer(this, -1);
  };

  function ask(scene) {
    var item = scene.order[scene.index];
    scene.questionText.setText(item.q);
    scene.progressText.setText((scene.index + 1) + " / " + scene.order.length);
    scene.choices.set(item.answers.map(function (a) { return a.text; }));
    scene.deadline = S.timePerQuestion > 0 ? scene.time.now + S.timePerQuestion * 1000 : 0;
    if (!scene.deadline) scene.timeText.setText("");
    scene.locked = false;
  }

  // Верного ответа нет: подсвечиваем выбранный, копим баллы. Пропуск по
  // таймеру баллов не даёт.
  function answer(scene, picked) {
    if (scene.over || scene.locked) return;
    scene.locked = true;
    scene.deadline = 0;
    var item = scene.order[scene.index];
    if (picked >= 0) {
      scene.choices.color(picked, Phaser.Display.Color.HexStringToColor(global.ZV.PRIMARY).color);
      var w = item.answers[picked].weights || {};
      for (var k in w) {
        if (Object.prototype.hasOwnProperty.call(w, k) && typeof scene.tally[k] === "number") scene.tally[k] += w[k];
      }
    }
    scene.nextCall = scene.time.delayedCall(picked >= 0 ? 450 : 0, function () {
      scene.index += 1;
      if (scene.index >= scene.order.length) finish(scene);
      else ask(scene);
    });
  }

  // Победитель — максимум баллов; при равенстве первый по порядку в файле:
  // порядок типов и есть приоритет, задаётся автором.
  function winner(scene) {
    var best = scene.types[0];
    for (var i = 1; i < scene.types.length; i++) {
      if (scene.tally[scene.types[i].id] > scene.tally[best.id]) best = scene.types[i];
    }
    return best;
  }

  function finish(scene) {
    scene.over = true;
    var t = winner(scene);
    global.ZV.finish(scene, {
      score: 0,
      hideScore: true,
      won: true,
      title: "Ты — " + t.title,
      text: t.text || "",
      prize: t.prize || null,
      outcome: t.id,
      meta: { archetype: "persona", type: t.id, tally: scene.tally }
    });
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.persona = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
