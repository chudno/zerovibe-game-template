// Кит «Викторина»: вопрос и до четырёх ответов, на каждый вопрос таймер.
// Чем дальше, тем меньше времени. Ассетов не требует — только текст.
// Вопросы — в content/quiz.json (формат и проверка — game/content.js),
// баланс — в config.params. Канва 360×640; текст — через ZV.ui.
(function (global) {
  "use strict";

  // Настройки по умолчанию; правятся в config.params (те же ключи).
  var DEFAULTS = {
    timeStart: 15,        // секунд на первый вопрос
    timeMin: 6,           // нижняя граница
    timeStep: 1,          // на сколько сокращается таймер с каждым вопросом
    points: 10,           // очки за верный ответ
    bonusPerSec: 1,       // бонус за каждую оставшуюся секунду
    passScore: 30,        // порог победы
    questionsPerRound: 0, // сколько вопросов в раунде; 0 — все из файла
    shuffleAnswers: false // перемешивать ли варианты (correct пересчитывается)
  };
  var S = DEFAULTS;

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    global.ZV.loadContent(this, "quiz");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;
    this.add.rectangle(W / 2, H / 2, W, H, 0x101018);

    S = ZV.params(DEFAULTS);
    var c = ZV.content(this, "quiz");
    this.over = false;
    this.deadline = 0;
    if (c.errors.length) {
      this.over = true;
      ZV.ui.fail(this, "Ошибки в content/quiz.json", c.errors);
      return;
    }

    this.score = 0;
    this.index = 0;
    this.order = ZV.random.shuffle(c.data.questions.slice());
    if (S.questionsPerRound > 0) this.order = this.order.slice(0, S.questionsPerRound);
    if (S.shuffleAnswers) this.order = this.order.map(shuffleAnswers);

    this.scoreText = ZV.ui.text(this, 20, 55, "0", {
      fontSize: "32px", fontStyle: "bold"
    }).setOrigin(0, 0.5).setDepth(5);
    this.timeText = ZV.ui.text(this, W - 20, 55, "", {
      fontSize: "24px", color: ZV.SECONDARY
    }).setOrigin(1, 0.5).setDepth(5);
    this.progressText = ZV.ui.text(this, W / 2, 55, "", {
      fontSize: "16px", color: "#9aa0b5"
    }).setOrigin(0.5).setDepth(5);

    this.questionText = ZV.ui.text(this, W / 2, 170, "", {
      fontSize: "24px",
      align: "center", wordWrap: { width: W - 60 }
    }).setOrigin(0.5);

    // Шаг 75 при высоте кнопки 64: тач-цель заведомо больше 24 логических px.
    this.choices = ZV.ui.choices(this, { y: 310, step: 75, onPick: function (i) { answer(self, i); } });

    ask(this);
  };

  PlayScene.prototype.update = function () {
    if (this.over || !this.deadline) return;
    var left = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.timeText.setText(left + " с");
    if (left <= 0) answer(this, -1);
  };

  // Варианты вперемешку, индекс верного следует за своим текстом.
  function shuffleAnswers(item) {
    var idx = item.answers.map(function (_, i) { return i; });
    global.ZV.random.shuffle(idx);
    return {
      q: item.q,
      answers: idx.map(function (i) { return item.answers[i]; }),
      correct: idx.indexOf(item.correct)
    };
  }

  function ask(scene) {
    var item = scene.order[scene.index];
    scene.questionText.setText(item.q);
    scene.progressText.setText((scene.index + 1) + " / " + scene.order.length);
    scene.choices.set(item.answers);
    scene.limit = Math.max(S.timeMin, S.timeStart - scene.index * S.timeStep);
    scene.deadline = scene.time.now + scene.limit * 1000;
    scene.locked = false;
  }

  function answer(scene, picked) {
    if (scene.over || scene.locked) return;
    scene.locked = true;
    var item = scene.order[scene.index];
    var left = Math.max(0, Math.ceil((scene.deadline - scene.time.now) / 1000));
    var right = picked === item.correct;

    scene.choices.color(item.correct, 0x2e9e5b);
    if (picked >= 0 && !right) scene.choices.color(picked, 0xa33b45);

    if (right) {
      scene.score += S.points + left * S.bonusPerSec;
      scene.scoreText.setText(String(scene.score));
    }

    scene.nextCall = scene.time.delayedCall(700, function () {
      scene.index += 1;
      if (scene.index >= scene.order.length) finish(scene);
      else ask(scene);
    });
  }

  function finish(scene) {
    scene.over = true;
    scene.deadline = 0;
    global.ZV.finish(scene, {
      score: scene.score,
      won: scene.score >= S.passScore,
      text: "очков за викторину",
      meta: { archetype: "quiz", questions: scene.order.length }
    });
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.quiz = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
