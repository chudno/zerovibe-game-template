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

// Карточки-данные: тот же архетип, другой контент (гибрид — novel с сюжетом,
// где есть узел мини-игры). Кит без карточки — красный тест; карточка без
// кита — тоже, кроме перечисленных здесь.
const DATA_CARDS = { hybrid: "novel" };

test("галерея перечисляет ровно те киты, что есть в game/kits, с подсказкой у каждого", () => {
  const listed = [...html.matchAll(/\{ id: "([a-z0-9_-]+)", name: "([^"]+)", hint: "([^"]+)"/g)]
    .map((m) => ({ id: m[1], name: m[2], hint: m[3] }));
  const ids = listed.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length, "id карточек повторяются: " + ids.join(", "));
  assert.deepEqual(ids.filter((id) => !DATA_CARDS[id]).sort(), kits);
  for (const k of listed) {
    assert.ok(k.name.length >= 3 && k.hint.length >= 10, `${k.id}: нужны имя и подсказка «что делать»`);
  }
  for (const [id, arch] of Object.entries(DATA_CARDS)) {
    const re = new RegExp(`\\{ id: "${id}",[^\\n]*archetype: "([a-z0-9_-]+)"`);
    const m = html.match(re);
    assert.ok(m, `у карточки ${id} нет archetype — она поднимет несуществующий кит`);
    assert.equal(m[1], arch, `карточка ${id} должна поднимать ${arch}`);
  }
});

test("галерея: карточка-данные подсовывает свой контент через ZV_TEST.contentUrl", () => {
  assert.ok(/kit\.archetype \|\| kit\.id/.test(html), "config(kit) не берёт archetype карточки");
  assert.ok(/contentUrl = kit\.content/.test(html), "build() не инлайнит адрес контента карточки");
  for (const [id] of Object.entries(DATA_CARDS)) {
    const m = html.match(new RegExp(`\\{ id: "${id}",[^\\n]*content: \\{ ([a-z]+): "([^"]+)" \\}`));
    assert.ok(m, `у карточки ${id} нет content: { <вид>: "<путь>" }`);
    assert.ok(fs.existsSync(path.join(root, m[2])), `${id}: файла ${m[2]} нет`);
  }
});

test("галерея подменяет config.js в index.html и ставит <base> на корень шаблона", () => {
  assert.ok(html.includes('game\\/config\\.js'), "нет подмены game/config.js");
  assert.ok(html.includes("<base href="), "нет <base> — относительные пути кадров сломаются");
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(index.includes('<script src="game/config.js"></script>'), "index.html подключает config.js иначе — подмена в галерее не сработает");
});
