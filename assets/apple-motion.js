/* Mario World · Apple design layer motion + chrome behaviour.
   Purely presentational: it never touches the 3D scene, canvas sizing or data. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

  root.classList.add('js-reveal');

  /* ------------------------------------------------------------------ header */
  var header = document.getElementById('site-header');
  if (header) {
    var ticking = false;
    var sync = function () {
      header.classList.toggle('is-scrolled', (window.scrollY || window.pageYOffset || 0) > 8);
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(sync);
    }, { passive: true });
    sync();
  }

  /* ------------------------------------------------------------ reveal on scroll */
  var items = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  function show(item) {
    item.style.setProperty('--reveal-delay', '0ms');
    item.classList.add('is-visible');
  }
  if (!items.length) {
    /* nothing to reveal */
  } else if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(show);
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var group = el.parentElement
          ? Array.prototype.slice.call(el.parentElement.querySelectorAll(':scope > [data-reveal]'))
          : [el];
        var index = Math.max(0, group.indexOf(el));
        el.style.setProperty('--reveal-delay', (index * 90) + 'ms');
        window.requestAnimationFrame(function () { el.classList.add('is-visible'); });
        observer.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach(function (item) { observer.observe(item); });
  }

  /* -------------------------------------------------- application panel change */
  var panel = document.getElementById('application-panel');
  if (panel && !reduce) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-example]'), function (button) {
      button.addEventListener('click', function () {
        panel.classList.remove('is-swapping');
        void panel.offsetWidth;
        panel.classList.add('is-swapping');
      });
    });
    panel.addEventListener('animationend', function () { panel.classList.remove('is-swapping'); });
  }

  /* -------------------------------------------------------- keyboard affordance */
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    root.classList.add('is-keyboarding');
  });
  ['pointerdown', 'mousedown', 'touchstart'].forEach(function (type) {
    window.addEventListener(type, function () { root.classList.remove('is-keyboarding'); }, { passive: true });
  });
})();
