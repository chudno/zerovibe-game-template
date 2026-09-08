// Проверки сайта до публикации: ссылки ведут на существующие файлы, внешних
// адресов нет (White Label и работа без сети), имени платформы нет, config.js
// указывает на существующий кит, весь JS парсится.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
// Что уезжает в бакет: всё, кроме тестов, документации, скрытого и служебного.
function siteFiles(dir = root, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.name.startsWith(".") || ["tests", "docs", "node_modules"].includes(e.name)) continue;
    if (e.isDirectory()) out.push(...siteFiles(path.join(dir, e.name), r));
    else if (!/\.md$|\.test\.js$/.test(e.name)) out.push(r);
  }
  return out;
}
const linkRe = /(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g;
const external = (ref) => /^(https?:)?\/\//.test(ref) || /^(data:|mailto:|#|javascript:)/.test(ref);

test("в корне есть index.html — иначе раздавать нечего", () => {
  assert.ok(fs.existsSync(path.join(root, "index.html")));
});

test("ссылки в html/css/js ведут на существующие файлы, внешних адресов нет", () => {
  for (const f of siteFiles()) {
    if (!/\.(html|css|js)$/.test(f) || f.startsWith("vendor/")) continue;
    const text = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of text.matchAll(linkRe)) {
      const ref = m[1] || m[2];
      if (!ref) continue;
      assert.ok(!/^(https?:)?\/\//.test(ref), `${f}: внешний адрес ${ref}`);
      if (external(ref)) continue;
      const target = path.normalize(path.join(path.dirname(f), ref.split(/[?#]/)[0]));
      assert.ok(fs.existsSync(path.join(root, target)), `${f}: ссылка ${ref} → нет файла ${target}`);
    }
  }
});

test("имени платформы в статике нет", () => {
  for (const f of siteFiles()) {
    if (!/\.(html|css|js|json|txt)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(!/zerovibe/i.test(text), `${f}: встречается имя платформы`);
  }
});

test("config.js указывает на существующий кит", () => {
  const src = fs.readFileSync(path.join(root, "game", "config.js"), "utf8");
  const m = src.match(/archetype:\s*"([a-z0-9_-]+)"/);
  assert.ok(m, "в config.js не найден archetype");
  assert.ok(fs.existsSync(path.join(root, "game", "kits", m[1], "kit.js")), `кит ${m[1]} не найден`);
});

test("в корне нет package.json — зависимостей в рантайме у игры быть не должно", () => {
  assert.ok(!fs.existsSync(path.join(root, "package.json")));
  assert.ok(!fs.existsSync(path.join(root, "node_modules")));
});

test("весь JS игры парсится (по одному файлу — node --check с несколькими проверяет только первый)", () => {
  for (const f of siteFiles()) {
    if (!f.endsWith(".js") || f.startsWith("vendor/")) continue;
    execFileSync(process.execPath, ["--check", path.join(root, f)], { stdio: "pipe" });
  }
});
