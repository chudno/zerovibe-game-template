// Экономика кликера числами, без Phaser: та же петля, что в ките (тап,
// жажда, уход, автодоход, покупки), но на модельном времени шагом 100 мс.
// Нужен затем же, зачем солвер проходимости платформеру: «цель достижима» —
// это свойство ДАННЫХ, и его обязан проверять node --test, а не ощущение
// автора. Тот же best() отдаёт план боту-эксперту в headless-прогоне:
// модель сказала «набирается за 42 с» — бот в Chromium обязан набрать.
// Модуль чистый, случайности внутри нет вовсе (петля кликера детерминирована).
(function (root) {
  "use strict";

  var STEP = 100;          // шаг модельного времени, мс
  var FULL_PERM = 6;       // до стольких апгрейдов перебираем порядок покупок целиком
  var CARE_AT = 0.4;       // уход, когда шкала нужды ниже 40 %
  var NEED_MAX = 100;      // шкала нужды в процентах

  function num(v, def) {
    var n = Number(v);
    return isFinite(n) ? n : def;
  }

  // Дефолты кита: модуль зовётся и из валидатора, где params ещё нет.
  var PARAMS = {
    duration: 75000, tapPoints: 1, tapCooldownMs: 30, autoTickMs: 1000, startScore: 0,
    decayPerSec: 6, decayDelayMs: 12000, decayRamp: 1.8, hungryFactor: 0.5,
    careCooldownMs: 4000, botTapsPerSec: 5
  };

  function withDefaults(params) {
    var p = {}, k;
    for (k in PARAMS) if (Object.prototype.hasOwnProperty.call(PARAMS, k)) {
      p[k] = params && typeof params[k] === "number" && isFinite(params[k]) ? params[k] : PARAMS[k];
    }
    return p;
  }

  // Список апгрейдов в удобной форме; порядок в данных сохраняется.
  function upgradesOf(data) {
    var list = (data && data.upgrades) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var u = list[i] || {};
      out.push({
        id: String(u.id === undefined ? i : u.id),
        cost: Math.max(1, Math.round(num(u.cost, 1))),
        perTap: Math.max(0, num(u.perTap, 0)),
        perSec: Math.max(0, num(u.perSec, 0)),
        max: Math.max(1, Math.round(num(u.max, 1))),
        needs: typeof u.needs === "string" && u.needs ? u.needs : ""
      });
    }
    return out;
  }

  // Цена уровня n (0-based): каждый следующий вдвое дороже — иначе один
  // дешёвый апгрейд с max: 99 превращает партию в один и тот же тап.
  function costOf(u, level) {
    return Math.round(u.cost * Math.pow(2, level));
  }

  // Апгрейд доступен, когда куплена хотя бы одна ступень того, что в needs.
  function unlocked(u, levels, index) {
    if (!u.needs) return true;
    var j = index[u.needs];
    return j !== undefined && levels[j] > 0;
  }

  // --- одна партия ---------------------------------------------------------
  // strategy — что бот делает на каждом шаге:
  //   { taps: true|false, care: true|false, plan: [id…] }
  // plan — очередь покупок по id (по одной ступени за элемент); покупка
  // случается, как только на неё хватает очков и она разблокирована.
  function simulate(data, params, strategy) {
    var p = withDefaults(params);
    var st = strategy || {};
    var ups = upgradesOf(data);
    var index = {};
    for (var i = 0; i < ups.length; i++) index[ups[i].id] = i;
    var levels = [];
    for (i = 0; i < ups.length; i++) levels.push(0);

    var goal = Math.max(1, Math.round(num(data && data.goal && data.goal.score, 1)));
    var stages = (data && data.stages) || [];
    var duration = p.duration > 0 ? p.duration : 600000;   // 0 — «только по цели», но потолок нужен
    var rate = st.taps === false ? 0 : Math.max(0, num(st.tapsPerSec, p.botTapsPerSec));
    // Кулдаун тапа — потолок темпа: автокликер не быстрее живого пальца.
    if (p.tapCooldownMs > 0) rate = Math.min(rate, 1000 / p.tapCooldownMs);

    var score = Math.max(0, Math.round(num(p.startScore, 0)));
    var need = NEED_MAX;         // шкала нужды, %
    var t = 0, taps = 0, careUses = 0, tapDebt = 0, autoDebt = 0, careReady = 0;
    var bought = [];
    var queue = (st.plan || []).slice();
    var stagesSeen = [];
    var reached = false;

    function perTap() {
      var v = num(p.tapPoints, 1);
      for (var k = 0; k < ups.length; k++) v += ups[k].perTap * levels[k];
      return v * (need <= 0 ? num(p.hungryFactor, 0.5) : 1);
    }
    function perSec() {
      var v = 0;
      for (var k = 0; k < ups.length; k++) v += ups[k].perSec * levels[k];
      return v;
    }
    function seeStages() {
      for (var k = 0; k < stages.length; k++) {
        var at = num(stages[k] && stages[k].at, 0);
        if (score >= at && stagesSeen.indexOf(k) < 0) stagesSeen.push(k);
      }
    }
    seeStages();

    while (t < duration) {
      // 1. Покупки: очередь плана, по ступени за раз. Голова очереди, ещё
      // закрытая по needs, пропускается — иначе план «дорогое раньше того,
      // что его открывает» встал бы навсегда. На нехватке очков копим дальше:
      // именно это и есть выбор «тратить сейчас или копить».
      for (var guard = 0; guard < queue.length + 1; guard++) {
        var take = -1;
        for (var q = 0; q < queue.length; q++) {
          var j = index[queue[q]];
          if (j === undefined || levels[j] >= ups[j].max) { queue.splice(q, 1); q -= 1; continue; }
          if (!unlocked(ups[j], levels, index)) continue;   // закрыт — смотрим следующий
          if (score >= costOf(ups[j], levels[j])) take = q;
          break;                                            // первый ОТКРЫТЫЙ решает
        }
        if (take < 0) break;
        var ji = index[queue[take]];
        score -= costOf(ups[ji], levels[ji]);
        levels[ji] += 1;
        bought.push(ups[ji].id);
        queue.splice(take, 1);
      }

      // 2. Уход: тратит тап и имеет кулдаун — за палец спорят очки и нужда.
      if (st.care !== false && need < NEED_MAX * CARE_AT && t >= careReady) {
        need = NEED_MAX;
        careReady = t + Math.max(0, num(p.careCooldownMs, 0));
        careUses += 1;
        tapDebt = Math.max(0, tapDebt - 1);   // ход ушёл на лейку, а не на героя
      }

      // 3. Тапы за шаг: дробный остаток копится, темп ровный.
      tapDebt += rate * (STEP / 1000);
      var n = Math.floor(tapDebt);
      if (n > 0) {
        tapDebt -= n;
        score += perTap() * n;
        taps += n;
      }

      // 4. Автодоход: начисляется тиками autoTickMs, как в ките.
      autoDebt += STEP;
      var tick = Math.max(1, num(p.autoTickMs, 1000));
      while (autoDebt >= tick) {
        autoDebt -= tick;
        score += perSec() * (tick / 1000);
      }

      // 5. Жажда: падает после decayDelayMs, к концу партии — быстрее в decayRamp раз.
      t += STEP;
      if (t > num(p.decayDelayMs, 0)) {
        var ramp = 1 + (num(p.decayRamp, 1) - 1) * Math.min(1, t / duration);
        need = Math.max(0, need - num(p.decayPerSec, 0) * ramp * (STEP / 1000));
      }

      seeStages();
      if (score >= goal) { reached = true; break; }
    }

    return {
      score: Math.floor(score), seconds: Math.round(t / 1000), taps: taps, careUses: careUses,
      bought: bought, reached: reached, stagesSeen: stagesSeen,
      stage: stagesSeen.length ? stagesSeen[stagesSeen.length - 1] : 0
    };
  }

  // --- лучший план ---------------------------------------------------------
  // Порядок покупок решает: сначала дешёвый perTap, потом дорогой perSec —
  // и наоборот. При ≤6 апгрейдах перебираем все перестановки (720 партий по
  // 750 шагов — миллисекунды), дальше жадно по окупаемости.
  function best(data, params) {
    var p = withDefaults(params);
    var ups = upgradesOf(data);
    var plans = ups.length <= FULL_PERM ? allPlans(ups) : [greedyPlan(ups, p)];
    var winner = null, fallback = null;
    for (var i = 0; i < plans.length; i++) {
      var r = simulate(data, p, { taps: true, care: true, plan: plans[i] });
      r.plan = plans[i];
      if (r.reached) {
        // Из достигших цели берём самый быстрый.
        if (!winner || r.seconds < winner.seconds) winner = r;
      } else if (!fallback || r.score > fallback.score) fallback = r;
    }
    var out = winner || fallback || simulate(data, p, { taps: true, care: true, plan: [] });
    return {
      reachable: !!out.reached,
      seconds: out.seconds,
      score: out.score,
      // План для бота: когда покупать — по факту накопления, поэтому просто
      // очередь id. Бот покупает первую доступную позицию очереди.
      plan: (out.plan || []).slice()
    };
  }

  // Все очереди покупок: каждый апгрейд берётся до max, порядок ступеней
  // внутри апгрейда фиксирован (дешёвая раньше дорогой — иначе смысла нет).
  function allPlans(ups) {
    var ids = [];
    for (var i = 0; i < ups.length; i++) ids.push(ups[i].id);
    var out = [];
    permute(ids, [], out);
    // Каждую перестановку разворачиваем в ступени: id повторяется max раз.
    var full = [];
    for (var k = 0; k < out.length; k++) {
      var seq = [];
      for (var j = 0; j < out[k].length; j++) {
        var u = ups[indexOfId(ups, out[k][j])];
        for (var s = 0; s < u.max; s++) seq.push(u.id);
      }
      full.push(seq);
    }
    full.push([]);   // «ничего не покупать» — иногда цель ближе без трат
    return full;
  }

  function indexOfId(ups, id) {
    for (var i = 0; i < ups.length; i++) if (ups[i].id === id) return i;
    return -1;
  }

  function permute(rest, acc, out) {
    if (!rest.length) { out.push(acc.slice()); return; }
    for (var i = 0; i < rest.length; i++) {
      var next = rest.slice();
      var one = next.splice(i, 1)[0];
      acc.push(one);
      permute(next, acc, out);
      acc.pop();
    }
  }

  // Жадный порядок: сперва то, что быстрее окупается на нашем темпе тапа.
  function greedyPlan(ups, p) {
    var rate = p.botTapsPerSec;
    var order = ups.slice().sort(function (a, b) {
      var ga = a.perTap * rate + a.perSec, gb = b.perTap * rate + b.perSec;
      return (a.cost / (ga || 0.001)) - (b.cost / (gb || 0.001));
    });
    var seq = [];
    for (var i = 0; i < order.length; i++) {
      for (var s = 0; s < order[i].max; s++) seq.push(order[i].id);
    }
    return seq;
  }

  // Проверка честности обратного знака: новичок тапает вчетверо реже, ничего
  // не покупает и нужду не гасит. Дошёл до цели — игра проходится сама.
  function novice(data, params) {
    var p = withDefaults(params);
    return simulate(data, p, { taps: true, care: false, plan: [], tapsPerSec: p.botTapsPerSec / 4 });
  }

  var api = {
    STEP: STEP, PARAMS: PARAMS, CARE_AT: CARE_AT, NEED_MAX: NEED_MAX,
    simulate: simulate, best: best, novice: novice,
    upgradesOf: upgradesOf, costOf: costOf, unlocked: unlocked, withDefaults: withDefaults
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_CLICKER = api;
})(typeof window !== "undefined" ? window : null);
