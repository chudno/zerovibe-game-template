// Экономика кликера: детерминизм, монотонность, достижимость цели на боевом
// content/clicker.json и НЕдостижимость новичком. Это тот же класс проверки,
// что солвер проходимости платформера: «цель достижима» обязано быть
// свойством данных, а не ощущением автора.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("./clicker.js");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "clicker.json"), "utf8"));
const expert = (d, p) => C.simulate(d || data, p || {}, { taps: true, care: true, plan: C.best(d || data, p || {}).plan });

test("детерминизм: одни данные и один план — партия байт-в-байт та же", () => {
  const a = expert();
  const b = expert();
  assert.deepEqual(a, b);
  // И сам план воспроизводим: перебор перестановок устойчив по порядку.
  assert.deepEqual(C.best(data, {}), C.best(data, {}));
});

test("боевой content/clicker.json: цель достижима при лучшей игре и с запасом по времени", () => {
  const b = C.best(data, {});
  assert.ok(b.reachable, `цель недостижима: ${JSON.stringify(b)}`);
  // Запас на кадры браузера: e2e даёт боту потолок best.seconds·1.35, и это
  // не должно упираться в duration.
  assert.ok(b.seconds * 1.35 < C.PARAMS.duration / 1000,
    `цель берётся только под самый конец (${b.seconds} с из ${C.PARAMS.duration / 1000}) — у бота не будет запаса`);
  assert.ok(b.plan.length > 0, "лучший план без единой покупки — апгрейды в игре лишние");
});

test("новичок (темп botTapsPerSec/4, без покупок и ухода) до цели не доходит", () => {
  const n = C.novice(data, {});
  assert.equal(n.reached, false, `игра проходится сама: ${JSON.stringify(n)}`);
  assert.ok(n.score < data.goal.score / 2, `новичок набрал ${n.score} из ${data.goal.score} — цель слишком близко`);
});

test("апгрейды и уход реально нужны: без покупок эксперт цели не берёт", () => {
  const bare = C.simulate(data, {}, { taps: true, care: true, plan: [] });
  assert.equal(bare.reached, false, "цель набирается одними тапами — покупать незачем");
});

test("монотонность: чем длиннее партия и чем выше темп, тем больше счёт", () => {
  const short = C.simulate(data, { duration: 30000 }, { taps: true, care: true, plan: [] });
  const long = C.simulate(data, { duration: 60000 }, { taps: true, care: true, plan: [] });
  assert.ok(long.score > short.score, `${long.score} должно быть больше ${short.score}`);
  const slow = C.simulate(data, {}, { taps: true, care: true, plan: [], tapsPerSec: 2 });
  const fast = C.simulate(data, {}, { taps: true, care: true, plan: [], tapsPerSec: 8 });
  assert.ok(fast.score > slow.score, `${fast.score} должно быть больше ${slow.score}`);
});

test("жажда: без ухода счёт ниже, а первые decayDelayMs наказания нет вовсе", () => {
  const withCare = C.simulate(data, {}, { taps: true, care: true, plan: [] });
  const noCare = C.simulate(data, {}, { taps: true, care: false, plan: [] });
  assert.ok(withCare.score > noCare.score, "уход обязан что-то давать");
  assert.ok(withCare.careUses > 0, "эксперт ни разу не полил — шкала не падает?");
  // До decayDelayMs множитель полный: два прогона с разной жаждой совпадают.
  const a = C.simulate(data, { duration: 10000 }, { taps: true, care: true, plan: [] });
  const b = C.simulate(data, { duration: 10000, decayPerSec: 60 }, { taps: true, care: true, plan: [] });
  assert.equal(a.score, b.score, "в первые 10 секунд жажда не должна ни на что влиять");
});

test("кулдаун тапа — потолок темпа: автокликер не быстрее живого пальца", () => {
  const human = C.simulate(data, {}, { taps: true, care: true, plan: [], tapsPerSec: 5 });
  const cheat = C.simulate(data, {}, { taps: true, care: true, plan: [], tapsPerSec: 500 });
  // 30 мс кулдауна = не больше 33 тапов в секунду, а не 500.
  assert.ok(cheat.taps <= 34 * (C.PARAMS.duration / 1000), `тапов ${cheat.taps} — кулдаун не работает`);
  assert.ok(cheat.taps > human.taps);
});

test("needs: закрытый апгрейд не покупается, пока не куплен тот, что его открывает", () => {
  const d = {
    goal: { score: 10000, title: "Ц" },
    stages: [{ at: 0, title: "А" }],
    upgrades: [
      { id: "base", title: "Б", cost: 20, perTap: 1, max: 1 },
      { id: "top", title: "В", cost: 20, perTap: 5, max: 1, needs: "base" }
    ]
  };
  // План просит сперва закрытый — он обязан подождать, а не заблокировать очередь.
  const r = C.simulate(d, { duration: 20000 }, { taps: true, care: true, plan: ["top", "base"] });
  assert.deepEqual(r.bought, ["base", "top"], JSON.stringify(r));
  // Без открывающего апгрейда закрытый не покупается никогда.
  const only = C.simulate(d, { duration: 20000 }, { taps: true, care: true, plan: ["top"] });
  assert.deepEqual(only.bought, []);
});

test("ступени дорожают вдвое, счёт за покупку списывается", () => {
  const u = C.upgradesOf({ upgrades: [{ id: "a", cost: 50, perTap: 1, max: 3 }] })[0];
  assert.deepEqual([0, 1, 2].map((l) => C.costOf(u, l)), [50, 100, 200]);
  const d = { goal: { score: 99999, title: "Ц" }, stages: [{ at: 0, title: "А" }], upgrades: [{ id: "a", title: "А", cost: 50, perTap: 1, max: 2 }] };
  const r = C.simulate(d, { duration: 30000 }, { taps: true, care: true, plan: ["a", "a"] });
  assert.deepEqual(r.bought, ["a", "a"]);
});

test("партия кончается всегда: reached или ровно duration", () => {
  const r = C.simulate(data, { duration: 20000 }, { taps: true, care: true, plan: [] });
  assert.equal(r.reached, false);
  assert.equal(r.seconds, 20);
  const win = expert();
  assert.ok(win.reached && win.seconds <= C.PARAMS.duration / 1000);
});

test("стадии: пройденные видны в stagesSeen, stage — последняя", () => {
  const r = expert();
  assert.ok(r.stagesSeen.length >= 2, JSON.stringify(r));
  assert.equal(r.stage, r.stagesSeen[r.stagesSeen.length - 1]);
  assert.equal(r.stagesSeen[0], 0, "стадия 0 видна с первого шага");
});

test("больше шести апгрейдов: перебор уступает жадному плану, но партия считается", () => {
  const ups = [];
  for (let i = 0; i < 8; i++) ups.push({ id: "u" + i, title: "У" + i, cost: 30 + i * 20, perTap: 1, max: 1 });
  const d = { goal: { score: 900, title: "Ц" }, stages: [{ at: 0, title: "А" }], upgrades: ups };
  const b = C.best(d, {});
  assert.ok(typeof b.reachable === "boolean" && b.plan.length === 8, JSON.stringify(b));
});
