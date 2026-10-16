/* ===================================================================
   镜界 JINGJIE · 高级交互层（v5.0）
   —— 水波纹 / 光斑跟随 / 滚动渐显 / 数字滚动 / 视差
   设计原则：渐进增强，任何一步失败都不影响主流程（全部 try/catch 隔离）。
   =================================================================== */

const FX = (() => {
  'use strict';

  const reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. 水波纹：点击带 .btn/.btn-primary/.btn-ghost/.quick 的元素 ---------- */
  function ripple(e) {
    try {
      const host = e.target.closest('.btn, .btn-primary, .btn-ghost, .quick, .tab, .gs-opt');
      if (!host || reduce) return;
      const r = host.getBoundingClientRect();
      const size = Math.max(r.width, r.height);
      const el = document.createElement('span');
      el.className = 'jj-ripple';
      el.style.width = el.style.height = size + 'px';
      el.style.left = (e.clientX - r.left - size / 2) + 'px';
      el.style.top = (e.clientY - r.top - size / 2) + 'px';
      // 确保宿主可容纳绝对定位水波
      const cs = getComputedStyle(host);
      if (cs.position === 'static') host.style.position = 'relative';
      host.appendChild(el);
      setTimeout(() => el.remove(), 640);
    } catch (err) { /* 静默 */ }
  }

  /* ---------- 2. 光斑跟随：卡片内鼠标位置写入 --mx/--my ---------- */
  function glow(e) {
    try {
      const host = e.target.closest('.quick, .card, .report-card');
      if (!host) return;
      const r = host.getBoundingClientRect();
      host.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      host.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    } catch (err) { /* 静默 */ }
  }

  /* ---------- 3. 滚动渐显：IntersectionObserver 给 .reveal 加 .in ---------- */
  function reveal() {
    try {
      const nodes = document.querySelectorAll('.reveal');
      if (!('IntersectionObserver' in window) || reduce) {
        nodes.forEach(n => n.classList.add('in'));
        return;
      }
      const io = new IntersectionObserver((ents) => {
        ents.forEach(en => {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { root: null, threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      nodes.forEach(n => {
        const scroller = n.closest('.scroll');
        if (scroller) io.observe(n);
      });
      // 手机屏内滚动容器用自身作为 root
      const ioScoped = new IntersectionObserver((ents) => {
        ents.forEach(en => {
          if (en.isIntersecting) { en.target.classList.add('in'); ioScoped.unobserve(en.target); }
        });
      }, { root: null, threshold: 0.08 });
      document.querySelectorAll('.scroll').forEach(sc => {
        sc.querySelectorAll('.reveal').forEach(n => { ioScoped.unobserve(n); });
      });
    } catch (err) { /* 静默 */ }
  }

  /* ---------- 4. 数字滚动：给带 data-roll 的元素从 0 滚到目标值 ---------- */
  function rollNumber(el, target, dur) {
    if (!el) return;
    target = parseFloat(target) || 0;
    dur = dur || 900;
    if (reduce) { el.textContent = target; return; }
    const start = performance.now();
    const dec = (String(target).split('.')[1] || '').length;
    function tick(now) {
      const p = Math.min(1, (now - start) / dur);
      // expo-out 缓动，收尾自然
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * e).toFixed(dec);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target.toFixed(dec);
    }
    requestAnimationFrame(tick);
  }

  /* ---------- 5. 首屏微视差：鼠标移动让光晕轻微偏移 ---------- */
  function parallax() {
    if (reduce) return;
    try {
      const orbs = document.querySelectorAll('.orb');
      if (!orbs.length) return;
      let tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
      function loop() {
        cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
        orbs.forEach((o, i) => {
          const k = (i + 1) * 5;
          o.style.translate = `${(cx * k).toFixed(1)}px ${(cy * k).toFixed(1)}px`;
        });
        if (Math.abs(tx - cx) > 0.1 || Math.abs(ty - cy) > 0.1) raf = requestAnimationFrame(loop);
        else raf = null;
      }
      window.addEventListener('mousemove', (e) => {
        tx = (e.clientX / innerWidth - 0.5) * 2;
        ty = (e.clientY / innerHeight - 0.5) * 2;
        if (!raf) raf = requestAnimationFrame(loop);
      }, { passive: true });
    } catch (err) { /* 静默 */ }
  }

  /* ---------- 初始化 ---------- */
  function boot() {
    try { document.addEventListener('pointerdown', ripple, true); } catch (e) {}
    try { document.addEventListener('mousemove', glow, { passive: true }); } catch (e) {}
    try { reveal(); } catch (e) {}
    try { parallax(); } catch (e) {}
    // 页面切换后重新扫描 .reveal（新出现的元素）
    try {
      const obs = new MutationObserver(() => { try { reveal(); } catch (e) {} });
      const pages = document.querySelector('.pages');
      if (pages) obs.observe(pages, { subtree: true, attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return { rollNumber, reveal, boot };
})();
