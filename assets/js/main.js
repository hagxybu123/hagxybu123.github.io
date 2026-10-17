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

  /* ---------------------------------------------------------------- 自检
     用于把"页面到底跑成什么样"直接暴露给用户，而不是靠猜或控制台。
     skyCtx / skyCanvas 由 initSky 填入，供 drawSelfCheck 读取真实像素。 */
  var skyCtx = null, skyCanvas = null;
  var skyNotes = [];
  function skyNote(msg) {
    skyNotes.push(msg);
    try {
      var st = document.getElementById('buildStamp');
      if (st) st.textContent = 'v5 · 2026-10-16 · ⚠ ' + msg;
    } catch (e) {}
  }

  /* 读取画布真实像素，判断星空是否真的画出来了。
     判据说明：不能用"亮像素占比" —— 2px 的星点在 1600x900 画布上占比极低，
     正常的星空也会被判成"几乎是黑的"（本项目真的误判过一次）。
     改为看**最亮的那批像素有多亮**：有星星 -> 顶端会明显高亮；
     全黑画布 -> 最亮的也只有个位数。 */
  function drawSelfCheck() {
    var res = { peak: 0, sky: false, note: '' };
    try {
      if (!skyCtx || !skyCanvas) { res.note = '画布未初始化'; return res; }
      var w = skyCanvas.width, h = skyCanvas.height;
      if (!w || !h) { res.note = '画布尺寸为 0'; return res; }
      var data = skyCtx.getImageData(0, 0, w, h).data;
      var hist = new Array(256).fill(0);
      var total = 0;
      // 抽样统计亮度直方图
      for (var i = 0; i < data.length; i += 4 * 7) {
        var lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        hist[Math.min(255, Math.round(lum))]++;
        total++;
      }
      if (!total) { res.note = '画布无像素'; return res; }
      // 取亮度最高的 1% 像素作为"星点"代表
      var need = Math.max(1, Math.round(total * 0.01));
      var acc = 0, cut = 255;
      for (var v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= need) { cut = v; break; } }
      res.peak = cut;
      res.sky = cut >= 90;
      res.note = res.sky
        ? '星空已绘制（最亮像素 ' + cut + '/255）'
        : '画布几乎是黑的（最亮仅 ' + cut + '/255）';
    } catch (e) {
      res.note = '无法读取画布像素：' + (e && e.name ? e.name : '未知');
    }
    return res;
  }

  /* ---------------------------------------------------------------- 星野 */
  function initSky() {
    var canvas = $('#sky');
    if (!canvas) { skyNote('找不到画布元素'); return; }
    var ctx = canvas.getContext('2d');
    if (!ctx) { skyNote('浏览器未能创建 2D 画布上下文'); return; }

    // Canvas 可用：淡出 CSS 静态星点兜底层
    document.documentElement.classList.add('sky-live');
    skyCtx = ctx;
    skyCanvas = canvas;

    /* 精灵缓存必须在最前面声明并赋值：palette() 与 auroraSprite() 在文件更早的
       位置就会被调用，而 var 只提升声明不提升赋值——放后面会静默拿到 undefined。 */
    var spriteCache = {};

    /* ---- 光晕精灵缓存 ----------------------------------------------------
       原来每颗星每帧都调用 createRadialGradient，560 颗星 = 每秒创建几万个
       渐变对象，跑久了渲染管线会卡顿撕裂（表现为闪屏）。
       改为把光晕预渲染成小图，之后只做 drawImage —— 快几十倍。            */
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
    var trail = [];          // 按住拖动画出的星屑
    var painting = false;
    var lastPaint = 0;
    var aurora = [];         // 极光帘幕
    var auroraT = 0;
    var shafts = [];         // 深空漫射光柱（体积光）
    var coreGlow = 0;        // 中心辉光呼吸相位
    var w = 0, h = 0, dpr = 1;
    var scrollY = window.scrollY || 0;
    var mx = -9999, my = -9999;
    var last = 0, acc = 0;
    var cometAt = 0;
    var frameId = null;

    function resize() {
      /* 手机上把画布分辨率压到 1.5 倍，桌面保持 2 倍。
         原因（实测数据）：手机 dpr=3 时画布是 1170x2532，而本场景每帧要叠加
         4 道 lighter 混合层（星云/极光/光柱/星点）。手机的瓶颈不是绘制调用数
         （实测仅 596/帧，远低于预算），而是**填充率** —— 每个像素被混合 4 次，
         GPU 吞吐不足就会掉帧撕裂，也就是用户反馈的"闪屏"。
         画布内容本身就是柔和光晕，1.5 倍与 3 倍在观感上几乎无差别。 */
      var isNarrow = window.innerWidth < 760;
      var maxDpr = isNarrow ? 1.5 : 2;
      dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
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

      // 极光帘幕：几道缓慢横向漂移的竖直柔光，每道独立呼吸
      // 手机上只留 1 道：每道都是半屏以上的混合层，填充率优先
      aurora = [];
      var auroraDefs = mobile
        ? [[0.42, '160, 245, 225']]
        : [[0.16, '150, 255, 220'], [0.44, '205, 232, 255'], [0.72, '198, 178, 255'], [0.89, '255, 190, 220']];
      for (var au = 0; au < auroraDefs.length; au++) {
        aurora.push({
          x: w * auroraDefs[au][0],
          rgb: auroraDefs[au][1],
          wd: rnd(w * 0.16, w * 0.30),
          ht: rnd(h * 0.52, h * 0.82),
          baseY: h + rnd(6, 40),
          vx: rnd(0.045, 0.14) * (Math.random() > 0.5 ? 1 : -1),
          ph: Math.random() * Math.PI * 2,
          sp: rnd(0.004, 0.011),
          // 背景压暗后有了空间，极光可以更明显一点（氛围感主力）
          a: rnd(0.46, 0.78)
        });
      }

      /* 深空漫射光柱：几道斜向的柔光，缓慢明灭（氛围感主力之一）
         手机上直接关掉：它几乎铺满全屏（ht 达 1.0~1.5 倍视高），
         是全屏级别的 lighter 混合层。手机闪屏的根因是填充率而非绘制调用数，
         所以优先砍掉这类"满屏混合"，视觉差异很小但填充率下降明显。 */
      shafts = [];
      var shaftDefs = mobile ? [] : [[0.18, -16, '150, 200, 255'], [0.42, -7, '205, 232, 255'],
           [0.63, 8, '198, 178, 255'], [0.86, 15, '255, 190, 220']];
      for (var sh = 0; sh < shaftDefs.length; sh++) {
        shafts.push({
          x: w * shaftDefs[sh][0],
          deg: shaftDefs[sh][1],
          rgb: shaftDefs[sh][2],
          wd: rnd(w * 0.10, w * 0.22),
          ht: rnd(h * 1.0, h * 1.5),
          ph: Math.random() * Math.PI * 2,
          sp: rnd(0.0025, 0.007),
          a: rnd(0.14, 0.26)
        });
      }

      // 星云：亮色云团（中心实、边缘透），是"星光感"的主体
      // 每个云团都是一个覆盖大半屏的径向混合层 —— 手机上只留 2 个
      clouds = mobile
        ? [
            { x: w * 0.22, y: h * 0.26, r: Math.max(w, h) * 0.46, vx: 0.020, vy: 0.011, c: [104, 152, 255], a: 0.92 },
            { x: w * 0.78, y: h * 0.62, r: Math.max(w, h) * 0.42, vx: -0.014, vy: 0.012, c: [178, 118, 250], a: 0.80 }
          ]
        : [
            { x: w * 0.18, y: h * 0.24, r: Math.max(w, h) * 0.44, vx: 0.022, vy: 0.011, c: [104, 152, 255], a: 0.92 },
            { x: w * 0.82, y: h * 0.18, r: Math.max(w, h) * 0.40, vx: -0.016, vy: 0.013, c: [178, 118, 250], a: 0.86 },
            { x: w * 0.55, y: h * 0.72, r: Math.max(w, h) * 0.48, vx: 0.012, vy: -0.015, c: [64, 186, 240], a: 0.78 },
            { x: w * 0.42, y: h * 0.12, r: Math.max(w, h) * 0.30, vx: -0.010, vy: 0.014, c: [242, 205, 140], a: 0.55 }
          ];
    }

    function palette(hue) {
      if (hue === 'gold') return '255, 232, 168';
      if (hue === 'ice') return '205, 232, 255';
      if (hue === 'violet') return '198, 178, 255';
      if (hue === 'rose') return '255, 190, 220';
      return '255, 255, 255';
    }

    /* 体积光柱精灵：一条竖直的柔光，用于斜着拉伸成"深空漫射光"。
       同样预渲染，帧循环只做 drawImage。 */
    function shaftSprite(rgb) {
      if (!spriteCache) spriteCache = {};
      var key = 'shaft|' + rgb;
      var s = spriteCache[key];
      if (s) return s;
      var c = document.createElement('canvas');
      c.width = 64; c.height = 256;
      var g = c.getContext('2d');
      if (!g) return null;
      var v = g.createLinearGradient(0, 256, 0, 0);
      v.addColorStop(0, 'rgba(' + rgb + ', 0.85)');
      v.addColorStop(0.5, 'rgba(' + rgb + ', 0.30)');
      v.addColorStop(1, 'rgba(' + rgb + ', 0)');
      g.fillStyle = v;
      g.fillRect(0, 0, 64, 256);
      g.globalCompositeOperation = 'destination-in';
      var h = g.createLinearGradient(0, 0, 64, 0);
      h.addColorStop(0, 'rgba(0,0,0,0)');
      h.addColorStop(0.5, 'rgba(0,0,0,1)');
      h.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = h;
      g.fillRect(0, 0, 64, 256);
      spriteCache[key] = c;
      return c;
    }
    function auroraSprite(rgb) {
      if (!spriteCache) spriteCache = {};
      var key = 'aurora|' + rgb;
      var s = spriteCache[key];
      if (s) return s;
      var c = document.createElement('canvas');
      c.width = 128; c.height = 256;
      var g = c.getContext('2d');
      if (!g) return null;
      // 竖直渐变：底部亮、向上散开
      var v = g.createLinearGradient(0, 256, 0, 0);
      v.addColorStop(0, 'rgba(' + rgb + ', 0.55)');
      v.addColorStop(0.35, 'rgba(' + rgb + ', 0.28)');
      v.addColorStop(1, 'rgba(' + rgb + ', 0)');
      g.fillStyle = v;
      g.fillRect(0, 0, 128, 256);
      // 横向柔边：两侧淡出，避免出现直边
      g.globalCompositeOperation = 'destination-in';
      var hgr = g.createLinearGradient(0, 0, 128, 0);
      hgr.addColorStop(0, 'rgba(0,0,0,0)');
      hgr.addColorStop(0.5, 'rgba(0,0,0,1)');
      hgr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = hgr;
      g.fillRect(0, 0, 128, 256);
      spriteCache[key] = c;
      return c;
    }

    /* 流星：氛围感的主角。分两种——
       big   : 长尾大流星，慢、亮、拖尾长，偶尔来一颗就够惊艳
       small : 短促小流星，快、细、滑过即走，用来撑"流星雨"的密度
       两者都走预渲染精灵画头部，拖尾用实心描边分段，零每帧渐变创建。 */
    function spawnComet(force) {
      if (comets.length >= 7) return;
      var big = force === 'big' || (force !== 'small' && Math.random() < 0.34);
      var fromLeft = Math.random() > 0.35;
      var ang = fromLeft ? rnd(0.28, 0.62) : rnd(Math.PI - 0.62, Math.PI - 0.28);
      var roll = Math.random();
      comets.push({
        x: fromLeft ? rnd(-w * 0.25, w * 0.6) : rnd(w * 0.45, w * 1.25),
        y: rnd(-h * 0.08, h * 0.6),
        ang: ang,
        speed: big ? rnd(6, 10) : rnd(11, 20),
        len: big ? rnd(280, 520) : rnd(90, 200),
        life: 1,
        decay: big ? rnd(0.0032, 0.0052) : rnd(0.0075, 0.014),
        width: big ? rnd(2.0, 3.6) : rnd(1.0, 2.0),
        // 金色约占四成，"金色星光"成为主视觉；大流星偏向金白
        hue: roll > (big ? 0.52 : 0.62) ? 'gold' : (roll > 0.15 ? 'ice' : 'violet'),
        big: big
      });
    }

    // 点击爆开：星环冲击波 + 中心闪光 + 四散金蓝星火
    function addSpark(x, y) {
      // 粒子总量上限：狂点也不至于把渲染拖垮（闪屏的另一诱因）
      if (sparks.length > 420) sparks.splice(0, sparks.length - 420);
      if (rings.length > 24) rings.splice(0, rings.length - 24);

      // 整片星空会"回应"你：随机唤醒几颗远处的星一起亮一下
      if (stars.length) {
        var wake = 3 + Math.floor(Math.random() * 4);
        for (var wk = 0; wk < wake; wk++) {
          var rs = stars[(Math.random() * stars.length) | 0];
          if (!rs) continue;
          rs.echo = 1;
          rs.echoDecay = rnd(0.012, 0.03);
        }
      }

      // ① 三道扩散星环，速度与粗细各异，形成冲击波层次
      rings.push({ x: x, y: y, life: 1, r: 0, grow: rnd(4.6, 6.2), decay: rnd(0.016, 0.022), w: 5.0, hue: 'gold' });
      rings.push({ x: x, y: y, life: 1, r: 10, grow: rnd(3.0, 4.0), decay: rnd(0.020, 0.027), w: 3.4, hue: 'ice' });
      rings.push({ x: x, y: y, life: 1, r: 22, grow: rnd(1.8, 2.6), decay: rnd(0.026, 0.034), w: 2.2, hue: 'white' });

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

    /* 自适应画质：连续掉帧就降低星空密度。
       参数按设备分档 —— 手机 GPU 弱得多，需要更早、更狠地降级。
       用户实测反馈"手机还是会闪"，说明原来的 90 帧门槛 + 25% 步长太保守。 */
    var isMobileDevice = window.innerWidth < 760;
    var slowStreak = 0, quality = 1;
    var SLOW_MS = isMobileDevice ? 26 : 34;         // 超过这个帧时长算掉帧
    var SLOW_LIMIT = isMobileDevice ? 30 : 90;      // 连续多少帧后降级
    var QUALITY_STEP = isMobileDevice ? 0.34 : 0.25;
    var QUALITY_FLOOR = isMobileDevice ? 0.22 : 0.35;
    // 帧率上限：15ms 约 60fps，用于拦住 120Hz 高刷屏的翻倍负载。
    // 手机上放宽到 12ms，避免与 60Hz 刷新周期打架导致偶发跳帧（那也是"闪"的来源之一）。
    var FRAME_FLOOR = isMobileDevice ? 12 : 15;

    function frame(ts) {
      if (!last) last = ts;
      var rawDt = ts - last;

      if (rawDt < FRAME_FLOOR) {
        frameId = window.requestAnimationFrame(frame);
        return;
      }
      last = ts;
      var dt = rawDt > 50 ? 2 : rawDt / 16.67;

      if (rawDt > SLOW_MS) {
        slowStreak++;
        if (slowStreak > SLOW_LIMIT && quality > QUALITY_FLOOR) {
          quality -= QUALITY_STEP;
          slowStreak = 0;
          var keep = Math.max(40, Math.round(stars.length * quality));
          if (keep < stars.length) stars.length = keep;
          var keepDrift = Math.max(16, Math.round(drift.length * quality));
          if (keepDrift < drift.length) drift.length = keepDrift;
          // 手机上同时砍掉云团（每个都是大半屏的混合层）
          if (isMobileDevice && clouds.length > 1) clouds.length = clouds.length - 1;
          if (window.console && console.info) {
            console.info('[星庭] 检测到持续掉帧，已自动降低星空密度到 ' + Math.round(quality * 100) + '%');
          }
        }
      } else if (slowStreak > 0) {
        slowStreak--;
      }

      ctx.clearRect(0, 0, w, h);

      // 深空漫射光柱：斜向柔光缓慢明灭，最底层
      if (shafts.length) {
        coreGlow += dt;
        ctx.globalCompositeOperation = 'lighter';
        for (var sf = 0; sf < shafts.length; sf++) {
          var sk = shafts[sf];
          sk.ph += sk.sp * dt;
          var spr2 = shaftSprite(sk.rgb);
          if (!spr2) continue;
          var breathe2 = 0.55 + 0.45 * Math.sin(sk.ph);
          ctx.globalAlpha = sk.a * breathe2;
          ctx.save();
          ctx.translate(sk.x, 0);
          ctx.rotate(sk.deg * Math.PI / 180);
          ctx.drawImage(spr2, -sk.wd / 2, -sk.ht * 0.25, sk.wd, sk.ht);
          ctx.restore();
          ctx.globalAlpha = 1;
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // 极光帘幕：最底层，几道慢慢漂移的柔光柱（全部用预渲染精灵，零渐变创建）
      if (aurora.length) {
        auroraT += dt;
        ctx.globalCompositeOperation = 'lighter';
        for (var ai = 0; ai < aurora.length; ai++) {
          var ab = aurora[ai];
          ab.x += ab.vx * dt;
          ab.ph += ab.sp * dt;
          if (ab.x < -ab.wd) ab.x = w + ab.wd;
          if (ab.x > w + ab.wd) ab.x = -ab.wd;
          var spr = auroraSprite(ab.rgb);
          if (!spr) continue;
          var breathe = 0.62 + 0.38 * Math.sin(ab.ph);
          ctx.globalAlpha = ab.a * breathe * 0.78;
          ctx.drawImage(spr, ab.x - ab.wd / 2, ab.baseY - ab.ht, ab.wd, ab.ht);
          ctx.globalAlpha = 1;
        }
        ctx.globalCompositeOperation = 'source-over';
      }

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
        g.addColorStop(0, 'rgba(' + cc + ', ' + Math.min(1, cl.a * pulse * 0.40).toFixed(3) + ')');
        g.addColorStop(0.30, 'rgba(' + cc + ', ' + (cl.a * pulse * 0.34).toFixed(3) + ')');
        g.addColorStop(0.62, 'rgba(' + cc + ', ' + (cl.a * pulse * 0.15).toFixed(3) + ')');
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
        var da = p.a * (0.7 + 0.5 * Math.sin(p.ph));
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
        // 远处星星的"回应"：你点击时被唤醒，然后慢慢暗回去
        if (st.echo > 0) {
          st.echo -= (st.echoDecay || 0.02) * dt;
          if (st.echo < 0) st.echo = 0;
          boost = Math.max(boost, st.echo * 0.75);
        }

        var alpha = Math.min(1, st.a + boost);
        var col = palette(st.hue);
        var radius = st.r * (1 + boost);

        ctx.globalCompositeOperation = 'lighter';

        // ① 外层彩色光晕：改用预渲染精灵（原来每帧新建渐变，是闪屏主因）
        var glowR = radius * (st.flare ? 13 : 7);
        halo(col, st.x, y, glowR, alpha * 1.0);

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
        ctx.fillStyle = 'rgba(255, 255, 255, ' + Math.min(1, alpha * 1.3).toFixed(3) + ')';
        ctx.arc(st.x, y, radius * 0.82, 0, Math.PI * 2);
        ctx.fill();

        // ④ 再补一层色彩，让色相透出来
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + col + ', ' + Math.min(1, alpha * 1.1).toFixed(3) + ')';
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

        // 大流星额外加一层更宽的柔光，让拖尾有厚度（氛围感的关键）
        if (cm.big) {
          ctx.globalAlpha = 0.22 * cm.life;
          ctx.strokeStyle = grad;
          ctx.lineWidth = cm.width * 3.4;
          ctx.beginPath();
          ctx.moveTo(cm.x, cm.y);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // 头部光晕：预渲染精灵。大流星更亮更大
        var headR = cm.big ? 46 : 26;
        halo('255, 255, 255', cm.x, cm.y, headR, Math.min(1, (cm.big ? 1.5 : 1.25) * cm.life));
        halo(col2, cm.x, cm.y, headR * 0.72, (cm.big ? 0.8 : 0.55) * cm.life);

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
        ctx.strokeStyle = 'rgba(' + rc + ', ' + Math.min(1, rn.life * 1.45).toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.6, rn.w * rn.life);
        ctx.beginPath();
        ctx.arc(rn.x, rn.y, rn.r, 0, Math.PI * 2);
        ctx.stroke();
        // 环外一圈柔光，让冲击波有厚度
        ctx.strokeStyle = 'rgba(' + rc + ', ' + (rn.life * 0.38).toFixed(3) + ')';
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
        ctx.fillStyle = 'rgba(' + scol + ', ' + (sp.life * 0.45).toFixed(3) + ')';
        ctx.arc(sp.x, sp.y, 6 * sp.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255, 255, 255, ' + Math.min(1, sp.life * 1.25).toFixed(3) + ')';
        ctx.arc(sp.x, sp.y, 2.6 * sp.life, 0, Math.PI * 2);
        ctx.fill();
      }

      // 按住拖动画出的星屑
      // 关键改动：不再只画"一堆独立光点"（实测那样太容易看不见），
      // 而是把拖过的相邻两点连成一条光带 —— 丝带 + 高光 + 发亮的头部，
      // 即使半透明也能一眼看出"星星跟着手走"。
      if (trail.length) {
        // 先推进生命周期并清理过期的
        for (var tr = trail.length - 1; tr >= 0; tr--) {
          var tp = trail[tr];
          tp.life -= 0.0028 * dt;        // 约 6 秒寿命
          tp.ph += 0.07 * dt;
          if (tp.life <= 0) trail.splice(tr, 1);
        }

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // ① 光带主体：相邻点连线，越靠后越细越淡
        for (var s1 = trail.length - 1; s1 > 0; s1--) {
          var a1 = trail[s1], b1 = trail[s1 - 1];
          var la = a1.life;
          if (la <= 0) continue;
          var dxs = b1.x - a1.x, dys = b1.y - a1.y;
          if (dxs * dxs + dys * dys > 40000) continue;   // 跨度太大（换手/跳点）不连
          // 外层柔光
          ctx.strokeStyle = 'rgba(' + palette(a1.hue) + ', ' + (la * 0.82).toFixed(3) + ')';
          ctx.lineWidth = Math.max(2.4, (7 + a1.r * 3.2) * la);
          ctx.beginPath();
          ctx.moveTo(a1.x, a1.y);
          ctx.lineTo(b1.x, b1.y);
          ctx.stroke();
          // 内层高光：白芯，让光带中间是亮的
          ctx.strokeStyle = 'rgba(255, 255, 255, ' + (la * 0.95).toFixed(3) + ')';
          ctx.lineWidth = Math.max(1.6, (1.8 + a1.r * 0.8) * la);
          ctx.beginPath();
          ctx.moveTo(a1.x, a1.y);
          ctx.lineTo(b1.x, b1.y);
          ctx.stroke();
        }

        // ② 每个落点再点一颗星：光带有"颗粒感"，不只是平滑的线
        for (var s2 = 0; s2 < trail.length; s2++) {
          var tp2 = trail[s2];
          if (tp2.life <= 0) continue;
          var breath = 0.66 + 0.34 * Math.sin(tp2.ph);
          var talpha = tp2.life * breath;
          halo(palette(tp2.hue), tp2.x, tp2.y, tp2.r * 15, talpha * 1.9);
          ctx.fillStyle = 'rgba(255, 255, 255, ' + Math.min(1, talpha * 1.5).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(tp2.x, tp2.y, tp2.r * 0.5 * tp2.life + 1.2, 0, Math.PI * 2);
          ctx.fill();
        }

        // ③ 笔尖：最新那点的头部更亮，像一颗正在划过的流星
        var tip = trail[trail.length - 1];
        if (tip && tip.life > 0) {
          halo('255, 255, 255', tip.x, tip.y, tip.r * 22, Math.min(1, tip.life * 1.5));
          halo('255, 232, 168', tip.x, tip.y, tip.r * 8, Math.min(1, tip.life * 0.9));
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      // 流星节奏：常态约 1.4~2.6 秒来一批，一批 1~2 颗；
      // 另有一成概率触发"流星雨"——短时间连发 4~6 颗，其中一颗必为大流星。
      acc += rawDt;
      if (acc > cometAt) {
        var shower = Math.random() < 0.1;
        if (shower) {
          var burst = 4 + Math.floor(Math.random() * 3);
          for (var cb = 0; cb < burst; cb++) spawnComet(cb === 0 ? 'big' : 'small');
          cometAt = rnd(2600, 4200);
        } else {
          spawnComet();
          if (Math.random() > 0.42) spawnComet('small');
          cometAt = rnd(1400, 2600);
        }
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
    window.addEventListener('pointerdown', function (e) {
      addSpark(e.clientX, e.clientY);
      painting = true;
      lastPaint = 0;
    }, { passive: true });
    // 按住拖动：沿轨迹画出一串会呼吸的星屑（彩蛋，也是"这片星空可以摸"的证明）
    window.addEventListener('pointerup', function () { painting = false; }, { passive: true });
    window.addEventListener('pointercancel', function () { painting = false; }, { passive: true });
    window.addEventListener('pointermove', function (e) {
      if (!painting) return;
      var now = performance.now();
      if (now - lastPaint < 16) return;      // 限流：最多约每 16ms 落一颗
      lastPaint = now;
      // 上限保护：满了就不再新增（不用 shift 淘汰，避免把刚拖出的痕抹掉）
      if (trail.length >= 260) return;
      trail.push({
        x: e.clientX, y: e.clientY,
        life: 1,
        // 起点更大更亮，肉眼才看得出"星星跟着手走"
        r: rnd(4.4, 10.0),
        ph: Math.random() * Math.PI * 2,
        hue: Math.random() > 0.5 ? 'gold' : (Math.random() > 0.35 ? 'ice' : 'violet')
      });
    }, { passive: true });
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

  /* ------------------------------------------------------------ 留言板
     公用留言板：数据存 textdb.online，所有访客都能看到、都能留言。
     —— 为什么用它：静态站没有后端，需要一个"匿名可读写"的存储。
        实测（2026-10-15）：POST /update 写入 200、GET /{key} 读回、CORS 正确、
        单条可存 5 万字符、无需注册。是唯一通过全部实测的免费方案。
     已知取舍（如实标注，不隐瞒）：
       · 数据 30 天无人访问会被服务方清理（站点有人看就会刷新，实际不触发）
       · 无鉴权：知道这个 key 的人理论上能覆盖数据
         → 因此加了本地冷却、长度上限与条数上限，且每次写入都是
           "读出-合并-写回"，正常使用不会互相覆盖
     —— 若日后要更强的保障，可换成 Supabase（deliverables 里有建表脚本）。 */
  var GB = {
    endpoint: 'https://textdb.online/update',
    readBase: 'https://textdb.online/',
    key: 'tianyi-star-court-guestbook-7k2m9q',
    max: 120,          // 最多保留 120 条
    coolMs: 45000      // 同一浏览器 45 秒冷却
  };
  var STORE_KEY = 'tianyi-guestbook-v1';    // 本地缓存
  var COOL_KEY = 'tianyi-gb-cool';          // 冷却时间戳

  function gbConfigured() { return !!GB.key; }

  /* 带重试的请求：textdb.online 是免费服务，实测会出现"首次请求失败、重试即成功"
     的间歇性抖动（2026-10-15 实测）。没有重试的话访客会直接看到"发送失败"。
     但重试必须受总时长约束：一次提交包含"读取→写入→刷新"三步，若每步都重试 4 次，
     离线时要等十几秒才给出反馈（曾实测到 12 秒以上，按钮一直转）。
     因此用 deadline 把整体等待压在 ~4.5 秒内。 */
  function gbRequest(url, opts, budgetMs) {
    var budget = budgetMs || 2500;
    var deadline = Date.now() + budget;
    var attempt = 0;
    function once() {
      attempt++;
      return fetch(url, opts).then(function (r) {
        if (!r.ok && r.status >= 500 && Date.now() < deadline) throw new Error('HTTP ' + r.status);
        return r;
      }).catch(function (e) {
        var wait = 600 * attempt;
        if (Date.now() + wait >= deadline) throw e;
        return new Promise(function (res) { window.setTimeout(res, wait); }).then(once);
      });
    }
    return once();
  }

  // 读：GET 一个纯文本 JSON 数组；失败时抛错，由上层兜底
  function gbFetch() {
    return gbRequest(GB.readBase + encodeURIComponent(GB.key) + '?t=' + Date.now(), {
      signal: AbortSignal.timeout(15000)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      var s = (txt || '').trim();
      if (!s) return [];
      // 服务端可能返回带引号的 JSON 字符串，做一次兼容解析
      var data;
      try { data = JSON.parse(s); } catch (e) { throw new Error('bad json'); }
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = []; } }
      if (!Array.isArray(data)) data = [];
      return data.filter(function (m) {
        return m && typeof m.name === 'string' && typeof m.text === 'string';
      }).map(function (m) {
        return { name: m.name.slice(0, 24), text: m.text.slice(0, 300), time: Number(m.time) || Date.now() };
      });
    });
  }

  // 写：读出现有 -> 合并新留言 -> 整块写回
  function gbPost(name, text) {
    return gbFetch().then(function (list) {
      list.unshift({ name: name, text: text, time: Date.now() });
      var payload = JSON.stringify(list.slice(0, GB.max));
      var body = new URLSearchParams();
      body.set('key', GB.key);
      body.set('value', payload);
      return gbRequest(GB.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: body.toString(),
        signal: AbortSignal.timeout(20000)
      });
    }).then(function (r) {
      if (!r.ok) {
        var e = new Error('HTTP ' + r.status);
        e.code = 'fail';
        throw e;
      }
      return r.text();
    }).then(function (t) {
      // 服务端成功时返回 {"status":1,...}；status 不为 1 视为失败
      if (t && t.indexOf('"status":1') === -1 && t.indexOf('"status": 1') === -1) {
        var e = new Error('rejected');
        e.code = 'fail';
        throw e;
      }
      return true;
    });
  }

  function gbCooling() {
    try {
      var t = Number(localStorage.getItem(COOL_KEY)) || 0;
      var left = GB.coolMs - (Date.now() - t);
      return left > 0 ? Math.ceil(left / 1000) : 0;
    } catch (e) { return 0; }
  }

  function gbMarkSent() {
    try { localStorage.setItem(COOL_KEY, String(Date.now())); } catch (e) {}
  }

  /* 离线兜底：后端不可用时退回本地存储，页面不白 */
  function readMessages() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function writeMessages(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, GB.max))); } catch (e) {}
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderMessages(data, placeholder) {
    var list = $('#guestList');
    var empty = $('#emptyHint');
    var countEl = $('#guestCount');
    if (!list) return;
    var rows = data || [];
    list.innerHTML = '';

    if (countEl) countEl.textContent = rows.length ? rows.length + ' 条' : '';

    if (placeholder) {
      // 加载中 / 加载失败：给一行灰字，而不是空白，避免让人以为"没有留言"
      var ph = document.createElement('li');
      ph.className = 'g-placeholder';
      ph.textContent = placeholder;
      list.appendChild(ph);
      if (empty) empty.style.display = 'none';
      return;
    }

    rows.forEach(function (m) {
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

    if (empty) empty.style.display = rows.length ? 'none' : 'block';
  }

  // 拉取并渲染；后端没配好或挂了就退回本地缓存，页面不会白掉
  function gbRefresh(showLoading) {
    if (showLoading) renderMessages([], '正在取星简…');
    if (!gbConfigured()) {
      renderMessages(readMessages());
      return Promise.resolve({ offline: true });
    }
    return gbFetch().then(function (rows) {
      writeMessages(rows);                    // 成功时刷新本地缓存
      renderMessages(rows);
      return { online: true, count: rows.length };
    }).catch(function () {
      var cached = readMessages();
      // 提示写清楚一点：多数情况下是"读不到"，而不是"没人留言"
      var hint = cached.length
        ? ''
        : '留言暂时读不到（网络或服务未就绪）—— 你写的留言会送到服务器，别人也能看到';
      renderMessages(cached, hint);
      return { error: true };
    });
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

      var submitBtn = form.querySelector('button[type="submit"]');
      function lock(on) {
        if (submitBtn) submitBtn.disabled = !!on;
        form.classList.toggle('is-sending', !!on);
      }

      // 本地冷却：给个即时反馈，避免白等一次往返
      var cool = gbCooling();
      if (cool > 0) {
        say('发得太快了，等 ' + cool + ' 秒再来 ✦', true);
        return;
      }

      lock(true);
      say('正在送往星庭…');
      gbPost(name.slice(0, 20), text.slice(0, 300)).then(function () {
        gbMarkSent();
        form.reset();
        if (counter) counter.textContent = '0';
        say('星简已送达，所有人都能看到了 ✦');
        return gbRefresh();
      }).catch(function (err) {
        var code = err && err.code;
        if (code === 'rate') say('发得太快了，等一分钟再来 ✦', true);
        else say('没能送出去，检查下网络再试一次 ✦', true);
        return gbRefresh();
      }).then(function () {
        lock(false);
      });
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        // 公用留言不能由访客清空（数据库也不给删的权限），这里只清本地缓存
        try { localStorage.removeItem(STORE_KEY); } catch (e) {}
        say('已清掉本机缓存。星庭上的留言由站主保管，谁也删不掉 ✦');
        gbRefresh();
      });
    }

    gbRefresh(true);
    // 每 45 秒自动同步一次，别人新留的言能自己出现
    window.setInterval(function () {
      if (!document.hidden) gbRefresh();
    }, 45000);
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

    /* ---- 话题库：keywords 命中越多分越高，回复随机取一条 ----
       语气设定：王室少女 · 毒舌傲娇。刀子嘴豆腐心：
       先损你一句，再悄悄把有用的信息塞给你。损的是"事"，不是人。 */
    var TOPICS = [
      {
        id: 'greet', chips: '你好',
        keywords: ['你好', '您好', 'hi', 'hello', '在吗', '在么', '嗨', '哈喽', 'hey'],
        replies: [
          '哟，稀客。……别站着，坐吧，反正这院子也没别人。',
          '嗯，来了。我本来在忙很重要的事——好吧，我在发呆。',
          '你终于开口了。站那儿盯了这么久，我还以为你在研究我的像素。'
        ]
      },
      {
        id: 'who', chips: '你是谁',
        keywords: ['你是谁', '你叫什么', '自我介绍', '介绍一下你', '什么角色', '你是'],
        replies: [
          '天逸。王室的——算了，这头衔说出来也没人信，你看你这表情。',
          '"逸"是逃逸的逸。从别人给我写好的剧本里逃出来，听懂了没？',
          '名字都写在标题上了，你居然还要问。……行吧，我叫天逸，记住了。'
        ]
      },
      {
        id: 'creator', chips: '天逸是谁做的',
        keywords: ['谁做的', '谁创', '作者', '站长', '原型', '谁写', '谁做'],
        replies: [
          '他写的。设定、脾气、连这句嘴硬都是他敲进去的。……想笑就笑，我习惯了。',
          '一个熬夜到天亮、还坚持说"再改一版就好"的人。你说这种人是不是有病？',
          '他把我造出来，然后指望我替他说那些他不好意思说的话。懦弱，但有效。'
        ]
      },
      {
        id: 'site', chips: '这网站怎么做的',
        keywords: ['网站', '这个页面', '网页', '站点', '怎么做的'],
        replies: [
          '手写的。HTML、CSS、JavaScript，一个框架都没用。他说"得是自己讲得清楚的东西"。',
          '第一版丑得他自己都不想看，于是推翻重做。你看到的已经是第 N 版了，别再挑了。',
          '你点一下页面空白处，会炸开星环。他为了这个效果折腾到凌晨——男人至死是少年。'
        ]
      },
      {
        id: 'stars', chips: '星星是你加的吗',
        keywords: ['星星', '星空', '星环', '流星', '彗星', '点一下'],
        replies: [
          '嗯，他加的。星星多到他电脑风扇开始唱歌，他还说"再密一点"。',
          '背景那张是 NASA 拍的实景。上面飘的这些才是他画的——别看错了。',
          '那些星星一闪一闪的，他管这叫"呼吸感"。我看叫"显卡在哀嚎"更准确。'
        ]
      },
      {
        id: 'code', chips: '会写代码吗',
        keywords: ['代码', '编程', 'python', '写程序', '会不会写', 'js', '前端', 'bug'],
        replies: [
          '他写，我在旁边看。变量名起得跟闹着玩似的，我看了三遍才忍住没说话。',
          '会一点。但我更擅长挑毛病——"你这函数是不是该拆了？"他每次都装没听见。',
          '他有个怪癖：报错了不慌，先弄明白为什么。这点……勉强算他厉害。'
        ]
      },
      {
        id: 'chess', chips: '你下棋怎么样',
        keywords: ['棋', '象棋', '围棋', '下棋', '棋艺'],
        replies: [
          '落子前先算三步——他写在页面上的话。可惜生活里他经常只算一步。',
          '他下棋很稳，输急了也不翻脸，先复盘。这点比他写代码时成熟多了。',
          '急的人先输。这话是他输了不知道多少盘才憋出来的，血泪教训。'
        ]
      },
      {
        id: 'game', chips: '玩什么游戏',
        keywords: ['游戏', '打游戏', '玩什么', 'steam', '策略'],
        replies: [
          '策略类，一局能琢磨一晚上。别人以为他挂机了，其实他在算。人菜瘾大。',
          '他玩得很慢。慢到你怀疑他是不是睡着了——然后他突然一步把你将死。',
          '玩着玩着就开始琢磨"这东西怎么做出来的"。然后就有了这一页。也是没救了。'
        ]
      },
      {
        id: 'dress', chips: '听说你喜欢女装？',
        keywords: ['女装', '裙子', '穿搭', '蕾丝', '版型'],
        replies: [
          '喜欢。这事不需要解释——觉得需要解释的人，是自己没想通。',
          '版型、配色、蕾丝走向，他研究得比对代码还认真。你说这算什么优先级？',
          '穿得开心就是最好的理由。你要是想听个"更深层的原因"，那你要失望了。'
        ]
      },
      {
        id: 'sweet', chips: '你爱吃什么',
        keywords: ['吃', '甜', '桂花糖', '糖', '点心', '零食', '蜜饯'],
        replies: [
          '桂花糖。……不是我想吃，是那摊小贩看着可怜。别用那种眼神看我。',
          '点心。宫里摆的那些规矩太多，好看是好看，一点味道都没有。',
          '我兜里常年揣着糖。你要问为什么——我乐意，不行吗？'
        ]
      },
      {
        id: 'anime', chips: '洛天依',
        keywords: ['洛天依', '二次元', '动漫', '番', '天依'],
        replies: [
          '洛天依。这一页的宝蓝和冰蓝就是从她那儿偷来的配色——他说是"致敬"。',
          '他写过很多遍她的设定。写着写着就把审美搬进了这个页面，还觉得自己很隐蔽。',
          '蓝白配色配星空——你以为是随便挑的？天真。'
        ]
      },
      {
        id: 'music', chips: '背景音乐是什么',
        keywords: ['音乐', '歌', 'bgm', '守护', '奥特曼', '听歌'],
        replies: [
          '《只想守护你》。点右上角那个唱片图标——别告诉我你连按钮都找不到。',
          '歌是"只想守护你 ～理纱之歌～"。他挑了很久，久到我以为他在写论文。',
          '有音乐的时候这片星空才像真的。不信你把声音关了点一下星星，差远了。'
        ]
      },
      {
        id: 'school', chips: '你在哪上学',
        keywords: ['学校', '大学', '专业', '沈阳', '丹东', '在哪', '哪里人'],
        replies: [
          '沈阳理工大学，计算机科学与技术。丹东东港人。要查户口吗？',
          '在沈阳读书。东北的冬天你体会过就知道，能不出门就是胜利。',
          '辽宁丹东东港。海风很咸，星空倒是干净——比城里的强多了。'
        ]
      },
      {
        id: 'contact', chips: '怎么联系他',
        keywords: ['联系', '邮箱', 'qq', '微信', '找你', '怎么找'],
        replies: [
          '747693891@qq.com。他会看的——虽然回得慢，慢到你怀疑他掉线了。',
          '"找到我"那一栏写着呢，眼睛是装饰品吗？留言板也行，他真会看。',
          'GitHub 是 hagxybu123。偷偷说：他挺希望有人来留句话的，别让他失望。'
        ]
      },
      {
        id: 'hobby', chips: '他有什么爱好',
        keywords: ['爱好', '兴趣', '喜欢做什么', '平时', '嗜好'],
        replies: [
          '棋艺、二次元、折腾电脑、女装、打游戏。五样，写在"关于我"里，自己看。',
          '下棋和写代码在他眼里是一回事——先想清楚，再动手。可惜他经常想太久。',
          '爱好挺杂。共同点是都很费时间，且都不赚钱。'
        ]
      },
      {
        id: 'feel', chips: '你心情怎么样',
        keywords: ['心情', '开心吗', '难过', '累', '烦', '郁闷', '压力'],
        replies: [
          '……还行。你要是不太顺，就坐会儿，星庭不收门票也不问理由。',
          '累了就歇着。他熬到天亮写这页的时候我也劝过，他不听。你们一个样。',
          '别硬撑。规矩都能变通，情绪更不用憋着——这话我说的，记着。'
        ]
      },
      {
        id: 'thanks', chips: '谢谢你',
        keywords: ['谢谢', '感谢', '多谢', 'thank'],
        replies: [
          '……谢什么。我只是顺手，别自作多情。',
          '嗯。你能来他大概会高兴——我才没有替他高兴，别瞎猜。',
          '客气话就免了。下次记得回来，比说谢谢有用。'
        ]
      },
      {
        id: 'bye', chips: '我先走了',
        keywords: ['再见', '拜拜', '走了', '下线', '晚安', 'bye'],
        replies: [
          '走吧。……门在那儿，不用我指。',
          '晚安。星光不息，代码不止——这话好听吧，我编的。',
          '行，不送。反正我也出不去，只能目送，挺惨的。'
        ]
      },
      {
        id: 'praise', chips: '这页面真好看',
        keywords: ['好看', '漂亮', '厉害', '牛', '强', '喜欢这个', '不错', '惊艳'],
        replies: [
          '……哼。他改了不知道多少版才这样，你一句话就想夸完？',
          '这话他听了会装作不在意，然后半夜偷偷再看一遍。我太了解他了。',
          '眼光还行。不过星星那块还能更好，他还在调——别夸太早。'
        ]
      },
      {
        id: 'critic', chips: '有点丑',
        keywords: ['丑', '难看', '不行', '烂', '差', '垃圾'],
        replies: [
          '……说吧，哪儿不好。他让我记着，我记性比他好。',
          '审美各花入各眼。但你得说具体点，光说"丑"我也没法转达。',
          '第一版比这难看十倍。真的。你现在看到的已经是审美进步的结果了。'
        ]
      },
      {
        id: 'meaning', chips: '什么是星庭',
        keywords: ['星庭', '什么意思', '含义', '为什么叫'],
        replies: [
          '我住的地方。他造了一座，顺手给路过的人留了个门——多此一举，但还行。',
          '星是星空，庭是庭院。一个人的院子，门开着。听着挺矫情，做出来倒不赖。',
          '他名字里有个"逸"，想逃出去；又造了座庭院，等人进来。矛盾得很有水平。'
        ]
      },
      {
        id: 'ai', chips: '你是真的 AI 吗',
        keywords: ['你是ai', '真的ai', '是不是ai', '人工智能', '大模型', '语言模型', 'chatgpt', 'deepseek', '智能', '模型', '机器人'],
        replies: [
          '不是。我是一张对话表，性格是真的，脑子是预置的。失望了？',
          '说实话：我不会思考，只是被写得很像。但他把脾气写对了，这就够了。',
          '静态页面养不起真模型——Key 放前端等于把家门钥匙插在锁上。所以，你看到的是他手写的我。'
        ]
      },
      {
        id: 'roast', chips: '你能损我一句吗',
        keywords: ['损我', '骂我', '毒舌', '吐槽我', '喷我'],
        replies: [
          '可以，但你会后悔。……算了，看你这么诚恳，就免了。',
          '你专门来让人骂？这爱好比我认识的所有人都奇特。',
          '我只损事不损人。你暂时还没做出什么值得我开口的事——继续保持。'
        ]
      },
      {
        id: 'secret', chips: '有什么秘密',
        keywords: ['秘密', '彩蛋', '藏了', '隐藏', '好玩'],
        replies: [
          '页面空白处点一下，会炸开星环。他以为没人会发现——你也别告诉他是我说的。',
          '他在页脚藏了话。自己找，我不当导游。',
          '你按住鼠标在星空中拖一下试试。别说是我让你试的。'
        ]
      }
    ];;

    /* ---- 性格碎片：没命中话题时用（保持毒舌，但损的是事不是人）---- */
    var FALLBACK = [
      '……这问题超纲了。换个说法，或者换个人问。',
      '我记下了，但我不打算假装听懂——这一点比他诚实。',
      '唔。要不你去点一下页面空白处，看星星炸开？比这个话题有意思。',
      '你确定这是在跟我说话？我只是一张对话表，别为难我。',
      '答不上来。承认这件事，比现编一个体面多了。'
    ];
    var PROMPTS = ['……然后呢？', '就这？', '继续，我听着。'];

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
        typingThen('……你来了。星庭今天没什么人，随便看看吧。<br>想问我什么就问，我不一定答，答了就一定是真的。<br><span style="display:inline-block;margin-top:7px;padding:5px 11px;border-radius:999px;background:rgba(242,215,155,.15);border:1px solid rgba(242,215,155,.42);color:#f2d79b;font-size:.86em">✦ 试试按住鼠标在星空里拖动，星星会跟着你走</span>', 700);
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

    /* ------------------------------------------------------------------
       启动自检：把"脚本到底跑起来没有"直接写在左下角的标记上。
       这一步专门用来排查"用户看到的是静态页面"这类问题 ——
       若提示减少动效，动画循环不会启动，星环/拖拽/流星都不会出现。
       ------------------------------------------------------------------ */
    try {
      var stamp = $('#buildStamp');
      var tag = document.querySelector ? document.querySelector('.build-tag') : null;

      // 启动后稍等一下再读画布像素（等第一帧画完）
      window.setTimeout(function () {
        try {
          var chk = drawSelfCheck();
          var parts = ['v5 · 2026-10-16'];
          if (reduceMotion) parts.push('⚠ 系统开启了"减少动态效果"，动画已停用');
          else parts.push('动画已启动');
          parts.push(chk.note);
          if (skyNotes.length) parts.push(skyNotes.join('；'));
          var line = parts.join(' · ');
          if (stamp) stamp.textContent = line;
          if (tag) tag.textContent = line;
          document.title = '天逸 · 星庭 [v5]' + (chk.sky ? ' · 星空正常' : ' · ⚠ ' + chk.note);
        } catch (e) {}
      }, 900);
    } catch (e) {}

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
