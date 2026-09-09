// Оболочка игры: экраны Играть → Игра → Результат, мобильный контур,
// события родительскому окну. Киты о ней знают через ZV.finish/ZV.ui —
// свои экраны меню и результата им рисовать не нужно.
// Игры пиксель-арт: канва 360×640, ни одного дробного масштаба спрайтов.
(function (global) {
  "use strict";

  // Дизайн-канва: портрет, Scale.FIT растягивает её силами CSS.
  // 360×640 делится на 8/16/32 — тайловая сетка сходится, ассеты 1:1.
  var WIDTH = 360;
  var HEIGHT = 640;

  // Пиксельный шрифт (Pixel Cyr) рисуется спрайтами из атласа game/fontdata.js
  // (BitmapText), не canvas-текстом: тот мылит края на любом кегле и требует
  // ждать загрузки. Кегль — целый множитель k: 10·k px (капитель 10 px при k=1).
  var F = global.ZV_FONT;
  var FONT_KEY = global.ZV_PIXELFONT.KEY;

  var config = global.ZV_GAME || {};
  // Тема игры: название на первом экране и два акцента. config.brand — старое
  // имя поля (проекты до 9 сент 2026), читается как запасное.
  var theme = config.theme || config.brand || {};
  var PRIMARY = theme.primary || "#4f7cff";
  var SECONDARY = theme.secondary || "#ffd23f";

  // Перекрытия для автопрогона (tests/e2e): сид и параметры кита. В обычной
  // игре объекта нет.
  var TEST = global.ZV_TEST || {};

  // Случайность с сидом: ?seed=42 воспроизводит партию, иначе сид со времени.
  // Кит зовёт ZV.random() / .between / .pick / .shuffle / .weighted — не Math.random.
  var seedValue = TEST.seed !== undefined ? TEST.seed
    : global.ZV_RANDOM.seedFromSearch(global.location ? global.location.search : "");
  var random = global.ZV_RANDOM.create(seedValue);
  // Для багрепорта: «открой ?seed=<число>» повторяет партию.
  if (global.console && global.console.log) global.console.log("game seed: " + random.seed);

  // Параметры кита: дефолты кита ← config.params ← перекрытия теста.
  // Опечатка в config.params не ломает игру — уходит в предупреждение.
  function params(defaults) {
    var r = global.ZV_CONTENT.mergeParams(defaults, config.params, TEST.params);
    for (var i = 0; i < r.warnings.length; i++) {
      if (global.console) global.console.warn("config.params: " + r.warnings[i]);
    }
    return r.params;
  }

  // Контент кита: content/<kind>.json грузится в preload (loadContent), в
  // create кит берёт content(scene, kind) → { data, errors }. Ошибки формата
  // показываются экраном (ui.fail), а не белой страницей.
  function loadContent(scene, kind, url) {
    scene.load.json("zv-content-" + kind, url || ("content/" + kind + ".json"));
  }
  // opts — данные для валидатора (у платформера: физика, от которой зависит
  // проходимость уровней).
  function content(scene, kind, opts) {
    var data = scene.cache.json.get("zv-content-" + kind);
    if (!data) return { data: null, errors: ["content/" + kind + ".json не загрузился"] };
    return { data: data, errors: global.ZV_CONTENT.validate(kind, data, opts) };
  }

  var lastResult = { score: 0, won: false, meta: {} };

  // --- события родителю (контракт встраивания) ---------------------------
  function post(type, payload) {
    var msg = { source: "zv-game", type: type };
    if (payload) {
      for (var k in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
      }
    }
    try {
      if (global.parent && global.parent !== global) global.parent.postMessage(msg, "*");
    } catch (e) { /* родитель на другом origin и закрыт — не мешаем игре */ }
  }

  // --- звук: браузер разрешает WebAudio только после жеста ---------------
  function unlockAudio(scene) {
    var snd = scene.sound;
    if (snd && snd.locked && typeof snd.unlock === "function") snd.unlock();
    if (snd && snd.context && snd.context.state === "suspended") {
      snd.context.resume().catch(function () {});
    }
  }

  // Кегль из стиля: size — множитель k (1..6). Старая запись fontSize: "24px"
  // тоже понимается и округляется к ближайшему целому кеглю.
  function sizeK(style) {
    if (typeof style.size === "number") return Phaser.Math.Clamp(Math.round(style.size), 1, 6);
    var px = parseInt(style.fontSize, 10);
    if (!px) return 1;
    return px <= 17 ? 1 : (px <= 26 ? 2 : (px <= 44 ? 3 : 4));
  }

  // Текст пиксель-арта: BitmapText из атласа, целые координаты, целый кегль.
  // Стиль: size (k), color, align ("center"|"right"), wordWrap.width, lineSpacing.
  // fontStyle игнорируется: синтетический жирный размазал бы пиксели.
  function label(scene, x, y, text, style) {
    style = style || {};
    var k = sizeK(style);
    var t = scene.add.bitmapText(Math.round(x), Math.round(y), FONT_KEY, F.sanitize(text), F.UNIT * k);
    var origSetText = t.setText;
    t.setText = function (v) { return origSetText.call(t, F.sanitize(v)); };
    t.zvK = k;
    if (style.color) t.setTint(Phaser.Display.Color.HexStringToColor(style.color).color);
    if (style.align === "center") t.setCenterAlign();
    else if (style.align === "right") t.setRightAlign();
    if (style.wordWrap && style.wordWrap.width) t.setMaxWidth(style.wordWrap.width);
    if (typeof style.lineSpacing === "number") t.setLineSpacing(style.lineSpacing);
    return t;
  }

  // Кегль, при котором текст влезает в ширину за maxLines строк (не ниже 1).
  function fitK(text, maxWidth, maxLines, kMax) {
    return F.fit(text, maxWidth, maxLines, kMax) || 1;
  }

  // --- общие элементы интерфейса ----------------------------------------
  var ui = {
    // Тач-цель ≥24 логических px: при типичном масштабе это ≈48 css.
    button: function (scene, x, y, text, onTap, opts) {
      opts = opts || {};
      var w = opts.width || 208;
      var h = opts.height || 64;
      var color = opts.color || PRIMARY;
      var box = scene.add.rectangle(Math.round(x), Math.round(y), w, h,
        Phaser.Display.Color.HexStringToColor(color).color)
        .setOrigin(0.5).setInteractive({ useHandCursor: true });
      box.setStrokeStyle(2, 0xffffff, 0.18);
      // Кегль 2, а если подпись не влезает в кнопку — 1.
      var t = label(scene, x, y, text, { size: opts.size || fitK(text, w - 16, 1, 2) }).setOrigin(0.5);
      // Тап засчитываем по pointerup — это ближе к ожиданиям на телефоне.
      box.on("pointerdown", function () { box.setAlpha(0.75); });
      box.on("pointerout", function () { box.setAlpha(1); });
      box.on("pointerup", function () {
        box.setAlpha(1);
        onTap();
      });
      return { box: box, text: t };
    },

    // Заголовок: кегль 3 (size ≥ 30) или 2, ужимается до 2 строк.
    title: function (scene, x, y, text, size) {
      var kMax = (size || 32) >= 30 ? 3 : 2;
      return label(scene, x, y, text, {
        size: fitK(text, WIDTH - 60, 2, kMax),
        align: "center",
        wordWrap: { width: WIDTH - 60 }
      }).setOrigin(0.5);
    },

    hint: function (scene, x, y, text) {
      return label(scene, x, y, text, {
        size: 1, color: "#9aa0b5",
        align: "center", wordWrap: { width: WIDTH - 70 }
      }).setOrigin(0.5);
    },

    // Фон экрана: заглушка вместо оформления — подставляется картинкой кита.
    backdrop: function (scene) {
      scene.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101018).setOrigin(0.5);
    },

    // Столбик кнопок-вариантов (ответы квиза, реплики новеллы). Кнопки
    // создаются один раз и перезаполняются set(): текст поверх текста и утечки
    // при пересоздании — типовая ошибка. Тач-цель 64 px при шаге 75.
    // opts: { y, step, height, width, max, onPick(i) }. Кегль подбирается в set().
    choices: function (scene, opts) {
      opts = opts || {};
      var y0 = opts.y || 310, step = opts.step || 75;
      var h = opts.height || 64, w = opts.width || WIDTH - 60;
      var max = opts.max || 4;
      var IDLE = 0x2a2f45;
      var ctl = { items: [], enabled: true };
      function make(i) {
        var y = y0 + i * step;
        var box = scene.add.rectangle(WIDTH / 2, y, w, h, IDLE)
          .setOrigin(0.5).setInteractive({ useHandCursor: true });
        box.setStrokeStyle(2, 0xffffff, 0.12);
        var text = label(scene, WIDTH / 2, y, "", {
          size: 2, align: "center", wordWrap: { width: w - 30 }
        }).setOrigin(0.5);
        box.on("pointerup", function () {
          if (ctl.enabled && box.visible && opts.onPick) opts.onPick(i);
        });
        return { box: box, text: text };
      }
      for (var i = 0; i < max; i++) ctl.items.push(make(i));
      // Подставить подписи: лишние кнопки прячутся, цвета сбрасываются.
      // Кегль общий: 2, а если хоть одна подпись не влезает — 1. В кнопку
      // 64 px кеглем 2 влезают 2 строки, в низкую (новелла, 40 px) — одна.
      var maxLines2 = h >= 60 ? 2 : 1;
      ctl.set = function (labels) {
        var k = 2;
        (labels || []).forEach(function (l) { if (l && !F.fits(String(l), w - 30, maxLines2, 2)) k = 1; });
        for (var i = 0; i < ctl.items.length; i++) {
          var it = ctl.items[i], on = !!(labels && labels[i]);
          it.text.setFontSize(F.UNIT * k);
          it.text.setText(on ? String(labels[i]) : "");
          it.box.setFillStyle(IDLE);
          it.box.setVisible(on);
          it.text.setVisible(on);
        }
        return ctl;
      };
      ctl.color = function (i, hex) {
        if (ctl.items[i]) ctl.items[i].box.setFillStyle(hex);
        return ctl;
      };
      ctl.setDepth = function (d) {
        ctl.items.forEach(function (it) { it.box.setDepth(d); it.text.setDepth(d + 1); });
        return ctl;
      };
      // Координата центра i-й кнопки — для автопрогона и подсказок.
      ctl.centerOf = function (i) { return { x: WIDTH / 2, y: y0 + i * step }; };
      return ctl;
    },

    // Экран ошибки данных: заголовок и до восьми строк. Видит и человек в
    // превью, и автопрогон (в консоль уходит error).
    fail: function (scene, title, lines) {
      ui.backdrop(scene);
      label(scene, WIDTH / 2, 80, title || "Ошибка в данных игры", {
        size: 2, color: "#ff5f6d", align: "center", wordWrap: { width: WIDTH - 40 }
      }).setOrigin(0.5);
      var list = (lines || []).slice(0, 8);
      label(scene, 20, 130, list.map(function (l) { return "- " + l; }).join("\n"), {
        size: 1, color: "#e6e8f0", wordWrap: { width: WIDTH - 40 }, lineSpacing: 6
      });
      if (global.console && global.console.error) global.console.error((title || "content error") + ": " + list.join(" | "));
      post("error", { message: title || "content error", details: list });
    },

    text: label
  };

  // --- подстановка картинок и анимаций ------------------------------------
  // Единственная точка, через которую кит меняет текстуру/анимацию у спрайта.
  // Смысл: setTexture() и play() внутри зовут setSizeToFrame(), то есть
  // сбрасывают тело под размер нового кадра и обнуляют offset. Если тело
  // задать один раз в create, после подстановки настоящего спрайта герой
  // «повисает» над полом или проваливается. Хелпер запоминает желаемое тело
  // на спрайте и переприменяет его — но ТОЛЬКО когда размер кадра изменился
  // (см. refresh): лишний setSize/setOffset на каждом кадре анимации дёргает
  // тело относительно пола.

  // Непрозрачная область первого кадра текстуры: пиксель-арт почти всегда
  // приходит с прозрачными полями (у листа 96×96 ноги на y≈88, снизу ещё
  // 8 px пустоты). Тело по размеру КАДРА встаёт ниже видимых ног — герой
  // висит над землёй. Сканируем кадр один раз и кэшируем на текстуре.
  function opaqueBounds(scene, key, frameName) {
    var tex = scene.textures.get(key);
    if (!tex) return null;
    var cacheKey = "zvTrim:" + frameName;
    if (tex[cacheKey]) return tex[cacheKey];
    var frame = tex.get(frameName);
    if (!frame) return null;
    var w = frame.cutWidth, h = frame.cutHeight;
    var res = null;
    try {
      var cv = Phaser.Display.Canvas.CanvasPool.create2D(null, w, h);
      var ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(frame.source.image, frame.cutX, frame.cutY, w, h, 0, 0, w, h);
      var data = ctx.getImageData(0, 0, w, h).data;
      var minX = w, maxX = -1, minY = h, maxY = -1;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      Phaser.Display.Canvas.CanvasPool.remove(cv);
      if (maxX >= minX && maxY >= minY) {
        res = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, fw: w, fh: h };
      }
    } catch (e) {
      // Текстура с чужого origin — canvas «испорчен» (tainted), пиксели не
      // прочитать. Не беда: без обрезки тело будет по кадру, как раньше.
      res = null;
    }
    tex[cacheKey] = res || { none: true, fw: w, fh: h };
    return tex[cacheKey];
  }

  var sprite = {
    // opts: { texture, frame, anim, bodyW, bodyH, offsetX, offsetY, scale }
    // Размеры тела — в единицах ТЕКСТУРЫ (масштаб Arcade учитывает сам).
    // scale только целый: дробный рвёт пиксельную сетку внутри спрайта.
    // Якорь спрайта ставим по низу ног (0.5, 1): при смене картинки другого
    // размера точка опоры остаётся на земле, герой не уезжает вверх/вниз.
    // trim: false — не обрезать прозрачные поля (по умолчанию обрезаем).
    apply: function (obj, opts) {
      opts = opts || {};
      if (typeof opts.scale === "number") obj.setScale(Math.max(1, Math.round(opts.scale)));
      if (opts.origin !== false) obj.setOrigin(0.5, 1);
      // origin пересчитан — база сдвига картинки устарела.
      obj.setData("zvOriginY", undefined);

      var spec = obj.getData("zvBody") || {};
      ["bodyW", "bodyH", "offsetX", "offsetY"].forEach(function (k) {
        if (typeof opts[k] === "number") spec[k] = opts[k];
      });
      if (opts.trim === false) spec.noTrim = true;
      obj.setData("zvBody", spec);

      sprite.watch(obj);

      if (opts.texture) obj.setTexture(opts.texture, opts.frame);
      else if (typeof opts.frame !== "undefined") obj.setFrame(opts.frame);
      if (opts.anim) sprite.playAnim(obj, opts.anim, opts.animIgnoreIfPlaying !== false);

      sprite.refresh(obj, true);
      // Отдельно поднимать картинку не нужно: тело обрезано по ногам, и
      // спрайт с origin по низу кадра встаёт ровно так, что ноги ложатся
      // на верх тела-пола. Прозрачные поля остаются висеть НАД землёй,
      // как им и положено.
      return obj;
    },

    // Проигрывание анимации с тем же переприменением тела.
    playAnim: function (obj, key, ignoreIfPlaying) {
      if (!obj.anims || !obj.scene || !obj.scene.anims.exists(key)) return obj;
      obj.anims.play(key, ignoreIfPlaying !== false);
      sprite.refresh(obj);
      return obj;
    },

    // Возвращает телу размер и смещение, записанные в zvBody.
    // Размеры в единицах текстуры — Arcade множит их на масштаб сам.
    //
    // Тело считаем от НЕПРОЗРАЧНОЙ области кадра, а не от кадра целиком:
    // иначе низ тела уезжает под видимые ноги на всю высоту прозрачных полей
    // и герой висит в воздухе. bodyW/bodyH/offsetY из конфига перебивают
    // автообрезку — на них последнее слово.
    //
    // force !== true и размер кадра не менялся — не трогаем тело вовсе.
    // Лишний setSize/setOffset на КАЖДОМ кадре анимации переставляет тело
    // относительно пола, Arcade теряет контакт и герой начинает дрожать.
    refresh: function (obj, force) {
      var body = obj.body;
      var spec = obj.getData("zvBody");
      if (!body || !spec) return obj;
      var fw = obj.frame ? obj.frame.realWidth : obj.width;
      var fh = obj.frame ? obj.frame.realHeight : obj.height;

      var sig = fw + "x" + fh;
      if (force !== true && obj.getData("zvBodySig") === sig) return obj;
      obj.setData("zvBodySig", sig);

      // Обрезка прозрачных полей по первому кадру текстуры.
      var trim = null;
      if (!spec.noTrim && obj.texture && obj.frame && obj.scene) {
        var names = obj.texture.getFrameNames();
        var first = names.length ? names[0] : obj.frame.name;
        var b = opaqueBounds(obj.scene, obj.texture.key, first);
        if (b && !b.none && b.fw === fw && b.fh === fh) trim = b;
      }

      var w = spec.bodyW || (trim ? trim.w : fw);
      var h = spec.bodyH || (trim ? trim.h : fh);
      var ox = typeof spec.offsetX === "number" ? spec.offsetX
        : (trim ? trim.x + Math.round((trim.w - w) / 2) : Math.round((fw - w) / 2));
      // Низ тела — по низу непрозрачной области (ноги), а не по низу кадра.
      var bottom = trim ? trim.y + trim.h : fh;
      var oy = typeof spec.offsetY === "number" ? spec.offsetY : (bottom - h);

      body.setSize(w, h, false);
      // Картинка может быть сдвинута «соком» (shiftView): он держит
      // displayOriginY смещённым, и offset обязан остаться согласованным,
      // иначе тело прыгнет ровно на величину сдвига.
      var base = obj.getData("zvOriginY");
      var shifted = typeof base === "number" ? (obj.displayOriginY - base) : 0;
      body.setOffset(ox, oy + shifted);
      obj.setData("zvFootPad", fh - bottom);
      return obj;
    },

    // Прозрачных пикселей под ногами в текущем кадре (0, если полей нет).
    footPad: function (obj) {
      var v = obj.getData("zvFootPad");
      return typeof v === "number" ? v : 0;
    },

    // Подписка на события анимации: они меняют кадр, а значит и тело.
    watch: function (obj) {
      if (obj.getData("zvWatched")) return obj;
      obj.setData("zvWatched", true);
      var again = function () { sprite.refresh(obj); };
      obj.on(Phaser.Animations.Events.ANIMATION_START, again);
      obj.on(Phaser.Animations.Events.ANIMATION_UPDATE, again);
      obj.on(Phaser.Animations.Events.ANIMATION_REPEAT, again);
      return obj;
    }
  };

  // --- пол и «сок» ---------------------------------------------------------
  // Пол статическим телом БОЛЬШОЙ глубины: видно полоску, а тело уходит вниз.
  // Расчёт: герой падает со скоростью до v = jump (≈850 px/с). При просадке
  // до 30 fps кадр длится 33 мс — тело проходит 850/30 ≈ 28 px за кадр, при
  // 10 fps уже 85 px. Полоса 14 px пробивается уже на 30 fps, поэтому тело
  // делаем глубиной DEPTH = 200 px: даже без fixedStep запас четырёхкратный,
  // а с ним (шаг всегда 1/60) фактический ход за тик ≈ 14 px.
  var FLOOR_DEPTH = 200;

  // Чётное число не меньше min: нечётная ширина при origin 0.5 даёт полпикселя.
  function even(v, min) {
    return Math.max(min || 2, Math.round(v / 2) * 2);
  }

  // Сдвиг ТОЛЬКО картинки на целое число пикселей (плюс — вверх).
  //
  // ГРАБЛЯ, из-за которой герой дрожал: displayOriginY для этого НЕ ГОДИТСЯ.
  // Arcade считает позицию тела как
  //     body.position.y = gameObject.y + (body.offset.y - displayOriginY)
  // (Body.updateFromGameObject), то есть displayOrigin входит в физику
  // напрямую. Сдвиг картинки на 2 px поднимал тело на 2 px над полом,
  // blocked.down гас, включалась гравитация, герой падал обратно, кит видел
  // «приземление», снова звал squash — и цикл замыкался сам на себя.
  //
  // Физика читает с объекта ровно x, y, angle, scaleX, scaleY и
  // displayOriginX/Y, причём в виде разности (offset.y − displayOriginY).
  // Значит сдвиг картинки безопасен ровно тогда, когда мы одновременно
  // сдвигаем body.offset.y на ту же величину: разность не меняется,
  // body.position.y остаётся прежним, контакт с полом не рвётся.
  function shiftView(obj, dy) {
    var base = obj.getData("zvOriginY");
    if (typeof base !== "number") {
      base = obj.displayOriginY;
      obj.setData("zvOriginY", base);
    }
    var want = base + (Math.round(dy) || 0);
    var delta = want - obj.displayOriginY;
    if (!delta) return;
    obj.setDisplayOrigin(obj.displayOriginX, want);
    // Компенсация: тело обязано остаться там же, где было.
    if (obj.body) obj.body.setOffset(obj.body.offset.x, obj.body.offset.y + delta);
  }

  // Кадр, на который надо вернуться после подмены: у играющей анимации его
  // вернёт сама анимация, поэтому там null.
  function restoreFrameOf(obj) {
    if (obj.anims && obj.anims.isPlaying) return null;
    return obj.frame ? obj.frame.name : null;
  }

  function floor(scene, x, yTop, width, visibleH, color) {
    var vis = typeof visibleH === "number" ? visibleH : 14;
    // vis = 0: видимую часть рисует сам кит (тайлы дорожки), тело всё равно нужно.
    if (vis > 0) {
      scene.add.rectangle(x, yTop + vis / 2, width, vis,
        typeof color === "number" ? color : 0x2a2f45).setOrigin(0.5);
    }
    var body = scene.add.rectangle(x, yTop + FLOOR_DEPTH / 2, width, FLOOR_DEPTH, 0x000000, 0);
    scene.physics.add.existing(body, true);
    return body;
  }

  // Приземление и взлёт: «сок» без дробного масштаба. Спрайт пиксель-арта
  // нельзя ни сплющить твином, ни наклонить — вместо этого подменяем кадр
  // (если кит его завёл) и двигаем спрайт на ЦЕЛОЕ число пикселей.
  var juice = {
    // Приземление: кадр «сплющен» на 2–3 тика плюс просадка картинки на 2 px.
    // Кадра нет — остаётся одна просадка, она читается и без своей картинки.
    // ВАЖНО: двигаем displayOriginY, а не obj.y. Сдвиг obj.y у тела, лежащего
    // на полу, дерётся с коллайдером: тело снова падает на пол, обратный сдвиг
    // поднимает его — герой зависает в воздухе и больше не «приземляется».
    // displayOrigin меняет только отрисовку, физика его не видит.
    squash: function (scene, obj, frame, ms) {
      var d = typeof ms === "number" ? ms : 50;   // ~3 тика при 60 fps
      if (obj.zvSquash) { obj.zvSquash.remove(); obj.zvSquash = null; }
      var back = restoreFrameOf(obj);
      if (typeof frame !== "undefined" && frame !== null) {
        if (obj.anims) obj.anims.stop();
        obj.setFrame(frame);
        sprite.refresh(obj);
      }
      shiftView(obj, -2);   // картинка вниз на целое число пикселей
      obj.zvSquash = scene.time.delayedCall(d, function () {
        obj.zvSquash = null;
        shiftView(obj, 0);
        if (back !== null) { obj.setFrame(back); sprite.refresh(obj); }
      });
    },

    // Подъём картинки на 2 px в момент отрыва — обратная сторона приёма.
    stretch: function (scene, obj, frame, ms) {
      var d = typeof ms === "number" ? ms : 50;
      var back = restoreFrameOf(obj);
      if (typeof frame !== "undefined" && frame !== null) {
        if (obj.anims) obj.anims.stop();
        obj.setFrame(frame);
        sprite.refresh(obj);
      }
      shiftView(obj, 2);
      scene.time.delayedCall(d, function () {
        shiftView(obj, 0);
        if (back !== null) { obj.setFrame(back); sprite.refresh(obj); }
      });
    },

    // Тень отдельным спрайтом: три готовых кадра-размера вместо дробного
    // масштаба. Чем выше объект, тем меньше кадр.
    shadow: function (scene, obj, groundY, maxW, opts) {
      opts = opts || {};
      var w = maxW || 48;
      var color = typeof opts.color === "number" ? opts.color : 0x000000;
      var base = typeof opts.alpha === "number" ? opts.alpha : 0.35;
      var key = "zv-shadow-" + w + "-" + color;
      if (!scene.textures.exists(key)) {
        // Лист из трёх кадров-размеров: 100 %, 70 %, 45 % ширины. Все числа
        // чётные — спрайт с origin 0.5 садится ровно на пиксель.
        var hs = even(w * 0.25, 2);
        var widths = [even(w, 2), even(w * 0.7, 2), even(w * 0.45, 2)];
        var heights = [hs, even(hs * 0.75, 2), even(hs * 0.5, 2)];
        var g = scene.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(color, 1);
        for (var i = 0; i < 3; i++) {
          g.fillRect(i * w + (w - widths[i]) / 2, (hs - heights[i]) / 2, widths[i], heights[i]);
        }
        g.generateTexture(key, w * 3, hs);
        g.destroy();
        var tex = scene.textures.get(key);
        for (var j = 0; j < 3; j++) tex.add(j, 0, j * w, 0, w, hs);
      }
      var sh = scene.add.sprite(Math.round(obj.x), Math.round(groundY), key, 0)
        .setOrigin(0.5, 0.5).setAlpha(base).setDepth((obj.depth || 0) - 1);
      sh.zvFollow = function () {
        var h = Phaser.Math.Clamp((groundY - obj.y) / 160, 0, 1);
        sh.x = Math.round(obj.x);
        sh.setFrame(h > 0.66 ? 2 : (h > 0.28 ? 1 : 0));
        sh.setAlpha(base * (1 - h * 0.5));
      };
      return sh;
    },

    // Пара пылинок под ногами. Размер частицы целый, без дробного scale.
    dust: function (scene, x, y, color) {
      if (!scene.textures.exists("zv-dust")) {
        var g = scene.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.fillRect(0, 0, 3, 3);
        g.generateTexture("zv-dust", 3, 3);
        g.destroy();
      }
      var em = scene.add.particles(Math.round(x), Math.round(y), "zv-dust", {
        speed: { min: 30, max: 85 },
        angle: { min: 195, max: 345 },
        gravityY: 450,
        scale: 1,                      // целый: пылинка остаётся квадратом 3×3
        alpha: { start: 0.55, end: 0 },
        lifespan: 320,
        tint: typeof color === "number" ? color : 0x9aa0b5,
        quantity: 3,
        emitting: false
      }).setDepth(2);
      em.explode(3);
      scene.time.delayedCall(400, function () { em.destroy(); });
      return em;
    }
  };

  // --- призы -------------------------------------------------------------
  // Приз: { title, code, text, button, url }. Откуда берётся: config.prize
  // (один приз за победу в любом ките) или сам кит (колесо, «какой ты»)
  // через ZV.finish(scene, { prize }). Карточка рисуется на экране результата.
  var prizes = {
    // Взвешенный выбор из content/wheel.json-подобного списка (item.weight).
    pick: function (items) { return random.weighted(items); },

    // Карточка приза с верхом в y. Возвращает { height }.
    card: function (scene, prize, y) {
      var w = WIDTH - 48, pad = 14, cy = y + pad;
      var box = scene.add.rectangle(WIDTH / 2, y, w, 10, 0x1b1f33).setOrigin(0.5, 0);
      box.setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(SECONDARY).color, 0.6);
      var title = label(scene, WIDTH / 2, cy, prize.title, {
        size: fitK(prize.title, w - 2 * pad, 2, 2), align: "center", wordWrap: { width: w - 2 * pad }
      }).setOrigin(0.5, 0);
      cy += title.height + 10;
      if (prize.code) {
        var codeBox = scene.add.rectangle(WIDTH / 2, cy, 216, 44, 0x101018).setOrigin(0.5, 0);
        codeBox.setStrokeStyle(2, 0xffffff, 0.12);
        label(scene, WIDTH / 2, cy + 22, prize.code, {
          size: fitK(prize.code, 200, 1, 2), color: SECONDARY
        }).setOrigin(0.5);
        cy += 44 + 10;
      }
      if (prize.text) {
        var t = label(scene, WIDTH / 2, cy, prize.text, {
          size: 1, color: "#9aa0b5", align: "center", wordWrap: { width: w - 2 * pad }
        }).setOrigin(0.5, 0);
        cy += t.height + 10;
      }
      var action = prize.url ? "open" : (prize.code ? "copy" : "");
      if (action) {
        var caption = prize.button || (action === "open" ? "Забрать" : "Скопировать код");
        var btn = ui.button(scene, WIDTH / 2, cy + 24, caption, function () {
          if (action === "open") {
            try { global.open(prize.url, "_blank", "noopener"); } catch (e) { /* блокировщик окон */ }
            post("prize", { action: "open", code: prize.code || "", url: prize.url });
            return;
          }
          post("prize", { action: "copy", code: prize.code });
          var clip = global.navigator && global.navigator.clipboard;
          if (clip && clip.writeText) {
            clip.writeText(prize.code).then(function () { btn.text.setText("Скопировано"); },
              function () { /* без разрешения — код и так на экране */ });
          }
        }, { width: 240, height: 48 });
        cy += 48 + pad;
      } else {
        cy += pad - 6;
      }
      box.setSize(w, cy - y);
      return { height: cy - y };
    }
  };

  // --- загрузка: атлас шрифта до первого экрана -----------------------------
  function BootScene() {
    Phaser.Scene.call(this, { key: "zv-boot" });
  }
  BootScene.prototype = Object.create(Phaser.Scene.prototype);
  BootScene.prototype.constructor = BootScene;
  BootScene.prototype.preload = function () {
    // Логотип темы — картинка по ссылке из файлов проекта; битая ссылка не
    // должна ронять игру: ошибка загрузки глотается, экраны идут без него.
    if (theme.logoUrl) {
      this.load.image("zv-logo", theme.logoUrl);
      this.load.on("loaderror", function () {});
    }
  };
  BootScene.prototype.create = function () {
    global.ZV_PIXELFONT.install(this);
    this.scene.start("zv-menu");
  };

  // Логотип целым масштабом (1/n при крупном файле, k при мелком), чтобы не
  // мылить пиксели; вписывается в maxW×maxH, центр в (x, y). Нет текстуры —
  // null, вызывающий ставит подпись theme.name как раньше.
  function logo(scene, x, y, maxW, maxH) {
    if (!scene.textures.exists("zv-logo")) return null;
    var src = scene.textures.get("zv-logo").getSourceImage();
    var w = src.width, h = src.height;
    if (!w || !h) return null;
    var k = Math.floor(Math.min(maxW / w, maxH / h));
    var scale = k >= 1 ? k : 1 / Math.ceil(Math.max(w / maxW, h / maxH));
    return scene.add.image(x, y, "zv-logo").setScale(scale).setDepth(1);
  }

  // --- экран «Играть» ----------------------------------------------------
  function MenuScene() {
    Phaser.Scene.call(this, { key: "zv-menu" });
  }
  MenuScene.prototype = Object.create(Phaser.Scene.prototype);
  MenuScene.prototype.constructor = MenuScene;
  MenuScene.prototype.create = function () {
    var self = this;
    ui.backdrop(this);
    if (!logo(this, WIDTH / 2, 100, 240, 80) && theme.name) {
      label(this, WIDTH / 2, 100, theme.name, { size: 1, color: SECONDARY })
        .setOrigin(0.5);
    }
    ui.title(this, WIDTH / 2, 190, config.title || "Игра", 32);
    ui.hint(this, WIDTH / 2, 260, "Одно касание — одно действие");

    ui.button(this, WIDTH / 2, HEIGHT / 2 + 60, "Играть", function () {
      unlockAudio(self);
      post("start");
      self.scene.start("zv-play");
    });

    if (!config.embed) {
      ui.button(this, WIDTH / 2, HEIGHT - 110, "Во весь экран", function () {
        unlockAudio(self);
        if (self.scale.isFullscreen) self.scale.stopFullscreen();
        else self.scale.startFullscreen();
      }, { width: 224, height: 48, color: "#2a2f45" });
    }

    post("ready");
  };

  // --- экран «Результат» -------------------------------------------------
  function ResultScene() {
    Phaser.Scene.call(this, { key: "zv-result" });
  }
  ResultScene.prototype = Object.create(Phaser.Scene.prototype);
  ResultScene.prototype.constructor = ResultScene;
  ResultScene.prototype.init = function (data) {
    this.result = data || lastResult;
  };
  // Раскладка зависит от того, есть ли приз: с карточкой всё поджимается вверх.
  ResultScene.prototype.create = function () {
    var self = this;
    var r = this.result || {};
    var prize = r.prize && global.ZV_CONTENT.hasPrize(r.prize) ? r.prize : null;
    ui.backdrop(this);
    var y = prize ? 90 : 190;
    // Логотип — над заголовком, мелко: экран результата занят итогом.
    if (logo(this, WIDTH / 2, prize ? 40 : 100, 160, 48) && prize) y = 110;
    var t = ui.title(this, WIDTH / 2, y, r.title || (r.won ? "Победа" : "Раунд окончен"), prize ? 26 : 32);
    y += Math.max(t.height / 2, 20) + (prize ? 22 : 46);
    if (!r.hideScore) {
      label(this, WIDTH / 2, y, String(r.score || 0), {
        size: prize ? 3 : 4, color: SECONDARY
      }).setOrigin(0.5);
      y += prize ? 34 : 60;
    }
    if (r.text) {
      var h = ui.hint(this, WIDTH / 2, y, r.text);
      y += h.height / 2 + (prize ? 18 : 40);
    }
    if (prize) {
      y += prizes.card(this, prize, Math.round(y)).height + 18;
    } else {
      y = Math.max(y, HEIGHT / 2 + 78);
    }
    var by = Math.round(Math.max(y + 32, prize ? HEIGHT - 116 : HEIGHT / 2 + 110));
    if (r.replay !== false) {
      ui.button(this, WIDTH / 2, by, "Ещё раз", function () {
        post("start");
        self.scene.start("zv-play");
      });
      by += 80;
    } else {
      by = Math.round(y + 32);   // без «Ещё раз» — «В меню» сразу под карточкой
    }
    ui.button(this, WIDTH / 2, Math.min(by, HEIGHT - 36), "В меню", function () {
      self.scene.start("zv-menu");
    }, { width: 192, height: 48, color: "#2a2f45" });
  };

  // --- сборка игры -------------------------------------------------------
  var game = null;

  function boot(kit) {
    var scenes = [BootScene, MenuScene].concat(kit.createScenes(config) || []).concat([ResultScene]);
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game",
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: "#101018",
      // pixelArt: ближайший сосед внутри канвы. Мыло на финальном апскейле
      // снимает только image-rendering: pixelated в style.css — без него
      // все эти флаги ничего не дают.
      render: {
        pixelArt: true,
        roundPixels: true,
        antialias: false,
        powerPreference: "low-power"   // игра с телефона, батарея важнее кадров
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        autoRound: true                // размер канвы целыми пикселями
      },
      // fixedStep: физический шаг всегда 1/60 с, даже когда кадры проседают.
      // Без него на слабом телефоне шаг равен длине кадра, и быстрое тело
      // пролетает сквозь пол за один тик (туннелирование).
      physics: {
        default: "arcade",
        arcade: { gravity: { y: 0 }, debug: false, fixedStep: true, fps: 60, timeScale: 1 }
      },
      input: { activePointers: 2 },
      scene: scenes
    });
    global.ZV.game = game; // ссылка для отладки из консоли
    return game;
  }

  // Родитель просит перезапуск: возвращаемся на игровой экран.
  global.addEventListener("message", function (ev) {
    var d = ev && ev.data;
    if (!d || d.source !== "zv-host") return;
    if (d.type === "restart" && game) {
      post("start");
      // Гасим то, что сейчас на экране: иначе результат остаётся поверх игры.
      game.scene.stop("zv-result");
      game.scene.stop("zv-menu");
      game.scene.start("zv-play");
    }
  });

  global.ZV = {
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    PRIMARY: PRIMARY,
    SECONDARY: SECONDARY,
    FONT: F.FAMILY,
    font: F,            // метрики: width/wrap/fit/sanitize — подобрать кегль под ширину
    ui: ui,
    sprite: sprite,
    juice: juice,
    floor: floor,
    FLOOR_DEPTH: FLOOR_DEPTH,
    boot: boot,
    random: random,
    seed: random.seed,
    params: params,
    loadContent: loadContent,
    content: content,
    prizes: prizes,

    // Уровни платформера: разбор карты, солвер проходимости, исполнитель плана.
    levels: global.ZV_LEVELS,
    // Новелла: граф сюжета, проверка по состояниям, рантайм со снимком.
    novel: global.ZV_NOVEL,

    // Промежуточный прогресс многоэкранной игры (пройден уровень, глава):
    // событие родителю, экран не меняется. p: { step, total, meta }.
    progress: function (scene, p) {
      p = p || {};
      post("progress", { step: p.step || 0, total: p.total || 0, meta: p.meta || {} });
    },

    // Кит зовёт это в конце раунда: событие родителю + экран результата.
    // result: { score, won, text, meta, title, hideScore, prize, outcome, replay }.
    // prize — карточка на экране результата; без него при победе берётся
    // config.prize. outcome — исход словом (тип в «какой ты», концовка) для
    // аналитики партнёра. replay: false — без кнопки «Ещё раз» (розыгрыш).
    finish: function (scene, result) {
      var r = result || {};
      var prize = r.prize;
      if (!prize && r.won && global.ZV_CONTENT.hasPrize(config.prize)) prize = config.prize;
      lastResult = {
        score: r.score || 0, won: !!r.won, meta: r.meta || {},
        text: typeof r.text === "string" ? r.text : "очков",
        title: r.title || "", hideScore: !!r.hideScore,
        prize: prize || null, outcome: r.outcome || "", replay: r.replay !== false
      };
      var payload = { score: lastResult.score, won: lastResult.won, meta: lastResult.meta };
      if (lastResult.outcome) payload.outcome = lastResult.outcome;
      if (prize) payload.prize = { id: prize.id || "", title: prize.title, code: prize.code || "" };
      post("finish", payload);
      scene.scene.start("zv-result", lastResult);
    }
  };
})(window);
