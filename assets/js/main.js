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
  // 共用的随机数工具（星野与开场页漩涡都要用）
  var rnd = function (a, b) { return a + Math.random() * (b - a); };

  /* ---------------------------------------------------------------- 星野 */
  function initSky() {
    var canvas = $('#sky');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas 可用：淡出 CSS 静态星点兜底层
    document.documentElement.classList.add('sky-live');

    /* ---- 光晕精灵缓存 ----------------------------------------------------
       原来每颗星每帧都调用 createRadialGradient，560 颗星 = 每秒创建几万个
       渐变对象，跑久了渲染管线会卡顿撕裂（表现为闪屏）。
       改为把光晕预渲染成小图，之后只做 drawImage —— 快几十倍。            */
    var spriteCache = {};
    function glowSprite(rgb, size) {
      var key = rgb + '|' + size;
      var s = spriteCache[key];
      if (s) return s;
      var c = document.createElement('canvas');
      var d = size * 2;
      c.width = d;
      c.height = d;
      var g = c.getContext('2d');
      if (!g) return null;
      var grd = g.createRadialGradient(size, size, 0, size, size, size);
      grd.addColorStop(0, 'rgba(' + rgb + ', 1)');
      grd.addColorStop(0.42, 'rgba(' + rgb + ', 0.34)');
      grd.addColorStop(1, 'rgba(' + rgb + ', 0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(size, size, size, 0, Math.PI * 2);
      g.fill();
      spriteCache[key] = c;
      return c;
    }

    // 把光晕裁成只含 alpha 的白色贴图，绘制时用 globalAlpha 控强度，
    // 这样同一种色相所有星点共用一张图。
    function halo(rgb, x, y, r, alpha) {
      var size = 64;
      var spr = glowSprite(rgb, size);
      if (!spr) return;
      var prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      var d = size * 2;
      ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = prev;
    }

    var stars = [];
    var dust = [];
    var drift = [];
    var comets = [];
    var clouds = [];
    var sparks = [];
    var rings = [];
    var w = 0, h = 0, dpr = 1;
    var scrollY = window.scrollY || 0;
    var mx = -9999, my = -9999;
    var last = 0, acc = 0;
    var cometAt = 0;
    var frameId = null;

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
      var density = mobile ? 6000 : 3200;
      var cap = mobile ? 260 : 560;
      var count = Math.round(Math.min(cap, Math.max(mobile ? 120 : 220, (w * h) / density)));
      var flareRate = mobile ? 0.55 : 0.34;
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

      // 横向漂移的星点：让星空"整个在动"，而不是只有闪烁
      drift = [];
      var nDrift = Math.round(Math.min(mobile ? 60 : 130, Math.max(30, (w * h) / 15000)));
      for (var f = 0; f < nDrift; f++) {
        var rollD = Math.random();
        drift.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: rnd(1.0, 3.0),
          vx: rnd(0.10, 0.55) * (Math.random() > 0.22 ? 1 : -1),
          vy: rnd(-0.07, 0.07),
          a: rnd(0.40, 1),
          tw: rnd(0.008, 0.03),
          dir: Math.random() > 0.5 ? 1 : -1,
          hue: rollD > 0.55 ? 'gold' : (rollD > 0.24 ? 'ice' : 'white')
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

    // 点击爆开：星环冲击波 + 中心闪光 + 四散金蓝星火
    function addSpark(x, y) {
      // 粒子总量上限：狂点也不至于把渲染拖垮（闪屏的另一诱因）
      if (sparks.length > 420) sparks.splice(0, sparks.length - 420);
      if (rings.length > 24) rings.splice(0, rings.length - 24);

      // ① 三道扩散星环，速度与粗细各异，形成冲击波层次
      rings.push({ x: x, y: y, life: 1, r: 0, grow: rnd(4.6, 6.2), decay: rnd(0.016, 0.022), w: 3.2, hue: 'gold' });
      rings.push({ x: x, y: y, life: 1, r: 10, grow: rnd(3.0, 4.0), decay: rnd(0.020, 0.027), w: 2.0, hue: 'ice' });
      rings.push({ x: x, y: y, life: 1, r: 22, grow: rnd(1.8, 2.6), decay: rnd(0.026, 0.034), w: 1.2, hue: 'white' });

      // ② 中心闪光
      rings.push({ x: x, y: y, life: 1, r: 0, grow: 0, decay: 0.055, w: 0, hue: 'flash' });

      // ③ 四散星火，带一点切向速度让轨迹卷曲成漩涡状
      var n = 34;
      for (var i = 0; i < n; i++) {
        var ang = (Math.PI * 2 * i) / n + rnd(-0.18, 0.18);
        var sp = rnd(1.8, 7.6);
        sparks.push({
          x: x, y: y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          spin: rnd(-0.10, 0.10),
          life: 1,
          decay: rnd(0.010, 0.026),
          hue: Math.random() > 0.38 ? 'gold' : 'ice'
        });
      }
    }

    // 自适应画质：连续掉帧就减少星点数量，避免长时间停留后卡顿/闪屏
    var slowStreak = 0, quality = 1;
    // 帧率上限：15ms 约等于 60fps，只用于拦住 120Hz 高刷屏的翻倍负载，
    // 不能设太高，否则 60Hz 屏幕会被整帧跳过（画面反而卡）。
    var FRAME_FLOOR = 15;

    function frame(ts) {
      if (!last) last = ts;
      var rawDt = ts - last;

      // 帧率上限：不到 21ms 就跳过这一帧，降低 GPU 持续负载
      if (rawDt < FRAME_FLOOR) {
        frameId = window.requestAnimationFrame(frame);
        return;
      }
      last = ts;
      var dt = rawDt > 50 ? 2 : rawDt / 16.67;

      // 连续 90 帧耗时过长 -> 降级一次（最多降 3 档，每次减 25% 星点）
      if (rawDt > 34) {
        slowStreak++;
        if (slowStreak > 90 && quality > 0.35) {
          quality -= 0.25;
          slowStreak = 0;
          var keep = Math.max(40, Math.round(stars.length * quality));
          if (keep < stars.length) stars.length = keep;
          var keepDrift = Math.max(20, Math.round(drift.length * quality));
          if (keepDrift < drift.length) drift.length = keepDrift;
          if (window.console && console.info) {
            console.info('[星庭] 检测到持续掉帧，已自动降低星空密度到 ' + Math.round(quality * 100) + '%');
          }
        }
      } else if (slowStreak > 0) {
        slowStreak--;
      }

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

      // 漂移星点：横向缓慢掠过，让整片星空"在动"
      ctx.globalCompositeOperation = 'lighter';
      for (var dr = 0; dr < drift.length; dr++) {
        var ds = drift[dr];
        ds.x += ds.vx * dt;
        ds.y += ds.vy * dt;
        ds.a += ds.tw * ds.dir * dt;
        if (ds.a >= 1) { ds.a = 1; ds.dir = -1; }
        if (ds.a <= 0.42) { ds.a = 0.42; ds.dir = 1; }
        // 环绕
        if (ds.x < -14) ds.x = w + 12;
        if (ds.x > w + 14) ds.x = -12;
        if (ds.y < -14) ds.y = h + 12;
        if (ds.y > h + 14) ds.y = -12;

        var dcol = palette(ds.hue);
        // 拖尾：原来每颗每帧新建线性渐变（130 个/帧），改为两段实心描边
        var tl = 2.6 + Math.abs(ds.vx) * 7;
        var tailX = ds.x - ds.vx * tl, tailY = ds.y - ds.vy * tl;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(' + dcol + ', ' + (ds.a * 0.22).toFixed(3) + ')';
        ctx.lineWidth = ds.r * 0.7;
        ctx.beginPath();
        ctx.moveTo(ds.x, ds.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(' + dcol + ', ' + (ds.a * 0.55).toFixed(3) + ')';
        ctx.lineWidth = ds.r * 0.4;
        ctx.beginPath();
        ctx.moveTo(ds.x, ds.y);
        ctx.lineTo((ds.x + tailX) / 2, (ds.y + tailY) / 2);
        ctx.stroke();

        // 星点本体 + 白芯
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + dcol + ', ' + ds.a.toFixed(3) + ')';
        ctx.arc(ds.x, ds.y, ds.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (ds.a * 0.92).toFixed(3) + ')';
        ctx.arc(ds.x, ds.y, ds.r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

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

        // ① 外层彩色光晕：改用预渲染精灵（原来每帧新建渐变，是闪屏主因）
        var glowR = radius * (st.flare ? 9 : 5);
        halo(col, st.x, y, glowR, alpha * 0.55);

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

        // 头部光晕：改用预渲染精灵
        halo('255, 255, 255', cm.x, cm.y, 30, Math.min(1, 1.1 * cm.life));
        halo(col2, cm.x, cm.y, 20, 0.62 * cm.life);

        cm.x += dx * cm.speed * dt;
        cm.y += dy * cm.speed * dt;
        cm.life -= cm.decay * dt;
        if (cm.life <= 0 || cm.x < -w * 0.6 || cm.x > w * 1.6 || cm.y > h * 1.4) comets.splice(m, 1);
      }

      // 点击爆开：扩散星环 + 中心闪光
      for (var rg = rings.length - 1; rg >= 0; rg--) {
        var rn = rings[rg];
        rn.life -= rn.decay * dt;
        if (rn.life <= 0) { rings.splice(rg, 1); continue; }

        if (rn.hue === 'flash') {
          // 中心闪光：改用预渲染精灵
          var fl = rn.life;
          halo('255, 255, 255', rn.x, rn.y, 74 * fl, Math.min(1, fl * 1.1));
          halo('255, 236, 190', rn.x, rn.y, 96 * fl, fl * 0.65);
          continue;
        }

        rn.r += rn.grow * dt;
        var rc = rn.hue === 'gold' ? '255, 226, 150' : (rn.hue === 'ice' ? '190, 224, 255' : '255, 255, 255');
        // 环本体
        ctx.strokeStyle = 'rgba(' + rc + ', ' + Math.min(1, rn.life * 1.15).toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.6, rn.w * rn.life);
        ctx.beginPath();
        ctx.arc(rn.x, rn.y, rn.r, 0, Math.PI * 2);
        ctx.stroke();
        // 环外一圈柔光，让冲击波有厚度
        ctx.strokeStyle = 'rgba(' + rc + ', ' + (rn.life * 0.22).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, rn.w * rn.life * 4.5);
        ctx.beginPath();
        ctx.arc(rn.x, rn.y, rn.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 点击爆开的星光
      for (var k = sparks.length - 1; k >= 0; k--) {
        var sp = sparks[k];
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        // 切向分量 -> 轨迹卷曲，像被星环甩出去
        if (sp.spin) {
          var tvx = -sp.vy * sp.spin;
          var tvy = sp.vx * sp.spin;
          sp.vx += tvx * dt;
          sp.vy += tvy * dt;
        }
        sp.vx *= 0.976;
        sp.vy *= 0.976;
        sp.life -= sp.decay * dt;
        if (sp.life <= 0) { sparks.splice(k, 1); continue; }
        var scol = sp.hue === 'gold' ? '255, 226, 150' : '200, 230, 255';
        // 拖尾：从上一帧位置拉一条渐隐线
        var pxx = sp.x - sp.vx * 1.6, pyy = sp.y - sp.vy * 1.6;
        ctx.strokeStyle = 'rgba(' + scol + ', ' + (sp.life * 0.55).toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.6, sp.life * 1.8);
        ctx.beginPath();
        ctx.moveTo(pxx, pyy);
        ctx.lineTo(sp.x, sp.y);
        ctx.stroke();
        // 先画一圈光晕再画芯，金色才会"炸"出来
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + scol + ', ' + (sp.life * 0.28).toFixed(3) + ')';
        ctx.arc(sp.x, sp.y, 6 * sp.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255, 255, 255, ' + Math.min(1, sp.life * 1.25).toFixed(3) + ')';
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

  /* ------------------------------------------------------------- 开场页 */
  function initEntry() {
    var entry = $('#entry');
    var body = document.body;

    // 已经进过站（同一次会话）就直接跳过开场页
    var seen = false;
    try { seen = sessionStorage.getItem('tianyi-entered') === '1'; } catch (e) {}
    if (!entry || seen) {
      if (entry && entry.parentNode) entry.parentNode.removeChild(entry);
      body.classList.remove('is-locked');
      return;
    }

    body.classList.add('is-locked');

    /* ---------------- 星空漩涡：汇聚 → 停顿 → 炸开 ---------------- */
    var vortex = $('#vortex');
    var vctx = vortex ? vortex.getContext('2d') : null;
    var parts = [];
    var vw = 0, vh = 0, vraf = null;
    var phase = 'idle';   // idle | converge | hold | explode
    var phaseAt = 0;

    function vresize() {
      if (!vortex) return;
      var d = Math.min(window.devicePixelRatio || 1, 2);
      vw = window.innerWidth;
      vh = window.innerHeight;
      vortex.width = Math.floor(vw * d);
      vortex.height = Math.floor(vh * d);
      vctx.setTransform(d, 0, 0, d, 0, 0);
    }

    function palette2(h) {
      if (h === 'gold') return '255, 232, 168';
      if (h === 'ice') return '205, 232, 255';
      return '255, 255, 255';
    }

    function vbuild() {
      parts = [];
      var cx = vw / 2, cy = vh / 2;
      // 先清空画布，保证"整片星空"都参与漩涡
      vctx.clearRect(0, 0, vw, vh);
      var n = Math.min(420, Math.max(160, Math.round((vw * vh) / 4200)));
      for (var i = 0; i < n; i++) {
        var ang = Math.random() * Math.PI * 2;
        // 中心稀疏、外圈密集，汇聚时层次更好看
        var dist = rnd(30, Math.max(vw, vh) * 0.78);
        var roll = Math.random();
        parts.push({
          x: cx + Math.cos(ang) * dist,
          y: cy + Math.sin(ang) * dist,
          px: 0, py: 0,
          r: rnd(0.7, 2.6),
          speed: rnd(0.012, 0.055),
          ang: ang,
          spin: rnd(-0.016, 0.016),
          hue: roll > 0.58 ? 'gold' : (roll > 0.26 ? 'ice' : 'white'),
          life: 1,
          tvx: 0, tvy: 0
        });
      }
      for (var j = 0; j < parts.length; j++) { parts[j].px = parts[j].x; parts[j].py = parts[j].y; }
    }

    function vdraw(now) {
      vctx.clearRect(0, 0, vw, vh);
      var cx = vw / 2, cy = vh / 2;

      // 汇聚时给中心加一个逐渐增强的引力光核
      if (phase === 'converge' || phase === 'hold') {
        var el = now - phaseAt;
        var core = phase === 'hold' ? 1 : Math.min(1, el / 620);
        var cr = 26 + core * 92;
        var cg = vctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
        cg.addColorStop(0, 'rgba(255, 255, 255, ' + (0.92 * core).toFixed(3) + ')');
        cg.addColorStop(0.4, 'rgba(190, 220, 255, ' + (0.42 * core).toFixed(3) + ')');
        cg.addColorStop(1, 'rgba(140, 180, 255, 0)');
        vctx.fillStyle = cg;
        vctx.beginPath();
        vctx.arc(cx, cy, cr, 0, Math.PI * 2);
        vctx.fill();
      }

      // 炸开时的冲击光环
      if (phase === 'explode') {
        var e2 = now - phaseAt;
        if (e2 < 900) {
          var ring = e2 * 1.9;
          vctx.strokeStyle = 'rgba(255, 240, 210, ' + Math.max(0, 0.75 * (1 - e2 / 900)).toFixed(3) + ')';
          vctx.lineWidth = Math.max(1, 16 * (1 - e2 / 900));
          vctx.beginPath();
          vctx.arc(cx, cy, ring, 0, Math.PI * 2);
          vctx.stroke();
          var fg = vctx.createRadialGradient(cx, cy, 0, cx, cy, 60 + e2 * 2.4);
          fg.addColorStop(0, 'rgba(255, 255, 255, ' + Math.max(0, 0.6 * (1 - e2 / 700)).toFixed(3) + ')');
          fg.addColorStop(1, 'rgba(255, 255, 255, 0)');
          vctx.fillStyle = fg;
          vctx.beginPath();
          vctx.arc(cx, cy, 60 + e2 * 2.4, 0, Math.PI * 2);
          vctx.fill();
        }
      }

      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        var col = palette2(p.hue);
        if (p.life <= 0) continue;
        // 拖尾：从上一帧位置画一条渐隐线，运动感更强
        if (phase === 'explode') {
          vctx.strokeStyle = 'rgba(' + col + ', ' + (p.life * 0.5).toFixed(3) + ')';
          vctx.lineWidth = p.r * 0.9;
          vctx.beginPath();
          vctx.moveTo(p.px, p.py);
          vctx.lineTo(p.x, p.y);
          vctx.stroke();
        }
        // 每颗星带光晕，汇聚时才像"星光流"
        var gr = p.r * (phase === 'explode' ? 5 : 3.4);
        var g2 = vctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr);
        g2.addColorStop(0, 'rgba(' + col + ', ' + (p.life * 0.6).toFixed(3) + ')');
        g2.addColorStop(1, 'rgba(' + col + ', 0)');
        vctx.fillStyle = g2;
        vctx.beginPath();
        vctx.arc(p.x, p.y, gr, 0, Math.PI * 2);
        vctx.fill();

        // 白芯
        vctx.fillStyle = 'rgba(255, 255, 255, ' + p.life.toFixed(3) + ')';
        vctx.beginPath();
        vctx.arc(p.x, p.y, p.r * 0.7, 0, Math.PI * 2);
        vctx.fill();
      }
    }

    function vframe() {
      var now = Date.now();
      var cx = vw / 2, cy = vh / 2;

      if (phase === 'converge') {
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          p.px = p.x; p.py = p.y;
          var dx = cx - p.x, dy = cy - p.y;
          var d = Math.sqrt(dx * dx + dy * dy) || 1;
          // 越靠近中心越快 —— 形成"吸入"的加速感
          var pull = p.speed * (1 + Math.max(0, 300 - d) / 90) * 1.35;
          p.x += dx * pull;
          p.y += dy * pull;
          p.ang += p.spin;
          // 一点点切向偏移，轨迹弯曲成漩涡
          p.x += Math.cos(p.ang + Math.PI / 2) * 0.7;
          p.y += Math.sin(p.ang + Math.PI / 2) * 0.7;
        }
        vdraw(now);
        if (now - phaseAt > 620) {
          phase = 'hold';
          phaseAt = now;
        }
      } else if (phase === 'hold') {
        vdraw(now);
        if (now - phaseAt > 190) {
          phase = 'explode';
          phaseAt = now;
          for (var k = 0; k < parts.length; k++) {
            var q = parts[k];
            var ox = q.x - cx, oy = q.y - cy;
            var od = Math.sqrt(ox * ox + oy * oy) || 1;
            var lvl = rnd(3.6, 15);
            q.tvx = (ox / od) * lvl;
            q.tvy = (oy / od) * lvl;
          }
        }
      } else if (phase === 'explode') {
        var done = 0;
        for (var m = 0; m < parts.length; m++) {
          var s2 = parts[m];
          s2.px = s2.x; s2.py = s2.y;
          s2.x += s2.tvx;
          s2.y += s2.tvy;
          s2.tvx *= 0.975;
          s2.tvy *= 0.975;
          s2.life -= 0.016;
          if (s2.life <= 0) done++;
        }
        vdraw(now);
        if (done >= parts.length) {
          vraf = null;
          return;   // 收工
        }
      }
      vraf = window.requestAnimationFrame(vframe);
    }
    /* ------------------------------------------------------------ */

    var closed = false;
    // 画布可用即可播放漩涡（粒子在点击时才生成，不能作为判断条件）
    var canVortex = !!(vortex && vctx) && !reduceMotion;

    function enter() {
      if (closed) return;
      closed = true;

      if (canVortex) {
        entry.classList.add('is-sucking');
        vresize();
        vbuild();
        phase = 'converge';
        phaseAt = Date.now();
        vframe();
      }

      try { sessionStorage.setItem('tianyi-entered', '1'); } catch (e) {}

      var uiDelay = canVortex ? 1000 : 0;
      var killDelay = canVortex ? 1900 : 820;

      window.setTimeout(function () {
        entry.classList.add('is-gone');
        body.classList.remove('is-locked');
      }, uiDelay);

      window.setTimeout(function () {
        if (entry.parentNode) entry.parentNode.removeChild(entry);
      }, killDelay);
    }

    vresize();
    window.addEventListener('resize', function () { if (phase === 'idle') vresize(); }, { passive: true });

    entry.addEventListener('click', enter);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') enter();
    });

    var btn = $('#entryBtn');
    if (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); enter(); });
      // 键盘可达：把焦点放到按钮上
      window.setTimeout(function () { try { btn.focus(); } catch (e) {} }, 400);
    }

    // 兜底：7 秒后自动进入，避免任何情况下卡在开场页
    window.setTimeout(enter, 7000);
  }

  /* --------------------------------------------------- 首屏「进入星庭」按钮 */
  function initEnterButton() {
    var btn = $('#enterBtn');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      var target = document.getElementById('about');
      if (!target) return;      // 没有目标就让浏览器按 href 跳转
      e.preventDefault();
      var top = target.getBoundingClientRect().top + (window.scrollY || 0) - 78;
      window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
      if (history.replaceState) history.replaceState(null, '', '#about');
    });
  }

  /* ------------------------------------------------------------- 背景音乐 */
  function initMusic() {
    var audio = $('#bgm');
    if (!audio) return;

    var btn = $('#musicBtn');
    var entryBtn = $('#entryMusic');
    var label = $('#nowPlaying');
    var missingTip = null;
    var STORE = 'tianyi-bgm';
    var broken = false;

    var TRACK = '只想守护你 ～理纱之歌～';
    var TRACK_SUB = '日本群星';

    function paint(playing) {
      if (btn) {
        btn.classList.toggle('is-playing', playing);
        btn.setAttribute('aria-pressed', String(playing));
        btn.setAttribute('aria-label', playing ? '暂停背景音乐：' + TRACK : '播放背景音乐：' + TRACK);
        btn.setAttribute('title', '背景音乐：' + TRACK + ' · ' + TRACK_SUB);
      }
      if (entryBtn) {
        entryBtn.classList.toggle('is-on', playing);
        entryBtn.setAttribute('aria-pressed', String(playing));
        var txt = entryBtn.querySelector('.em-text');
        if (txt) txt.textContent = playing ? '正在播放「' + TRACK + '」' : '播放「' + TRACK + '」· ' + TRACK_SUB;
      }
      if (label) label.hidden = !playing;
    }

    function showMissingTip() {
      if (missingTip || broken) return;
      broken = true;
      if (btn) btn.classList.add('is-error');
      if (entryBtn) entryBtn.classList.add('is-error');
      var tip = document.createElement('div');
      tip.className = 'audio-missing-tip';
      tip.innerHTML = '还没有音频文件：把歌曲放到 <code>assets/audio/hero.mp3</code> 就会响。<br>' +
        '（有版权的商业歌曲不能随站公开分发，所以需要你自己放进去）';
      document.body.appendChild(tip);
      missingTip = tip;
      window.setTimeout(function () {
        if (tip.parentNode) tip.parentNode.removeChild(tip);
        missingTip = null;
      }, 9000);
    }

    function play() {
      var p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.then(function () {
          paint(true);
          try { localStorage.setItem(STORE, '1'); } catch (e) {}
        }).catch(function () {
          paint(false);
          showMissingTip();
        });
      } else {
        paint(true);
      }
    }

    function pause() {
      try { audio.pause(); } catch (e) {}
      paint(false);
      try { localStorage.setItem(STORE, '0'); } catch (e) {}
    }

    function toggle(e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (audio.paused) play(); else pause();
    }

    audio.addEventListener('error', showMissingTip);
    audio.addEventListener('play', function () { paint(true); });
    audio.addEventListener('pause', function () { paint(false); });

    if (btn) btn.addEventListener('click', toggle);
    if (entryBtn) entryBtn.addEventListener('click', toggle);

    // 用户上次选择过播放，就在首次交互时自动起播（浏览器要求手势后才能播放）
    var want = false;
    try { want = localStorage.getItem(STORE) === '1'; } catch (e) {}
    if (want) {
      var kick = function () {
        document.removeEventListener('pointerdown', kick);
        document.removeEventListener('keydown', kick);
        play();
      };
      document.addEventListener('pointerdown', kick, { once: true });
      document.addEventListener('keydown', kick, { once: true });
    }

    paint(false);
  }

  /* --------------------------------------------------- AI 形象互动（本地角色）
     说明：静态站无法安全持有大模型 API Key（会被前端泄露），所以这里是一个
     由「性格 + 话题」驱动的本地对话引擎。她的语气取自角色设定：
     王室少女、狮子座、INTP、口头禅"规矩是死的，人是活的"、嘴硬心软、爱吃甜食。 */
  function initAI() {
    var dock = $('#aiDock');
    var panel = $('#aiPanel');
    var launcher = $('#aiLauncher');
    var closeBtn = $('#aiClose');
    var log = $('#aiLog');
    var form = $('#aiForm');
    var input = $('#aiInput');
    var chips = $('#aiChips');
    var status = $('#aiStatus');
    if (!dock || !panel || !log || !form || !input) return;

    var PICK = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

    /* ---- 话题库：keywords 命中越多分越高，回复随机取一条 ---- */
    var TOPICS = [
      {
        id: 'greet', chips: '你好',
        keywords: ['你好', '您好', 'hi', 'hello', '在吗', '在么', '嗨', '哈喽'],
        replies: [
          '嗯，来了。……别误会，我只是刚好没在忙。',
          '你来了。星庭今天很安静，正好缺个说话的人。',
          '哟，稀客。说吧，想聊什么？我可是很挑话题的。'
        ]
      },
      {
        id: 'who', chips: '你是谁',
        keywords: ['你是谁', '你叫什么', '自我介绍', '介绍一下你', '什么角色', '你是'],
        replies: [
          '天逸。王室的……算了，这个头衔挺沉的。你叫我天逸就好。',
          '"逸"取的是"逃逸"的意思——从被安排好的剧本里逃出来。听懂了吗？',
          '名字里的"逸"是逃逸的逸。规矩是死的，人是活的，那么守规矩有意思吗？'
        ]
      },
      {
        id: 'creator', chips: '天逸是谁做的',
        keywords: ['谁做的', '谁创', '作者', '站长', '本人', '你真的', '谁写', '原型'],
        replies: [
          '我是他自己写出来的。设定、脾气、连这句嘴硬都是。……有点奇怪吧？我也这么觉得。',
          '严格说，我是他的一部分。他把不好意思直说的话，都交给我说了。',
          '是他做的。不过配色是他自己挑的——宝蓝、冰蓝、白蕾丝，全是他喜欢的样子。'
        ]
      },
      {
        id: 'code', chips: '会写代码吗',
        keywords: ['代码', '编程', 'python', '写程序', '程序', '会不会写', 'js', '前端'],
        replies: [
          '他写，我在旁边看。Python 那个猜数字小游戏，我看了三遍才忍住没吐槽变量名。',
          '会一点。但说实话，我更擅长挑毛病——比如"你这函数是不是该拆一下"。',
          '代码这事，他比我认真。他有个习惯：报错了不慌，先弄明白为什么。这点我认。'
        ]
      },
      {
        id: 'site', chips: '这网站怎么做的',
        keywords: ['网站', '这个页面', '网页', '站点', '怎么做的', '做的'],
        replies: [
          '手写的。HTML、CSS、JavaScript，没有框架，没有模板。他说"得是自己能讲清楚的东西"。',
          '从头做了一遍。第一版简陋到他不好意思给别人看，于是推翻重来——才有现在的星庭。',
          '你点一下空白处试试，会炸开星环。这个是他折腾了很久才满意的。'
        ]
      },
      {
        id: 'stars', chips: '星星是你加的吗',
        keywords: ['星星', '星空', '星环', '流星', '彗星', '点一下'],
        replies: [
          '嗯。他为了这些星星熬到很晚，还专门修过一次"看起来不动"的毛病。',
          '星星是真的——背景那张是 NASA 拍的。上面飘的这些才是他画的。',
          '随手点一下页面，会有星环炸开。他说这是给路过的人准备的小礼物。'
        ]
      },
      {
        id: 'chess', chips: '你下棋怎么样',
        keywords: ['棋', '象棋', '围棋', '下棋', '棋艺'],
        replies: [
          '落子前先算后面三步——这是他写在页面上的话，也是他真正在做的事。',
          '他下棋很稳。输了不急着翻盘，先复盘。这点比大多数人强。',
          '急的人先输。这句话他吃过亏才写下来的。'
        ]
      },
      {
        id: 'game', chips: '玩什么游戏',
        keywords: ['游戏', '打游戏', '玩什么', 'steam', '策略'],
        replies: [
          '策略类。一局能琢磨一晚上，反复想"要是当时换一步会怎样"。',
          '他玩得很慢，慢到别人都以为他在挂机。其实是在算。',
          '玩着玩着就开始好奇"这东西怎么做出来的"——后来就有了这一页。'
        ]
      },
      {
        id: 'dress', chips: '听说你喜欢女装？',
        keywords: ['女装', '裙子', '穿搭', '蕾丝', '版型'],
        replies: [
          '喜欢。这不是什么需要解释的事——好看的东西不该分性别。',
          '版型、配色、蕾丝走向，我研究得挺认真。跟他写代码时一个毛病：细节控。',
          '穿得开心就是最好的理由。你要问"为什么"，那说明你还没想通。'
        ]
      },
      {
        id: 'sweet', chips: '你爱吃什么',
        keywords: ['吃', '甜', '桂花糖', '糖', '点心', '零食', '蜜饯'],
        replies: [
          '桂花糖。……不是我想吃，是路上那摊卖得可怜，顺手买的。',
          '点心。宫里那套规矩太多，摆得再好看也没味道。',
          '有人问我兜里为什么总揣着糖——我是怕小商贩亏本，懂了没？'
        ]
      },
      {
        id: 'anime', chips: '洛天依',
        keywords: ['洛天依', '二次元', '动漫', '番', '天依'],
        replies: [
          '洛天依。这一页的宝蓝和冰蓝就是从她那里来的。',
          '他写了很多遍她的设定，最后把那份审美搬进了这个页面。',
          '蓝白配色，星空背景——你以为这些是随便挑的？'
        ]
      },
      {
        id: 'music', chips: '背景音乐是什么',
        keywords: ['音乐', '歌', 'bgm', '守护', '奥特曼', '听歌'],
        replies: [
          '《只想守护你》。点右上角那个唱片图标就能听。',
          '歌是"只想守护你 ～理纱之歌～"。他挑了很久才定下来。',
          '有音乐的时候，这片星空会更像真的。你自己听听看。'
        ]
      },
      {
        id: 'school', chips: '你在哪上学',
        keywords: ['学校', '大学', '专业', '沈阳', '丹东', '在哪', '哪里人'],
        replies: [
          '沈阳理工大学，计算机科学与技术。丹东东港人。',
          '在沈阳读书，学计算机。你要是也在东北，冬天就知道什么叫"不想出门"。',
          '坐标辽宁丹东东港。海风很咸，星空倒是很干净。'
        ]
      },
      {
        id: 'contact', chips: '怎么联系他',
        keywords: ['联系', '邮箱', 'qq', '微信', '找你', '怎么找'],
        replies: [
          '邮箱 747693891@qq.com。他有空都会看。',
          '"找到我"那一栏里都写着。留言板也行，他认真看的。',
          'GitHub 是 hagxybu123。偷偷说一句，他挺希望有人来留言的。'
        ]
      },
      {
        id: 'hobby', chips: '他有什么爱好',
        keywords: ['爱好', '兴趣', '喜欢做什么', '平时', '嗜好'],
        replies: [
          '棋艺、二次元、折腾电脑、女装、打游戏。五个爱好，全写在"关于我"里了。',
          '下棋和写代码是同一件事——先想清楚，再动手。',
          '爱好挺杂的。但共同点很明显：都要求他认真对待细节。'
        ]
      },
      {
        id: 'feel', chips: '你心情怎么样',
        keywords: ['心情', '开心吗', '难过', '累', '烦', '郁闷', '压力'],
        replies: [
          '……还好。你要是也不太顺，那就先坐一会儿，星庭不收门票。',
          '累了就歇着。他熬夜写这一页的时候，我也这么劝过他，他不听。',
          '别硬撑着。规矩都能变通，情绪更不用憋着。'
        ]
      },
      {
        id: 'thanks', chips: '谢谢你',
        keywords: ['谢谢', '感谢', '多谢', 'thank'],
        replies: [
          '……不用谢。别用那种眼神看我，我只是顺手。',
          '嗯。你能来，他应该会高兴——我才没有替他高兴。',
          '客气什么。星庭的门一直开着，想来随时来。'
        ]
      },
      {
        id: 'bye', chips: '我先走了',
        keywords: ['再见', '拜拜', '走了', '下线', '晚安', 'bye'],
        replies: [
          '走吧。……下次记得回来。',
          '晚安。星光不息，代码不止。',
          '行。我不送你了——反正我也出不去。'
        ]
      },
      {
        id: 'praise', chips: '这页面真好看',
        keywords: ['好看', '漂亮', '厉害', '牛', '强', '喜欢这个', '不错', '惊艳'],
        replies: [
          '……哼。他改了很多版才到这一步，别夸得太轻巧。',
          '这话他听了会装作不在意，然后偷偷记下来。',
          '眼光不错。不过星星那部分还能更好，他还在调。'
        ]
      },
      {
        id: 'critic', chips: '有点丑',
        keywords: ['丑', '难看', '不行', '烂', '差', '垃圾'],
        replies: [
          '……说吧，哪里不好。他让我记着，改就是了。',
          '审美这东西各有各的。但你得说具体点，不然改不了。',
          '第一版更难看。真的。'
        ]
      },
      {
        id: 'meaning', chips: '什么是星庭',
        keywords: ['星庭', '什么意思', '含义', '为什么叫'],
        replies: [
          '星庭是我住的地方。他给我造了一座，顺便留了门给路过的人。',
          '星是星空，庭是庭院。一个人的院子，开着门。',
          '他名字里有个"逸"，想逃出去；可又造了个庭院，等人进来。矛盾吧？'
        ]
      },
      {
        id: 'ai', chips: '你是真的 AI 吗',
        keywords: ['你是ai', '真的ai', '是不是ai', '人工智能', '大模型', '语言模型', 'chatgpt', 'deepseek', '智能', '模型', '机器人'],
        replies: [
          '不是。我是他写的一段对话表——性格是真的，脑子是预置的。',
          '说实话：我是个本地角色，不会真的思考。但他把我的脾气写得很像样。',
          '静态页面放不下真模型（Key 会被人偷走）。所以你看到的，是他手写的我。'
        ]
      }
    ];

    /* ---- 性格碎片：没命中话题时用 ---- */
    var FALLBACK = [
      '嗯……这个我答不上来。换个说法？',
      '你说的话我记下了。不过这个话题，他可能比我更懂。',
      '唔。要不你点一下页面空白处，看星星炸开的样子？',
      '我听不太懂，但我不装懂——这点比他强。',
      '……你去"关于我"那一栏翻翻？说不定有答案。'
    ];
    var PROMPTS = ['那你呢？', '……继续。', '说吧，我在听。'];

    var greeted = false;
    var history = {};

    function pickReply(text) {
      // 归一化：去掉所有空白与常见标点，避免"你是真的 AI 吗"这类输入因空格而匹配失败
      var q = String(text).toLowerCase().replace(/[\s\u3000·・,，.。!！?？~～:：;；'"“”‘’()（）\[\]【】]/g, '');
      var best = null, bestScore = 0;
      for (var i = 0; i < TOPICS.length; i++) {
        var t = TOPICS[i];
        var score = 0;
        for (var k = 0; k < t.keywords.length; k++) {
          if (q.indexOf(String(t.keywords[k]).toLowerCase()) !== -1) score += t.keywords[k].length;
        }
        // 同分时越靠前的话题优先（越具体的话题排在越前面），保证结果确定
        score = score * 100 - i;
        if (score > bestScore) { bestScore = score; best = t; }
      }
      if (!best || bestScore <= 0) return PICK(FALLBACK);

      history[best.id] = (history[best.id] || 0) + 1;
      var list = best.replies;
      // 同一话题问到第三次，换一句更"熟"的说法
      if (history[best.id] >= 3) {
        return '这个问题你问过 ' + history[best.id] + ' 遍了。……行吧，我再说一次：' + PICK(list);
      }
      return PICK(list);
    }

    function bubble(role, html) {
      var el = document.createElement('div');
      el.className = 'ai-msg ' + (role === 'me' ? 'is-me' : 'is-her');
      if (role === 'me') el.textContent = html;
      else el.innerHTML = html;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }

    function setStatus(txt, typing) {
      if (!status) return;
      status.textContent = txt;
      status.classList.toggle('is-typing', !!typing);
    }

    function typingThen(html, delay) {
      var t = document.createElement('div');
      t.className = 'ai-msg is-her';
      t.innerHTML = '<span class="ai-typing"><i></i><i></i><i></i></span>';
      log.appendChild(t);
      log.scrollTop = log.scrollHeight;
      setStatus('正在想…', true);
      window.setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
        bubble('her', html);
        setStatus('在线 · 想聊点什么？', false);
      }, delay || (420 + Math.random() * 520));
    }

    function renderChips(list) {
      if (!chips) return;
      chips.innerHTML = '';
      list.forEach(function (label) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', function () { send(label); });
        chips.appendChild(b);
      });
    }

    function send(text) {
      var msg = String(text || '').trim();
      if (!msg) return;
      bubble('me', msg);
      input.value = '';
      typingThen(pickReply(msg));
    }

    function open() {
      panel.hidden = false;
      dock.classList.add('is-open');
      launcher.setAttribute('aria-expanded', 'true');
      if (!greeted) {
        greeted = true;
        typingThen('……你来了。星庭今天没什么人，随便看看吧。<br>想问我什么就问，我不一定答，答了就一定是真的。', 700);
      }
      window.setTimeout(function () { try { input.focus(); } catch (e) {} }, 120);
    }

    function close() {
      panel.hidden = true;
      dock.classList.remove('is-open');
      launcher.setAttribute('aria-expanded', 'false');
    }

    launcher.addEventListener('click', function () { panel.hidden ? open() : close(); });
    if (closeBtn) closeBtn.addEventListener('click', close);
    form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) close();
    });

    renderChips(['你是谁', '这网站怎么做的', '听说你喜欢女装？', '你爱吃什么']);
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
      ['留言板', initGuestbook],
      ['背景音乐', initMusic],
      ['AI 形象互动', initAI],
      ['开场页', initEntry],
      ['进入按钮', initEnterButton]
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
