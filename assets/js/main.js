/* ==========================================================================
   天逸 · 星庭  —  main.js
   原生 JS，无任何依赖。功能：星野 canvas、滚动叙事、主题切换、
   技能进度、数字滚动、打字机、留言板（localStorage）
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- 星野 */
  function initSky() {
    var canvas = $('#sky');
    if (!canvas || reduceMotion) { if (canvas) canvas.style.display = 'none'; return; }
    var ctx = canvas.getContext('2d');
    var stars = [];
    var shooting = [];
    var w = 0, h = 0, dpr = 1;
    var scrollY = window.scrollY || 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth = window.innerWidth;
      h = canvas.clientHeight = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function build() {
      var count = Math.round(Math.min(190, Math.max(70, (w * h) / 13000)));
      stars = [];
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h * 1.15,
          r: Math.random() * 1.5 + 0.35,
          a: Math.random() * 0.55 + 0.25,
          tw: Math.random() * 0.02 + 0.004,
          dir: Math.random() > 0.5 ? 1 : -1,
          depth: Math.random() * 0.75 + 0.15,
          hue: Math.random() > 0.82 ? 'gold' : (Math.random() > 0.5 ? 'ice' : 'white')
        });
      }
    }

    function spawnShooting() {
      if (shooting.length > 2 || Math.random() > 0.35) return;
      shooting.push({
        x: Math.random() * w * 0.7,
        y: Math.random() * h * 0.35,
        len: Math.random() * 160 + 90,
        speed: Math.random() * 5 + 5,
        life: 1,
        angle: Math.PI / 5 + Math.random() * 0.2
      });
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        s.a += s.tw * s.dir;
        if (s.a > 0.92 || s.a < 0.14) s.dir *= -1;
        var y = s.y - scrollY * s.depth * 0.06;
        y = ((y % (h * 1.2)) + h * 1.2) % (h * 1.2);
        if (y > h + 6) continue;
        var color = s.hue === 'gold' ? '242, 215, 155' : (s.hue === 'ice' ? '180, 215, 255' : '255, 255, 255');
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + color + ', ' + s.a.toFixed(3) + ')';
        ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.r > 1.15) {
          ctx.beginPath();
          ctx.fillStyle = 'rgba(' + color + ', ' + (s.a * 0.14).toFixed(3) + ')';
          ctx.arc(s.x, y, s.r * 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (var j = shooting.length - 1; j >= 0; j--) {
        var m = shooting[j];
        var dx = Math.cos(m.angle), dy = Math.sin(m.angle);
        var g = ctx.createLinearGradient(m.x, m.y, m.x - dx * m.len, m.y - dy * m.len);
        g.addColorStop(0, 'rgba(220, 240, 255, ' + (0.85 * m.life).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(220, 240, 255, 0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - dx * m.len, m.y - dy * m.len);
        ctx.stroke();
        m.x += dx * m.speed;
        m.y += dy * m.speed;
        m.life -= 0.012;
        if (m.life <= 0 || m.x > w + 200 || m.y > h + 200) shooting.splice(j, 1);
      }

      if (Math.random() < 0.008) spawnShooting();
      window.requestAnimationFrame(frame);
    }

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('scroll', function () { scrollY = window.scrollY || 0; }, { passive: true });
    resize();
    window.requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------- 滚动叙事与高亮 */
  function initScrollUI() {
    var header = $('#siteHeader');
    var bar = $('#progressBar');
    var toTop = $('#toTop');
    var links = $$('.nav-link');
    var sections = links
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);

    function onScroll() {
      var y = window.scrollY || 0;
      var docH = document.documentElement.scrollHeight - window.innerHeight;

      if (header) header.classList.toggle('is-stuck', y > 18);
      if (bar) bar.style.width = (docH > 0 ? Math.min(100, (y / docH) * 100) : 0) + '%';
      if (toTop) toTop.classList.toggle('is-on', y > 520);

      var current = sections[0];
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].getBoundingClientRect().top <= window.innerHeight * 0.35) current = sections[i];
      }
      if (current) {
        links.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + current.id);
        });
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();

    if (toTop) {
      toTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }
  }

  /* ------------------------------------------------------------- 移动菜单 */
  function initMenu() {
    var btn = $('#menuBtn');
    var nav = $('#nav');
    if (!btn || !nav) return;

    function close() {
      nav.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
    });
    $$('.nav-link', nav).forEach(function (a) { a.addEventListener('click', close); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target) && !btn.contains(e.target)) close();
    });
  }

  /* ------------------------------------------------------------- 主题切换 */
  function initTheme() {
    var btn = $('#themeBtn');
    var root = document.documentElement;
    var saved = null;
    try { saved = localStorage.getItem('tianyi-theme'); } catch (e) {}
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);

    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('tianyi-theme', next); } catch (e) {}
    });
  }

  /* ------------------------------------------------------ 入场 / 技能 / 数字 */
  function initReveal() {
    var items = $$('[data-reveal]');

    function activate(el) {
      el.classList.add('is-in');
      $$('.bar i', el).forEach(function (fill) {
        var skill = fill.closest('.skill');
        var level = skill ? parseInt(skill.getAttribute('data-level'), 10) : null;
        if (level) window.setTimeout(function () { fill.style.width = level + '%'; }, 180);
      });
      $$('[data-count]', el).forEach(function (node) {
        var target = parseInt(node.getAttribute('data-count'), 10);
        var suffix = node.getAttribute('data-suffix') || '';
        if (isNaN(target)) return;
        if (reduceMotion) { node.textContent = target + suffix; return; }
        var start = null;
        var dur = 1200;
        function step(ts) {
          if (start === null) start = ts;
          var p = Math.min(1, (ts - start) / dur);
          var eased = 1 - Math.pow(1 - p, 3);
          node.textContent = Math.round(target * eased) + suffix;
          if (p < 1) window.requestAnimationFrame(step);
        }
        window.requestAnimationFrame(step);
      });
    }

    if (!('IntersectionObserver' in window) || reduceMotion) {
      items.forEach(activate);
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        window.setTimeout(function () { activate(el); }, Math.min(i * 70, 350));
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------------------ 打字机 */
  function initTyping() {
    var el = $('#typed');
    if (!el) return;
    var lines = [
      '写一个能跑起来的 Python 小脚本',
      '把这一页的动效再调顺一点',
      '研究 CSS 怎么让手机上也好看',
      '把自己做的东西放上互联网'
    ];
    if (reduceMotion) { el.textContent = lines[0]; return; }

    var li = 0, ci = 0, deleting = false;
    function tick() {
      var text = lines[li];
      el.textContent = text.slice(0, ci);

      if (!deleting && ci < text.length) {
        ci++;
        window.setTimeout(tick, 62 + Math.random() * 55);
      } else if (!deleting && ci === text.length) {
        deleting = true;
        window.setTimeout(tick, 1700);
      } else if (deleting && ci > 0) {
        ci--;
        window.setTimeout(tick, 26);
      } else {
        deleting = false;
        li = (li + 1) % lines.length;
        window.setTimeout(tick, 320);
      }
    }
    window.setTimeout(tick, 600);
  }

  /* ------------------------------------------------------------ 立绘倾斜 */
  function initTilt() {
    if (reduceMotion || !window.matchMedia('(hover: hover)').matches) return;
    $$('[data-tilt]').forEach(function (card) {
      var raf = null;
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        if (raf) window.cancelAnimationFrame(raf);
        raf = window.requestAnimationFrame(function () {
          card.style.transform = 'perspective(1000px) rotateY(' + (px * 7).toFixed(2) + 'deg) rotateX(' +
            (-py * 7).toFixed(2) + 'deg) translateY(-4px)';
        });
      });
      card.addEventListener('mouseleave', function () {
        if (raf) window.cancelAnimationFrame(raf);
        card.style.transform = '';
      });
    });
  }

  /* ------------------------------------------------------------ 留言板 */
  var STORE_KEY = 'tianyi-guestbook-v1';

  function readMessages() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function writeMessages(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 60))); } catch (e) {}
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderMessages() {
    var list = $('#guestList');
    var empty = $('#emptyHint');
    if (!list) return;
    var data = readMessages();
    list.innerHTML = '';

    data.forEach(function (m) {
      var li = document.createElement('li');
      var head = document.createElement('div');
      head.className = 'g-head';
      var name = document.createElement('span');
      name.className = 'g-name';
      name.textContent = m.name;
      var time = document.createElement('span');
      time.className = 'g-time';
      time.textContent = fmtTime(m.time);
      head.appendChild(name);
      head.appendChild(time);

      var body = document.createElement('p');
      body.className = 'g-body';
      body.textContent = m.text;

      li.appendChild(head);
      li.appendChild(body);
      list.appendChild(li);
    });

    if (empty) empty.style.display = data.length ? 'none' : 'block';
  }

  function initGuestbook() {
    var form = $('#msgForm');
    if (!form) return;
    var nameEl = $('#gName');
    var msgEl = $('#gMsg');
    var tip = $('#formTip');
    var counter = $('#counter');
    var clearBtn = $('#clearMsgs');

    function say(text, isError) {
      if (!tip) return;
      tip.textContent = text;
      tip.classList.toggle('is-error', !!isError);
    }

    msgEl.addEventListener('input', function () {
      if (counter) counter.textContent = String(msgEl.value.length);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nameEl.value.trim();
      var text = msgEl.value.trim();

      if (!name) { say('还没告诉我怎么称呼你呢 ✦', true); nameEl.focus(); return; }
      if (text.length < 4) { say('至少写 4 个字吧，我认真看的 ✦', true); msgEl.focus(); return; }

      var list = readMessages();
      list.unshift({ name: name.slice(0, 20), text: text.slice(0, 300), time: Date.now() });
      writeMessages(list);
      renderMessages();

      form.reset();
      if (counter) counter.textContent = '0';
      say('星简已封存，谢谢你来到我的星庭 ✦');
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (!readMessages().length) { say('这里本来就没有留言。'); return; }
        if (window.confirm('确定清空保存在这个浏览器里的留言吗？')) {
          writeMessages([]);
          renderMessages();
          say('已清空。');
        }
      });
    }

    renderMessages();
  }

  /* --------------------------------------------------------------- 启动 */
  function boot() {
    var year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());
    initSky();
    initScrollUI();
    initMenu();
    initTheme();
    initReveal();
    initTyping();
    initTilt();
    initGuestbook();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
