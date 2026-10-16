/* ===================================================================
   镜界 JINGJIE · 摄像头 UI 桥接层
   职责：
   1. 进入拍摄页自动拉起摄像头，离开时释放
   2. 实时人脸框叠加 + 环境指标刷新
   3. 快门 → 真实抓帧分析 → Advisor 生成方案 → 渲染报告页
   4. 全流程语音播报联动
   =================================================================== */

const CamUI = (() => {

  const st = {
    video: null,
    started: false,      // 是否已成功拉起
    starting: false,
    loopOn: false,
    lightOn: true,
    camIndex: 0,
    cams: [],
    lastAnalysis: null,
    lastPlan: null,
    boxSmooth: null,      // 人脸框平滑
    gesture: false,       // 是否已发生用户手势
    pending: false        // 是否处于"待点击开启"状态
  };

  /* 监听首次用户手势（浏览器要求摄像头授权需在交互后） */
  (function armGesture() {
    const mark = () => {
      st.gesture = true;
      // 若正停留在拍摄页等待手势，则立即启动
      if (st.pending) boot();
      document.removeEventListener('pointerdown', mark, true);
      document.removeEventListener('keydown', mark, true);
      document.removeEventListener('touchstart', mark, true);
    };
    document.addEventListener('pointerdown', mark, true);
    document.addEventListener('keydown', mark, true);
    document.addEventListener('touchstart', mark, true);
  })();

  /* ---------------- 元素 ---------------- */
  const $ = id => document.getElementById(id);

  /* ============================================================
     一、启动 / 停止
     ============================================================ */
  async function boot() {
    st.video = $('camVideo');
    if (!st.video) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('warn', '浏览器不支持摄像头，已切换演示模式');
      fallback();
      return;
    }
    if (!window.isSecureContext) {
      setStatus('warn', '需通过 http(s) 打开才能启用摄像头');
      fallback();
      return;
    }

    // 浏览器要求：摄像头授权必须在用户交互之后。
    // 若尚未发生手势，则进入"待点击开启"状态，等手势到来再真正拉起。
    if (!st.gesture) {
      st.pending = true;
      setStatus('idle', '点击任意处开启摄像头');
      showStartBtn();
      fallback();
      return;
    }

    st.pending = false;
    hideStartBtn();
    // 先直接拉起（触发权限授权，最快路径），成功后再补枚举设备
    await connect();
    if (st.started) enumerate();   // 不 await，仅用于摄像头切换
  }

  async function enumerate() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      st.cams = devs.filter(d => d.kind === 'videoinput');
    } catch (e) { st.cams = []; }
  }

  async function connect(attempt = 0) {
    if (st.starting) return;
    st.starting = true;
    setStatus('load', attempt ? '正在重试连接摄像头…' : '正在启动摄像头…');

    const dev = st.cams[st.camIndex];
    const opts = { width: 1280, height: 960 };
    if (dev?.deviceId) opts.deviceId = { exact: dev.deviceId };

    let timedOut = false;
    const timeout = new Promise((_, rej) =>
      setTimeout(() => { timedOut = true; rej(new Error('TIMEOUT')); }, 6000));

    try {
      await Promise.race([Camera.start(st.video, opts), timeout]);
      st.started = true;
      showVideo(true);
      hideSilhouette();
      hideRetry();

      const s = Camera.getSettings();
      const label = (dev?.label || '前置摄像头').replace(/\(.*?\)/, '').trim();
      setStatus('ok', `${label} · ${s?.width || '—'}×${s?.height || '—'}`);

      startLoop();
      // 延迟 1.2s 藏起状态条
      setTimeout(() => { if (st.started) hideStatus(); }, 1200);
    } catch (err) {
      st.started = false;
      try { Camera.stop(); } catch (e) {}

      // 首次超时/失败 → 静默自动重试一次（headless 下首个 getUserMedia 偶发挂起）
      if (attempt === 0 && (timedOut || err.name === 'NotReadableError' || err.name === 'AbortError')) {
        st.starting = false;
        await new Promise(r => setTimeout(r, 420));
        return connect(1);
      }

      showVideo(false);
      const msg = err.name === 'NotAllowedError' ? '摄像头权限被拒绝'
                : err.name === 'NotFoundError'  ? '未检测到摄像头设备'
                : err.name === 'NotReadableError' ? '摄像头被其他程序占用'
                : err.message === 'TIMEOUT' ? '摄像头响应超时'
                : '摄像头启动失败';
      setStatus('warn', msg + '，可点重试或使用演示模式');
      showRetry();
      fallback();
    } finally {
      st.starting = false;
    }
  }

  async function retry() {
    hideRetry();
    await enumerate();
    await connect();
  }

  async function switchCamera() {
    if (st.cams.length < 2) { J.toast('仅检测到 1 个摄像头'); return; }
    st.camIndex = (st.camIndex + 1) % st.cams.length;
    stopLoop();
    await connect();
    J.toast('已切换至摄像头 ' + (st.camIndex + 1));
  }

  function shutdown() {
    stopLoop();
    Camera.stop();
    st.started = false;
  }

  /* ============================================================
     二、降级：无摄像头时用剪影演示
     ============================================================ */
  function fallback() {
    showSilhouette();
    $('faceDetect').style.display = 'none';
    $('liveMetrics').style.display = 'none';
  }
  function showSilhouette() { const s = $('capSilhouette'); if (s) s.style.display = ''; }
  function hideSilhouette() { const s = $('capSilhouette'); if (s) s.style.display = 'none'; }
  function showVideo(on)     { if (st.video) st.video.style.opacity = on ? '1' : '0'; }

  /* ============================================================
     三、状态条
     ============================================================ */
  function setStatus(kind, tx) {
    const el = $('camStatus'); if (!el) return;
    el.style.display = '';
    el.className = 'cam-status ' + kind;
    const ic = el.querySelector('.cs-ic');
    if (ic) ic.textContent = kind === 'ok' ? '✓' : kind === 'warn' ? '⚠' : kind === 'idle' ? '👆' : '📷';
    const t = $('camStatusTx'); if (t) t.textContent = tx;
  }
  function hideStatus() { const el = $('camStatus'); if (el) el.style.display = 'none'; }
  function showRetry()  { const b = $('camRetry'); if (b) b.style.display = ''; }
  function hideRetry()  { const b = $('camRetry'); if (b) b.style.display = 'none'; }
  function showStartBtn(){ const b = $('camStart'); if (b) b.style.display = ''; }
  function hideStartBtn(){ const b = $('camStart'); if (b) b.style.display = 'none'; }

  /* 用户显式点击开启（同时产生手势，满足浏览器授权前提） */
  function enable() {
    st.gesture = true;
    st.pending = false;
    hideStartBtn();
    hideStatus();
    connect();
  }

  /* ============================================================
     四、实时循环：人脸框 + 指标
     ============================================================ */
  function startLoop() {
    if (st.loopOn) return;
    st.loopOn = true;

    const fd = $('faceDetect');
    const lm = $('liveMetrics');

    Camera.startLoop(({ box, quality }) => {
      // --- 人脸框平滑跟随 ---
      if (box) {
        const cur = st.boxSmooth;
        const t = 0.35;
        st.boxSmooth = cur ? {
          x: cur.x + (box.x - cur.x) * t,
          y: cur.y + (box.y - cur.y) * t,
          w: cur.w + (box.w - cur.w) * t,
          h: cur.h + (box.h - cur.h) * t
        } : { x: box.x, y: box.y, w: box.w, h: box.h };

        const b = st.boxSmooth;
        // 映射到 stage 容器（video object-fit: cover 居中）
        fd.style.display = '';
        fd.style.left   = (b.x * 100) + '%';
        fd.style.top    = (b.y * 100) + '%';
        fd.style.width  = (b.w * 100) + '%';
        fd.style.height = (b.h * 100) + '%';

        const conf = Math.min(99, Math.round(60 + box.ratio * 260));
        const lb = $('fdLabel');
        if (lb) lb.textContent = `已识别 · 人脸 ${conf}%`;
      } else {
        fd.style.display = 'none';
        st.boxSmooth = null;
      }

      // --- 环境指标 ---
      if (quality) {
        lm.style.display = '';
        const b = $('lmBright'), s = $('lmSharp'), f = $('lmFace');
        if (b) b.textContent = quality.brightness;
        if (s) s.textContent = quality.sharpness.toFixed(1);
        if (f) f.textContent = box ? 'OK' : '--';

        // 底部指标同步真实值
        const ml = $('mLight');
        if (ml) ml.textContent = Math.min(100, Math.round(quality.brightness / 2.1)) + '%';
        const mk = $('mKp');
        if (mk) mk.textContent = box ? 33 : 0;
      }
    }, 8);
  }

  function stopLoop() {
    Camera.stopLoop();
    st.loopOn = false;
    st.boxSmooth = null;
    const fd = $('faceDetect'); if (fd) fd.style.display = 'none';
  }

  /* ============================================================
     五、快门：真实分析 → 生成方案 → 渲染报告
     ============================================================ */
  function capture() {
    // 无摄像头 → 走纯演示路径
    if (!st.started) { J.startAnalyze(); return; }

    // 抓一帧高清用于展示
    const hd = Camera.grabHD(720);
    if (hd) {
      const img = $('capturedShot');
      if (img) { img.src = hd.toDataURL('image/jpeg', 0.85); img.style.display = ''; }
    }

    // 连续抓 5 帧取中位，降噪后分析
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const a = Camera.analyzeAll();
      if (a) runs.push(a);
    }
    const analysis = mergeRuns(runs);
    st.lastAnalysis = analysis;

    // 生成方案（体态部分仍沿用原型数据，可后续接入姿态估计）
    const posture = { targets: ['forward_head', 'shoulder'], penalty: 5 };
    // 性别来自全局状态，决定穿搭 / 理容 / 妆容文案
    const gender = (typeof J !== 'undefined' && J.state && J.state.gender) || 'male';
    const plan = Advisor.build(analysis, posture, gender);
    st.lastPlan = plan;

    J.toast('采集完成，正在生成分析报告…');
    // 交给分析页
    setTimeout(() => J.startAnalyze(), 260);
  }

  /* 多帧融合：取中位数，抗单帧抖动 */
  function mergeRuns(runs) {
    if (!runs.length) return null;
    const withFace = runs.filter(r => r.hasFace);
    const pool = withFace.length ? withFace : runs;

    const pick = (arr, f) => {
      const v = arr.map(f).filter(x => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : null;
    };

    const base = pool[0];
    const tone = base.tone ? {
      ...base.tone,
      rgb: [
        Math.round(pick(pool.map(r => r.tone?.rgb[0]), x => x) ?? base.tone.rgb[0]),
        Math.round(pick(pool.map(r => r.tone?.rgb[1]), x => x) ?? base.tone.rgb[1]),
        Math.round(pick(pool.map(r => r.tone?.rgb[2]), x => x) ?? base.tone.rgb[2])
      ],
      hue: Math.round(pick(pool.map(r => r.tone?.hue), x => x) ?? base.tone.hue),
      lightness: Math.round(pick(pool.map(r => r.tone?.lightness), x => x) ?? base.tone.lightness),
      saturation: Math.round(pick(pool.map(r => r.tone?.saturation), x => x) ?? base.tone.saturation),
      coolWarm: Math.round(pick(pool.map(r => r.tone?.coolWarm), x => x) ?? base.tone.coolWarm),
      label: base.tone.label,
      pixels: pool.reduce((a, r) => a + (r.tone?.pixels || 0), 0)
    } : null;

    // coolWarm 变化后重新判定 label
    if (tone) {
      tone.label = tone.coolWarm <= -12 ? '冷调' : tone.coolWarm >= 12 ? '暖调' : '中性调';
    }

    return {
      ts: Date.now(),
      quality: base.quality,
      faceBox: base.faceBox,
      tone,
      face: base.face,
      hasFace: withFace.length > 0,
      hasTone: !!tone
    };
  }

  /* ============================================================
     六、渲染报告页（数据驱动）
     ============================================================ */
  function renderReports() {
    // 文案标题与性别强相关，即使还没采集过也要先同步
    try { syncGenderLabels(); } catch (e) { console.warn('[render] labels:', e); }

    const a = st.lastAnalysis;
    if (!a) return;

    // 若已采集过，但方案的性别与当前不一致 → 用新性别重建文案
    const g = (typeof J !== 'undefined' && J.state && J.state.gender) || 'male';
    if (st.lastPlan && st.lastPlan.gender !== g) {
      try {
        const posture = { targets: ['forward_head', 'shoulder'], penalty: 5 };
        st.lastPlan = Advisor.build(a, posture, g);
      } catch (e) { console.warn('[render] rebuild:', e); }
    }

    const p = st.lastPlan;
    if (!p) return;

    // 分区独立容错：任一区块出错不影响其他区块
    try { renderFaceReport(a, p); } catch (e) { console.warn('[render] face:', e); }
    try { renderHealthAdvice(a, p); } catch (e) { console.warn('[render] health:', e); }
  }

  /* ---- 报告页上所有随性别变化的静态文案 ---- */
  function syncGenderLabels() {
    const g = (typeof J !== 'undefined' && J.state && J.state.gender) || 'male';
    const isF = g === 'female';
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('makeupTitle',   isF ? '妆容' : '理容');
    set('hairCardTitle', isF ? '发型与配饰建议' : '发型与理容建议');
    set('beautySecLabel', isF ? '穿搭 / 妆容方案' : '穿搭 / 理容方案');
    set('makeupIcon',    isF ? '💄' : '🧔');
  }

  /* ---- P5 美学报告 ---- */
  function renderFaceReport(a, p) {
    const tone = a.tone, face = a.face, o = p.outfit;

    // 肤色诊断卡
    setText('diagTitle', `${o.palette.name} · ${o.subSeason || o.palette.season}`);
    setText('diagCoolWarm', tone ? ((tone.coolWarm > 0 ? '+' : '') + tone.coolWarm) : '—');
    setText('diagLight', tone ? tone.lightness : '—');
    setText('diagSat',   tone ? tone.saturation + '%' : '—');
    setText('diagHue',   tone ? tone.hue + '°' : '—');
    setText('diagDesc', tone
      ? `实测肤色 RGB(${tone.rgb.join(', ')})，有效肤色像素 ${tone.pixels.toLocaleString()} 个。<br>冷暖指数${tone.coolWarm > 0 ? '偏暖' : tone.coolWarm < 0 ? '偏冷' : '中性'}，判定为<b>${tone.label}</b>。`
      : `本次未检测到有效人脸区域，已按<b>中性基准</b>给出兜底方案。<br>建议正对镜面、保证面部完整入框后重新采集。`);

    const sw = $('diagSwatch');
    if (sw && tone) {
      const [r, g, b] = tone.rgb;
      const c2 = `rgb(${Math.round(r * .9)},${Math.round(g * .87)},${Math.round(b * .85)})`;
      const c3 = `rgb(${Math.round(r * .72)},${Math.round(g * .68)},${Math.round(b * .66)})`;
      sw.style.background = `radial-gradient(circle at 36% 32%, rgb(${r},${g},${b}), ${c2} 60%, ${c3})`;
    }

    // 明度刻度：标记用户落点
    const mark = $('diagMark');
    if (mark && tone) {
      const pct = Math.max(2, Math.min(98, Math.round((tone.lightness - 90) / 150 * 100)));
      mark.style.left = pct + '%';
      mark.style.display = '';
    }

    // 适配色卡
    const swWrap = $('toneSwatches');
    if (swWrap) {
      swWrap.innerHTML = o.mainColors.map(c =>
        `<div class="swatch" style="background:${c.c}"><span>${c.n}</span></div>`
      ).join('');
    }

    // 脸型标注
    setText('faceShapeLbl', `脸型 · ${face?.shape || '—'}`);

    // 穿搭 / 妆容（男生走理容分支）
    setText('outfitDesc', o.desc);
    const isF = p.gender === 'female';
    if (isF) {
      setText('makeupDesc', `唇色选${p.beauty.lip}，眼影走${p.beauty.eye}，发色推荐${p.beauty.hairColor}。`);
    } else {
      setText('makeupDesc', `护肤：${p.beauty.skin}；理容：${p.beauty.groom}；发色推荐${p.beauty.hairColor}。`);
    }

    // 发型配饰 / 理容要点
    const mr = $('makeupRow');
    if (mr) {
      const chips = isF
        ? [p.beauty.hairStyle, p.beauty.accessory, p.beauty.tip, `规避：${o.avoid.join(' / ')}`]
        : [p.beauty.hairStyle, p.beauty.brow, p.beauty.tip, `规避：${o.avoid.join(' / ')}`];
      mr.innerHTML = chips
        .map((t, i) => `<span class="chip${i < 2 ? ' info' : ''}">${t}</span>`).join('');
    }

    // 妆容区块标题跟随性别（统一由 syncGenderLabels 处理，这里不再重复）

    // 置信度
    setText('confVal', p.confidence + '%');
  }

  /* ---- 新增：健康 / 饮食 / 运动 / 作息 ---- */
  function renderHealthAdvice(a, p) {
    setText('healthScore', p.health);
    animateHealth(p.health);

    // 饮食
    const dEl = $('dietList');
    if (dEl) {
      dEl.innerHTML = p.diet.map(d =>
        `<div class="adv-item">
           <div class="ai">🥗</div>
           <div><div class="at">${d.t}</div><div class="ad">${d.d}</div></div>
           <div class="atag">${d.from}</div>
         </div>`).join('') || '<div class="adv-empty">暂无</div>';
    }
    // 运动
    const mEl = $('moveList');
    if (mEl) {
      mEl.innerHTML = p.move.map(d =>
        `<div class="adv-item">
           <div class="ai">🏃</div>
           <div><div class="at">${d.t}</div><div class="ad">${d.d}</div></div>
           <div class="atag">${d.from}</div>
         </div>`).join('');
    }
    // 作息
    const lEl = $('lifeList');
    if (lEl) {
      lEl.innerHTML = p.life.map(d =>
        `<div class="adv-item">
           <div class="ai">🌙</div>
           <div><div class="at">${d.t}</div><div class="ad">${d.d}</div></div>
           <div class="atag">${d.from}</div>
         </div>`).join('');
    }
    // 环境
    const eEl = $('envList');
    if (eEl) {
      eEl.innerHTML = p.env.length
        ? p.env.map(d => `<div class="adv-item warn"><div class="ai">⚠</div><div><div class="at">${d.t}</div><div class="ad">${d.d}</div></div></div>`).join('')
        : '<div class="adv-item ok"><div class="ai">✓</div><div><div class="at">拍摄环境良好</div><div class="ad">光照与清晰度均达标，分析结果可信度高。</div></div></div>';
    }
  }

  function setText(id, v) { const el = $(id); if (el) el.textContent = v; }

  /* 健康分环动画 */
  function animateHealth(score) {
    const ring = $('healthRing');
    if (!ring) return;
    const C = 238.8;                       // 2πr, r=38
    ring.style.strokeDashoffset = C;
    setTimeout(() => {
      ring.style.strokeDashoffset = C - C * (score / 100);
    }, 80);
  }

  /* 处方 tab 切换 */
  function tabHabit(kind, el) {
    document.querySelectorAll('.habit-tabs .ht').forEach(t => t.classList.remove('on'));
    if (el) el.classList.add('on');
    document.querySelectorAll('.habit-pane').forEach(p => p.classList.remove('on'));
    const pane = $('pane-' + kind);
    if (pane) pane.classList.add('on');
  }

  /* ============================================================
     七、灯光 / 拍照保存
     ============================================================ */
  function toggleLight() {
    st.lightOn = !st.lightOn;
    const stage = document.querySelector('.cam-stage');
    if (stage) stage.classList.toggle('light-off', !st.lightOn);
    J.toast('环形补光 ' + (st.lightOn ? '已开启' : '已关闭'));
    const ml = $('mLight');
    if (ml && !st.lightOn) ml.textContent = '0%';
  }

  /* ============================================================
     八、对外接口
     ============================================================ */
  return {
    boot, shutdown, retry, switchCamera, capture, renderReports, toggleLight, tabHabit, enable,
    get analysis() { return st.lastAnalysis; },
    get plan() { return st.lastPlan; },
    get running() { return st.started; },
    _dbg() { return { started: st.started, starting: st.starting, gesture: st.gesture,
                      pending: st.pending, loopOn: st.loopOn, cams: st.cams.length,
                      hasVideo: !!st.video, hasUM: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) }; }
  };
})();
