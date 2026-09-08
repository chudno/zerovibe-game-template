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

  // Пиксельный шрифт: моноширинные системные — единственные, что не мылят
  // мелкий кегль. Внешних шрифтов в игре нет (White Label, вес страницы).
  var FONT = '"Courier New", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  // Экранных пикселей на логический: без него текст в 2 раза меньше нужного
  // растеризуется и мылится на апскейле.
  var TEXT_RES = Math.min(global.devicePixelRatio || 1, 3);

  var config = global.ZV_GAME || {};
  var brand = config.brand || {};
  var PRIMARY = brand.primary || "#4f7cff";
  var SECONDARY = brand.secondary || "#ffd23f";

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

  // Текст пиксель-арта: целые координаты и своя растеризация под экран.
  function label(scene, x, y, text, style) {
    var s = { fontFamily: FONT, fontSize: "16px", color: "#ffffff", resolution: TEXT_RES };
    if (style) {
      for (var k in style) {
        if (Object.prototype.hasOwnProperty.call(style, k)) s[k] = style[k];
      }
    }
    return scene.add.text(Math.round(x), Math.round(y), text, s);
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
      var t = label(scene, x, y, text, { fontSize: opts.fontSize || "24px", fontStyle: "bold" }).setOrigin(0.5);
      // Тап засчитываем по pointerup — это ближе к ожиданиям на телефоне.
      box.on("pointerdown", function () { box.setAlpha(0.75); });
      box.on("pointerout", function () { box.setAlpha(1); });
      box.on("pointerup", function () {
        box.setAlpha(1);
        onTap();
      });
      return { box: box, text: t };
    },

    title: function (scene, x, y, text, size) {
      return label(scene, x, y, text, {
        fontSize: (size || 32) + "px",
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: WIDTH - 60 }
      }).setOrigin(0.5);
    },

    hint: function (scene, x, y, text) {
      return label(scene, x, y, text, {
        fontSize: "16px", color: "#9aa0b5",
        align: "center", wordWrap: { width: WIDTH - 70 }
      }).setOrigin(0.5);
    },

    // Фон экрана: заглушка вместо оформления — подставляется картинкой кита.
    backdrop: function (scene) {
      scene.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101018).setOrigin(0.5);
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

  // --- экран «Играть» ----------------------------------------------------
  function MenuScene() {
    Phaser.Scene.call(this, { key: "zv-menu" });
  }
  MenuScene.prototype = Object.create(Phaser.Scene.prototype);
  MenuScene.prototype.constructor = MenuScene;
  MenuScene.prototype.create = function () {
    var self = this;
    ui.backdrop(this);
    if (brand.name) {
      label(this, WIDTH / 2, 100, brand.name, { fontSize: "16px", color: SECONDARY })
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
      }, { width: 224, height: 48, color: "#2a2f45", fontSize: "16px" });
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
  ResultScene.prototype.create = function () {
    var self = this;
    var r = this.result || {};
    ui.backdrop(this);
    ui.title(this, WIDTH / 2, 190, r.won ? "Победа" : "Раунд окончен", 32);
    label(this, WIDTH / 2, 260, String(r.score || 0), {
      fontSize: "64px", color: SECONDARY, fontStyle: "bold"
    }).setOrigin(0.5);
    ui.hint(this, WIDTH / 2, 320, r.text || "очков");

    ui.button(this, WIDTH / 2, HEIGHT / 2 + 110, "Ещё раз", function () {
      post("start");
      self.scene.start("zv-play");
    });
    ui.button(this, WIDTH / 2, HEIGHT / 2 + 190, "В меню", function () {
      self.scene.start("zv-menu");
    }, { width: 192, height: 48, color: "#2a2f45" });
  };

  // --- сборка игры -------------------------------------------------------
  var game = null;

  function boot(kit) {
    var scenes = [MenuScene].concat(kit.createScenes(config) || []).concat([ResultScene]);
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
        powerPreference: "low-power"   // промо-игра, батарея телефона важнее
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
    FONT: FONT,
    TEXT_RES: TEXT_RES,
    ui: ui,
    sprite: sprite,
    juice: juice,
    floor: floor,
    FLOOR_DEPTH: FLOOR_DEPTH,
    boot: boot,

    // Кит зовёт это в конце раунда: событие родителю + экран результата.
    finish: function (scene, result) {
      var r = result || {};
      lastResult = { score: r.score || 0, won: !!r.won, meta: r.meta || {}, text: r.text || "очков" };
      post("finish", { score: lastResult.score, won: lastResult.won, meta: lastResult.meta });
      scene.scene.start("zv-result", lastResult);
    }
  };
})(window);
