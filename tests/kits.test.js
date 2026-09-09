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
const PURE = ["fontdata.js", "font.js", "layout.js", "random.js", "levels.js", "content.js"];
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

test("китов не меньше шести", () => {
  assert.ok(kitNames.length >= 6, kitNames.join(", "));
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
}

test("index.html подключает каждый кит, а game/config.js знает все архетипы", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const cfg = fs.readFileSync(path.join(root, "game", "config.js"), "utf8");
  for (const name of kitNames) {
    assert.ok(html.includes(`game/kits/${name}/kit.js`), `index.html не подключает кит ${name}`);
    assert.ok(cfg.includes(`"${name}"`), `config.js не перечисляет архетип ${name}`);
  }
});
