// Последовательность шагов по времени без физики и без Phaser: «показать
// карточку → подождать → перевернуть обратно → разблокировать ввод». Время
// МОДЕЛЬНОЕ: ленту двигает только update(delta), настенные часы внутри запрещены —
// иначе прогон с сидом перестаёт повторяться, а node --test не может её
// прокрутить. Просроченные шаги (телефон ушёл в фон и вернулся с delta 5000)
// выполняются ВСЕ по одному разу в порядке времени: анимация догоняется, а
// состояние игры остаётся согласованным. Исключение в шаге не блокирует ввод
// навсегда: шаг помечается выполненным, ошибка идёт в tl.errors и в
// console.error (e2e видит console error). Модуль чистый — гоняется node.
(function (root) {
  "use strict";

  // Потолок шагов за один update и за один flush: шаг, добавленный из шага с
  // нулевой задержкой, иначе крутится вечно и вешает кадр.
  var MAX_STEPS_PER_UPDATE = 1000;

  // console берётся глобально: в браузере это console страницы (её ошибки
  // видит e2e), в node --test — консоль процесса.
  function report(msg) {
    if (typeof console !== "undefined" && console.error) console.error(msg);
  }

  function create() {
    var steps = [];      // { at, fn, id }
    var time = 0;        // модельное время ленты, мс
    var cursor = 0;      // конец последнего добавленного шага — для wait/then
    var seq = 0;

    function push(at, fn) {
      if (typeof fn !== "function") return tl;
      steps.push({ at: at, fn: fn, id: seq++ });
      return tl;
    }

    var tl = {
      errors: [],

      // Выполнить fn через ms модельных мс от ТЕКУЩЕГО момента ленты.
      add: function (ms, fn) {
        var at = time + Math.max(0, Number(ms) || 0);
        if (at > cursor) cursor = at;
        return push(at, fn);
      },
      // Пауза: сдвигает курсор, к которому крепится then().
      wait: function (ms) {
        cursor = Math.max(cursor, time) + Math.max(0, Number(ms) || 0);
        return tl;
      },
      // Сразу после предыдущего шага (или после wait).
      then: function (fn) {
        return push(Math.max(cursor, time), fn);
      },
      // times раз с шагом ms: fn(i). Курсор уходит на последний повтор.
      repeat: function (times, ms, fn) {
        times = Math.max(0, Math.round(Number(times) || 0));
        ms = Math.max(0, Number(ms) || 0);
        var base = Math.max(cursor, time);
        for (var i = 0; i < times; i++) {
          (function (idx) { push(base + ms * (idx + 1), function () { fn(idx); }); })(i);
        }
        if (times > 0) cursor = base + ms * times;
        return tl;
      },

      // Двигает ленту на delta мс и выполняет всё созревшее в порядке времени.
      // true — на этом кадре что-то сработало.
      update: function (delta) {
        time += Math.max(0, Number(delta) || 0);
        // Лента, набранная ДО кадра, — честная работа (догон из фона), а не цикл;
        // самодобавлением считается только то, что сверх неё.
        var queued = steps.length;
        var fired = false, guard = 0;
        for (;;) {
          var next = null, ni = -1;
          for (var i = 0; i < steps.length; i++) {
            var s = steps[i];
            if (s.at > time) continue;
            if (!next || s.at < next.at || (s.at === next.at && s.id < next.id)) { next = s; ni = i; }
          }
          if (!next) break;
          steps.splice(ni, 1);
          fired = true;
          run(next);
          if (++guard >= MAX_STEPS_PER_UPDATE) {
            if (guard > queued) {
              tl.errors.push("таймлайн: больше " + MAX_STEPS_PER_UPDATE + " шагов за кадр — шаг добавляет сам себя без задержки");
              report(tl.errors[tl.errors.length - 1]);
            }
            // Честное переполнение остаётся молча: остаток догонится следующим кадром.
            break;
          }
        }
        return fired;
      },

      // Отменить всё незапущенное. Обязателен в shutdown: сцена
      // переиспользуется на «Ещё раз», хвост прошлой партии выстрелит в новой.
      clear: function () {
        steps.length = 0;
        cursor = time;
        return tl;
      },
      busy: function () { return steps.length > 0; },
      pending: function () { return steps.length; },
      // Выполнить всё немедленно (тесты, typeMs: 0). Порядок сохраняется.
      flush: function () {
        var guard = 0;
        while (steps.length && guard++ < MAX_STEPS_PER_UPDATE) {
          var next = steps[0];
          for (var i = 1; i < steps.length; i++) {
            if (steps[i].at < next.at || (steps[i].at === next.at && steps[i].id < next.id)) next = steps[i];
          }
          if (next.at > time) time = next.at;
          steps.splice(steps.indexOf(next), 1);
          run(next);
        }
        cursor = time;
        // Иначе кит получил бы наполовину прокрученную ленту без единого признака.
        if (steps.length) {
          var msg = "таймлайн: лента длиннее потолка " + MAX_STEPS_PER_UPDATE + " — flush не доделал " + steps.length + " шагов";
          tl.errors.push(msg);
          report(msg);
        }
        return tl;
      },
      time: function () { return time; }
    };

    function run(step) {
      try {
        step.fn();
      } catch (e) {
        var msg = "таймлайн: шаг бросил исключение — " + (e && e.message ? e.message : e);
        tl.errors.push(msg);
        report(msg);
      }
    }

    return tl;
  }

  var api = { create: create, MAX_STEPS_PER_UPDATE: MAX_STEPS_PER_UPDATE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_TIMELINE = api;
})(typeof window !== "undefined" ? window : null);
