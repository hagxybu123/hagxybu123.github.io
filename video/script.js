/* ==========================================================
   时间轴驱动的「网页短视频」
   ----------------------------------------------------------
   每一幕用 { t: 开始秒, d: 持续秒, html: 内容, cls: 样式 } 描述，
   t 是绝对时间点，不是间隔，改起来不容易算错。

   全程 48 秒，与口播脚本一致。
   ========================================================== */
(function () {
  "use strict";

  // 总时长（秒）。比最后一句的结束时间略长，
  // 让收尾那句能停住一会儿再切到提问画面，不会一闪就消失。
  var TOTAL = 50.5;

  var SCENES = [
    { t: 0.0,  d: 3.4, html: "所有关系，<br>都在自动变淡。", cls: "beat" },

    { t: 3.4,  d: 2.4, html: "热力学第二定律", cls: "small" },
    { t: 5.8,  d: 2.4, html: "ΔS ≥ 0", cls: "formula" },
    { t: 8.2,  d: 4.6, html: "一个孤立系统，<br>熵不会减少。", cls: "strong" },

    { t: 12.8, d: 4.6, html: "<span>房间会乱</span><span>绳子会打结</span><span>耳机线会缠成一团</span>", cls: "stagger" },

    { t: 17.4, d: 3.2, html: "只要不管它，<br>一切都会自己乱掉。", cls: "" },
    { t: 20.6, d: 2.6, html: "没人教过它们。", cls: "small" },

    { t: 23.2, d: 4.2, html: "你和一个人不再联系，<br>不需要任何理由。", cls: "" },
    { t: 27.4, d: 3.4, html: "没有吵架，没有背叛，<br>只是各自忙起来。", cls: "" },

    { t: 30.8, d: 3.0, html: "这不是谁的错。", cls: "strong" },
    { t: 33.8, d: 2.4, html: "这是定律。", cls: "beat" },

    { t: 36.2, d: 3.0, html: "熵增不需要原因，<br>减熵才需要。", cls: "" },
    { t: 39.2, d: 3.0, html: "还留在你生活里的人，<br>不是「恰好还在」。", cls: "" },

    { t: 42.2, d: 3.4, html: "是有人<br>一直在做功。", cls: "beat" },

    { t: 45.6, d: 4.9, html: "上一次我为这段关系做功，<br>是什么时候？", cls: "small" }
  ];

  var frame = document.getElementById("frame");
  var holder = document.getElementById("lines");
  var bar = document.getElementById("bar");
  var startBtn = document.getElementById("start");
  var endBox = document.getElementById("end");
  var againBtn = document.getElementById("again");

  var nodes = [];
  var rafId = null;
  var t0 = 0;
  var running = false;
  var started = false;

  // ---------- 构建 DOM ----------
  SCENES.forEach(function (sc, i) {
    var el = document.createElement("div");
    el.className = "line " + (sc.cls || "");
    el.innerHTML = sc.html;
    el.setAttribute("data-i", String(i));
    holder.appendChild(el);
    nodes.push(el);
  });

  // ---------- 主循环 ----------
  function tick(now) {
    if (!running) return;

    var el = (now - t0) / 1000;

    // 进度条
    var p = Math.min(el / TOTAL, 1) * 100;
    bar.style.width = p.toFixed(2) + "%";

    // 逐幕显隐：当前时间落在 [t, t+d) 内则显示
    for (var i = 0; i < SCENES.length; i++) {
      var sc = SCENES[i];
      var on = el >= sc.t && el < sc.t + sc.d;
      if (on !== (nodes[i].classList.contains("on"))) {
        nodes[i].classList.toggle("on", on);
      }
    }

    // 结束
    if (el >= TOTAL) {
      finish();
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  function finish() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    bar.style.width = "100%";
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove("on");
    endBox.classList.add("on");
  }

  function play() {
    // 清空状态
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove("on");
    endBox.classList.remove("on");
    bar.style.width = "0%";

    startBtn.classList.add("hide");
    started = true;
    running = true;
    t0 = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // ---------- 交互 ----------
  startBtn.addEventListener("click", play);
  againBtn.addEventListener("click", play);

  // 空格 / 回车也能开始
  document.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Enter") {
      if (!started || !running) {
        e.preventDefault();
        play();
      }
    }
  });

  // 切到后台时暂停，回来时从暂停处续播（避免后台继续走时间）
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (running) {
        stop();
        pausedAt = (performance.now() - t0) / 1000;
        wasRunning = true;
      }
    } else if (wasRunning) {
      wasRunning = false;
      running = true;
      t0 = performance.now() - pausedAt * 1000;
      rafId = requestAnimationFrame(tick);
    }
  });

  var pausedAt = 0;
  var wasRunning = false;

  // 打开即自动播放。页面没有音频轨道，浏览器的自动播放限制不适用，
  // 因此不需要用户点击。起始按钮仅在自动播放被环境阻断时作为兜底。
  window.addEventListener("load", function () {
    startBtn.classList.add("hide");
    setTimeout(play, 350);
  });
})();
