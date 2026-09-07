// Кит «Викторина»: вопрос и четыре ответа, на каждый вопрос таймер.
// Чем дальше, тем меньше времени. Ассетов не требует — только текст.
// Канва 360×640; текст — через ZV.ui.text (пиксельный шрифт и resolution).
(function (global) {
  "use strict";

  var S = {
    timeStart: 15,   // секунд на первый вопрос
    timeMin: 6,      // нижняя граница
    timeStep: 1,     // на сколько сокращается таймер с каждым вопросом
    points: 10,      // очки за верный ответ
    bonusPerSec: 1,  // бонус за каждую оставшуюся секунду
    passScore: 30    // порог победы
  };

  // Вопросы. Правильный — индекс в answers (нумерация с нуля).
  var QUESTIONS = [
    { q: "Какой сейчас век?", answers: ["XIX", "XX", "XXI", "XXII"], correct: 2 },
    { q: "Сколько сторон у шестиугольника?", answers: ["4", "5", "6", "8"], correct: 2 },
    { q: "Что тяжелее: килограмм пуха или килограмм железа?", answers: ["Пух", "Железо", "Одинаково", "Смотря где"], correct: 2 },
    { q: "Сколько минут в двух часах?", answers: ["100", "120", "60", "180"], correct: 1 },
    { q: "Какого цвета небо в ясный день?", answers: ["Зелёное", "Синее", "Красное", "Жёлтое"], correct: 1 }
  ];

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.create = function () {
    var W = global.ZV.WIDTH, H = global.ZV.HEIGHT;
    this.add.rectangle(W / 2, H / 2, W, H, 0x101018);

    this.score = 0;
    this.index = 0;
    this.over = false;
    this.order = shuffle(QUESTIONS.slice());

    var ZV = global.ZV;
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

    this.buttons = [];
    for (var i = 0; i < 4; i++) {
      this.buttons.push(makeAnswer(this, i));
    }

    ask(this);
  };

  PlayScene.prototype.update = function () {
    if (this.over || !this.deadline) return;
    var left = Math.max(0, Math.ceil((this.deadline - this.time.now) / 1000));
    this.timeText.setText(left + " с");
    if (left <= 0) answer(this, -1);
  };

  function makeAnswer(scene, i) {
    var W = global.ZV.WIDTH;
    // Шаг 75 при высоте кнопки 64: тач-цель заведомо больше 24 логических px.
    var y = 310 + i * 75;
    var box = scene.add.rectangle(W / 2, y, W - 60, 64, 0x2a2f45)
      .setOrigin(0.5).setInteractive({ useHandCursor: true });
    box.setStrokeStyle(2, 0xffffff, 0.12);
    var text = global.ZV.ui.text(scene, W / 2, y, "", {
      fontSize: "18px",
      align: "center", wordWrap: { width: W - 90 }
    }).setOrigin(0.5);
    box.on("pointerup", function () { answer(scene, i); });
    return { box: box, text: text };
  }

  function ask(scene) {
    var item = scene.order[scene.index];
    scene.questionText.setText(item.q);
    scene.progressText.setText((scene.index + 1) + " / " + scene.order.length);
    for (var i = 0; i < scene.buttons.length; i++) {
      var b = scene.buttons[i];
      b.text.setText(item.answers[i] || "");
      b.box.setFillStyle(0x2a2f45);
      b.box.setVisible(!!item.answers[i]);
      b.text.setVisible(!!item.answers[i]);
    }
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

    scene.buttons[item.correct].box.setFillStyle(0x2e9e5b);
    if (picked >= 0 && !right) scene.buttons[picked].box.setFillStyle(0xa33b45);

    if (right) {
      scene.score += S.points + left * S.bonusPerSec;
      scene.scoreText.setText(String(scene.score));
    }

    scene.time.delayedCall(700, function () {
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

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.quiz = {
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
