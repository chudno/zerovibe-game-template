// Порядок слоёв параметров кита в оболочке: дефолты кита ← config.params ←
// ZV_PLAY_PARAMS (параметры узла мини-игры внутри сюжета) ← ZV_TEST.params.
// Перекрытие теста обязано быть ПОСЛЕДНИМ: иначе e2e не может урезать партию
// и прогон упирается в боевую длительность. shell.js в node не грузится
// (ему нужен Phaser), поэтому порядок проверяется по вызову в исходнике, а
// само слияние — на mergeParams.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../game/content.js");

const shell = fs.readFileSync(path.join(__dirname, "..", "game", "shell.js"), "utf8");

test("shell.js: четыре слоя параметров в правильном порядке", () => {
  const m = /mergeParams\(([\s\S]{0,200}?)\);/.exec(shell);
  assert.ok(m, "в shell.js нет вызова mergeParams");
  const args = m[1].replace(/\s+/g, " ");
  const order = ["defaults", "config.params", "ZV_PLAY_PARAMS", "TEST.params"];
  let pos = -1;
  for (const name of order) {
    const at = args.indexOf(name);
    assert.ok(at >= 0, `слоя «${name}» нет в вызове: ${args}`);
    assert.ok(at > pos, `слой «${name}» стоит не на своём месте: ${args}`);
    pos = at;
  }
});

test("mergeParams: последний слой побеждает — тест перекрывает и сюжет, и config", () => {
  const defaults = { duration: 75000, pairs: 6 };
  const cfg = { duration: 60000 };
  const play = { duration: 30000, pairs: 4 };
  const t = { duration: 5000 };
  const r = C.mergeParams(defaults, cfg, play, t);
  assert.equal(r.params.duration, 5000, "перекрытие ZV_TEST обязано быть последним");
  assert.equal(r.params.pairs, 4, "узел мини-игры перекрывает config.params");
  assert.deepEqual(C.mergeParams(defaults, cfg, {}, undefined).params, { duration: 60000, pairs: 6 });
});

test("shell.js: адрес контента можно подменить только через ZV_TEST", () => {
  assert.ok(/TEST\.contentUrl/.test(shell), "loadContent не смотрит в ZV_TEST.contentUrl");
  // Ни одного другого источника адреса: подмена контента — только тестовая.
  const hits = shell.match(/contentUrl/g) || [];
  const testHits = shell.match(/TEST\.contentUrl/g) || [];
  assert.equal(hits.length, testHits.length, "contentUrl читается мимо ZV_TEST");
});
