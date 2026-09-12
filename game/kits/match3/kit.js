// Кит «Три в ряд»: поле фишек, обмен двух соседних собирает линию от трёх,
// собранное осыпается, сверху досыпается новое — и так каскадом. Вся правда о
// поле живёт в чистом game/match3.js (раздача без готовых троек, поиск ходов,
// каскад, перемешивание, очки), кит только рисует его и принимает ввод.
// Ввод двойной: тап по фишке → тап по соседней, и свайп в сторону. Анимации —
// шагами ZV.timeline по модельному времени, целыми пикселями; своих таймеров
// и дробного масштаба нет. Канва 360×640.
(function (global) {
  "use strict";

  // Настройки по умолчанию; правятся в config.params (те же ключи), S
  // собирается в create через ZV.params.
  var DEFAULTS = {
    cols: 6,               // столбцов поля (4..8)
    rows: 7,               // строк поля (4..9)
    kinds: 5,              // видов фишек (3..7), не больше, чем в content
    moves: 20,             // ходов на партию
    targetScore: 600,      // очков для победы
    base: 10,              // очков за фишку
    cascadeStep: 1,        // прибавка к множителю за каждый каскад
    lineBonus: 20,         // очков за каждую фишку сверх трёх в линии
    swipeMin: 16,          // сдвиг пальца, с которого это свайп, px
    wrongCostsMove: true,  // неудачный обмен тоже тратит ход
    fallMs: 60,            // шаг падения фишки на одну клетку, мс
    clearMs: 140,          // пауза на «собралось», мс
    wobbleMs: 90           // качок на неудачном обмене, мс
  };
  var S = DEFAULTS;

  // Поле под HUD. При cols 6 ячейка выходит 52 px — палец попадает уверенно,
  // и 6×7 фишек целиком видны без прокрутки.
  var BOARD = { x: 12, y: 150, w: 336, h: 392, gap: 4 };
  var HUD = { score: 46, goal: 80, moves: 116 };
  var BACK = 0x1a1e2e;               // подложка поля
  var PICK = 0xffffff;               // контур выбранной фишки
  // Запасные цвета и формы, если в content их не хватило: разная ФОРМА, а не
  // только цвет — пять кружков разного оттенка на телефоне сливаются.
  var FALLBACK = [
    { color: 0x2e9e5b, shape: "circle" },
    { color: 0x38bdf8, shape: "diamond" },
    { color: 0xd9a100, shape: "square" },
    { color: 0xff5f6d, shape: "cross" },
    { color: 0x9b59b6, shape: "bar" },
    { color: 0x4f7cff, shape: "triangle" },
    { color: 0xe6e8f0, shape: "ring" }
  ];

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

  PlayScene.prototype.preload = function () {
    var a = (global.ZV_GAME && global.ZV_GAME.assets) || {};
    var items = a.items || {}, bg = a.background || {}, k;
    for (k in items) {
      if (Object.prototype.hasOwnProperty.call(items, k) && items[k] && items[k].url) this.load.image("it:" + k, items[k].url);
    }
    this.bgTile = !!bg.tile;
    if (bg.url) this.load.image("bg", bg.url);
    this.failedKeys = {};
    this.load.on("loaderror", function (file) { this.failedKeys[file.key] = true; }, this);
    global.ZV.loadContent(this, "match3");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;

    S = ZV.params(DEFAULTS);
    this.over = true;                    // до проверки контента сцена ничего не делает

    // Параметры уезжают в валидатор: достижимость targetScore за moves ходов
    // считается тем же ядром, что играет кит.
    var c = ZV.content(this, "match3", { params: S });
    if (c.errors.length) {
      ZV.ui.fail(this, "Ошибки в content/match3.json", c.errors);
      return;
    }
    this.over = false;
    this.data = c.data;

    this.tl = ZV.timeline.create();
    this.events.once("shutdown", function () { self.tl.clear(); });

    // Рекорд — удобство, не условие: партия проходится при пустом хранилище.
    this.slot = ZV.save.open("match3", ZV.save.version([c.data, S]), { best: 0 });
    this.best = this.slot.get().best;

    this.score = 0;
    this.movesLeft = Math.max(1, Math.round(S.moves));
    this.movesUsed = 0;
    this.wrongMoves = 0;
    this.shuffles = 0;
    this.bestCascade = 0;
    this.cleared = 0;
    this.picked = -1;                    // выбранная фишка (тап-тап)
    this.swipeFrom = null;               // старт свайпа

    ZV.ui.backdrop(this);
    drawBackground(this, W, H);

    // Раскладка поля: cols задан, ячейки чётные и целые (ZV.grid).
    this.layout = ZV.grid.layout({
      count: S.cols * S.rows, cols: S.cols,
      area: { x: BOARD.x, y: BOARD.y, w: BOARD.w, h: BOARD.h },
      min: { w: 24, h: 24 }, gap: BOARD.gap, aspect: 1, maxCols: global.ZV_MATCH3.LIMITS.maxCols
    });
    if (!this.layout.fits) {
      this.over = true;
      ZV.ui.fail(this, "Ошибки в config.params", ["поле " + S.cols + "×" + S.rows + ": " + this.layout.reason]);
      return;
    }

    this.add.rectangle(W / 2, BOARD.y + BOARD.h / 2, BOARD.w, BOARD.h, BACK).setDepth(0)
      .setStrokeStyle(2, 0xffffff, 0.08);
    // Крышка над полем: досыпанная фишка заводится ВЫШЕ поля и падает вниз —
    // без крышки она едет поверх счёта. Маски в пиксель-арте мылят край, а
    // непрозрачный прямоугольник между фишками (depth 3) и HUD (depth 5)
    // делает ровно то же и целыми пикселями.
    this.add.rectangle(W / 2, BOARD.y / 2, W, BOARD.y, 0x101018).setDepth(4);

    this.scoreText = ZV.ui.text(this, W / 2, HUD.score, "0", { size: 3 }).setOrigin(0.5).setDepth(5);
    this.goalText = ZV.ui.text(this, W / 2, HUD.goal, "", { size: 1, color: "#9aa0b5", align: "center" })
      .setOrigin(0.5).setDepth(5);
    this.movesText = ZV.ui.text(this, W - 16, HUD.moves, "", { size: 1, color: "#9aa0b5" }).setOrigin(1, 0.5).setDepth(5);
    this.clearText = ZV.ui.text(this, 16, HUD.moves, "", { size: 1, color: "#e6e8f0" }).setOrigin(0, 0.5).setDepth(5);
    this.flash = ZV.ui.text(this, W / 2, BOARD.y - 18, "", { size: 1, color: ZV.SECONDARY, align: "center" })
      .setOrigin(0.5).setDepth(9);

    // Модель поля: вид фишки 1..kinds, всё остальное считает ядро.
    this.board = global.ZV_MATCH3.deal(S.cols, S.rows, kindCount(this), ZV.random);
    this.tiles = [];
    for (var i = 0; i < this.board.cells.length; i++) this.tiles.push(makeTile(this, i, this.board.cells[i]));

    // Один слушатель на канву: своих кнопок у фишек нет, попадание считает
    // ZV.grid.hit — так тач-цель гарантирована сеткой, а не глазомером.
    this.input.on("pointerdown", function (p) { down(self, p.x, p.y); });
    this.input.on("pointerup", function (p) { up(self, p.x, p.y); });

    updateHud(this);
  };

  PlayScene.prototype.update = function (time, delta) {
    if (this.over) return;
    this.tl.update(delta);
  };

  // Видов на поле: params.kinds, зажатый словарём контента и пределами ядра.
  function kindCount(scene) {
    var lim = global.ZV_MATCH3.LIMITS;
    var want = Math.round(S.kinds);
    var have = scene.data.kinds.length;
    return Math.max(lim.minKinds, Math.min(want, have, lim.maxKinds));
  }

  // --- фишки -------------------------------------------------------------------

  function kindDef(scene, kind) {
    var list = scene.data.kinds;
    var def = list[(kind - 1) % list.length] || {};
    var spare = FALLBACK[(kind - 1) % FALLBACK.length];
    return {
      id: def.id || "k" + kind,
      title: def.title || "",
      color: def.color ? Phaser.Display.Color.HexStringToColor(def.color).color : spare.color,
      shape: def.shape || spare.shape,
      icon: def.icon || ("k" + kind)
    };
  }

  // Фишка = либо картинка config.assets.items.k1..k5, либо заглушка формы
  // shape целыми размерами. Формы разные намеренно: цвет на телефоне читается
  // хуже силуэта, и пять оттенков кружков сливаются в шум.
  function makeTile(scene, i, kind) {
    var cell = scene.layout.cells[i];
    var def = kindDef(scene, kind);
    var key = "it:" + def.icon;
    var parts = [];
    var img = null;
    if (scene.textures.exists(key) && !scene.failedKeys[key]) {
      img = scene.add.image(cell.cx, cell.cy, key).setDepth(3);
      global.ZV.sprite.apply(img, { origin: false });
      fitIcon(scene, img, key, cell.w - 6);
      parts.push(img);
    } else {
      parts = drawShape(scene, cell.cx, cell.cy, cell.w, def);
    }
    // Контур выбора рисуется отдельным прямоугольником: он целый, не масштаб.
    var mark = scene.add.rectangle(cell.cx, cell.cy, cell.w, cell.h)
      .setDepth(6).setStrokeStyle(2, PICK, 1).setVisible(false);
    return { i: i, kind: kind, parts: parts, mark: mark, x: cell.cx, y: cell.cy, cell: cell, img: img, def: def };
  }

  // Масштаб только 1/n (прореживание пикселей): дробный рвёт пиксельную сетку.
  function fitIcon(scene, img, key, max) {
    var src = scene.textures.get(key).getSourceImage();
    var down = Math.max(1, Math.ceil(Math.max(src.width, src.height) / Math.max(1, max)));
    if (down > 1) img.setScale(1 / down);
  }

  // Заглушки: целые размеры, разная форма. Половина ячейки чётная (grid даёт
  // чётную ячейку), поэтому все координаты остаются целыми.
  function drawShape(scene, x, y, size, def) {
    var half = Math.floor(size / 2) - 4;           // поле вокруг фишки
    var s = half * 2;
    var out = [];
    var color = def.color;
    switch (def.shape) {
      case "circle":
        out.push(scene.add.circle(x, y, half, color).setDepth(3));
        break;
      case "diamond":
        // Ромб — квадрат, повёрнутый на 45°: угол кратен 45 и на заливке без
        // текстуры не мылит (правило «наклона нет» про спрайты).
        out.push(scene.add.rectangle(x, y, Math.floor(s * 0.72), Math.floor(s * 0.72), color).setDepth(3).setAngle(45));
        break;
      case "square":
        out.push(scene.add.rectangle(x, y, s, s, color).setDepth(3));
        break;
      case "cross": {
        var arm = Math.max(2, Math.floor(s / 3));
        out.push(scene.add.rectangle(x, y, s, arm, color).setDepth(3));
        out.push(scene.add.rectangle(x, y, arm, s, color).setDepth(3));
        break;
      }
      case "bar":
        out.push(scene.add.rectangle(x, y, s, Math.floor(s / 2), color).setDepth(3));
        break;
      case "triangle":
        out.push(scene.add.triangle(x, y, 0, s, half, 0, s, s, color).setDepth(3));
        break;
      default:  // ring — кольцо: заливка фона внутри круга
        out.push(scene.add.circle(x, y, half, color).setDepth(3));
        out.push(scene.add.circle(x, y, Math.max(2, half - 6), BACK).setDepth(4));
    }
    return out;
  }

  function placeTile(tile, x, y) {
    tile.x = x; tile.y = y;
    for (var i = 0; i < tile.parts.length; i++) tile.parts[i].setPosition(x, y);
    tile.mark.setPosition(x, y);
  }

  function destroyTile(tile) {
    for (var i = 0; i < tile.parts.length; i++) if (tile.parts[i].scene) tile.parts[i].destroy();
    if (tile.mark.scene) tile.mark.destroy();
    tile.parts = [];
  }

  function setAlpha(tile, a) {
    for (var i = 0; i < tile.parts.length; i++) tile.parts[i].setAlpha(a);
  }

  // --- ввод --------------------------------------------------------------------
  // Тап-тап: выбрать фишку (контур) и тапнуть соседнюю. Свайп: pointerdown по
  // фишке и pointerup со сдвигом ≥ swipeMin в сторону. Оба пути ведут в один
  // tryMove — правил обмена ровно одни.
  function down(scene, x, y) {
    if (scene.over || scene.tl.busy()) return;
    var i = global.ZV.grid.hit(scene.layout, x, y);
    scene.swipeFrom = i >= 0 ? { i: i, x: x, y: y } : null;
  }

  function up(scene, x, y) {
    if (scene.over || scene.tl.busy()) return;
    var from = scene.swipeFrom;
    scene.swipeFrom = null;
    var i = global.ZV.grid.hit(scene.layout, x, y);

    // Свайп: направление по большей оси сдвига, шаг ровно на клетку.
    if (from) {
      var dx = x - from.x, dy = y - from.y;
      if (Math.abs(dx) >= S.swipeMin || Math.abs(dy) >= S.swipeMin) {
        var p = global.ZV_MATCH3.cell(scene.board, from.i);
        var c = p.c + (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : -1) : 0);
        var r = p.r + (Math.abs(dx) > Math.abs(dy) ? 0 : (dy > 0 ? 1 : -1));
        var j = global.ZV.grid.at(scene.layout, c, r);
        clearPick(scene);
        if (j >= 0) tryMove(scene, from.i, j);
        return;
      }
    }

    if (i < 0) { clearPick(scene); return; }
    // Тап по уже выбранной — снять выбор: иначе выбор нечем отменить.
    if (scene.picked === i) { clearPick(scene); return; }
    if (scene.picked >= 0 && global.ZV_MATCH3.adjacent(scene.board, scene.picked, i)) {
      var a = scene.picked;
      clearPick(scene);
      tryMove(scene, a, i);
      return;
    }
    setPick(scene, i);
  }

  function setPick(scene, i) {
    clearPick(scene);
    scene.picked = i;
    if (scene.tiles[i]) scene.tiles[i].mark.setVisible(true);
  }

  function clearPick(scene) {
    if (scene.picked >= 0 && scene.tiles[scene.picked]) scene.tiles[scene.picked].mark.setVisible(false);
    scene.picked = -1;
  }

  // --- ход ---------------------------------------------------------------------

  function tryMove(scene, a, b) {
    var M = global.ZV_MATCH3;
    if (a === b || !M.adjacent(scene.board, a, b)) return;
    // Пробуем обмен на копии: модель поля меняется только при удачном ходе.
    var probe = M.clone(scene.board);
    M.swap(probe, a, b);
    if (!M.matches(probe).cleared.length) {
      wobble(scene, a, b);
      if (S.wrongCostsMove) spendMove(scene);
      return;
    }
    M.swap(scene.board, a, b);
    swapTiles(scene, a, b);
    spendMove(scene);
    // Обмен виден до того, как линия осыплется: без паузы фишки «телепортируются».
    scene.tl.add(S.clearMs, function () { resolveBoard(scene); });
  }

  // Неудачный обмен: фишки качнулись навстречу на 4 px и вернулись. Целые
  // пиксели, без дробного scale и без своих таймеров.
  function wobble(scene, a, b) {
    var ta = scene.tiles[a], tb = scene.tiles[b];
    if (!ta || !tb) return;
    var ax = ta.cell.cx, ay = ta.cell.cy, bx = tb.cell.cx, by = tb.cell.cy;
    var dx = bx - ax === 0 ? 0 : (bx > ax ? 4 : -4);
    var dy = by - ay === 0 ? 0 : (by > ay ? 4 : -4);
    placeTile(ta, ax + dx, ay + dy);
    placeTile(tb, bx - dx, by - dy);
    scene.tl.add(S.wobbleMs, function () {
      if (!ta.parts.length || !tb.parts.length) return;
      placeTile(ta, ax, ay);
      placeTile(tb, bx, by);
    });
    say(scene, "так не собрать", 500);
  }

  // Обмен спрайтов местами — модель уже обменяна, спрайты идут следом.
  function swapTiles(scene, a, b) {
    var ta = scene.tiles[a], tb = scene.tiles[b];
    scene.tiles[a] = tb;
    scene.tiles[b] = ta;
    ta.i = b; tb.i = a;
    ta.cell = scene.layout.cells[b];
    tb.cell = scene.layout.cells[a];
    placeTile(ta, ta.cell.cx, ta.cell.cy);
    placeTile(tb, tb.cell.cx, tb.cell.cy);
  }

  // Разбор хода: ядро считает шаги каскада, кит проигрывает их лентой. Модель
  // меняется сразу и целиком (после resolve поле уже полное и без совпадений),
  // а спрайты догоняют — иначе ввод пришлось бы блокировать по-другому в
  // каждом шаге.
  function resolveBoard(scene) {
    var M = global.ZV_MATCH3;
    var before = scene.board.cells.slice();
    var res = M.resolve(scene.board, global.ZV.random, S);
    if (!res.steps.length) { afterTurn(scene); return; }
    scene.score += res.score;
    if (res.cascades > scene.bestCascade) scene.bestCascade = res.cascades;
    // Играем шаги по очереди: гасим собранное, роняем, досыпаем.
    var model = M.make(scene.board.cols, scene.board.rows, before);
    for (var n = 0; n < res.steps.length; n++) playStep(scene, res.steps[n], model, n === res.steps.length - 1);
    scene.tl.then(function () { afterTurn(scene); });
  }

  // Один шаг каскада на спрайтах. model — поле ДО шага, нужно, чтобы знать,
  // какой вид досыпается и куда. Все координаты целые: падение считается в
  // клетках, а клетка у grid чётная.
  function playStep(scene, step, model, last) {
    var M = global.ZV_MATCH3;
    var stride = scene.layout.cell.h + scene.layout.gap;
    var i;
    // 1. Собранное гаснет и исчезает.
    scene.tl.then(function () {
      for (var k = 0; k < step.cleared.length; k++) {
        var t = scene.tiles[step.cleared[k]];
        if (t) setAlpha(t, 0.4);
      }
      scene.cleared += step.cleared.length;
      var mid = scene.tiles[step.cleared[Math.floor(step.cleared.length / 2)]];
      if (mid) {
        popup(scene, mid.x, mid.y, "+" + step.gain);
        global.ZV.juice.dust(scene, mid.x, mid.y, Phaser.Display.Color.HexStringToColor(global.ZV.SECONDARY).color);
      }
      // Каскад бьёт заметнее первого сбора — «о!» видно без надписи.
      scene.cameras.main.shake(step.cascade > 0 ? 140 : 80, step.cascade > 0 ? 0.006 : 0.003);
      if (step.cascade > 0) say(scene, "каскад x" + (1 + step.cascade * S.cascadeStep), 700);
      updateHud(scene);
    });
    scene.tl.wait(S.clearMs).then(function () {
      for (var k = 0; k < step.cleared.length; k++) {
        var t = scene.tiles[step.cleared[k]];
        if (t) { destroyTile(t); scene.tiles[step.cleared[k]] = null; }
      }
    });

    // 2. Гравитация: фишка едет вниз на целое число клеток, шагами по клетке.
    var maxDrop = 1;
    for (i = 0; i < step.fell.length; i++) {
      var d = Math.round((M.cell(model, step.fell[i].to).r - M.cell(model, step.fell[i].from).r));
      if (d > maxDrop) maxDrop = d;
    }
    scene.tl.then(function () {
      for (var k = 0; k < step.fell.length; k++) {
        var mv = step.fell[k];
        var t = scene.tiles[mv.from];
        if (!t) continue;
        scene.tiles[mv.from] = null;
        scene.tiles[mv.to] = t;
        t.i = mv.to;
        t.cell = scene.layout.cells[mv.to];
      }
    });
    fallTo(scene, step.fell.map(function (mv) { return mv.to; }), stride, maxDrop);

    // 3. Досыпка: новая фишка заводится выше поля и падает на своё место.
    scene.tl.then(function () {
      for (var k = 0; k < step.filled.length; k++) {
        var f = step.filled[k];
        var t = makeTile(scene, f.i, f.kind);
        scene.tiles[f.i] = t;
        placeTile(t, t.cell.cx, t.cell.cy - stride * f.above);
        // Модель догоняем здесь же: шаги ленты идут по порядку, и следующий
        // шаг каскада будет читать уже обновлённое поле.
        model.cells[f.i] = f.kind;
      }
      for (var n = 0; n < step.cleared.length; n++) model.cells[step.cleared[n]] = 0;
      for (var m = 0; m < step.fell.length; m++) {
        model.cells[step.fell[m].to] = step.fell[m].kind;
        model.cells[step.fell[m].from] = 0;
      }
    });
    fallTo(scene, step.filled.map(function (f) { return f.i; }), stride, maxDrop + 1);
    if (last) scene.tl.wait(S.fallMs);
  }

  // Довести перечисленные фишки до их клеток шагами по одной клетке:
  // координата всегда целая, дробного «плавного» падения нет.
  function fallTo(scene, list, stride, steps) {
    steps = Math.max(1, steps);
    for (var n = 1; n <= steps; n++) {
      (function (k) {
        scene.tl.add(S.fallMs, function () {
          for (var q = 0; q < list.length; q++) {
            var t = scene.tiles[list[q]];
            if (!t || !t.parts.length) continue;
            var want = t.cell.cy;
            var next = Math.min(want, t.y + stride);
            if (k === steps) next = want;          // последний шаг сажает точно
            placeTile(t, t.cell.cx, next);
          }
        });
      })(n);
    }
  }

  // --- после хода ---------------------------------------------------------------

  function afterTurn(scene) {
    if (scene.over) return;
    var M = global.ZV_MATCH3;
    updateHud(scene);
    // Тупик: перемешиваем ТЕ ЖЕ фишки (состав партии не меняется) и
    // перерисовываем поле. Ход на это не тратится — человек в тупике не
    // виноват.
    if (!M.moves(scene.board).length) {
      scene.shuffles += 1;
      say(scene, "перемешиваю", 700);
      M.reshuffle(scene.board, global.ZV.random);
      scene.tl.add(S.clearMs, function () { redraw(scene); });
      scene.tl.then(function () { finishIfDone(scene); });
      return;
    }
    finishIfDone(scene);
  }

  function finishIfDone(scene) {
    if (scene.over) return;
    if (scene.score >= S.targetScore) { finish(scene, true); return; }
    if (scene.movesLeft <= 0) { finish(scene, false); return; }
  }

  // Полная перерисовка поля по модели — после перемешивания.
  function redraw(scene) {
    clearPick(scene);
    for (var i = 0; i < scene.tiles.length; i++) {
      if (scene.tiles[i]) destroyTile(scene.tiles[i]);
      scene.tiles[i] = makeTile(scene, i, scene.board.cells[i]);
    }
  }

  function spendMove(scene) {
    scene.movesUsed += 1;
    scene.movesLeft = Math.max(0, scene.movesLeft - 1);
    updateHud(scene);
  }

  function finish(scene, won) {
    if (scene.over) return;
    scene.over = true;
    scene.tl.clear();
    var record = scene.score > scene.best;
    if (record) scene.slot.set({ best: scene.score });
    global.ZV.finish(scene, {
      score: scene.score,
      won: won,
      text: "очков",
      meta: {
        archetype: "match3", moves: scene.movesUsed, movesLeft: scene.movesLeft,
        cleared: scene.cleared, bestCascade: scene.bestCascade,
        shuffles: scene.shuffles, target: S.targetScore, record: record
      }
    });
  }

  // --- HUD и мелочи --------------------------------------------------------------

  function updateHud(scene) {
    scene.scoreText.setText(String(scene.score));
    scene.goalText.setText((scene.data.goal.title || "Цель") + " " + S.targetScore);
    scene.movesText.setText("ходы " + scene.movesLeft);
    scene.clearText.setText("фишки " + scene.cleared);
    // Ходов в обрез — счётчик краснеет: напряжение видно, а не подразумевается.
    var tight = scene.movesLeft <= 3;
    scene.movesText.setTint(Phaser.Display.Color.HexStringToColor(tight ? "#ff5f6d" : "#9aa0b5").color);
  }

  function popup(scene, x, y, text) {
    var t = global.ZV.ui.text(scene, Math.round(x), Math.round(y), text, {
      size: 2, color: global.ZV.SECONDARY
    }).setOrigin(0.5).setDepth(10);
    // Всплытие целыми пикселями: пять шагов по 4 px вместо твина с дробью.
    scene.tl.repeat(5, 50, function (i) {
      if (!t.scene) return;
      t.y = Math.round(y - (i + 1) * 4);
      if (i >= 3) t.setAlpha(i >= 4 ? 0 : 0.5);
      if (i === 4) t.destroy();
    });
  }

  function say(scene, text, ms) {
    if (!scene.flash.scene) return;
    scene.flash.setText(text);
    scene.tl.add(ms, function () { if (scene.flash.scene) scene.flash.setText(""); });
  }

  // Фон подгоняется под канву общим правилом layout.js (fitBackground).
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
  global.ZV_KITS.match3 = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
