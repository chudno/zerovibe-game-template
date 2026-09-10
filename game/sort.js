// Темп «собери заказ» числами, без Phaser: сколько миллисекунд человек видит
// предмет до линии сброса и сколько успевает подумать между предметами.
// Тот же класс проверки, что солвер проходимости у платформера: игра, в
// которую нельзя успеть, — не сложная, а сломанная, и ловится тестом до
// первой жалобы. Считается на ВСЁМ диапазоне скоростей beltSpeed..beltMax:
// партия разгоняется, и честной обязана быть последняя секунда, а не первая.
// Модуль чистый — гоняется node --test и зовётся валидатором content.js.
(function (root) {
  "use strict";

  var POOL = (typeof module !== "undefined" && module.exports) ? require("./pool.js") : root.ZV_POOL;

  // Геометрия ленты в px канвы 360×640 — те же числа, что рисует кит.
  // Предмет ЕДЕТ через всю ленту, но решать про него поздно с того момента,
  // как он миновал линию сброса, и рано, пока «текущим» считается предыдущий.
  // Честное окно — та полоса перед линией, где предмет уже единственный
  // текущий: его собственная ширина плюс подход. Меряем именно её, а не всю
  // ленту: «видно 3 секунды» ничего не говорит о том, успевает ли человек.
  var GEO = {
    itemW: 40,      // сторона предмета
    spawnX: -40,    // где предмет въезжает на ленту
    dropX: 300,     // линия сброса: правее неё предмет считается уехавшим
    zoneW: 68       // полоса решения перед линией сброса: предмет 40 + подход 28
  };

  // Пороги честности. reactionMs — время «увидел и решил» (реакция ~250 мс
  // плюс попадание пальцем); gapRatio — во сколько раз пауза между предметами
  // должна быть длиннее проезда предмета через линию сброса, иначе решение
  // принимается уже про следующий предмет.
  var LIMITS = { reactionMs: 350, gapRatio: 1.2 };

  function num(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? n : dflt;
  }

  // Шаг по скоростям: концы диапазона плюс середина — большего не нужно,
  // обе метрики монотонно убывают со скоростью, но концы читаются в тексте
  // ошибки, а середина ловит опечатку вида beltMax < beltSpeed.
  function speeds(from, to) {
    var out = [from];
    if (to > from) {
      var mid = Math.round((from + to) / 2);
      if (mid > from && mid < to) out.push(mid);
      out.push(to);
    }
    return out;
  }

  // window(params) -> { ok, reason, limits, atSpeed: [{ speed, visibleMs, passMs, gapMs }] }
  // Числа в reason обязательны: автор игры правит config.params по ним, а не
  // угадывает. Первая нарушенная скорость и объясняется.
  function windowOf(params) {
    params = params || {};
    var from = num(params.beltSpeed, 90);
    var to = num(params.beltMax, from);
    var spacing = num(params.spacing, 150);
    if (!(from > 0)) return fail("params.beltSpeed " + params.beltSpeed + ": скорость ленты — число больше нуля", []);
    if (to < from) return fail("params.beltMax " + to + " меньше beltSpeed " + from + ": потолок скорости ниже стартовой", []);
    if (!(spacing > 0)) return fail("params.spacing " + params.spacing + ": расстояние между предметами — число больше нуля", []);

    var list = [], i, bad = null;
    var list0 = speeds(from, to);
    for (i = 0; i < list0.length; i++) {
      var v = list0[i];
      var row = {
        speed: v,
        // Сколько предмет виден в полосе решения до линии сброса.
        visibleMs: POOL.visibleMs(v, GEO.zoneW),
        // Вся дорога по ленте — для README и отладки, порогом не служит.
        beltMs: POOL.visibleMs(v, GEO.dropX - GEO.spawnX),
        // Сколько он остаётся «текущим»: проезд собственной ширины через линию.
        passMs: POOL.visibleMs(v, GEO.itemW),
        // Пауза до следующего предмета.
        gapMs: POOL.visibleMs(v, spacing)
      };
      list.push(row);
      if (bad) continue;
      if (row.visibleMs < LIMITS.reactionMs) {
        bad = "params.beltMax " + v + ": на этой скорости предмет виден " + row.visibleMs +
          " мс — человек не успевает (нужно от " + LIMITS.reactionMs + "). Не больше " +
          Math.floor(GEO.zoneW * 1000 / LIMITS.reactionMs);
      } else if (row.gapMs < Math.round(row.passMs * LIMITS.gapRatio)) {
        bad = "params.spacing " + spacing + ": на скорости " + v + " пауза между предметами " +
          row.gapMs + " мс против проезда " + row.passMs + " мс — решение принимается уже про следующий предмет. Не меньше " +
          Math.ceil(GEO.itemW * LIMITS.gapRatio);
      }
    }
    if (bad) return fail(bad, list);
    return { ok: true, reason: "", limits: LIMITS, atSpeed: list };
  }

  function fail(reason, list) {
    return { ok: false, reason: reason, limits: LIMITS, atSpeed: list };
  }

  var api = { window: windowOf, GEO: GEO, LIMITS: LIMITS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_SORT = api;
})(typeof window !== "undefined" ? window : null);
