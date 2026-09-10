// Линт контракта кита: каждый game/kits/<name>/kit.js регистрирует
// ZV_KITS[<name>] с defaults и createScenes, ходит за случайностью только в
// ZV.random, за текстурой — только через ZV.sprite.apply, а README описывает
// каждый параметр. Правила — это вылеченные грабли; у каждого ссылка, почему.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const kitsDir = path.join(root, "game", "kits");
const kitNames = fs.readdirSync(kitsDir).filter((d) => fs.existsSync(path.join(kitsDir, d, "kit.js")));

// Кит грузится в песочнице с заглушкой Phaser: при загрузке ему нужны только
// Phaser.Scene.prototype, window и чистые модули game/*.js (index.html
// подключает их раньше китов).
const PURE = ["fontdata.js", "font.js", "layout.js", "random.js", "grid.js", "timeline.js", "save.js", "pool.js", "levels.js", "novel.js", "content.js", "stage.js"];
function loadKit(name) {
  const src = fs.readFileSync(path.join(kitsDir, name, "kit.js"), "utf8");
  const window = { ZV_KITS: {}, ZV_GAME: {} };
  const ctx = vm.createContext({
    window,
    Phaser: { Scene: function Scene() {}, Display: {}, Math: {}, Animations: { Events: {} } },
    console
  });
  for (const f of PURE) vm.runInContext(fs.readFileSync(path.join(root, "game", f), "utf8"), ctx, { filename: "game/" + f });
  vm.runInContext(src, ctx, { filename: name + "/kit.js" });
  return { kit: window.ZV_KITS[name], src };
}

test("китов не меньше восьми", () => {
  assert.ok(kitNames.length >= 8, kitNames.join(", "));
});

