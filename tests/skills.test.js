// Скиллы агента (.claude/skills) обязаны ссылаться на существующие файлы:
// после переезда шаблона на чистую статику 7 из 9 скиллов жили старыми путями
// (static/game/…, handler.go, go run ./cmd/server), и агент первым ходом читал
// несуществующее. Проверяем каждый путь в обратных кавычках, похожий на файл
// или каталог репозитория.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const skills = fs.readdirSync(path.join(root, ".claude", "skills")).map((d) => path.join(root, ".claude", "skills", d, "SKILL.md")).filter(fs.existsSync);

// Путь: сегменты через "/", без пробелов, начинается с известного каталога или
// файла корня; шаблоны с <…>/** пропускаем, как и внешние адреса.
const known = ["game/", "vendor/", "assets/", "content/", "tests/", "docs/", "index.html", ".claude/"];
function looksLikePath(s) {
  if (/[\s<>*{}$]/.test(s) || /^https?:/.test(s)) return false;
  return known.some((k) => s === k.replace(/\/$/, "") || s.startsWith(k));
}

test("скиллов не меньше девяти и в них нет следов Go и static/", () => {
  assert.ok(skills.length >= 9, `скиллов ${skills.length}`);
  for (const f of skills) {
    const text = fs.readFileSync(f, "utf8");
    for (const bad of ["static/game", "handler.go", "assets.go", "go run", "go test", "go build", "cmd/server", "internal/ycf"]) {
      assert.ok(!text.includes(bad), `${path.relative(root, f)}: упоминание «${bad}» — путь снесён вместе с Go`);
    }
  }
});

test("каждый путь в обратных кавычках в скиллах существует", () => {
  for (const f of skills) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const ref = m[1].replace(/^\.\//, "");
      if (!looksLikePath(ref)) continue;
      const target = path.join(root, ref.replace(/\/$/, ""));
      assert.ok(fs.existsSync(target), `${path.relative(root, f)}: путь \`${ref}\` не существует`);
    }
  }
});
