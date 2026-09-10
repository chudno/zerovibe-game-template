// Прогресс как УДОБСТВО, а не как условие: партия обязана проходиться при
// пустом хранилище. В сейв кладут то, потеря чего огорчает (рекорд, открытые
// стадии), а не то, без чего игра не кончается. Хранилище берётся фабрикой и
// try/catch стоит вокруг САМОГО обращения к нему: window.localStorage бросает
// как свойство в srcdoc-кадрах галереи и при выключенных куках — не только
// getItem. Версия — хэш контента и параметров: сменился content/*.json —
// старое состояние молча отбрасывается, а не ломает баланс. Модуль чистый.
(function (root) {
  "use strict";

  var LIMITS = { maxBytes: 4096 };
  var PREFIX = "zv:";
  var RANDOM = (typeof module !== "undefined" && module.exports) ? require("./random.js") : (root ? root.ZV_RANDOM : null);

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // Стабильная сериализация: ключи объектов сортируются, поэтому
  // переформатирование JSON не меняет версию и не стирает прогресс.
  function stable(value) {
    if (Array.isArray(value)) {
      var parts = [];
      for (var i = 0; i < value.length; i++) parts.push(stable(value[i]));
      return "[" + parts.join(",") + "]";
    }
    if (isObj(value)) {
      var keys = Object.keys(value).sort(), out = [];
      for (var k = 0; k < keys.length; k++) out.push(JSON.stringify(keys[k]) + ":" + stable(value[keys[k]]));
      return "{" + out.join(",") + "}";
    }
    if (typeof value === "number" && !isFinite(value)) return "null";
    if (value === undefined || typeof value === "function") return "null";
    return JSON.stringify(value);
  }

  // Своё FNV на случай, если ZV_RANDOM не подключён (порядок скриптов).
  function fnv(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function version(parts) {
    var s = stable(parts === undefined ? null : parts);
    var h = RANDOM && RANDOM.hashString ? RANDOM.hashString(s) : fnv(s);
    return "s" + (h >>> 0).toString(36);
  }

  function defaultStore() { return window.localStorage; }

  // Обращение к хранилищу целиком под try: доступ к свойству бросает сам.
  function reach(getStore) {
    try {
      var st = (getStore || defaultStore)();
      if (!st || typeof st.getItem !== "function" || typeof st.setItem !== "function") return null;
      return st;
    } catch (e) {
      return null;
    }
  }

  // Форма сверяется с defaults: чужие ключи и другой тип отбрасываются
  // (тот же принцип, что mergeParams) — битый или чужой слот не ломает кит.
  function shape(raw, defaults) {
    var out = {}, k;
    for (k in defaults) if (has(defaults, k)) out[k] = defaults[k];
    if (!isObj(raw)) return out;
    for (k in defaults) {
      if (!has(defaults, k) || !has(raw, k)) continue;
      if (typeof raw[k] !== typeof defaults[k]) continue;
      if (typeof raw[k] === "number" && !isFinite(raw[k])) continue;
      out[k] = raw[k];
    }
    return out;
  }

  function keyOf(name, ver) { return PREFIX + name + ":" + ver; }

  // Старые слоты того же кита (другая версия) чистятся при open: мусор в
  // хранилище копится от партии к партии.
  function sweep(store, name, keep) {
    try {
      var doomed = [], i, k;
      for (i = 0; i < store.length; i++) {
        k = store.key(i);
        if (typeof k === "string" && k.indexOf(PREFIX + name + ":") === 0 && k !== keep) doomed.push(k);
      }
      for (i = 0; i < doomed.length; i++) store.removeItem(doomed[i]);
    } catch (e) { /* хранилище без key/length или отказ — не беда */ }
  }

  // name — только имя кита (никогда имя проекта: ключ виден в чужом браузере).
  function open(name, ver, defaults, getStore) {
    defaults = isObj(defaults) ? defaults : {};
    var key = keyOf(String(name), String(ver));
    var store = reach(getStore);
    var mem = null;   // память на случай отказа хранилища: партия идёт как ни в чём

    var slot = {
      key: key,
      ok: !!store,
      get: function () {
        if (mem) return shape(mem, defaults);
        if (!store) return shape(null, defaults);
        var raw = null;
        try {
          raw = store.getItem(key);
        } catch (e) {
          slot.ok = false;
          return shape(null, defaults);
        }
        if (typeof raw !== "string" || !raw) return shape(null, defaults);
        try {
          return shape(JSON.parse(raw), defaults);
        } catch (e) {
          return shape(null, defaults);
        }
      },
      set: function (patch) {
        var next = slot.get(), k;
        if (isObj(patch)) {
          for (k in patch) {
            if (!has(patch, k) || !has(defaults, k)) continue;
            if (typeof patch[k] !== typeof defaults[k]) continue;
            if (typeof patch[k] === "number" && !isFinite(patch[k])) continue;
            next[k] = patch[k];
          }
        }
        var body = JSON.stringify(next);
        // Слишком большой слот не пишем вовсе: квота выбьет чужие ключи.
        if (body.length > LIMITS.maxBytes) { mem = next; return next; }
        if (!store) { mem = next; return next; }
        try {
          store.setItem(key, body);
          mem = null;
        } catch (e) {
          slot.ok = false;
          mem = next;
        }
        return next;
      },
      reset: function () {
        mem = null;
        if (store) {
          try { store.removeItem(key); } catch (e) { slot.ok = false; }
        }
        return shape(null, defaults);
      }
    };

    if (store) sweep(store, String(name), key);
    return slot;
  }

  // Стереть все слоты кита (для «Ещё раз» и тестов).
  function wipe(name, getStore) {
    var store = reach(getStore);
    if (!store) return false;
    sweep(store, String(name), null);
    return true;
  }

  var api = { LIMITS: LIMITS, PREFIX: PREFIX, stable: stable, version: version, open: open, wipe: wipe };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZV_SAVE = api;
})(typeof window !== "undefined" ? window : null);
