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
    pending: false,       // 是否处于"待点击开启"状态
    panelOpen: false      // 设备选择面板是否展开
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
    // 设备列表变了要同步刷新面板（若正打开着）
    if (st.panelOpen) renderCamPanel();
    return st.cams;
  }

  /* ---------- 设备友好名：把系统标签整理成可读名称 ---------- */
  // 系统标签形如 "USB2.0 HD UVC WebCam (0bda:5844)" / "Integrated Camera (13d3:56eb)"
  function camName(dev, i) {
    const raw = (dev && dev.label) || '';
    // 去掉末尾的 (xxxx:xxxx) 厂商号
    let n = raw.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
    if (!n) return `摄像头 ${i + 1}`;
    return n;
  }

  /* ---------- 判定是否为「外接 / USB」摄像头 ----------
     浏览器给的 label 五花八门，单靠 usb/uvc 会漏判（如 "Logitech BRIO 4K"）。
     判定顺序很关键：
       1) 先看「内置排除词」——"Integrated"/"Built-in"/"FaceTime" 是强信号，
          优先级高于 webcam 这类通用词（否则 "Integrated Webcam" 会被误判）。
       2) 再看外接关键词（usb/uvc/webcam/brio/c920/obsbot…）。
       3) 都没有：形如 "Camera"/"Camera 2" 的占位名 → 内置；有具体型号名 → 外接。
  */
  const INT_RE   = /integrated|built[- ]?in|internal|front\s*camera|ir\s*camera|infrared|facetime|laptop|notebook|surface|realsense|depth|intel/i;
  const EXT_RE   = /usb|uvc|webcam|brio|c\d{3,4}|obsbot|elgato|razer|kiyo|insta360|mevo|lifecam|logitech/i;
  const INT_NAME = /^(camera|camera\s*\d*|usb\s*camera|webcam|camera\s+front|front)\s*$/i;
  function isExternal(dev, i) {
    const raw = ((dev && dev.label) || '').trim();
    // 完全没有 label（未授权时浏览器会隐藏）→ 按内置处理，占位更稳妥
    if (!raw) return false;
    // 1) 内置强信号优先（Integrated Webcam 里含 webcam，必须先拦）
    if (INT_RE.test(raw)) return false;
    // 2) 外接关键词
    if (EXT_RE.test(raw)) return true;
    // 3) 名字形如 "Camera"/"Camera 2" 这种系统占位名 → 视为内置
    if (INT_NAME.test(camName(dev, i))) return false;
    // 其余有具体型号名但既非明显内置又非关键词命中 → 多为外接设备
    return true;
  }

  /* ---------- 设备选择面板（USB / 内置摄像头直选） ---------- */
  function renderCamPanel() {
    const box = $('camPanelList');
    if (!box) return;
    if (!st.cams.length) {
      box.innerHTML = '<div class="cp-empty">未检测到摄像头设备<br><span>请确认设备已连接并已授权</span></div>';
      return;
    }
    box.innerHTML = st.cams.map((d, i) => {
      const on = i === st.camIndex;
      const isUsb = isExternal(d, i);
      return `<button class="cp-item${on ? ' on' : ''}" onclick="CamUI.pickCamera(${i})">
        <span class="cp-ic">${isUsb ? '🔌' : '📷'}</span>
        <span class="cp-tx">
          <b>${camName(d, i)}</b>
          <i>${isUsb ? '外接 / USB' : '内置'}${on ? ' · 使用中' : ''}</i>
        </span>
        ${on ? '<span class="cp-dot"></span>' : ''}
      </button>`;
    }).join('') + `
      <button class="cp-refresh" onclick="CamUI.refreshCams()">↻ 重新扫描设备</button>`;
  }

  function openCamPanel() {
    const p = $('camPanel');
    if (!p) return;
    st.panelOpen = true;
    p.classList.add('show');
    renderCamPanel();
    enumerate();
  }

  function closeCamPanel() {
    const p = $('camPanel');
    if (p) p.classList.remove('show');
    st.panelOpen = false;
  }

  function toggleCamPanel() {
    st.panelOpen ? closeCamPanel() : openCamPanel();
  }

  async function refreshCams() {
    await enumerate();
    renderCamPanel();
    J.toast(`已扫描到 ${st.cams.length} 个摄像头`);
  }

  /* ---------- 选择指定设备并重连 ---------- */
  async function pickCamera(i) {
    if (i === st.camIndex && st.started) { closeCamPanel(); return; }
    st.camIndex = i;
    stopLoop();
    await connect();
    closeCamPanel();
    if (st.started) J.toast('已切换至 ' + camName(st.cams[i], i));
  }

  /* ---------- 设备热插拔：插上 USB 自动刷新 ---------- */
  (function watchDevices() {
    if (!navigator.mediaDevices?.addEventListener) return;
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      if (!st.gesture) return;
      const before = st.cams.length;
      await enumerate();
      if (st.panelOpen) renderCamPanel();
      if (st.cams.length !== before) {
        J.toast(st.cams.length > before
          ? `检测到新摄像头（共 ${st.cams.length} 个）`
          : `摄像头已断开（剩余 ${st.cams.length} 个）`);
        // 当前设备被拔掉 → 自动回落到第一个可用设备
        if (st.cams.length && !st.cams[st.camIndex]) {
          st.camIndex = 0;
          stopLoop();
          await connect();
        }
      }
    });
  })();

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
      const label = camName(st.cams[st.camIndex], st.camIndex);
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

  /* 快速切换：循环到下一个设备 */
  async function switchCamera() {
    await enumerate();
    if (st.cams.length < 2) { J.toast('仅检测到 1 个摄像头'); return; }
    st.camIndex = (st.camIndex + 1) % st.cams.length;
    stopLoop();
    await connect();
    if (st.started) J.toast('已切换至 ' + camName(st.cams[st.camIndex], st.camIndex));
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
    // 先用本地规则引擎即时出结果，保证交互零等待
    const plan = Advisor.build(analysis, posture, gender);
    st.lastPlan = plan;

    J.toast('采集完成，正在生成分析报告…');

    // 后端在线：把方案重算交给服务端（结果一致，但由 Python 规则引擎产出），
    // 同时把本次检测入库到 SQLite，供历史 / 趋势 / 跨会话留存使用。
    if (typeof API !== 'undefined') {
      API.ready().then(ok => {
        if (!ok) return;
        API.saveReport(analysis, posture, gender).then(res => {
          if (res && res.plan) {
            st.lastPlan = res.plan;
            st.lastReportId = res.id;
            try { renderReports(); } catch (e) {}
            if (typeof J !== 'undefined' && J.loadServerTrend) { try { J.loadServerTrend(); } catch (e) {} }
          }
        });
      });
    }

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

    // 气质雷达：由真实质量指标 + 肤色数据推导（v5.0）
    try {
      if (typeof J !== 'undefined' && J.buildRadar) {
        const q = a.quality || {};
        const clamp = v => Math.max(24, Math.min(96, Math.round(v)));
        const bright = q.brightness || 150;
        // 清晰度：拉普拉斯方差（sharpness 字段，越高越锐）
        const sharp = clamp(34 + (q.sharpness || 9) * 4.2);
        // 对比度：灰度标准差（contrast 字段）
        const cont  = clamp(28 + (q.contrast || 40) * 1.15);
        // 通透感：亮度居中度（偏离 140 越远越低）
        const clear = clamp(96 - Math.abs(bright - 140) * 0.42);
        // 立体感：肤色像素量（面部占比越高越立体）
        const mass  = clamp(tone ? 38 + Math.min(1, (tone.pixels || 0) / 26000) * 54 : 52);
        // 匀净度：饱和度落在舒适区间（~34%）最高
        const sat   = tone ? tone.saturation : 30;
        const even  = clamp(94 - Math.abs(sat - 34) * 1.3);
        // 光泽度：暖调 + 明度适中更显光泽
        const warm  = tone ? tone.coolWarm : 0;
        const gloss = clamp(56 + warm * 0.5 + (bright > 150 ? 8 : 0));
        J.buildRadar([sharp, cont, clear, mass, even, gloss]);
      }
    } catch (e) { console.warn('[render] radar:', e); }

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
    // 多摄像头 / USB 设备管理
    listCams: () => st.cams.map((d, i) => ({ index: i, id: d.deviceId, label: camName(d, i), raw: d.label, external: isExternal(d, i) })),
    openCamPanel, closeCamPanel, toggleCamPanel, refreshCams, pickCamera, enumerate, isExternal,
    get current() { return st.cams[st.camIndex] ? camName(st.cams[st.camIndex], st.camIndex) : null; },
    get analysis() { return st.lastAnalysis; },
    get plan() { return st.lastPlan; },
    get running() { return st.started; },
    _dbg() { return { started: st.started, starting: st.starting, gesture: st.gesture,
                      pending: st.pending, loopOn: st.loopOn, cams: st.cams.length,
                      hasVideo: !!st.video, hasUM: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) }; },

    // ---- 测试接缝：注入一份 analysis，复用真实「方案 + 入库 + 渲染」路径 ----
    // 无头环境没有摄像头，capture() 无法产出 analysis；此钩子让自动化验收
    // 能完整走一遍服务端 plan 生成与 SQLite 入库，不改变任何线上行为。
    __injectAnalysis(analysis, posture, gender) {
      st.lastAnalysis = analysis;
      st.lastPlan = Advisor.build(analysis, posture, gender);
      J.toast('采集完成，正在生成分析报告…');
      if (typeof API !== 'undefined') {
        API.ready().then(ok => {
          if (!ok) return;
          API.saveReport(analysis, posture, gender).then(res => {
            if (res && res.plan) {
              st.lastPlan = res.plan;
              st.lastReportId = res.id;
              try { renderReports(); } catch (e) {}
              if (typeof J !== 'undefined' && J.loadServerTrend) { try { J.loadServerTrend(); } catch (e) {} }
            }
          });
        });
      }
      setTimeout(() => J.startAnalyze(), 80);
      return true;
    }
  };
})();