for (const name of kitNames) {
  test(`${name}: регистрируется в ZV_KITS с defaults и createScenes`, () => {
    const { kit } = loadKit(name);
    assert.ok(kit, `ZV_KITS.${name} не зарегистрирован`);
    assert.equal(typeof kit.createScenes, "function");
    assert.ok(kit.defaults && typeof kit.defaults === "object", "нет defaults — параметры не вынесены в config.params");
    for (const [k, v] of Object.entries(kit.defaults)) {
      assert.ok(["number", "string", "boolean"].includes(typeof v), `defaults.${k}: только число/строка/булево`);
    }
  });

  test(`${name}: README описывает каждый параметр defaults`, () => {
    const { kit } = loadKit(name);
    const readme = fs.readFileSync(path.join(kitsDir, name, "README.md"), "utf8");
    for (const k of Object.keys(kit.defaults)) {
      assert.ok(readme.includes("`" + k + "`"), `README кита ${name} не описывает параметр \`${k}\``);
    }
  });

  test(`${name}: правила кода (случайность, текстуры, экраны, координаты)`, () => {
    const { src } = loadKit(name);
    // Сид: без ZV.random автопрогон и багрепорт по ?seed= невоспроизводимы.
    assert.ok(!/Math\.random\s*\(/.test(src), "Math.random — только ZV.random (game/random.js)");
    assert.ok(!/Phaser\.Math\.(Between|RND|FloatBetween)/.test(src), "Phaser.Math.Between/RND — только ZV.random");
    // Ключ игровой сцены и единственная точка выхода.
    assert.ok(src.includes('key: "zv-play"'), "игровая сцена обязана называться zv-play");
    assert.ok(/ZV\.finish\(/.test(src), "конец раунда — только ZV.finish");
    assert.ok(!/scene\.start\("zv-(menu|result)"/.test(src), "меню и результат рисует оболочка, кит их не стартует");
    // Смена текстуры мимо ZV.sprite.apply сбрасывает тело (shell.js, sprite.apply).
    assert.ok(!/\.setTexture\(/.test(src.replace(/setTexture\("boxOpen"\)/g, "")) || name === "wheel",
      "setTexture мимо ZV.sprite.apply сбрасывает тело — см. shell.js sprite.apply");
    // «Сок» через displayOrigin мимо ZV.juice рвёт контакт с полом (shell.js shiftView).
    assert.ok(!/setDisplayOrigin|displayOriginY\s*[+-]?=/.test(src), "displayOrigin — только через ZV.juice");
    // Дробный масштаб рвёт пиксельную сетку.
    assert.ok(!/setScale\(\s*\d*\.\d+/.test(src), "дробный setScale запрещён");
    // Контент грузится из существующего файла.
    for (const m of src.matchAll(/loadContent\([^,]+,\s*"([a-z0-9_-]+)"/g)) {
      assert.ok(fs.existsSync(path.join(root, "content", m[1] + ".json")), `content/${m[1]}.json не найден`);
    }
  });

  test(`${name}: время, хранилище и ключ сцены (правила недели 4)`, () => {
    const { src } = loadKit(name);
    // Таймлайн переживает «Ещё раз»: сцена переиспользуется, create() зовётся
    // снова, и хвост прошлой партии выстрелит в новой. Отсюда tl.clear() в
    // shutdown — тот же класс граблей, что Object.defineProperty без
    // configurable в квесте.
    if (/ZV\.timeline\.create\s*\(/.test(src)) {
      assert.ok(/\.clear\s*\(/.test(src), "есть ZV.timeline.create, но нет tl.clear(): зови его в shutdown, иначе шаги прошлой партии сработают в новой");
    }
    // Прямой localStorage бросает в приватном окне iOS и в кадре галереи —
    // причём на самом обращении к свойству, а не на getItem.
    assert.ok(!/localStorage/.test(src), "сохранение только через ZV.save: прямой localStorage бросает в приватном окне iOS");
    // Свой таймер переживает сцену: партия кончилась, а колбэк ещё стреляет.
    assert.ok(!/\b(setInterval|setTimeout)\s*\(/.test(src), "время игры — ZV.timeline и scene.time.*, а не setTimeout/setInterval: свой таймер переживёт сцену");
    // Кит регистрирует РОВНО одну сцену и ровно с ключом zv-play: мост
    // «сюжет ↔ мини-игра» переименовывает её в zv-mini перед scene.add, а
    // оболочка стартует по этому имени. Ключи анимаций (anims.create) — не
    // про это и правилом не считаются.
    const sceneKeys = [...src.matchAll(/Phaser\.Scene\.call\([^)]*?key:\s*"([^"]*)"/gs)].map((m) => m[1]);
    assert.equal(sceneKeys.length, 1, `сцен в ките должно быть ровно одна, найдено ${sceneKeys.length}: ${sceneKeys.join(", ")}`);
    for (const k of sceneKeys) {
      assert.equal(k, "zv-play", `ключ сцены «${k}»: оболочка знает только zv-play, чужое имя не запустится`);
    }
  });
}

test("index.html: модули недели 4 подключены до game/content.js (валидаторы их зовут)", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const at = (f) => html.indexOf(`game/${f}`);
  const content = at("content.js");
  assert.ok(content > 0, "index.html не подключает game/content.js");
  for (const f of ["grid.js", "timeline.js", "save.js", "pool.js"]) {
    const pos = at(f);
    assert.ok(pos > 0, `index.html не подключает game/${f}`);
    assert.ok(pos < content, `game/${f} подключён после content.js — валидатор его не найдёт`);
  }
  assert.ok(html.includes("<!-- modules: week4 -->"), "маркер modules: week4 потерян — новые модули будут вставлять кто куда");
  assert.ok(html.includes("<!-- kits: week4 -->"), "маркер kits: week4 потерян");
});

test("index.html подключает каждый кит, а game/config.js знает все архетипы", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cfg = fs.readFileSync(path.join(root, "game", "config.js"), "utf8");
  for (const name of kitNames) {
    assert.ok(html.includes(`game/kits/${name}/kit.js`), `index.html не подключает кит ${name}`);
    assert.ok(cfg.includes(`"${name}"`), `config.js не перечисляет архетип ${name}`);
  }
});
