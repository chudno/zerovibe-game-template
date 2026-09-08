// Точка входа: по config.archetype выбирается кит и запускается оболочка.
(function (global) {
  "use strict";
  var config = global.ZV_GAME || {};
  var kits = global.ZV_KITS || {};
  var kit = kits[config.archetype];
  if (!kit) {
    // Сюда попадаем только при опечатке в config.archetype.
    document.getElementById("game").textContent =
      "Неизвестный архетип: " + config.archetype;
    return;
  }
  global.ZV.boot(kit);
})(window);
