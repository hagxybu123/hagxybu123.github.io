/* ==========================================================================
   天逸 · 星庭  —  main.js
   原生 JS，无任何依赖。功能：星野 canvas（星点/彗星/星尘/鼠标交互）、
   滚动叙事、主题切换、技能进度、数字滚动、打字机、留言板（localStorage）
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- 星野 */
  function initSky() {
    var canvas = $('#sky');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas 可用：淡出 CSS 静态星点兜底层
    document.documentElement.classList.add('sky-live');

    var stars = [];
    var dust = [];
    var comets = [];
    var clouds = [];
    var sparks = [];
    var w = 0, h = 0, dpr = 1;
    var scrollY = window.scrollY || 0;
    var mx = -9999, my = -9999;
    var last = 0, acc = 0;
    var cometAt = 0;
    var frameId = null;

    function rnd(a, b) { return a + Math.random() * (b - a); }

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
      stars = [];
      // 窄屏（手机）自动降级，保证 60fps 不掉帧
      var mobile = w < 760;
      var density = mobile ? 9000 : 5200;
      var cap = mobile ? 190 : 380;
      var count = Math.round(Math.min(cap, Math.max(mobile ? 90 : 160, (w * h) / density)));
      var flareRate = mobile ? 0.55 : 0.32;
      for (var i = 0; i < count; i++) {
        var roll = Math.random();
        var hue = roll > 0.58 ? 'gold' : (roll > 0.26 ? 'ice' : 'white');
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h * 1.2,
          r: hue === 'gold' ? rnd(1.8, 5.6) : rnd(1.3, 4.6),
          // 亮度下限拉高，星星"淡"的根源就在这里
          a: hue === 'gold' ? rnd(0.92, 1) : rnd(0.80, 1),
          tw: rnd(0.020, 0.062),
          dir: Math.random() > 0.5 ? 1 : -1,
          depth: rnd(0.15, 0.9),
          hue: hue,
          flare: Math.random() > flareRate
        });
      }

      dust = [];
      var dCount = Math.round(Math.min(mobile ? 120 : 220, Math.max(80, (w * h) / 8000)));
      for (var d = 0; d < dCount; d++) {
        dust.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: rnd(2.2, 6),
          vx: rnd(-0.18, 0.18),
          vy: rnd(-0.34, -0.08),
          a: rnd(0.35, 0.8),
          hue: Math.random() > 0.32 ? 'gold' : 'ice',
          ph: Math.random() * 6.28
        });
      }

      // 星云：亮色云团（中心实、边缘透），是"星光感"的主体
      clouds = [
        { x: w * 0.18, y: h * 0.24, r: Math.max(w, h) * 0.44, vx: 0.022, vy: 0.011, c: [104, 152, 255], a: 0.92 },
        { x: w * 0.82, y: h * 0.18, r: Math.max(w, h) * 0.40, vx: -0.016, vy: 0.013, c: [178, 118, 250], a: 0.86 },
        { x: w * 0.55, y: h * 0.72, r: Math.max(w, h) * 0.48, vx: 0.012, vy: -0.015, c: [64, 186, 240], a: 0.78 },
        { x: w * 0.42, y: h * 0.12, r: Math.max(w, h) * 0.30, vx: -0.010, vy: 0.014, c: [242, 205, 140], a: 0.55 }
      ];
    }

    function palette(hue) {
      if (hue === 'gold') return '255, 232, 168';
      if (hue === 'ice') return '205, 232, 255';
      return '255, 255, 255';
    }

    function spawnComet() {
      if (comets.length >= 5) return;
      var fromLeft = Math.random() > 0.35;
      comets.push({
        x: fromLeft ? rnd(-w * 0.2, w * 0.55) : rnd(w * 0.5, w * 1.2),
        y: rnd(-h * 0.05, h * 0.55),
        ang: fromLeft ? rnd(0.28, 0.62) : rnd(Math.PI - 0.62, Math.PI - 0.28),
        speed: rnd(7, 14),
        len: rnd(140, 320),
        life: 1,
        decay: rnd(0.004, 0.0085),
        width: rnd(1.4, 3.2),
        // 金色彗星占比提到约 40%，"金色星光"成为主视觉
        hue: Math.random() > 0.6 ? 'gold' : 'ice'
      });
    }

    function addSpark(x, y) {
      var n = 26;
      for (var i = 0; i < n; i++) {
        var ang = (Math.PI * 2 * i) / n + rnd(-0.2, 0.2);
        var sp = rnd(1.5, 6.4);
        sparks.push({
          x: x, y: y,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          life: 1, decay: rnd(0.012, 0.028),
          hue: Math.random() > 0.35 ? 'gold' : 'ice'
        });
      }
    }

    function frame(ts) {
      if (!last) last = ts;
      var rawDt = ts - last;
      last = ts;
      var dt = rawDt > 50 ? 2 : rawDt / 16.67;

      ctx.clearRect(0, 0, w, h);

      // 星云：亮色云团，中心实、边缘透 —— 这是"星光"的主体
      ctx.globalCompositeOperation = 'source-over';
      for (var c = 0; c < clouds.length; c++) {
        var cl = clouds[c];
        cl.x += cl.vx * dt;
        cl.y += cl.vy * dt;
        if (cl.x < -cl.r * 0.5) cl.x = w + cl.r * 0.4;
        if (cl.x > w + cl.r * 0.5) cl.x = -cl.r * 0.4;
        if (cl.y < -cl.r * 0.5) cl.y = h + cl.r * 0.4;
        if (cl.y > h + cl.r * 0.5) cl.y = -cl.r * 0.4;
        cl.ph = (cl.ph || 0) + 0.0035 * dt;
        var pulse = 0.80 + 0.20 * Math.sin(cl.ph);
        var g = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.r);
        var cc = cl.c[0] + ', ' + cl.c[1] + ', ' + cl.c[2];
        // 多层停靠点：中心明亮，中段仍有厚度，边缘才散开
        g.addColorStop(0, 'rgba(' + cc + ', ' + Math.min(1, cl.a * pulse * 0.48).toFixed(3) + ')');
        g.addColorStop(0.30, 'rgba(' + cc + ', ' + (cl.a * pulse * 0.26).toFixed(3) + ')');
        g.addColorStop(0.62, 'rgba(' + cc + ', ' + (cl.a * pulse * 0.11).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + cc + ', 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cl.x, cl.y, cl.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 星尘：缓缓上浮
      for (var i = 0; i < dust.length; i++) {
        var p = dust[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.ph += 0.03 * dt;
        if (p.y < -12) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -12) p.x = w + 10;
        if (p.x > w + 12) p.x = -10;
        var da = p.a * (0.55 + 0.45 * Math.sin(p.ph));
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + palette(p.hue) + ', ' + da.toFixed(3) + ')';
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 星点：闪烁 + 视差 + 鼠标高亮
      for (var s = 0; s < stars.length; s++) {
        var st = stars[s];
        st.a += st.tw * st.dir * dt;
        if (st.a >= 1) { st.a = 1; st.dir = -1; }
        if (st.a <= 0.58) { st.a = 0.58; st.dir = 1; }

        var y = st.y - scrollY * st.depth * 0.08;
        var span = h * 1.25;
        y = ((y % span) + span) % span;
        if (y > h + 8) continue;

        var boost = 0;
        var dxm = st.x - mx, dym = y - my;
        if (dxm * dxm + dym * dym < 19000) boost = 0.5;

        var alpha = Math.min(1, st.a + boost);
        var col = palette(st.hue);
        var radius = st.r * (1 + boost);

        ctx.globalCompositeOperation = 'lighter';

        // ① 外层彩色光晕：整片星空发光的来源
        var glowR = radius * (st.flare ? 9 : 5);
        var gg = ctx.createRadialGradient(st.x, y, 0, st.x, y, glowR);
        gg.addColorStop(0, 'rgba(' + col + ', ' + (alpha * 0.55).toFixed(3) + ')');
        gg.addColorStop(0.45, 'rgba(' + col + ', ' + (alpha * 0.18).toFixed(3) + ')');
        gg.addColorStop(1, 'rgba(' + col + ', 0)');
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(st.x, y, glowR, 0, Math.PI * 2);
        ctx.fill();

        // ② 十字星芒
        if (st.flare) {
          var ray = st.r * (st.hue === 'gold' ? 17 : 12);
          ctx.strokeStyle = 'rgba(' + col + ', ' + (alpha * 0.85).toFixed(3) + ')';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(st.x - ray, y); ctx.lineTo(st.x + ray, y);
          ctx.moveTo(st.x, y - ray); ctx.lineTo(st.x, y + ray);
          ctx.stroke();
          var ray2 = ray * 0.42;
          ctx.strokeStyle = 'rgba(' + col + ', ' + (alpha * 0.5).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(st.x - ray2, y - ray2); ctx.lineTo(st.x + ray2, y + ray2);
          ctx.moveTo(st.x - ray2, y + ray2); ctx.lineTo(st.x + ray2, y - ray2);
          ctx.stroke();
        }

        // ③ 白芯：星星"亮"的关键，彩色外圈 + 纯白内芯
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255, 255, 255, ' + alpha.toFixed(3) + ')';
        ctx.arc(st.x, y, radius * 0.62, 0, Math.PI * 2);
        ctx.fill();

        // ④ 再补一层色彩，让色相透出来
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + col + ', ' + (alpha * 0.9).toFixed(3) + ')';
        ctx.arc(st.x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalCompositeOperation = 'source-over';
      }

      // 彗星：常驻划过
      ctx.globalCompositeOperation = 'lighter';
      for (var m = comets.length - 1; m >= 0; m--) {
        var cm = comets[m];
        var dx = Math.cos(cm.ang), dy = Math.sin(cm.ang);
        var tx = cm.x - dx * cm.len, ty = cm.y - dy * cm.len;
        var col2 = palette(cm.hue);
        var grad = ctx.createLinearGradient(cm.x, cm.y, tx, ty);
        grad.addColorStop(0, 'rgba(255, 255, 255, ' + Math.min(1, 1.15 * cm.life).toFixed(3) + ')');
        grad.addColorStop(0.16, 'rgba(' + col2 + ', ' + Math.min(1, 1.05 * cm.life).toFixed(3) + ')');
        grad.addColorStop(0.55, 'rgba(' + col2 + ', ' + (0.42 * cm.life).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(' + col2 + ', 0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = cm.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cm.x, cm.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        // 头部光晕（外圈放大，形成明显的发光头部）
        var hg = ctx.createRadialGradient(cm.x, cm.y, 0, cm.x, cm.y, 26);
        hg.addColorStop(0, 'rgba(255, 255, 255, ' + Math.min(1, 1.1 * cm.life).toFixed(3) + ')');
        hg.addColorStop(0.35, 'rgba(' + col2 + ', ' + (0.62 * cm.life).toFixed(3) + ')');
        hg.addColorStop(1, 'rgba(' + col2 + ', 0)');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(cm.x, cm.y, 26, 0, Math.PI * 2);
        ctx.fill();

        cm.x += dx * cm.speed * dt;
        cm.y += dy * cm.speed * dt;
        cm.life -= cm.decay * dt;
        if (cm.life <= 0 || cm.x < -w * 0.6 || cm.x > w * 1.6 || cm.y > h * 1.4) comets.splice(m, 1);
      }

      // 点击爆开的星光
      for (var k = sparks.length - 1; k >= 0; k--) {
        var sp = sparks[k];
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vx *= 0.975;
        sp.vy *= 0.975;
        sp.life -= sp.decay * dt;
        if (sp.life <= 0) { sparks.splice(k, 1); continue; }
        var scol = sp.hue === 'gold' ? '255, 226, 150' : '200, 230, 255';
        // 先画一圈光晕再画芯，金色才会"炸"出来
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + scol + ', ' + (sp.life * 0.25).toFixed(3) + ')';
        ctx.arc(sp.x, sp.y, 5.5 * sp.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + scol + ', ' + Math.min(1, sp.life * 1.2).toFixed(3) + ')';
        ctx.arc(sp.x, sp.y, 1.9 * sp.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // 彗星节奏：平均 1.6~3.2 秒一颗，约七成概率同时来两颗
      acc += rawDt;
      if (acc > cometAt) {
        spawnComet();
        if (Math.random() > 0.3) spawnComet();
        cometAt = rnd(1600, 3200);
        acc = 0;
      }

      frameId = window.requestAnimationFrame(frame);
    }

    function start() { if (frameId === null) { last = 0; frameId = window.requestAnimationFrame(frame); } }
    function stop() { if (frameId !== null) { window.cancelAnimationFrame(frameId); frameId = null; } }

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('scroll', function () { scrollY = window.scrollY || 0; }, { passive: true });
    window.addEventListener('mousemove', function (e) { mx = e.clientX; my = e.clientY; }, { passive: true });
    window.addEventListener('mouseout', function () { mx = -9999; my = -9999; });
    window.addEventListener('pointerdown', function (e) { addSpark(e.clientX, e.clientY); }, { passive: true });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });

    resize();

    if (reduceMotion) {
      // 尊重"减少动态效果"：画一帧静态星空，不启动动画循环
      last = 16; acc = 0; cometAt = 1e9;
      frame(32);
      stop();
      return;
    }
    start();
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
    // Mark that JS is alive. CSS only hides [data-reveal] elements under
    // html.js-ready, so a JS failure can never leave the page looking blank.
    document.documentElement.classList.add('js-ready');

    var steps = [
      ['年份', function () { var y = $('#year'); if (y) y.textContent = String(new Date().getFullYear()); }],
      ['星野', initSky],
      ['滚动与高亮', initScrollUI],
      ['移动菜单', initMenu],
      ['主题切换', initTheme],
      ['入场动效', initReveal],
      ['打字机', initTyping],
      ['立绘倾斜', initTilt],
      ['留言板', initGuestbook]
    ];

    for (var i = 0; i < steps.length; i++) {
      try {
        steps[i][1]();
      } catch (e) {
        // One broken feature must never take down the whole page.
        if (window.console && console.error) console.error('[星庭] ' + steps[i][0] + ' 初始化失败:', e);
      }
    }

    // Anything still hidden after boot gets revealed no matter what.
    window.setTimeout(function () {
      $$('[data-reveal]').forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && !el.classList.contains('is-in')) el.classList.add('is-in');
      });
    }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
