// Галерея китов (tests/gallery.html) обязана знать каждый кит из game/kits и
// не знать лишних: новый кит без карточки — красный тест, чтобы ручная
// приёмка не пропускала архетип.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(__dirname, "gallery.html"), "utf8");
const kits = fs.readdirSync(path.join(root, "game", "kits"))
  .filter((d) => fs.existsSync(path.join(root, "game", "kits", d, "kit.js"))).sort();

test("галерея перечисляет ровно те киты, что есть в game/kits, с подсказкой у каждого", () => {
  const listed = [...html.matchAll(/\{ id: "([a-z0-9_-]+)", name: "([^"]+)", hint: "([^"]+)"/g)]
    .map((m) => ({ id: m[1], name: m[2], hint: m[3] }));
  assert.deepEqual(listed.map((k) => k.id).sort(), kits);
  for (const k of listed) {
    assert.ok(k.name.length >= 3 && k.hint.length >= 10, `${k.id}: нужны имя и подсказка «что делать»`);
  }
});

test("галерея подменяет config.js в index.html и ставит <base> на корень шаблона", () => {
  assert.ok(html.includes('game\\/config\\.js'), "нет подмены game/config.js");
  assert.ok(html.includes("<base href="), "нет <base> — относительные пути кадров сломаются");
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(index.includes('<script src="game/config.js"></script>'), "index.html подключает config.js иначе — подмена в галерее не сработает");
});
