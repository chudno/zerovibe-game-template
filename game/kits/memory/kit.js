// Кит «Память-пары»: карточки рубашкой вверх, тап открывает; две одинаковые
// остаются, разные закрываются. Ход тратится на ПАРУ, не на тап. Раскладку
// (ровно 2·pairs значений, каждое дважды) считает чистый game/memory.js,
// координаты ячеек — ZV.grid, все паузы — ZV.timeline (один на сцену, clear в
// shutdown). Раунды и словарь карточек — content/memory.json.
// Канва 360×640, пиксель-арт: масштаб иконок только 1 или 1/n.
(function (global) {
  "use strict";

  // Настройки по умолчанию; правятся в config.params (те же ключи).
  var DEFAULTS = {
    peekMs: 800,         // сколько несовпавшая пара остаётся открытой
    openMs: 140,         // «переворот»: рубашка → узкая полоса → лицо
    matchMs: 320,        // пауза после второй карточки, до сравнения (успеть увидеть)
    previewMs: 1200,     // подглядка в начале раунда: все карточки открыты; 0 — без неё
    moves: 0,            // лимит ходов на раунд (0 — без лимита; rounds[].moves перебивает)
    timeLimit: 0,        // лимит времени на раунд, мс (0 — без)
    mistakePenalty: 0,   // очков за промах (0 — без наказания: ход уже потрачен)
    pairPoints: 10,      // очков за пару
    streakBonus: 5,      // добавка за пару сразу после пары
    roundBonus: 25,      // очков за пройденный раунд
    freeMistakes: 2,     // первые промахи раунда не тратят ход
    showTitles: true,    // подписи на лицевой стороне (без иконок — единственный способ различать)
    passRounds: 0        // сколько раундов достаточно для победы (0 — все)
  };
  var S = DEFAULTS;

  // Поле карточек: те же числа, что в MEMORY_BOARD валидатора (game/content.js).
  var BOARD = { x: 12, y: 150, w: 336, h: 400, gap: 8, maxCols: 5 };
  var BACK_COLOR = 0x2a2f45;
  var PALETTE = [0x4f7cff, 0xff5f6d, 0x2e9e5b, 0xd9a100, 0x9b59b6, 0x1abc9c];

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var items = a.items || {};
    var bg = a.background || {};
    for (var k in items) {
      if (Object.prototype.hasOwnProperty.call(items, k) && items[k] && items[k].url) this.load.image("it:" + k, items[k].url);
    }
    this.bgTile = !!bg.tile;
    if (bg.url) this.load.image("bg", bg.url);
    this.failedKeys = {};
    this.load.on("loaderror", function (file) { this.failedKeys[file.key] = true; }, this);
    global.ZV.loadContent(this, "memory");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    S = ZV.params(DEFAULTS);
    this.over = false;

    // Параметры кита едут в валидатор: лимит ходов из config.params должен
    // проверяться тем же порогом, что и rounds[].moves (иначе непроходимая
    // партия проходит проверку молча).
    var c = ZV.content(this, "memory", { moves: S.moves });
    if (c.errors.length) {
      this.over = true;
      ZV.ui.fail(this, "Ошибки в content/memory.json", c.errors);
      return;
    }
    this.data = c.data;
    this.rounds = c.data.rounds;

    // Один таймлайн на сцену: все паузы кита живут в нём, а shutdown его
    // гасит — иначе на «Ещё раз» хвост прошлой партии закроет чужие карточки.
    this.tl = ZV.timeline.create();
    this.events.once("shutdown", function () { self.tl.clear(); });

    // Рекорд — удобство, не условие: партия целиком проходится при пустом
    // хранилище (отказ хранилища ZV.save переживает сам).
    this.slot = ZV.save.open("memory", ZV.save.version([c.data, S]), { best: 0, rounds: 0 });
    this.best = this.slot.get().best;

    ZV.ui.backdrop(this);
    drawBackground(this, ZV.WIDTH, ZV.HEIGHT);

    this.score = 0;
    this.roundIndex = 0;
    this.roundsDone = 0;
    this.mistakes = 0;
    this.movesUsed = 0;
    this.bestStreak = 0;

    this.scoreText = ZV.ui.text(this, ZV.WIDTH / 2, 46, "0", { size: 3 }).setOrigin(0.5).setDepth(5);
    this.roundText = ZV.ui.text(this, ZV.WIDTH / 2, 82, "", { size: 1, color: "#9aa0b5", align: "center" })
      .setOrigin(0.5).setDepth(5);
    this.pairsText = ZV.ui.text(this, 16, 116, "", { size: 1, color: "#e6e8f0" }).setOrigin(0, 0.5).setDepth(5);
    this.movesText = ZV.ui.text(this, ZV.WIDTH - 16, 116, "", { size: 1, color: "#9aa0b5" }).setOrigin(1, 0.5).setDepth(5);
    this.hintText = ZV.ui.text(this, ZV.WIDTH / 2, ZV.HEIGHT - 34, "", { size: 1, color: "#9aa0b5", align: "center" })
      .setOrigin(0.5).setDepth(5);

    this.cards = [];
    // Тап по канве: попадание в ячейку считает ZV.grid.hit — своих
    // прямоугольников-кнопок нет, тач-цель гарантирует сетка.
    this.input.on("pointerup", function (p) { tap(self, p.x, p.y); });

    startRound(this);
  };

  PlayScene.prototype.update = function (time, delta) {
    if (this.over) return;
    this.tl.update(delta);
    if (this.deadline) {
      var left = Math.max(0, Math.ceil((this.deadline - time) / 1000));
      this.timeLeft = left;
      updateHud(this);
      if (left <= 0) endRound(this, false);
    }
  };

  // --- раунд ------------------------------------------------------------------
  function startRound(scene) {
    var ZV = global.ZV;
    var round = scene.rounds[scene.roundIndex];
    var deal = global.ZV_MEMORY.deal(round, scene.data.cards, ZV.random);

    clearCards(scene);
    scene.pairsTotal = deal.pairs;
    scene.found = 0;
    scene.open = [];
    scene.buffered = -1;
    scene.streak = 0;
    scene.roundMistakes = 0;
    scene.roundMoves = 0;
    scene.movesLimit = Number.isInteger(round.moves) && round.moves > 0 ? round.moves : S.moves;
    scene.movesLeft = scene.movesLimit > 0 ? scene.movesLimit : 0;
    scene.started = false;                     // ходы и время не тикают до первого тапа
    scene.deadline = 0;
    scene.timeLeft = 0;

    var lay = ZV.grid.best(deal.values.length, { x: BOARD.x, y: BOARD.y, w: BOARD.w, h: BOARD.h },
      { min: { w: 24, h: 24 }, gap: BOARD.gap, aspect: 1, maxCols: BOARD.maxCols });
    if (!lay.fits) {
      scene.over = true;
      ZV.ui.fail(scene, "Ошибки в content/memory.json", ["rounds[" + scene.roundIndex + "].pairs: " + lay.reason]);
      return;
    }
    scene.layout = lay;

    var byId = {};
    scene.data.cards.forEach(function (c) { byId[c.id] = c; });
    deal.values.forEach(function (id, i) {
      scene.cards.push(makeCard(scene, lay.cells[i], byId[id], id));
    });

    scene.roundText.setText(round.name + (round.hint ? "\n" + round.hint : ""));
    scene.hintText.setText("Раунд " + (scene.roundIndex + 1) + " из " + scene.rounds.length);
    updateHud(scene);

    // Подглядка: без неё первые ходы — лотерея, а не память (см. README).
    if (S.previewMs > 0) {
      scene.peeking = true;
      scene.cards.forEach(function (card) { setFace(scene, card, true); });
      scene.tl.add(S.previewMs, function () {
        scene.peeking = false;
        scene.cards.forEach(function (card) { if (!card.matched) setFace(scene, card, false); });
      });
    } else {
      scene.peeking = false;
    }
  }

  // Сколько раундов нужно для победы. passRounds зажат числом раскладов:
  // passRounds 5 при трёх раундах иначе делает победу невозможной в принципе.
  function passNeed(scene) {
    return S.passRounds > 0 ? Math.min(S.passRounds, scene.rounds.length) : scene.rounds.length;
  }

  function endRound(scene, cleared) {
    if (scene.over) return;
    scene.deadline = 0;
    if (cleared) {
      scene.roundsDone += 1;
      scene.score += S.roundBonus;
    }
    var need = passNeed(scene);
    global.ZV.progress(scene, {
      step: scene.roundIndex + 1, total: scene.rounds.length,
      meta: { pairs: scene.found, moves: scene.movesUsed, mistakes: scene.mistakes, cleared: !!cleared }
    });
    // Раунд не закрыт (кончились ходы или время) — партия кончается сразу:
    // «ещё разок с половиной поля» ощущается как наказание без цели.
    if (!cleared) { finish(scene); return; }
    if (scene.roundsDone >= need || scene.roundIndex + 1 >= scene.rounds.length) { finish(scene); return; }
    scene.roundIndex += 1;
    scene.tl.add(600, function () { startRound(scene); });
  }

  function finish(scene) {
    if (scene.over) return;
    scene.over = true;
    scene.tl.clear();
    var won = scene.roundsDone >= passNeed(scene);
    var record = scene.score > scene.best;
    if (record) scene.slot.set({ best: scene.score, rounds: scene.roundsDone });
    global.ZV.finish(scene, {
      score: scene.score,
      won: won,
      text: "очков",
      meta: {
        archetype: "memory", rounds: scene.roundsDone, pairs: scene.found,
        mistakes: scene.mistakes, moves: scene.movesUsed, bestStreak: scene.bestStreak, record: record
      }
    });
  }

  // --- карточки ---------------------------------------------------------------
  function makeCard(scene, cell, def, id) {
    var ZV = global.ZV;
    def = def || { id: id, title: id };
    var color = def.color ? Phaser.Display.Color.HexStringToColor(def.color).color : PALETTE[hash(id) % PALETTE.length];
    var box = scene.add.rectangle(cell.cx, cell.cy, cell.w, cell.h, BACK_COLOR).setDepth(1);
    box.setStrokeStyle(2, 0xffffff, 0.12);
    // Рубашка: картинка items.back, если задана, иначе знак «?» на заливке.
    var back = null, mark = null;
    if (hasIcon(scene, "it:back")) {
      back = scene.add.image(cell.cx, cell.cy, "it:back").setDepth(2);
      fitIcon(scene, back, "it:back", cell.w - 4);
    } else {
      mark = ZV.ui.text(scene, cell.cx, cell.cy, "?", { size: 2, color: "#9aa0b5" }).setOrigin(0.5).setDepth(2);
    }
    var title = null, icon = null;
    if (S.showTitles) {
      title = ZV.ui.text(scene, cell.cx, cell.cy, def.title || id, {
        size: 1, color: "#101018", align: "center", wordWrap: { width: cell.w - 6 }
      }).setOrigin(0.5).setDepth(3).setVisible(false);
    }
    var iconKey = "it:" + (def.icon || id);
    if (def.icon && hasIcon(scene, iconKey)) {
      icon = scene.add.image(cell.cx, cell.cy - (title ? 8 : 0), iconKey).setDepth(3).setVisible(false);
      fitIcon(scene, icon, iconKey, cell.w - 8);
    }
    return { id: id, cell: cell, box: box, back: back, mark: mark, title: title, icon: icon, color: color, face: false, matched: false };
  }

  function hasIcon(scene, key) {
    return scene.textures.exists(key) && !scene.failedKeys[key];
  }

  // Масштаб только 1/n (прореживание пикселей), как на полке квеста: дробный
  // размер размазал бы пиксель-арт.
  function fitIcon(scene, img, key, max) {
    var src = scene.textures.get(key).getSourceImage();
    var down = Math.max(1, Math.ceil(Math.max(src.width, src.height) / Math.max(1, max)));
    if (down > 1) img.setScale(1 / down);
  }

  function clearCards(scene) {
    scene.cards.forEach(function (card) {
      card.box.destroy();
      if (card.back) card.back.destroy();
      if (card.mark) card.mark.destroy();
      if (card.title) card.title.destroy();
      if (card.icon) card.icon.destroy();
    });
    scene.cards = [];
  }

  // Переворот без дробного масштаба: кадр «на ребре» — узкая полоса той же
  // высоты (целые пиксели), через openMs — нужная сторона.
  function flip(scene, card, toFace) {
    var narrow = Math.max(4, Math.round(card.cell.w / 4));
    card.box.setSize(narrow, card.cell.h);
    if (card.back) card.back.setVisible(false);
    if (card.mark) card.mark.setVisible(false);
    if (card.title) card.title.setVisible(false);
    if (card.icon) card.icon.setVisible(false);
    scene.tl.add(S.openMs, function () {
      card.box.setSize(card.cell.w, card.cell.h);
      setFace(scene, card, toFace);
    });
  }

  function setFace(scene, card, on) {
    card.face = !!on;
    card.box.setSize(card.cell.w, card.cell.h);
    card.box.setFillStyle(on ? card.color : BACK_COLOR);
    if (card.back) card.back.setVisible(!on);
    if (card.mark) card.mark.setVisible(!on);
    if (card.title) card.title.setVisible(on);
    if (card.icon) card.icon.setVisible(on);
  }

  // --- ход --------------------------------------------------------------------
  function tap(scene, x, y) {
    if (scene.over || scene.peeking) return;
    var i = global.ZV.grid.hit(scene.layout, x, y);
    if (i < 0 || !scene.cards[i]) return;
    // Тап в блокировке не теряется, а ждёт своей очереди: без буфера игра
    // ощущается тормозной, человек тычет второй раз и путается.
    if (scene.tl.busy()) { scene.buffered = i; return; }
    openCard(scene, i);
  }

  function openCard(scene, i) {
    var card = scene.cards[i];
    if (!card || card.matched || card.face) return;         // второй тап по той же карточке — ничего
    if (scene.open.length >= 2) return;
    if (!scene.started) {
      scene.started = true;
      if (S.timeLimit > 0) scene.deadline = scene.time.now + S.timeLimit;
    }
    flip(scene, card, true);
    scene.open.push(i);
    // Вторая карточка сравнивается НЕ в том же шаге, что её переворот: иначе
    // она видна ноль кадров — ни человеку, ни боту («открыл и сразу закрылось»).
    if (scene.open.length === 2) scene.tl.wait(S.matchMs).then(function () { resolvePair(scene); });
    else scene.tl.then(function () { drain(scene); });
  }

  // Отложенный тап играется, как только лента освободилась.
  function drain(scene) {
    if (scene.over || scene.buffered < 0) return;
    var i = scene.buffered;
    scene.buffered = -1;
    openCard(scene, i);
  }

  function resolvePair(scene) {
    var a = scene.cards[scene.open[0]], b = scene.cards[scene.open[1]];
    scene.open = [];
    if (!a || !b) return;
    if (a.id === b.id) {
      match(scene, a, b);
      return;
    }
    miss(scene, a, b);
  }

  function match(scene, a, b) {
    var ZV = global.ZV;
    a.matched = b.matched = true;
    scene.found += 1;
    scene.streak += 1;
    if (scene.streak > scene.bestStreak) scene.bestStreak = scene.streak;
    var gain = S.pairPoints + (scene.streak > 1 ? S.streakBonus : 0);
    scene.score += gain;
    spendMove(scene);

    [a, b].forEach(function (card) {
      card.box.setStrokeStyle(3, Phaser.Display.Color.HexStringToColor(ZV.SECONDARY).color, 1);
      ZV.juice.dust(scene, card.cell.cx, card.cell.cy, Phaser.Display.Color.HexStringToColor(ZV.SECONDARY).color);
      // Найденная пара гаснет: остаток поля читается сразу, без пересчёта глазами.
      scene.tl.add(240, function () {
        card.box.setAlpha(0.55);
        if (card.title) card.title.setAlpha(0.55);
        if (card.icon) card.icon.setAlpha(0.55);
      });
    });
    popup(scene, Math.round((a.cell.cx + b.cell.cx) / 2), Math.round((a.cell.cy + b.cell.cy) / 2), "+" + gain);
    updateHud(scene);

    var last = scene.found >= scene.pairsTotal;
    // Последняя пара бьёт сильнее — «поле закрыто» читается без надписи.
    scene.cameras.main.shake(last ? 140 : 90, last ? 0.006 : 0.003);
    if (last) { scene.tl.add(420, function () { endRound(scene, true); }); return; }
    scene.tl.then(function () { drain(scene); });
    checkMoves(scene);
  }

  function miss(scene, a, b) {
    scene.streak = 0;
    scene.roundMistakes += 1;
    scene.mistakes += 1;
    if (S.mistakePenalty > 0) scene.score = Math.max(0, scene.score - S.mistakePenalty);
    // Первые промахи раунда бесплатны: проиграть в первые секунды нельзя.
    if (scene.roundMistakes > S.freeMistakes) spendMove(scene);
    scene.cameras.main.shake(90, 0.004);
    updateHud(scene);
    scene.tl.add(S.peekMs, function () {
      flip(scene, a, false);
      flip(scene, b, false);
      scene.tl.then(function () { drain(scene); });
      checkMoves(scene);
    });
  }

  // Лимит ходов — на раунд, movesUsed копится за партию: отсюда два счётчика.
  function spendMove(scene) {
    scene.movesUsed += 1;
    scene.roundMoves += 1;
    if (scene.movesLimit > 0) scene.movesLeft = Math.max(0, scene.movesLimit - scene.roundMoves);
  }

  function checkMoves(scene) {
    if (scene.over || scene.movesLimit <= 0) return;
    if (scene.movesLeft <= 0 && scene.found < scene.pairsTotal) scene.tl.then(function () { endRound(scene, false); });
  }

  function popup(scene, x, y, text) {
    var t = global.ZV.ui.text(scene, x, y - 8, text, { size: 2, color: global.ZV.SECONDARY }).setOrigin(0.5).setDepth(9);
    // Всплытие целыми пикселями: шесть шагов по 4 px вместо твина с дробью.
    scene.tl.repeat(6, 40, function (i) {
      t.y = y - 8 - (i + 1) * 4;
      if (i >= 4) t.setAlpha(i >= 5 ? 0 : 0.5);
      if (i === 5) t.destroy();
    });
  }

  function updateHud(scene) {
    scene.scoreText.setText(String(scene.score));
    scene.pairsText.setText("пары " + scene.found + "/" + scene.pairsTotal);
    var parts = [];
    if (scene.movesLimit > 0) parts.push("ходы " + scene.movesLeft);
    if (scene.deadline) parts.push(scene.timeLeft + " с");
    scene.movesText.setText(parts.join("  "));
    // Ходов в обрез — счётчик краснеет: напряжение видно, а не подразумевается.
    var tight = scene.movesLimit > 0 && scene.movesLeft <= 3;
    scene.movesText.setTint(Phaser.Display.Color.HexStringToColor(tight ? "#ff5f6d" : "#9aa0b5").color);
  }

  function hash(s) {
    var h = 7;
    for (var i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0;
    return h;
  }

  function drawBackground(scene, W, H) {
    if (!scene.textures.exists("bg") || scene.failedKeys.bg) return false;
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

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.memory = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
