/* Met à l'échelle les maquettes conçues en largeur fixe pour qu'elles tiennent
 * dans la fenêtre, sans casser la mise en page interne (zoom, pas transform). */
(function () {
  function fit() {
    document.querySelectorAll('.fit').forEach(function (el) {
      var design = parseFloat(el.dataset.width || '1280');
      var avail = el.parentElement.clientWidth;
      var ratio = Math.min(1, avail / design);
      el.style.setProperty('--fit', String(Math.round(ratio * 1000) / 1000));
    });

    document.querySelectorAll('.phone').forEach(function (el) {
      var wrap = el.parentElement;
      var avail = wrap.clientWidth;
      var scale = Math.min(1, avail / 330);
      el.style.zoom = String(Math.round(scale * 1000) / 1000);
    });
  }

  window.addEventListener('resize', fit);
  window.addEventListener('DOMContentLoaded', fit);
  fit();
})();
