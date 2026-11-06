/* Homepage presentation only. No world API calls, remote requests, storage,
   analytics or dependency imports. Existing site.js owns scene/tab/form data.
   Sources and design rationale are documented in home-design.css. */
(function () {
  'use strict';
  var root = document.documentElement;
  var body = document.body;
  if (!body.classList.contains('home-design')) return;
  root.classList.add('home-enhanced');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var narrow = window.matchMedia('(max-width: 680px)');
  var toggle = document.getElementById('home-menu-toggle');
  var menu = document.getElementById('home-navigation');
  var header = document.getElementById('site-header');
  var main = document.getElementById('main');
  var footer = document.querySelector('.site-footer');
  var menuOpen = false;
  var savedOverflow = '';
  function setMenu(open, restoreFocus) {
    open = !!open && narrow.matches;
    if (menuOpen === open) return;
    menuOpen = open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
    menu.classList.toggle('is-open', open);
    if (open) {
      savedOverflow = body.style.overflow;
      body.style.overflow = 'hidden';
      main.inert = true;
      footer.inert = true;
    } else {
      body.style.overflow = savedOverflow;
      main.inert = false;
      footer.inert = false;
      if (restoreFocus) toggle.focus();
    }
  }
  toggle.addEventListener('click', function () { setMenu(!menuOpen, true); });
  menu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () { setMenu(false, false); });
  });
  document.addEventListener('keydown', function (event) {
    if (!menuOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setMenu(false, true);
      return;
    }
    if (event.key !== 'Tab') return;
    var focusable = Array.from(header.querySelectorAll('a[href],button:not([disabled])'));
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }, true);
  narrow.addEventListener('change', function () { if (!narrow.matches) setMenu(false, false); });

  /* Independent word observers use progressively later trigger lines so words
     on one text line still gain emphasis one at a time in reading order.
     Each observer disconnects after its word is revealed. No scroll listener. */
  var words = Array.from(document.querySelectorAll('[data-tagline-word]'));
  var observers = [];
  function revealAllWords() {
    observers.forEach(function (observer) { observer.disconnect(); });
    observers = [];
    words.forEach(function (word) { word.classList.remove('tagline-pending'); });
  }
  if (!reduce.matches && 'IntersectionObserver' in window) {
    words.forEach(function (word, index) {
      word.classList.add('tagline-pending');
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          word.classList.remove('tagline-pending');
          observer.disconnect();
        });
      }, { threshold: 1, rootMargin: '0px 0px -' + (18 + index * 7) + '% 0px' });
      observer.observe(word);
      observers.push(observer);
    });
  }
  reduce.addEventListener('change', function () { if (reduce.matches) revealAllWords(); });

  /* Contact intentionally accepts phone/other channels too. Validate email
     syntax only when the visitor enters an @, preserving the original field
     contract and site.js required/whitespace checks. Capture blocks malformed
     emails before site.js can display a successful demonstration preview. */
  var form = document.getElementById('demo-form');
  var contact = document.getElementById('contact-method');
  var error = document.getElementById('contact-method-error');
  function validateContact() {
    var value = contact.value.trim();
    var malformed = value.indexOf('@') !== -1 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    contact.setCustomValidity(malformed ? error.textContent : '');
    contact.setAttribute('aria-invalid', String(malformed));
    error.hidden = !malformed;
    return !malformed;
  }
  contact.addEventListener('blur', validateContact);
  contact.addEventListener('input', function () {
    contact.setCustomValidity('');
    contact.removeAttribute('aria-invalid');
    error.hidden = true;
  });
  form.addEventListener('submit', function (event) {
    if (validateContact()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var status = document.getElementById('form-status');
    status.hidden = true;
    contact.focus();
    form.reportValidity();
  }, true);

  /* Legal anchors reveal actual inline notices, never dead placeholder links. */
  function revealLinkedNotice() {
    if (location.hash !== '#privacy' && location.hash !== '#terms') return;
    var notice = document.getElementById(location.hash.slice(1));
    if (notice) notice.open = true;
  }
  window.addEventListener('hashchange', revealLinkedNotice);
  revealLinkedNotice();
})();
