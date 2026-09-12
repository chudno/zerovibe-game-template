// Кит «Найди предмет»: на фоне интерьера спрятаны предметы, внизу полка с
// тем, что ещё осталось найти, сверху таймер. Тап по предмету — найден,
// предмет улетает на полку. Среди спрятанного есть отвлечения (decoys): их
// искать не надо, тап по ним стоит времени. Долго без находок — подсказка:
// кольцо вокруг одного из оставшихся.
// Координаты целей кит НЕ проставляет руками по картинке (агент фона не
// видит): расстановку считает чистый game/hidden.js — без наложений, с
// минимальной дистанцией и целыми координатами. Паузы — ZV.timeline (один на
// сцену, clear в shutdown). Канва 360×640, масштаб спрайтов 1.
(function (global) {
  "use strict";

  // Настройки по умолчанию; правятся в config.params (те же ключи), S
  // собирается в create через ZV.params.
  var DEFAULTS = {
    duration: 40000,       // время на всю партию, мс
    rounds: 2,             // сколько расстановок подряд
    targets: 5,            // сколько предметов прячется в раунде
    decoys: 2,             // предметы-отвлечения: искать не надо, тап штрафуется
    hintMs: 8000,          // столько без находок — и появляется подсказка
    size: 40,              // сторона предмета, px (тач-цель не меньше 24)
    minDistance: 56,       // минимальное расстояние между центрами предметов
    hitPoints: 10,         // очки за находку
    speedBonusMax: 10,     // добавка за быструю находку (тает к hintMs)
    decoyPenaltyMs: 3000,  // штраф времени за тап по отвлечению
    passScore: 0           // очков для победы; 0 — победа = найдено всё во всех раундах
  };
  var S = DEFAULTS;

  // Поле поиска: те же числа, что HIDDEN_FIELD в валидаторе (game/content.js).
  var FIELD = { x: 8, y: 120, w: 344, h: 300 };
  // Полка «что осталось найти»: 4 столбца фиксированной ширины — подпись
  // меряется валидатором по области hiddenTitle (84 минус поля = 76 px).
  var SHELF = { x: 8, y: 440, w: 344, h: 176, cols: 4, cell: 84, rowH: 66 };
  var HUD = { score: 58, time: 96 };   // те же строки HUD, что у соседних китов
  var HINT_RING = 4;               // толщина кольца подсказки, целые пиксели

  // Заглушки: РАЗНАЯ форма, не только цвет — предмет должен быть узнаваем
  // силуэтом, иначе поиск превращается в «найди другой оттенок серого».
  var SHAPES = ["square", "tall", "wide", "cross", "notch", "frame"];
  var PALETTE = [0xf2c14e, 0x4f7cff, 0x2e9e5b, 0xff5f6d, 0x9b59b6, 0x1abc9c, 0xe6e8f0, 0xd9a100];

  function PlayScene() {
    Phaser.Scene.call(this, { key: "zv-play" });
  }
  PlayScene.prototype = Object.create(Phaser.Scene.prototype);
  PlayScene.prototype.constructor = PlayScene;

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
    global.ZV.loadContent(this, "hidden");
  };

  PlayScene.prototype.create = function () {
    var self = this;
    var ZV = global.ZV;
    var W = ZV.WIDTH, H = ZV.HEIGHT;

    S = ZV.params(DEFAULTS);
    this.over = true;   // до успешной проверки контента сцена ничего не делает

    // Параметры едут в валидатор: расстановка из config.params должна
    // проверяться тем же кодом, что разложит её в игре.
    var c = ZV.content(this, "hidden", { params: S });
    if (c.errors.length) {
      ZV.ui.fail(this, "Ошибки в content/hidden.json", c.errors);
      return;
    }
    this.over = false;
    this.items = c.data.items;

    this.tl = ZV.timeline.create();
    this.events.once("shutdown", function () { self.tl.clear(); });

    this.score = 0;
    this.roundIndex = 0;
    this.roundsDone = 0;
    this.foundTotal = 0;
    this.decoyTaps = 0;
    this.misses = 0;         // тапы мимо всего: считаем, но не наказываем
    this.bestFindMs = 0;

    this.add.rectangle(W / 2, H / 2, W, H, 0x101018).setDepth(-20);
    drawBackground(this, W, H);
    drawShelfPanel(this, W);

    this.scoreText = ZV.ui.text(this, W / 2, HUD.score, "0", { size: 3 }).setOrigin(0.5).setDepth(8);
    this.timeText = ZV.ui.text(this, W - 16, HUD.time, "", { size: 1, color: "#9aa0b5" }).setOrigin(1, 0.5).setDepth(8);
    this.roundText = ZV.ui.text(this, 16, HUD.time, "", { size: 1, color: "#9aa0b5" }).setOrigin(0, 0.5).setDepth(8);
    // Строка событий — над полем, между HUD и рамкой поиска: внутри поля она
    // закрывала бы предметы, ради которых игра и затевалась.
    this.flash = ZV.ui.text(this, W / 2, 112, "", { size: 1, color: ZV.SECONDARY, align: "center" })
      .setOrigin(0.5).setDepth(9);

    this.spots = [];
    this.shelf = [];
    this.flying = [];   // предметы в полёте на полку: их уборка не зависит от ленты
    this.ring = null;

    // Один обработчик на сцену: попадание считает ZV_HIDDEN.pick — своих
    // кнопок у предметов нет, тач-цель гарантирует модуль (не меньше 24 px).
    this.input.on("pointerup", function (p) { tap(self, Math.round(p.x), Math.round(p.y)); });

    this.deadline = this.time.now + S.duration;
    this.lastFindAt = this.time.now;
    startRound(this);
  };

  PlayScene.prototype.update = function (time, delta) {
    if (this.over) return;
    this.tl.update(delta);

    var left = Math.max(0, Math.ceil((this.deadline - time) / 1000));
    this.timeText.setText(left + " с");
    if (left <= 0) { finish(this, false); return; }

    // Подсказка после hintMs без находок: игрок, который «всё осмотрел», не
    // должен упираться в стену — но и даром она не даётся (очки за скорость
    // к этому моменту уже стаяли).
    if (S.hintMs > 0 && !this.hintOn && time - this.lastFindAt >= S.hintMs) showHint(this);
  };

  // --- раунд -------------------------------------------------------------------

  function startRound(scene) {
    var ZV = global.ZV;
    clearSpots(scene);

    var need = S.targets + S.decoys;
    var lay = global.ZV_HIDDEN.place({
      count: need, area: FIELD, size: S.size, minDistance: S.minDistance,
      decoys: S.decoys, rng: ZV.random
    });
    if (!lay.fits) {
      // Валидатор это уже ловит на боевом контенте, но params из config могут
      // прийти любыми: экран с числом лучше половины раскладки молча.
      scene.over = true;
      ZV.ui.fail(scene, "Ошибки в параметрах «найди предмет»", [lay.reason]);
      return;
    }

    // Предметы раздаются БЕЗ повторов: две одинаковые подписи на полке не
    // дают понять, какую из них уже нашли. Валидатор это проверяет, но
    // config.params может прийти любым — молча повторять предмет нельзя.
    if (need > scene.items.length) {
      scene.over = true;
      ZV.ui.fail(scene, "Ошибки в параметрах «найди предмет»", [
        "предметов в content/hidden.json " + scene.items.length + ", а на раскладку нужно " + need +
        " (targets " + S.targets + " + decoys " + S.decoys + ")"
      ]);
      return;
    }
    var pool = scene.items.slice();
    ZV.random.shuffle(pool);
    scene.spots = lay.spots.map(function (spot, i) {
      var def = pool[i];
      return {
        i: i, x: spot.x, y: spot.y, size: spot.size, decoy: spot.decoy,
        id: def.id, title: def.title, icon: def.icon || def.id,
        found: false, obj: null, shelfAt: -1
      };
    });

    scene.targetsLeft = scene.spots.filter(function (s) { return !s.decoy; }).length;
    scene.spots.forEach(function (s) { s.obj = drawSpot(scene, s); });
    buildShelf(scene);

    scene.roundText.setText("Раунд " + (scene.roundIndex + 1) + " из " + S.rounds);
    scene.lastFindAt = scene.time.now;
    hideHint(scene);
  }

  function endRound(scene, cleared) {
    if (scene.over) return;
    if (cleared) scene.roundsDone += 1;
    global.ZV.progress(scene, {
      step: scene.roundIndex + 1, total: S.rounds,
      meta: { score: scene.score, found: scene.foundTotal, cleared: !!cleared }
    });
    if (scene.roundIndex + 1 >= S.rounds) { finish(scene, true); return; }
    scene.roundIndex += 1;
    say(scene, "Раунд пройден", 700);
    scene.tl.add(700, function () { if (!scene.over) startRound(scene); });
  }

  function finish(scene, cleared) {
    if (scene.over) return;
    scene.over = true;
    scene.tl.clear();
    clearFlying(scene);
    // passScore 0 — победа означает «найдено всё во всех раундах»: игра про
    // поиск, а не про набор очков, и порог очками тут только по желанию.
    var won = S.passScore > 0 ? scene.score >= S.passScore : (cleared && scene.roundsDone >= S.rounds);
    global.ZV.finish(scene, {
      score: scene.score,
      won: won,
      text: "очков",
      meta: {
        archetype: "hidden", rounds: scene.roundsDone, found: scene.foundTotal,
        decoyTaps: scene.decoyTaps, misses: scene.misses, bestFindMs: scene.bestFindMs,
        hints: scene.hintsShown || 0
      }
    });
  }

  // --- ход игрока --------------------------------------------------------------

  function tap(scene, x, y) {
    if (scene.over || !scene.spots.length) return;
    var i = global.ZV_HIDDEN.pick(scene.spots, x, y, function (s) { return s.found; });
    if (i < 0) { scene.misses++; return; }
    var spot = scene.spots[i];
    if (spot.decoy) { tapDecoy(scene, spot); return; }
    findSpot(scene, spot);
  }

  function findSpot(scene, spot) {
    var ZV = global.ZV;
    spot.found = true;
    scene.foundTotal++;
    scene.targetsLeft--;

    // Быстрее — больше: добавка тает линейно к hintMs. Так поиск остаётся
    // соревнованием с собой, а не «рано или поздно найду».
    var sinceMs = scene.time.now - scene.lastFindAt;
    var window = S.hintMs > 0 ? S.hintMs : 1;
    var bonus = Math.max(0, Math.round(S.speedBonusMax * (1 - Math.min(1, sinceMs / window))));
    scene.score += S.hitPoints + bonus;
    if (!scene.bestFindMs || sinceMs < scene.bestFindMs) scene.bestFindMs = Math.round(sinceMs);
    scene.lastFindAt = scene.time.now;

    hideHint(scene);
    refresh(scene);
    popup(scene, spot.x, spot.y - S.size, "+" + (S.hitPoints + bonus));
    ZV.juice.dust(scene, spot.x, spot.y, 0xf2c14e);
    flyToShelf(scene, spot);

    if (scene.targetsLeft <= 0) endRound(scene, true);
  }

  // Отвлечение: не «неверный ответ», а потерянное время — так тап наугад по
  // всему экрану перестаёт быть выигрышной стратегией, но и жизни не отнимает.
  function tapDecoy(scene, spot) {
    scene.decoyTaps++;
    scene.deadline -= S.decoyPenaltyMs;
    scene.cameras.main.shake(120, 0.006);
    tint(spot.obj, 0xff5f6d);
    scene.tl.add(220, function () { if (spot.obj && spot.obj.scene) tint(spot.obj, spot.color); });
    say(scene, "не то: −" + Math.round(S.decoyPenaltyMs / 1000) + " с", 700);
    popup(scene, spot.x, spot.y - S.size, "−" + Math.round(S.decoyPenaltyMs / 1000) + " с");
  }

  function refresh(scene) {
    scene.scoreText.setText(String(scene.score));
  }

  // --- поле --------------------------------------------------------------------

  function clearSpots(scene) {
    hideHint(scene);
    clearFlying(scene);
    (scene.spots || []).forEach(function (s) {
      if (s.obj && s.obj.scene) s.obj.destroy();
      s.obj = null;
    });
    scene.spots = [];
    clearShelf(scene);
  }

  // Предмет: картинка из config.assets.items[icon] через ZV.sprite.apply,
  // иначе заглушка. Заглушки различаются ФОРМОЙ: одинаковые квадраты разного
  // цвета на пёстром фоне неразличимы.
  function drawSpot(scene, spot) {
    var key = "it:" + spot.icon;
    if (scene.textures.exists(key)) {
      var img = scene.add.image(spot.x, spot.y, key).setDepth(4);
      global.ZV.sprite.apply(img, { origin: false });
      spot.color = 0xffffff;
      return img;
    }
    var shape = SHAPES[hash(spot.id) % SHAPES.length];
    var color = PALETTE[hash(spot.id + ":c") % PALETTE.length];
    spot.color = color;
    return drawShape(scene, spot.x, spot.y, S.size, shape, color);
  }

  // Заглушка одной формы: контейнер из прямоугольников целых размеров —
  // никаких дробных масштабов и наклонов, силуэт читается на любом фоне.
  function drawShape(scene, x, y, size, shape, color) {
    var g = scene.add.container(x, y).setDepth(4);
    var half = Math.floor(size / 2);
    var third = Math.floor(size / 3);
    var parts = [];
    if (shape === "square") {
      parts.push([0, 0, size, size]);
    } else if (shape === "tall") {
      parts.push([0, 0, Math.floor(size / 2), size]);
    } else if (shape === "wide") {
      parts.push([0, 0, size, Math.floor(size / 2)]);
    } else if (shape === "cross") {
      parts.push([0, 0, third, size], [0, 0, size, third]);
    } else if (shape === "notch") {
      parts.push([0, third, size, size - third], [-third, -third, third, third]);
    } else {
      // frame: рамка четырьмя полосами — самый «дырявый» силуэт из набора.
      parts.push([0, -half + 2, size, 4], [0, half - 2, size, 4], [-half + 2, 0, 4, size], [half - 2, 0, 4, size]);
    }
    parts.forEach(function (p) {
      var r = scene.add.rectangle(p[0], p[1], p[2], p[3], color);
      r.setStrokeStyle(2, 0x101018, 0.6);
      g.add(r);
    });
    g.zvParts = g.list.slice();
    // Контейнеру размер нужен только ради заливки на подсветке — тач-цель
    // считает ZV_HIDDEN.hit по координатам, а не по телу объекта.
    g.setSize(size, size);
    return g;
  }

  // Заглушка красится заливкой частей, картинка — тинтом.
  function tint(obj, color) {
    if (!obj || !obj.scene) return;
    if (obj.zvParts) obj.zvParts.forEach(function (r) { r.setFillStyle(color); });
    else if (obj.setTint) obj.setTint(color);
  }

  // --- полка «что осталось найти» ----------------------------------------------

  function drawShelfPanel(scene, W) {
    scene.add.rectangle(W / 2, SHELF.y + SHELF.h / 2, W, SHELF.h, 0x1a1f30).setDepth(0);
    scene.add.rectangle(W / 2, SHELF.y, W, 2, 0x3a4160).setDepth(1);
    global.ZV.ui.text(scene, W / 2, SHELF.y + 14, "Найди", { size: 1, color: "#9aa0b5" })
      .setOrigin(0.5).setDepth(2);
  }

  function clearShelf(scene) {
    (scene.shelf || []).forEach(function (s) {
      if (s.icon && s.icon.scene) s.icon.destroy();
      if (s.label && s.label.scene) s.label.destroy();
    });
    scene.shelf = [];
  }

  // Полка — фиксированная сетка 4 в ряд: ширина ячейки постоянна, значит
  // подпись меряется валидатором одной областью (hiddenTitle), а не «как
  // повезёт с числом целей».
  function shelfCell(n) {
    var col = n % SHELF.cols, row = Math.floor(n / SHELF.cols);
    return {
      x: SHELF.x + col * SHELF.cell + Math.floor(SHELF.cell / 2),
      y: SHELF.y + 36 + row * SHELF.rowH
    };
  }

  function buildShelf(scene) {
    clearShelf(scene);
    var n = 0;
    scene.spots.forEach(function (spot) {
      if (spot.decoy) return;                      // отвлечений на полке нет — их не ищут
      var cell = shelfCell(n);
      var icon = shelfIcon(scene, cell.x, cell.y, spot);
      var label = global.ZV.ui.text(scene, cell.x, cell.y + 24, spot.title, {
        size: 1, color: "#e6e8f0", align: "center"
      }).setOrigin(0.5).setDepth(3);
      spot.shelfAt = n;
      scene.shelf.push({ spot: spot, icon: icon, label: label, x: cell.x, y: cell.y });
      n++;
    });
  }

  // Значок на полке: та же форма, что на поле, но меньше — заглушка рисуется
  // своим размером (не масштабом), а картинка остаётся 1:1: пиксель-арт
  // дробно не жмём, и целого масштаба «в меньшую сторону» не бывает.
  function shelfIcon(scene, x, y, spot) {
    var key = "it:" + spot.icon;
    if (scene.textures.exists(key)) {
      var img = scene.add.image(x, y, key).setDepth(3);
      global.ZV.sprite.apply(img, { origin: false });
      return img;
    }
    var shape = SHAPES[hash(spot.id) % SHAPES.length];
    var side = Math.max(24, Math.floor(S.size / 2 / 2) * 2);   // чётное, не меньше тач-цели
    return drawShape(scene, x, y, side, shape, spot.color).setDepth(3);
  }

  // Полёт на полку целыми пикселями по ленте шагов: без твинов, чтобы
  // координаты оставались целыми и партия повторялась при том же сиде.
  function flyToShelf(scene, spot) {
    var slot = null;
    for (var i = 0; i < scene.shelf.length; i++) if (scene.shelf[i].spot === spot) slot = scene.shelf[i];
    var obj = spot.obj;
    spot.obj = null;
    if (!obj || !obj.scene) { markFound(scene, slot); return; }

    // Летящий предмет держим отдельным списком: последняя находка закрывает
    // раунд, а закрытие раунда гасит ленту (tl.clear) — шаг, который должен
    // был его уничтожить, не выстрелит, и предмет завис бы над полкой поверх
    // экрана результата. Отсюда явная уборка в finish и на смене раунда.
    scene.flying.push(obj);
    var steps = 6;
    var x0 = obj.x, y0 = obj.y;
    var tx = slot ? slot.x : x0, ty = slot ? slot.y : y0;
    var dx = (tx - x0) / steps, dy = (ty - y0) / steps;
    for (var n = 1; n <= steps; n++) {
      (function (k) {
        scene.tl.add(k * 24, function () {
          if (!obj.scene) return;
          obj.setPosition(Math.round(x0 + dx * k), Math.round(y0 + dy * k));
          if (k === steps) { dropFlying(scene, obj); markFound(scene, slot); }
        });
      })(n);
    }
  }

  // Снять летящий предмет со сцены и из списка «в полёте».
  function dropFlying(scene, obj) {
    var at = scene.flying.indexOf(obj);
    if (at >= 0) scene.flying.splice(at, 1);
    if (obj && obj.scene) obj.destroy();
  }

  function clearFlying(scene) {
    (scene.flying || []).forEach(function (obj) { if (obj && obj.scene) obj.destroy(); });
    scene.flying = [];
  }

  // Найденное на полке гасим, а не убираем: список «что искали» остаётся
  // перед глазами, и видно, сколько ещё осталось.
  function markFound(scene, slot) {
    if (!slot) return;
    if (slot.icon && slot.icon.scene) slot.icon.setAlpha(0.25);
    if (slot.label && slot.label.scene) slot.label.setAlpha(0.35);
  }

  // --- подсказка ---------------------------------------------------------------

  // Пульсирующее кольцо вокруг одного из ненайденных: размеры целые, пульс —
  // подменой размера шагами ленты, а не дробным масштабом.
  function showHint(scene) {
    var left = scene.spots.filter(function (s) { return !s.decoy && !s.found; });
    // Показывать нечего (раунд уже закрыт, идёт пауза до следующего) — отметку
    // времени двигаем, иначе update пытался бы показать подсказку каждый кадр.
    if (!left.length) { scene.lastFindAt = scene.time.now; return; }
    var spot = global.ZV.random.pick(left);
    scene.hintOn = true;
    scene.hintsShown = (scene.hintsShown || 0) + 1;
    var base = S.size + 16;
    var ring = scene.add.rectangle(spot.x, spot.y, base, base);
    ring.setStrokeStyle(HINT_RING, 0xf2c14e, 0.9).setFillStyle().setDepth(6);
    scene.ring = ring;
    scene.hintSpot = spot;
    pulse(scene, ring, base, 0);
  }

  function pulse(scene, ring, base, step) {
    scene.tl.add(260, function () {
      if (!ring.scene || scene.ring !== ring) return;
      var d = step % 2 === 0 ? 8 : 0;
      ring.setSize(base + d, base + d);
      pulse(scene, ring, base, step + 1);
    });
  }

  function hideHint(scene) {
    if (scene.ring && scene.ring.scene) scene.ring.destroy();
    scene.ring = null;
    scene.hintSpot = null;
    scene.hintOn = false;
  }

  // --- живость -----------------------------------------------------------------

  function popup(scene, x, y, text) {
    var t = global.ZV.ui.text(scene, Math.round(x), Math.round(y), text, {
      size: 1, color: global.ZV.SECONDARY
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

  // Кегль подбирается под ширину канвы: длинная строка кеглем 2 уезжала бы
  // за оба края экрана.
  function say(scene, text, ms) {
    scene.flash.setFontSize(global.ZV.font.UNIT * (global.ZV.font.fit(text, global.ZV.WIDTH - 40, 1, 2) || 1));
    scene.flash.setText(text);
    scene.tl.add(ms, function () { if (scene.flash.scene) scene.flash.setText(""); });
  }

  // Устойчивый хэш строки: форма и цвет заглушки у предмета всегда одни и те
  // же, иначе «Ключи» в разных раундах выглядели бы разными предметами.
  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // Фон подгоняется под канву общим правилом layout.js (fitBackground).
  // Без картинки — крупные пиксельные «пятна» интерьера: на пустоте предметы
  // читались бы сразу, и игры бы не было.
  function drawBackground(scene, W, H) {
    if (scene.textures.exists("bg") && !scene.bgFailed) {
      var src = scene.textures.get("bg").getSourceImage();
      var fit = global.ZV_LAYOUT.fitBackground(src.width, src.height, W, H, scene.bgTile);
      if (fit) {
        if (fit.mode === "tile") {
          scene.add.tileSprite(0, 0, W, H, "bg").setOrigin(0, 0).setDepth(-10);
          return;
        }
        var img = scene.add.image(W / 2, H / 2, "bg").setDepth(-10);
        if (fit.mode === "cover") img.setDisplaySize(fit.width, fit.height);
        else img.setScale(fit.scale);
        return;
      }
    }
    drawClutter(scene);
  }

  // Заглушка фона: полки, ящики и половицы прямоугольниками целых размеров.
  // Расстановка детерминированная (ZV.random), поэтому ?seed=42 повторяет и
  // фон, и раскладку — жалоба воспроизводится целиком.
  function drawClutter(scene) {
    var ZV = global.ZV;
    scene.add.rectangle(ZV.WIDTH / 2, FIELD.y + FIELD.h / 2, ZV.WIDTH, FIELD.h + 40, 0x232a40).setDepth(-9);
    var tones = [0x2c3450, 0x353d5c, 0x1f2740, 0x3c4566];
    var y;
    // Половицы: горизонтальные полосы во всю ширину.
    for (y = FIELD.y; y < FIELD.y + FIELD.h; y += 40) {
      scene.add.rectangle(ZV.WIDTH / 2, y, ZV.WIDTH, 2, 0x1a2036).setDepth(-8);
    }
    // Пятна интерьера: крупные блоки целых размеров, 12 штук — достаточно,
    // чтобы предмет не читался на пустоте, и не столько, чтобы рябило.
    for (var i = 0; i < 12; i++) {
      var w = ZV.random.between(3, 8) * 12;
      var h = ZV.random.between(2, 6) * 12;
      var x = ZV.random.between(FIELD.x, FIELD.x + FIELD.w - w) + Math.floor(w / 2);
      var cy = ZV.random.between(FIELD.y, FIELD.y + FIELD.h - h) + Math.floor(h / 2);
      var box = scene.add.rectangle(x, cy, w, h, ZV.random.pick(tones)).setDepth(-8);
      box.setStrokeStyle(2, 0x1a2036, 0.8);
    }
  }

  global.ZV_KITS = global.ZV_KITS || {};
  global.ZV_KITS.hidden = {
    defaults: DEFAULTS,
    createScenes: function () { return [new PlayScene()]; }
  };
})(window);
