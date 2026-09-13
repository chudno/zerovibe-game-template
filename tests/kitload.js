// Кит в песочнице node: заглушка Phaser, window и чистые модули game/*.js в
// порядке index.html. Достаточно, чтобы кит зарегистрировался в ZV_KITS
// (defaults, createScenes) — сцены не создаются. Общий для тестов контракта
// кита и контента проекта.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const kitsDir = path.join(root, "game", "kits");
const PURE = ["fontdata.js", "font.js", "layout.js", "random.js", "grid.js", "timeline.js", "save.js", "pool.js", "levels.js", "novel.js", "content.js", "stage.js"];

function kitNames() {
  return fs.readdirSync(kitsDir).filter((d) => fs.existsSync(path.join(kitsDir, d, "kit.js")));
}

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

// Виды контента, которые кит грузит в preload: content/<kind>.json.
function contentKinds(src) {
  return [...src.matchAll(/loadContent\([^,]+,\s*"([a-z0-9_-]+)"/g)].map((m) => m[1]);
}

module.exports = { root, kitsDir, kitNames, loadKit, contentKinds };
