// Кит «Собери заказ»: по ленте едут предметы, внизу 2–4 корзины. Тап по
// КОРЗИНЕ отправляет туда текущий предмет — тот, что ближе всех к линии
// сброса. Мусор (bin: "junk") надо пропустить, не тапая ничего. Жизнь
// снимается только за неверную корзину: ошибиться страшно, не успеть — нет.
// Предмет нейтрального цвета с подписью: игра про «куда это относится», а не
// про угадывание цвета. Темп держит game/sort.js (инвариант окна реакции).
// Картинки подставляются только через ZV.sprite.apply, канва 360×640,
// пиксель-арт: масштаб спрайтов всегда 1.
(function (global) {
  "use strict";

  // Настройки по умолчанию; правятся в config.params (те же ключи), S
  // собирается в create через ZV.params.
  var DEFAULTS = {
    duration: 45000,     // длительность раунда, мс
    beltSpeed: 90,       // стартовая скорость ленты, px/с
    beltMax: 190,        // потолок скорости (выше — game/sort.js ругается числом)
    beltStep: 4,         // прибавка скорости за каждый разобранный предмет
    spacing: 150,        // расстояние между предметами на ленте, px
    lives: 3,            // ошибок до конца раунда
    freeMistakes: 2,     // первые N ошибок не снимают жизнь
    hitPoints: 10,       // очки за верную корзину (умножаются на серию)
    junkPoints: 5,       // очки за верно пропущенный мусор
    missPenalty: 0,      // штраф очками за неверную корзину
    junkChance: 0.12,    // доля мусора в начале партии
    junkChanceMax: 0.28, // доля мусора к концу
    streakStep: 5,       // сколько верных подряд дают +1 к множителю
    streakMax: 3,        // потолок множителя
    targetItems: 0,      // разобрать столько предметов для победы (0 — по passScore)
    passScore: 150,      // очков для победы
    showBinHint: true    // первые 5 предметов подписаны названием корзины
  };
  var S = DEFAULTS;

  // Раскладка. Числа те же, что в game/sort.js: линия сброса и ширина
  // предмета участвуют в инварианте темпа, менять их надо там и тут вместе.
  var BELT = { y: 392, h: 64, tick: 16 };
  var ITEM = { size: 40, y: 392, spawnX: -40, dropX: 300, gone: 340, label: 438 };
  var BINS = { top: 512, h: 96 };
  var HUD = { score: 58, lives: 96 };
  var NEUTRAL = 0xe6e8f0;          // предмет нейтрален: подсказка — подпись, не цвет
  var RUSH_MS = 10000;             // последние 10 с: белая полоса и ускорение
  var HINT_ITEMS = 5;              // сколько первых предметов подписаны корзиной

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  // Картинки: config.assets.items по ключу icon предмета и bin_<id> корзины.
  // Контент ещё не загружен, поэтому грузим ВСЕ ключи items — лишние просто
  // не пригодятся; сопоставление с предметом идёт уже в create.
  PlayScene.prototype.preload = function () {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var items = a.items || {}, bg = a.background || {}, k;
    for (k in items) {
      if (Object.prototype.hasOwnProperty.call(items, k) && items[k] && items[k].url) {
        this.load.image("it:" + k, items[k].url);
      }
    }
    this.bgTile = !!bg.tile;
    if (bg.url) this.load.image("bg", bg.url);
    this.load.on("loaderror", function (file) {
      if (file.key === "bg") this.bgFailed = true;
    }, this);
    global.ZV.loadContent(this, "sort");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;

    S = ZV.params(DEFAULTS);
    this.over = true;   // до успешной проверки контента сцена ничего не делает

    var c = ZV.content(this, "sort", { params: S });
    if (c.errors.length) {
      ZV.ui.fail(this, "Ошибки в content/sort.json", c.errors);
      return;
    }
    this.over = false;
    this.data = c.data;

    // Пул: корзина предмета — это его категория. Мусор берётся отдельным
    // выбором по категории "junk", обычный предмет — исключением мусора,
    // поэтому долю мусора задаёт junkChance, а не веса в файле.
    this.junkIds = [];
    var items = c.data.items.map(function (it) {
      if (it.bin === "junk") self.junkIds.push(it.id);
      return { id: it.id, title: it.title, icon: it.icon || it.id, category: it.bin, weight: it.weight === undefined ? 1 : it.weight };
    });
    this.pool = ZV.pool.create(items, ZV.random);
    this.hasJunk = this.junkIds.length > 0;

    this.tl = ZV.timeline.create();
    this.events.once("shutdown", function () { self.tl.clear(); });

    this.score = 0;
    this.lives = S.lives;
    this.streak = 0;
    this.bestStreak = 0;
    this.mult = 1;
    this.sorted = 0;
    this.mistakes = 0;
    this.missed = 0;
    this.junkPassed = 0;
    this.seen = 0;             // сколько предметов уже выехало (для showBinHint)
    this.speed = S.beltSpeed;
    this.topSpeed = S.beltSpeed;
    this.nextProgress = 10;
    this.items = [];
    this.sinceSpawn = S.spacing;   // первый предмет выезжает сразу
    this.rush = false;

    this.add.rectangle(W / 2, H / 2, W, H, 0x101018).setDepth(-20);
    drawBackground(this, W, H);
    buildBelt(this, W);
    buildBins(this, W);

    this.scoreText = ZV.ui.text(this, W / 2, HUD.score, "0", { size: 3 }).setOrigin(0.5).setDepth(5);
    this.multText = ZV.ui.text(this, W / 2 + 54, HUD.score, "", { size: 2, color: ZV.SECONDARY }).setOrigin(0, 0.5).setDepth(5);
    this.livesText = ZV.ui.text(this, 20, HUD.lives, "", { size: 1, color: "#9aa0b5" }).setOrigin(0, 0.5).setDepth(5);
    this.timeText = ZV.ui.text(this, W - 20, HUD.lives, "", { size: 1, color: "#9aa0b5" }).setOrigin(1, 0.5).setDepth(5);
    this.flash = ZV.ui.text(this, W / 2, 230, "", { size: 2, color: ZV.SECONDARY, align: "center" }).setOrigin(0.5).setDepth(9);
    drawLives(this);

    this.deadline = this.time.now + S.duration;
  };

  PlayScene.prototype.update = function (time, delta) {
    if (this.over) return;
    this.tl.update(delta);

    var left = Math.max(0, Math.ceil((this.deadline - time) / 1000));
    this.timeText.setText(left + " с");
    // Рывок только у партии, которая длиннее самого рывка: иначе «последние
    // секунды» начинаются на первой и разгон читается как стартовый темп.
    if (!this.rush && S.duration > RUSH_MS && this.deadline - time <= RUSH_MS) startRush(this);
    if (left <= 0) { finish(this, true); return; }

    var step = this.speed * (delta / 1000);
    moveBelt(this, step);
    moveItems(this, step);
    spawnIfDue(this, step);
  };

  // --- лента и корзины ---------------------------------------------------------

  function buildBelt(scene, W) {
    var top = BELT.y - BELT.h / 2;
    scene.add.rectangle(W / 2, BELT.y, W, BELT.h, 0x2a2f45).setDepth(0);
    scene.add.rectangle(W / 2, top + 1, W, 2, 0x3a4160).setDepth(1);
    scene.add.rectangle(W / 2, top + BELT.h - 1, W, 2, 0x3a4160).setDepth(1);
    // Насечки прямоугольниками, а не tileSprite: заглушка не степень двойки,
    // WebGL сгладил бы её вопреки pixelArt. Сдвигаются целыми пикселями.
    scene.ticks = [];
    for (var x = 0; x < W + BELT.tick; x += BELT.tick) {
      scene.ticks.push(scene.add.rectangle(x, BELT.y, 2, BELT.h - 12, 0x3a4160).setDepth(1));
    }
    scene.beltShift = 0;
    // Линия сброса: правее неё предмет уже уехал — видно, где кончается время.
    scene.add.rectangle(ITEM.dropX, BELT.y, 2, BELT.h, 0xff5f6d, 0.7).setDepth(2);
    scene.rushBar = scene.add.rectangle(W / 2, BELT.y - BELT.h / 2 - 4, W, 4, 0xffffff, 1)
      .setDepth(2).setVisible(false);
  }

  function moveBelt(scene, step) {
    scene.beltShift = (scene.beltShift + step) % BELT.tick;
    var base = Math.floor(scene.beltShift);
    for (var i = 0; i < scene.ticks.length; i++) {
      scene.ticks[i].x = i * BELT.tick + base - BELT.tick;
    }
  }

  function buildBins(scene, W) {
    var ZV = global.ZV;
    var list = scene.data.bins;
    var w = Math.floor(W / list.length);
    scene.bins = list.map(function (b, i) {
      var x = Math.round(i * w + w / 2);
      var cy = BINS.top + BINS.h / 2;
      var color = Phaser.Display.Color.HexStringToColor(b.color || "#4f7cff").color;
      // Заливка цветом корзины остаётся всегда: она и тач-цель, и подсветка.
      // Картинка bin_<id>, если её дали, ложится по центру поверх заливки.
      var box = scene.add.rectangle(x, cy, w - 4, BINS.h, color).setDepth(3)
        .setInteractive({ useHandCursor: true });
      box.setStrokeStyle(2, 0xffffff, 0.18);
      var iconKey = "it:bin_" + b.id;
      var hasIcon = scene.textures.exists(iconKey);
      if (hasIcon) scene.add.image(x, cy - 12, iconKey).setDepth(4);
      // Со значком подпись съезжает вниз — просадка обязана помнить её место,
      // а не возвращать в центр корзины.
      var labelY = cy + (hasIcon ? 30 : 0);
      var label = ZV.ui.text(scene, x, labelY, b.title, {
        size: 1, align: "center", wordWrap: { width: w - 14 }
      }).setOrigin(0.5).setDepth(4);
      var bin = { id: b.id, title: b.title, box: box, label: label, x: x, y: cy, baseY: cy, labelY: labelY, color: color };
      box.on("pointerup", function () { tapBin(scene, bin); });
      return bin;
    });
  }

  // --- поток предметов ---------------------------------------------------------

  function spawnIfDue(scene, step) {
    scene.sinceSpawn += step;
    if (scene.sinceSpawn < S.spacing) return;
    scene.sinceSpawn = 0;
    spawn(scene);
  }

  function spawn(scene) {
    var ZV = global.ZV;
    var junk = scene.hasJunk && ZV.random.chance(junkChanceNow(scene));
    var data;
    try {
      data = junk ? scene.pool.pick({ category: "junk" }) : scene.pool.pick({ exclude: scene.junkIds });
    } catch (e) {
      // Мусора нет или обычные предметы кончились — валидатор такого не
      // пропустит, но пул не должен ронять партию на живом человеке.
      return;
    }
    var x = ITEM.spawnX;
    var key = "it:" + data.icon;
    var box;
    if (scene.textures.exists(key)) {
      box = scene.add.image(x, ITEM.y, key).setDepth(6);
      // Масштаб 1: картинку под предмет рисуют 40×40, дробно её не тянем.
      global.ZV.sprite.apply(box, { origin: false });
    } else {
      // Заглушка нейтральна намеренно: цвет корзины на предмете превратил бы
      // игру в «тапай по цвету» и убил бы саму механику.
      box = scene.add.rectangle(x, ITEM.y, ITEM.size, ITEM.size, NEUTRAL).setDepth(6);
      box.setStrokeStyle(2, 0x101018, 0.5);
    }
    var title = global.ZV.ui.text(scene, x, ITEM.label, data.title, {
      size: 1, align: "center", color: "#e6e8f0"
    }).setOrigin(0.5).setDepth(6);
    var hint = null;
    if (S.showBinHint && scene.seen < HINT_ITEMS && data.category !== "junk") {
      hint = global.ZV.ui.text(scene, x, ITEM.label + 14, binTitle(scene, data.category), {
        size: 1, color: "#9aa0b5", align: "center"
      }).setOrigin(0.5).setDepth(6);
    }
    scene.seen++;
    scene.items.push({ id: data.id, bin: data.category, box: box, title: title, hint: hint, x: x, done: false });
  }

  // Доля мусора растёт линейно к концу партии: рефлекс «тапать всё» должен
  // наказываться чаще там, где темп уже высокий.
  function junkChanceNow(scene) {
    var passed = 1 - Math.max(0, Math.min(1, (scene.deadline - scene.time.now) / S.duration));
    return S.junkChance + (S.junkChanceMax - S.junkChance) * passed;
  }

  function binTitle(scene, id) {
    for (var i = 0; i < scene.bins.length; i++) if (scene.bins[i].id === id) return scene.bins[i].title;
    return "";
  }

  function moveItems(scene, step) {
    for (var i = scene.items.length - 1; i >= 0; i--) {
      var it = scene.items[i];
      if (it.done) continue;
      it.x += step;
      place(it, Math.round(it.x));
      if (it.x <= ITEM.gone) continue;
      // Уехал за край: мусор — верный пропуск, обычный предмет — обрыв серии
      // без жизни. Не успеть не страшно, ошибиться страшно.
      if (it.bin === "junk") passJunk(scene, it);
      else missItem(scene, it);
    }
  }

  function place(it, x) {
    if (it.box) it.box.x = x;
    if (it.title) it.title.x = x;
    if (it.hint) it.hint.x = x;
  }

  // Текущий предмет — ближайший к линии сброса из тех, что её ещё не прошли;
  // если все прошли, берётся самый правый: тап должен что-то отправлять.
  function current(scene) {
    var best = null;
    for (var i = 0; i < scene.items.length; i++) {
      var it = scene.items[i];
      if (it.done) continue;
      if (!best || it.x > best.x) best = it;
    }
    return best;
  }

  // --- ход игрока --------------------------------------------------------------

  function tapBin(scene, bin) {
    if (scene.over) return;
    var it = current(scene);
    if (!it) return;
    // Мусор надо было пропустить — тап по любой корзине уже ошибка.
    if (it.bin === "junk") { wrong(scene, it, "это мусор"); return; }
    if (it.bin === bin.id) right(scene, it, bin);
    else wrong(scene, it, "не та корзина");
  }

  function right(scene, it, bin) {
    var ZV = global.ZV;
    it.done = true;
    scene.sorted++;
    scene.streak++;
    if (scene.streak > scene.bestStreak) scene.bestStreak = scene.streak;
    scene.mult = Math.min(S.streakMax, 1 + Math.floor(scene.streak / S.streakStep));
    var gain = S.hitPoints * scene.mult;
    scene.score += gain;
    scene.speed = Math.min(S.beltMax, scene.speed + S.beltStep);
    if (scene.speed > scene.topSpeed) scene.topSpeed = scene.speed;

    flyInto(scene, it, bin);
    dip(scene, bin);
    popup(scene, bin.x, BINS.top - 16, "+" + gain);
    ZV.juice.dust(scene, bin.x, BINS.top + 8, bin.color);
    refresh(scene);
    step(scene);
  }

  function wrong(scene, it, why) {
    it.done = true;
    scene.mistakes++;
    scene.streak = 0;
    scene.mult = 1;
    scene.score = Math.max(0, scene.score - S.missPenalty);
    dropOut(scene, it);
    scene.cameras.main.shake(140, 0.007);
    say(scene, why + ", серия прервана", 600);
    if (scene.mistakes > S.freeMistakes) {
      scene.lives--;
      drawLives(scene);
    }
    refresh(scene);
    step(scene);
    if (scene.lives <= 0) finish(scene, false);
  }

  // Мусор доехал до края нетронутым: корзины тускнеют — «правильно, что не
  // тапнул». Без этого сигнала пропуск ощущается как невезение.
  function passJunk(scene, it) {
    it.done = true;
    scene.junkPassed++;
    scene.streak++;
    if (scene.streak > scene.bestStreak) scene.bestStreak = scene.streak;
    scene.mult = Math.min(S.streakMax, 1 + Math.floor(scene.streak / S.streakStep));
    scene.score += S.junkPoints;
    dim(scene);
    popup(scene, Math.round(it.x) - 20, ITEM.y - 30, "+" + S.junkPoints);
    clear(scene, it);
    refresh(scene);
    step(scene);
  }

  function missItem(scene, it) {
    it.done = true;
    scene.missed++;
    scene.streak = 0;
    scene.mult = 1;
    clear(scene, it);
    refresh(scene);
    step(scene);
  }

  // Общий хвост любого разобранного предмета: прогресс каждые 10 штук и
  // условие победы по targetItems.
  function step(scene) {
    var handled = scene.sorted + scene.mistakes + scene.missed + scene.junkPassed;
    if (handled >= scene.nextProgress) {
      scene.nextProgress += 10;
      global.ZV.progress(scene, {
        step: Math.floor(handled / 10),
        total: S.targetItems ? Math.ceil(S.targetItems / 10) : 0,
        meta: { score: scene.score, streak: scene.streak }
      });
    }
    if (S.targetItems && scene.sorted >= S.targetItems) finish(scene, true);
  }

  function refresh(scene) {
    scene.scoreText.setText(String(scene.score));
    scene.multText.setText(scene.mult > 1 ? "x" + scene.mult : "");
  }

  function drawLives(scene) {
    scene.livesText.setText("жизни: " + Math.max(0, scene.lives) + "/" + S.lives);
  }

  // --- живость -----------------------------------------------------------------

  // Полёт в корзину целыми пикселями по ленте шагов: без твинов, чтобы
  // координаты оставались целыми и партия повторялась при том же сиде.
  function flyInto(scene, it, bin) {
    var steps = 6, i;
    var x0 = Math.round(it.x), y0 = ITEM.y;
    var dx = (bin.x - x0) / steps, dy = (BINS.top + 16 - y0) / steps;
    // Подписи улетать не должны: снимаем их сразу, летит один предмет.
    if (it.hint) { it.hint.destroy(); it.hint = null; }
    if (it.title) { it.title.destroy(); it.title = null; }
    for (i = 1; i <= steps; i++) {
      (function (n) {
        scene.tl.add(n * 22, function () {
          if (!it.box || !it.box.scene) return;
          it.box.setPosition(Math.round(x0 + dx * n), Math.round(y0 + dy * n));
          if (n === steps) clear(scene, it);
        });
      })(i);
    }
  }

  // Неверная корзина: предмет краснеет и уезжает вниз мимо корзин.
  function dropOut(scene, it) {
    if (it.hint) { it.hint.destroy(); it.hint = null; }
    tint(it, 0xff5f6d);
    var y0 = ITEM.y;
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        scene.tl.add(n * 26, function () {
          if (!it.box || !it.box.scene) return;
          it.box.y = Math.round(y0 + n * 26);
          if (it.title) it.title.y = it.box.y + ITEM.size / 2 + 26;
          if (n === 5) clear(scene, it);
        });
      })(i);
    }
  }

  // Снять предмет со сцены и из списка. Зовётся и из шага ленты, и напрямую —
  // отсюда проверки на уже уничтоженное: партия может кончиться посреди полёта.
  function clear(scene, it) {
    if (it.box && it.box.scene) it.box.destroy();
    if (it.title && it.title.scene) it.title.destroy();
    if (it.hint && it.hint.scene) it.hint.destroy();
    it.box = null; it.title = null; it.hint = null;
    var at = scene.items.indexOf(it);
    if (at >= 0) scene.items.splice(at, 1);
  }

  // Заглушка красится заливкой, картинка — тинтом: у Rectangle нет setTint.
  function tint(it, color) {
    if (!it.box) return;
    if (it.box.setFillStyle) it.box.setFillStyle(color);
    else it.box.setTint(color);
  }

  // Корзина просаживается на 2 px — целое число, пиксельная сетка цела.
  function dip(scene, bin) {
    bin.box.y = bin.baseY + 2;
    bin.label.y = bin.labelY + 2;
    scene.tl.add(90, function () {
      if (!bin.box.scene) return;
      bin.box.y = bin.baseY;
      bin.label.y = bin.labelY;
    });
  }

  function dim(scene) {
    scene.bins.forEach(function (b) { b.box.setAlpha(0.45); });
    scene.tl.add(200, function () {
      scene.bins.forEach(function (b) { if (b.box.scene) b.box.setAlpha(1); });
    });
  }

  function popup(scene, x, y, text) {
    var t = global.ZV.ui.text(scene, Math.round(x), Math.round(y), text, {
      size: 2, color: global.ZV.SECONDARY
    }).setOrigin(0.5).setDepth(10);
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        scene.tl.add(n * 60, function () {
          if (!t.scene) return;
          t.y = Math.round(y - n * 4);
          if (n === 5) t.destroy();
        });
      })(i);
    }
  }

  // Кегль подбирается под ширину канвы: строка «серия прервана» кеглем 2 уже
  // не влезала и уезжала за оба края экрана.
  function say(scene, text, ms) {
    scene.flash.setFontSize(global.ZV.font.UNIT * (global.ZV.font.fit(text, global.ZV.WIDTH - 40, 1, 2) || 1));
    scene.flash.setText(text);
    scene.tl.add(ms, function () { if (scene.flash.scene) scene.flash.setText(""); });
  }

  // Последние 10 секунд: лента получает белую полосу и заметно ускоряется —
  // конец партии видно и слышно, а не только по цифре таймера.
  function startRush(scene) {
    scene.rush = true;
    scene.rushBar.setVisible(true);
    scene.speed = Math.min(S.beltMax, Math.round(scene.speed * 1.25));
    if (scene.speed > scene.topSpeed) scene.topSpeed = scene.speed;
    say(scene, "последние секунды", 900);
  }

  // --- конец раунда ------------------------------------------------------------

  function finish(scene, survived) {
    if (scene.over) return;
    scene.over = true;
    scene.tl.clear();
    var won = survived && (S.targetItems ? scene.sorted >= S.targetItems : scene.score >= S.passScore);
    global.ZV.finish(scene, {
      score: scene.score,
      won: won,
      text: "очков",
      meta: {
        archetype: "sort", sorted: scene.sorted, mistakes: scene.mistakes,
        missed: scene.missed, junkPassed: scene.junkPassed,
        bestStreak: scene.bestStreak, topSpeed: scene.topSpeed
      }
    });
  }

  // Фон подгоняется под канву общим правилом layout.js (fitBackground).
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

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.sort = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
