// Контент проекта проходит те же проверки, что и в игре (ZV_CONTENT.validate):
// архетип из config.js → кит → его content/<kind>.json; у сюжета — ещё и
// мини-игры узлов play с параметрами узла (дефолты кита ← config.params ←
// play.params, как слои в shell.js). До этого формат ловился только в браузере
// по кнопке «Играть»: тесты зелёные, а игрок видел экран «Ошибки в content/…»
// (живой прогон 13 сент: rules длиннее области).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../game/content.js");
const { root, kitNames, loadKit, contentKinds } = require("./kitload.js");

// config.js читает адрес страницы (?embed, тема) — даём пустой location.
function config() {
  const location = { search: "", hash: "", href: "" };
  const window = { location };
  vm.runInContext(fs.readFileSync(path.join(root, "game", "config.js"), "utf8"),
    vm.createContext({ window, location, URLSearchParams, navigator: { language: "ru" } }), { filename: "game/config.js" });
  return window.ZV_GAME;
}

// Что кит передаёт валидатору вместе с данными — см. ZV.content(...) в kit.js.
function validatorOpts(kind, S) {
  if (kind === "memory") return { moves: S.moves };
  if (kind === "levels") return { physics: { moveSpeed: S.moveSpeed, gravity: S.gravity, jump: S.jump, maxFall: S.maxFall } };
  return { params: S };
}

function readJSON(kind) {
  const file = path.join(root, "content", kind + ".json");
  assert.ok(fs.existsSync(file), `content/${kind}.json не найден`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { assert.fail(`content/${kind}.json: не JSON — ${e.message}`); }
}

// Проверить контент кита с параметрами слоёв; у сюжета — и мини-игры узлов.
function checkKit(name, cfgParams, playParams, where) {
  const { kit, src } = loadKit(name);
  assert.ok(kit, `${where}: кит «${name}» не найден`);
  const S = C.mergeParams(kit.defaults, cfgParams || {}, playParams || {}, undefined).params;
  for (const kind of contentKinds(src)) {
    const data = readJSON(kind);
    assert.deepEqual(C.validate(kind, data, validatorOpts(kind, S)), [], `${where}: content/${kind}.json`);
    if ((kind === "novel" || kind === "quest") && data.nodes) {
      for (const [id, n] of Object.entries(data.nodes)) {
        if (n && n.play) checkKit(n.play.kit, cfgParams, n.play.params, `${where} → nodes.${id}.play (${n.play.kit})`);
      }
    }
  }
}

test("config.js: контент архетипа и мини-игр сюжета проходит валидатор игры", () => {
  const cfg = config();
  assert.ok(cfg && typeof cfg.archetype === "string", "config.js не задаёт archetype");
  checkKit(cfg.archetype, cfg.params, {}, `archetype ${cfg.archetype}`);
});

test("content/*.json шаблона — рабочие примеры: каждый файл нужен какому-то киту и валиден на его дефолтах", () => {
  const owners = {};
  for (const name of kitNames()) for (const kind of contentKinds(loadKit(name).src)) owners[kind] = name;
  const files = fs.readdirSync(path.join(root, "content")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  for (const kind of files) assert.ok(owners[kind], `content/${kind}.json не грузит ни один кит — лишний файл или опечатка`);
  for (const name of kitNames()) checkKit(name, {}, {}, `кит ${name}`);
});

test("сообщение о длине: «1 строки», «2 строк»", () => {
  const long = "Веди сумку пальцем. Лови коробки, пропускай мусор, не задевай ворону и лужи";
  const sample = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "hybrid.json"), "utf8"));
  const a = sample();
  const playId = Object.keys(a.nodes).find((id) => a.nodes[id].play);
  a.nodes[playId].play.rules = long;
  const two = C.validate("novel", a);
  assert.ok(two.some((e) => e.includes("nodes." + playId + ".play: rules не влезает — не больше 2 строк по")), two.join("\n"));
  const b = sample();
  b.nodes[b.start].speaker = long;
  const one = C.validate("novel", b);
  assert.ok(one.some((e) => e.includes("speaker не влезает — не больше 1 строки по")), one.join("\n"));
});
