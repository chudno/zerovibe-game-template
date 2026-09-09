// Генератор уровней платформера для тестов: случайные уровни с сидом (ямы,
// ступени, платформы с монетами, шипы) и заведомо НЕПРОХОДИМЫЕ конструкции
// (яма шире прыжка, стена выше прыжка, замурованный выход, низкий коридор,
// выход на башне). На них сверяются солвер и бот: «проходим» — бот обязан
// дойти, «непроходим» — обязан не дойти. Не попадает в публикацию (tests/).
"use strict";
const R = require("../game/random.js");
const L = require("../game/levels.js");

function blank(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill("."));
}
function toMap(grid) {
  return grid.map((row) => row.join(""));
}

// Случайный уровень: пол с ямами 1–4, ступени 1–2, платформы на 2–3 клетки
// выше пола с монетами, редкие шипы. Проходим ли — решает солвер.
function generate(seed, opts) {
  opts = opts || {};
  const rng = R.create(seed);
  const rows = opts.rows || 17;
  const cols = opts.cols || rng.between(30, 44);
  const g = blank(rows, cols);
  const floor = rows - 1;
  for (let c = 0; c < cols; c++) g[floor][c] = "#";
  // Ямы: не в первых четырёх и последних шести столбцах.
  let c = 4;
  while (c < cols - 8) {
    if (rng.chance(0.3)) {
      const w = rng.between(1, 4);
      for (let k = 0; k < w && c + k < cols - 6; k++) g[floor][c + k] = ".";
      c += w + 3;
    } else {
      c += 1;
    }
  }
  // Ступени на полу.
  for (let x = 3; x < cols - 5; x++) {
    if (g[floor][x] !== "#" || !rng.chance(0.12)) continue;
    const h = rng.between(1, 2), w = rng.between(1, 3);
    for (let k = 0; k < w && x + k < cols - 4; k++) {
      if (g[floor][x + k] !== "#") continue;
      for (let y = 1; y <= h; y++) g[floor - y][x + k] = "#";
    }
    x += w + 1;
  }
  // Платформы в воздухе с монетами.
  const n = rng.between(2, 5);
  for (let i = 0; i < n; i++) {
    const w = rng.between(2, 4);
    const x = rng.between(4, cols - 6 - w);
    const y = floor - rng.between(3, 4);
    let free = true;
    for (let k = -1; k <= w; k++) {
      for (let dy = -2; dy <= 1; dy++) {
        const cx = x + k, cy = y + dy;
        if (cx < 0 || cx >= cols || cy < 0) continue;
        if (g[cy][cx] !== ".") free = false;
      }
    }
    if (!free) continue;
    for (let k = 0; k < w; k++) {
      g[y][x + k] = "#";
      if (rng.chance(0.6)) g[y - 1][x + k] = "o";
    }
  }
  // Шипы на полу между сплошными клетками.
  for (let x = 5; x < cols - 6; x++) {
    if (g[floor][x] === "#" && g[floor - 1][x] === "." && g[floor][x - 1] === "#" && g[floor][x + 1] === "#" &&
      g[floor - 1][x - 1] === "." && g[floor - 1][x + 1] === "." && rng.chance(0.08)) {
      g[floor - 1][x] = "^";
    }
  }
  // Монеты на полу.
  for (let x = 4; x < cols - 4; x++) {
    if (g[floor][x] === "#" && g[floor - 1][x] === "." && g[floor - 2][x] === "." && rng.chance(0.1)) g[floor - 1][x] = "o";
  }
  g[floor - 1][1] = "S"; g[floor - 2][1] = ".";
  g[floor - 1][cols - 2] = "X"; g[floor - 2][cols - 2] = ".";
  g[floor][1] = "#"; g[floor][cols - 2] = "#";
  return { name: "Сид " + seed, map: toMap(g) };
}

// Заведомо непроходимые конструкции. Числа — от физики: прыжок ≈ 3,4 клетки
// вверх и ≈ 3,7 клетки в длину (L.reach), герой 1,5 клетки ростом.
const IMPOSSIBLE = {
  pit(rows, cols) {                 // яма в 7 клеток
    const g = blank(rows, cols), f = rows - 1;
    for (let c = 0; c < cols; c++) g[f][c] = c >= 10 && c < 17 ? "." : "#";
    g[f - 1][1] = "S"; g[f - 1][cols - 2] = "X";
    return g;
  },
  wall(rows, cols) {                // стена в 6 клеток до потолка нет, но выше прыжка
    const g = blank(rows, cols), f = rows - 1;
    for (let c = 0; c < cols; c++) g[f][c] = "#";
    for (let y = 1; y <= 6; y++) g[f - y][12] = "#";
    g[f - 1][1] = "S"; g[f - 1][cols - 2] = "X";
    return g;
  },
  box(rows, cols) {                 // выход замурован
    const g = blank(rows, cols), f = rows - 1;
    for (let c = 0; c < cols; c++) g[f][c] = "#";
    const ex = cols - 4;
    for (let y = 1; y <= 3; y++) { g[f - y][ex - 2] = "#"; g[f - y][ex + 2] = "#"; }
    for (let c = ex - 2; c <= ex + 2; c++) g[f - 3][c] = "#";
    g[f - 1][ex] = "X";
    g[f - 1][1] = "S";
    return g;
  },
  ceiling(rows, cols) {             // коридор в одну клетку: герой не пролезет
    const g = blank(rows, cols), f = rows - 1;
    for (let c = 0; c < cols; c++) g[f][c] = "#";
    for (let y = 2; y < rows - 1; y++) for (let c = 12; c <= 14; c++) g[f - y][c] = "#";
    g[f - 1][1] = "S"; g[f - 1][cols - 2] = "X";
    return g;
  },
  tower(rows, cols) {               // выход на башне в 5 клеток
    const g = blank(rows, cols), f = rows - 1;
    for (let c = 0; c < cols; c++) g[f][c] = "#";
    for (let y = 1; y <= 5; y++) for (let c = 15; c <= 17; c++) g[f - y][c] = "#";
    g[f - 6][16] = "X";
    g[f - 1][1] = "S";
    return g;
  }
};

function impossible(kind, opts) {
  opts = opts || {};
  const rows = opts.rows || 17, cols = opts.cols || 28;
  const g = IMPOSSIBLE[kind](rows, cols);
  return { name: "Непроходимый: " + kind, map: toMap(g) };
}

// Набор для сверки: первые n проходимых по солверу (с планом и достижимыми
// монетами) среди сидов from…, и все непроходимые конструкции.
function suite(n, from, phys) {
  const solvable = [];
  for (let seed = from || 1; solvable.length < n && seed < (from || 1) + 400; seed++) {
    const lv = generate(seed);
    const v = L.validateLevel(lv.map, phys);
    if (v.errors.length) continue;
    solvable.push({ seed, level: lv, plan: v.solved.plan });
  }
  const unsolvable = Object.keys(IMPOSSIBLE).map((kind) => ({ kind, level: impossible(kind) }));
  return { solvable, unsolvable };
}

module.exports = { generate, impossible, suite, kinds: Object.keys(IMPOSSIBLE) };
