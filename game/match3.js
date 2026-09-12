// «Три в ряд» числами, без Phaser: поле — плоский массив видов (1..kinds),
// вся правда о партии живёт здесь, а кит только рисует и принимает тапы. Так
// же, как солвер проходимости у платформера: игра, в которой нет ни одного
// хода или где раздача начинается с готовой тройки, сломана, и ловится это
// тестом, а не жалобой. Всё детерминировано по rng (ZV.random): один сид —
// одна партия, иначе баг из ?seed= не воспроизвести.
// Модуль чистый — гоняется node --test и зовётся валидатором content.js.
(function (root) {
  "use strict";

  var LIMITS = {
    minCols: 4, maxCols: 8,
    minRows: 4, maxRows: 9,
    minKinds: 3, maxKinds: 7,
    minLine: 3            // длина линии, которая считается совпадением
  };

  // Потолок попыток перетряхнуть раздачу до поля «без троек и с ходом»: на
  // 5 видах хватает единиц, но вырожденные настройки (kinds 3, поле 4×4) могут
  // упираться. После потолка поле чинится точечно — свап из moves-поиска.
  var DEAL_TRIES = 200;
  // Потолок шагов каскада: цикл «убрать → уронить → досыпать» сходится сам,
  // но испорченный rng (всегда один вид) крутил бы его вечно.
  var MAX_CASCADES = 50;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(num(v, lo)))); }

  // Поле: { cols, rows, cells: [вид…] }, индекс = r * cols + c. Ноль значит
  // «пусто» и живёт только внутри resolve — снаружи поле всегда полное.
  function make(cols, rows, cells) {
    return { cols: cols, rows: rows, cells: cells };
  }
  function idx(b, c, r) { return r * b.cols + c; }
  function at(b, c, r) {
    if (c < 0 || r < 0 || c >= b.cols || r >= b.rows) return 0;
    return b.cells[idx(b, c, r)];
  }
  function clone(b) { return make(b.cols, b.rows, b.cells.slice()); }
  // Координаты клетки по индексу — киту, чтобы не пересчитывать деление.
  function cell(b, i) { return { i: i, c: i % b.cols, r: Math.floor(i / b.cols) }; }

  function pickKind(kinds, rng) {
    // between(1, kinds) — целое включительно; rng обязателен, свой Math.random
    // сделал бы партию неповторяемой.
    return rng.between(1, kinds);
  }

  // --- совпадения -------------------------------------------------------------
  // Все линии длиной ≥ minLine по горизонтали и вертикали. Пересечения
  // (крест, угол) попадают в cleared один раз: клетки складываются в множество,
  // а lines несут сами линии — по ним считается бонус за длину.
  // Возвращает { cleared: [индекс…] по возрастанию, lines: [{ kind, cells }] }.
  function matches(b) {
    var lines = [], seen = {}, cleared = [], c, r, i;
    // Горизонтали.
    for (r = 0; r < b.rows; r++) {
      c = 0;
      while (c < b.cols) {
        var k = at(b, c, r);
        var e = c;
        while (k > 0 && e + 1 < b.cols && at(b, e + 1, r) === k) e++;
        if (k > 0 && e - c + 1 >= LIMITS.minLine) {
          var run = [];
          for (i = c; i <= e; i++) run.push(idx(b, i, r));
          lines.push({ kind: k, cells: run, dir: "h" });
        }
        c = e + 1;
      }
    }
    // Вертикали.
    for (c = 0; c < b.cols; c++) {
      r = 0;
      while (r < b.rows) {
        var k2 = at(b, c, r);
        var e2 = r;
        while (k2 > 0 && e2 + 1 < b.rows && at(b, c, e2 + 1) === k2) e2++;
        if (k2 > 0 && e2 - r + 1 >= LIMITS.minLine) {
          var run2 = [];
          for (i = r; i <= e2; i++) run2.push(idx(b, c, i));
          lines.push({ kind: k2, cells: run2, dir: "v" });
        }
        r = e2 + 1;
      }
    }
    for (i = 0; i < lines.length; i++) {
      for (var j = 0; j < lines[i].cells.length; j++) {
        var n = lines[i].cells[j];
        if (!seen[n]) { seen[n] = true; cleared.push(n); }
      }
    }
    cleared.sort(function (x, y) { return x - y; });
    return { cleared: cleared, lines: lines };
  }

  // Обмен двух клеток НА МЕСТЕ (кит зовёт его на копии, когда проверяет ход).
  function swap(b, a, c) {
    var t = b.cells[a];
    b.cells[a] = b.cells[c];
    b.cells[c] = t;
    return b;
  }

  function adjacent(b, a, c) {
    var A = cell(b, a), C = cell(b, c);
    return Math.abs(A.c - C.c) + Math.abs(A.r - C.r) === 1;
  }

  // --- ходы -------------------------------------------------------------------
  // Все пары соседних клеток, обмен которых даёт совпадение. Пара нормализована
  // (a < b) и встречается один раз: иначе бот-эксперт считал бы один ход дважды.
  function moves(b) {
    var out = [], c, r;
    for (r = 0; r < b.rows; r++) {
      for (c = 0; c < b.cols; c++) {
        var a = idx(b, c, r);
        // Только вправо и вниз: пары «влево/вверх» — те же самые.
        if (c + 1 < b.cols) tryPair(b, a, idx(b, c + 1, r), out);
        if (r + 1 < b.rows) tryPair(b, a, idx(b, c, r + 1), out);
      }
    }
    return out;
  }

  function tryPair(b, a, c, out) {
    if (b.cells[a] === b.cells[c]) return;      // обмен одинаковых ничего не меняет
    swap(b, a, c);
    var m = matches(b);
    swap(b, a, c);
    if (m.cleared.length) out.push({ a: a, b: c, cleared: m.cleared.length });
  }

  // Ход с наибольшим немедленным сбором — для бота-эксперта и для подсказки.
  // При равном сборе побеждает меньший индекс: выбор устойчив, прогон
  // повторяется.
  function best(b) {
    var list = moves(b), top = null;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!top || m.cleared > top.cleared || (m.cleared === top.cleared && m.a < top.a)) top = m;
    }
    return top;
  }

  // --- раздача ----------------------------------------------------------------
  // Поле без готовых троек и хотя бы с одним ходом. Детерминировано по rng.
  // Заполняем клетка за клеткой, запрещая вид, который сразу замкнёт тройку с
  // уже поставленными соседями слева и сверху: так поле «без совпадений»
  // получается с первой попытки, а не отбраковкой целиком.
  function deal(cols, rows, kinds, rng) {
    cols = clamp(cols, LIMITS.minCols, LIMITS.maxCols);
    rows = clamp(rows, LIMITS.minRows, LIMITS.maxRows);
    kinds = clamp(kinds, LIMITS.minKinds, LIMITS.maxKinds);
    var b;
    for (var t = 0; t < DEAL_TRIES; t++) {
      b = fill(cols, rows, kinds, rng);
      if (moves(b).length) return b;
    }
    // Ходов так и не нашлось (вырожденные kinds/размер): чиним точечно —
    // ставим заведомо рабочую пару в левом верхнем углу и снова проверяем.
    return seedMove(b, kinds, rng);
  }

  function fill(cols, rows, kinds, rng) {
    var b = make(cols, rows, new Array(cols * rows).fill(0));
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        b.cells[idx(b, c, r)] = safeKind(b, c, r, kinds, rng);
      }
    }
    return b;
  }

  // Вид, не замыкающий тройку влево и вверх. Ставим случайный и сдвигаем по
  // кругу, пока не станет безопасным: перебор по кругу от случайного старта
  // оставляет распределение ровным и всегда заканчивается (запрещено не больше
  // двух видов из kinds ≥ 3).
  function safeKind(b, c, r, kinds, rng) {
    var start = pickKind(kinds, rng);
    for (var n = 0; n < kinds; n++) {
      var k = (start - 1 + n) % kinds + 1;
      if (at(b, c - 1, r) === k && at(b, c - 2, r) === k) continue;
      if (at(b, c, r - 1) === k && at(b, c, r - 2) === k) continue;
      return k;
    }
    return start;
  }

  // Аварийная починка раздачи: в углу ставится «две рядом и одна через клетку»,
  // то есть ход существует заведомо. Тройки при этом не возникает — проверяем.
  function seedMove(b, kinds, rng) {
    if (!b || b.cols < 3 || b.rows < 2) return b;
    var k = pickKind(kinds, rng);
    var other = k % kinds + 1;
    b.cells[idx(b, 0, 0)] = k;
    b.cells[idx(b, 1, 0)] = k;
    b.cells[idx(b, 2, 0)] = other;
    b.cells[idx(b, 2, 1)] = k;
    // Обмен (2,0)↔(2,1) даст тройку в верхней строке; на всякий случай
    // добиваем поле до состояния «без готовых совпадений».
    for (var g = 0; g < b.cells.length && matches(b).cleared.length; g++) {
      var m = matches(b);
      var i = m.cleared[m.cleared.length - 1];
      var p = cell(b, i);
      if (p.r === 0 && p.c <= 2) break;        // угол трогать нельзя — он держит ход
      b.cells[i] = safeKind(b, p.c, p.r, kinds, rng);
    }
    return b;
  }

  // --- очки -------------------------------------------------------------------
  // За каждую фишку base, за каждую сверх трёх в линии — lineBonus, и всё это
  // множится на каскад: 1 + cascadeIndex·cascadeStep. Каскад — единственное
  // место, где игрок получает кратно больше, поэтому множитель и вынесен в
  // параметры кита.
  function score(cleared, cascadeIndex, params) {
    params = isObj(params) ? params : {};
    var base = num(params.base, 10);
    var step = num(params.cascadeStep, 1);
    var bonus = num(params.lineBonus, 20);
    var n = Array.isArray(cleared) ? cleared.length : Math.max(0, Math.round(num(cleared, 0)));
    var extra = Math.max(0, n - LIMITS.minLine);
    var mult = 1 + Math.max(0, cascadeIndex) * step;
    return Math.round((n * base + extra * bonus) * mult);
  }

  // --- разбор хода ------------------------------------------------------------
  // Цикл «убрать совпадения → гравитация вниз → досыпать сверху из rng →
  // повторить». Поле правится НА МЕСТЕ (кит анимирует по шагам и держит ту же
  // модель). Возвращает { steps: [{ cleared, fell, filled, lines, gain }],
  // score, cascades }. После вызова поле полное и без совпадений — это и есть
  // главный инвариант, который проверяют тесты и бот в e2e.
  function resolve(b, rng, params) {
    var steps = [], total = 0, kinds = kindsOf(params, b);
    for (var n = 0; n < MAX_CASCADES; n++) {
      var m = matches(b);
      if (!m.cleared.length) break;
      var i;
      for (i = 0; i < m.cleared.length; i++) b.cells[m.cleared[i]] = 0;
      var moved = gravity(b);
      var filled = refill(b, kinds, rng);
      var gain = score(m.cleared, n, params);
      total += gain;
      steps.push({ cleared: m.cleared, lines: m.lines, fell: moved, filled: filled, gain: gain, cascade: n });
    }
    return { steps: steps, score: total, cascades: steps.length };
  }

  function kindsOf(params, b) {
    var k = isObj(params) ? clamp(params.kinds, LIMITS.minKinds, LIMITS.maxKinds) : 0;
    if (k >= LIMITS.minKinds) return k;
    // Параметра нет — берём из самого поля: максимум встречающегося вида.
    var max = LIMITS.minKinds;
    for (var i = 0; i < b.cells.length; i++) if (b.cells[i] > max) max = b.cells[i];
    return max;
  }

  // Гравитация: всё, что выше пустой клетки, съезжает вниз. Возвращает список
  // перемещений [{ from, to, kind }] — по ним кит двигает спрайты целыми
  // пикселями, а не пересоздаёт поле.
  function gravity(b) {
    var moved = [];
    for (var c = 0; c < b.cols; c++) {
      var write = b.rows - 1;
      for (var r = b.rows - 1; r >= 0; r--) {
        var k = at(b, c, r);
        if (!k) continue;
        if (write !== r) {
          b.cells[idx(b, c, write)] = k;
          b.cells[idx(b, c, r)] = 0;
          moved.push({ from: idx(b, c, r), to: idx(b, c, write), kind: k });
        }
        write--;
      }
    }
    return moved;
  }

  // Досыпка сверху: пустые клетки сверху вниз получают новый вид из rng.
  // Возвращает [{ i, kind, from }] — from это «сколько клеток сверху упало»,
  // кит по нему заводит фишку выше поля.
  function refill(b, kinds, rng) {
    var out = [];
    for (var c = 0; c < b.cols; c++) {
      var above = 0;
      for (var r = b.rows - 1; r >= 0; r--) {
        var i = idx(b, c, r);
        if (b.cells[i]) continue;
        above++;
        b.cells[i] = pickKind(kinds, rng);
        out.push({ i: i, kind: b.cells[i], above: above });
      }
    }
    return out;
  }

  // --- перемешивание ----------------------------------------------------------
  // Ходов нет — тасуем ТЕ ЖЕ фишки: мультимножество видов обязано сохраниться,
  // иначе перемешивание тихо меняет сложность партии. Тасуем, пока не выйдет
  // поле без готовых совпадений и хотя бы с одним ходом; не вышло за потолок —
  // добираем детерминированной перестановкой соседей.
  function reshuffle(b, rng) {
    var kinds = 0, i;
    for (i = 0; i < b.cells.length; i++) if (b.cells[i] > kinds) kinds = b.cells[i];
    for (var t = 0; t < DEAL_TRIES; t++) {
      var list = b.cells.slice();
      rng.shuffle(list);
      var next = make(b.cols, b.rows, list);
      if (matches(next).cleared.length) continue;
      if (!moves(next).length) continue;
      b.cells = list;
      return b;
    }
    // Потолок: ставим фишки по видам «полосами» и разбиваем готовые тройки
    // обменом соседей — состав тот же, а поле рабочее гарантированно редко,
    // но детерминированно.
    b.cells = b.cells.slice().sort(function (x, y) { return x - y; });
    for (i = 0; i + 1 < b.cells.length; i += 2) {
      if (matches(b).cleared.length) swap(b, i, i + 1);
    }
    return b;
  }

  // Мультимножество видов поля — тестам и киту (сверка «перемешали, не подменив»).
  function counts(b) {
    var out = {};
    for (var i = 0; i < b.cells.length; i++) out[b.cells[i]] = (out[b.cells[i]] || 0) + 1;
    return out;
  }

  // --- прогон партии ----------------------------------------------------------
  // Солвер достижимости: играет moves ходов и возвращает счёт.
  //   "best"   — каждый ход лучший из возможных (потолок игры);
  //   "first"  — первый ход из moves() (игрок, который видит любую тройку);
  //   "random" — случайный соседний обмен, как тычет новичок: неудачный обмен
  //              тоже тратит ход (wrongCostsMove у кита), поэтому из 20 тычков
  //              совпадением кончаются единицы. Это и есть нижняя планка, с
  //              которой валидатор сравнивает «не слишком ли легко».
  // Тем же прогоном валидатор отвечает на два вопроса: набирается ли
  // targetScore за moves ходов и не набирается ли он сам собой. Играет ровно ту
  // же модель, что кит, — иначе обещание расходится с игрой.
  // params: { cols, rows, kinds, moves, targetScore, base, cascadeStep, lineBonus }.
  function play(params, rng, mode) {
    params = isObj(params) ? params : {};
    var turns = Math.max(1, Math.round(num(params.moves, 20)));
    var target = num(params.targetScore, 0);
    var b = deal(params.cols, params.rows, params.kinds, rng);
    var total = 0, shuffles = 0, cascades = 0, turn = 0, hits = 0;
    for (; turn < turns; turn++) {
      var mv = pickMove(b, mode, rng);
      if (!mv) {
        // Ходов нет вовсе — перемешиваем; у "random" пустой ход это промах,
        // а не тупик, и перемешивать не надо.
        if (mode !== "random" || !moves(b).length) {
          reshuffle(b, rng);
          shuffles++;
          mv = pickMove(b, mode, rng);
        }
        if (!mv) continue;                    // промах новичка: ход потрачен впустую
      }
      hits++;
      swap(b, mv.a, mv.b);
      var res = resolve(b, rng, params);
      total += res.score;
      if (res.cascades > cascades) cascades = res.cascades;
    }
    return {
      score: total, moves: turn, hits: hits, shuffles: shuffles, maxCascade: cascades,
      reached: target > 0 ? total >= target : true
    };
  }

  function pickMove(b, mode, rng) {
    if (mode === "first") return moves(b)[0] || null;
    if (mode !== "random") return best(b);
    // Случайная пара соседей; совпадения может и не быть — тогда null.
    var c = rng.between(0, b.cols - 1), r = rng.between(0, b.rows - 1);
    var right = rng.chance(0.5);
    var a = idx(b, c, r);
    if (right ? c + 1 >= b.cols : r + 1 >= b.rows) return null;
    var d = right ? idx(b, c + 1, r) : idx(b, c, r + 1);
    if (b.cells[a] === b.cells[d]) return null;
    swap(b, a, d);
    var ok = matches(b).cleared.length > 0;
    swap(b, a, d);
    return ok ? { a: a, b: d, cleared: 0 } : null;
  }

  var api = {
    LIMITS: LIMITS, MAX_CASCADES: MAX_CASCADES,
    play: play,
    make: make, clone: clone, idx: idx, at: at, cell: cell, adjacent: adjacent,
    deal: deal, matches: matches, moves: moves, best: best, swap: swap,
    resolve: resolve, reshuffle: reshuffle, score: score, counts: counts
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_MATCH3 = api;
})(typeof window !== "undefined" ? window : null);
