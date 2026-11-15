(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');

  // Reveal sections as they scroll into view
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window) {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); rio.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (r) { rio.observe(r); });
  } else { reveals.forEach(function (r) { r.classList.add('in'); }); }

  // Scale the live project previews (a 1280px-wide page) down to their frame
  var views = Array.prototype.slice.call(document.querySelectorAll('.viewport'));
  var fitViews = function () { views.forEach(function (v) { v.style.setProperty('--s', (v.clientWidth / 1280).toFixed(4)); }); };
  if (views.length) { fitViews(); window.addEventListener('resize', fitViews); }

  // Theme toggle
  var themeBtn = document.querySelector('.theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var dark = root.dataset.theme
        ? root.dataset.theme === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = dark ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  // Mobile menu
  var menuBtn = document.querySelector('.menu-btn');
  var nav = document.getElementById('nav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Highlight the section in view
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('#nav a[href^="#"]'));
  if ('IntersectionObserver' in window && navLinks.length) {
    var byId = {};
    navLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          navLinks.forEach(function (a) { a.removeAttribute('aria-current'); });
          var link = byId[en.target.id];
          if (link) link.setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  // Dividend Discount Model calculator
  var RISK_FREE = 7, MARKET = 13;
  var el = function (id) { return document.getElementById(id); };
  var div = el('div'), growth = el('growth'), beta = el('beta');
  var rupees = function (n) { return '₹' + Math.round(n).toLocaleString('en-IN'); };
  var defaultMsg = el('calc-msg') ? el('calc-msg').textContent : '';

  function valueAt(d, g, r) { return r - g > 0.25 ? d / ((r - g) / 100) : null; }

  function drawCurve(d, g, r) {
    var svg = el('curve'); if (!svg) return;
    var W = 320, H = 90, pad = 6, maxG = Math.max(0.5, r - 1.5), pts = [], maxV = 0, i, x, v;
    for (i = 0; i <= 40; i++) {
      x = (maxG * i) / 40; v = valueAt(d, x, r);
      if (v !== null) { pts.push([x, v]); if (v > maxV) maxV = v; }
    }
    var sx = function (gx) { return pad + (gx / maxG) * (W - 2 * pad); };
    var sy = function (vy) { return H - pad - (vy / maxV) * (H - 2 * pad - 8); };
    var line = pts.map(function (p, k) { return (k ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join(' ');
    var area = line + ' L' + sx(pts[pts.length - 1][0]).toFixed(1) + ' ' + (H - pad) + ' L' + sx(0).toFixed(1) + ' ' + (H - pad) + ' Z';
    var cur = valueAt(d, g, r);
    var dot = cur !== null && g <= maxG
      ? '<circle class="dot" r="5" cx="' + sx(g).toFixed(1) + '" cy="' + sy(Math.min(cur, maxV)).toFixed(1) + '"/>' : '';
    svg.innerHTML = '<line class="axis" x1="' + pad + '" x2="' + (W - pad) + '" y1="' + (H - pad) + '" y2="' + (H - pad) + '"/>' +
      '<path class="area" d="' + area + '"/><path class="line" d="' + line + '"/>' + dot;
  }

  function update() {
    var d = parseFloat(div.value), g = parseFloat(growth.value), b = parseFloat(beta.value);
    var r = RISK_FREE + b * (MARKET - RISK_FREE);
    el('div-out').textContent = rupees(d);
    el('growth-out').textContent = g.toFixed(1) + '%';
    el('beta-out').textContent = b.toFixed(2);
    el('req').textContent = r.toFixed(1) + '%';
    var v = valueAt(d, g, r), msg = el('calc-msg');
    if (v === null) {
      el('value').textContent = 'No value';
      msg.textContent = 'The model only works when growth is lower than the required return. Lower the growth rate or raise beta.';
      msg.classList.add('warn');
    } else {
      el('value').textContent = rupees(v);
      msg.textContent = defaultMsg;
      msg.classList.remove('warn');
    }
    drawCurve(d, g, r);
  }
  if (div && growth && beta) {
    [div, growth, beta].forEach(function (i) { i.addEventListener('input', update); });
    update();
  }

  // Copy email
  var copyBtn = el('copy-email');
  if (copyBtn) {
    var address = copyBtn.getAttribute('data-email') || '';
    copyBtn.addEventListener('click', function () {
      var done = function (ok) {
        copyBtn.textContent = ok ? 'Email address copied' : 'Copy failed. The address is ' + address;
        setTimeout(function () { copyBtn.textContent = 'Copy email address'; }, 2500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(address).then(function () { done(true); }, function () { done(false); });
      } else { done(false); }
    });
  }

  var y = el('year'); if (y) y.textContent = String(new Date().getFullYear());
})();
