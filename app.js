/* ===================================================================
   镜界 JINGJIE · 交互原型控制逻辑
   =================================================================== */

const J = (() => {

  /* ---------- 状态 ---------- */
  const state = { page: 'home', mode: 'front', analyzing: false, gender: 'male' };

  /* ============================================================
     性别主题：切换后整套配色 + 建议文案同步改变
     ============================================================ */
  const GENDER_KEY = 'jingjie.gender';
  const GENDER_NAME = { male: '男生', female: '女生' };

  function setGender(g, opts) {
    opts = opts || {};
    g = (g === 'female') ? 'female' : 'male';
    state.gender = g;

    // 1) 换肤：一切都由 [data-gender] 上的 CSS 变量驱动
    //    必须同时挂到 <html> 和 <body> —— :root 与 body 是两个不同元素，
    //    只挂 body 时 html 自身仍读取 :root 的旧值（canvas / 滚动条 / 表单控件会漏色）。
    document.documentElement.dataset.gender = g;
    document.body.dataset.gender = g;

    // 2) 同步两个切换控件的选中态与滑块位置
    document.querySelectorAll('.gs-opt, .gp-opt').forEach(el => {
      const on = el.dataset.gender === g;
      el.classList.toggle('on', on);
      if (el.getAttribute('role') === 'radio') el.setAttribute('aria-checked', String(on));
    });
    document.querySelectorAll('.gs-seg, .gender-pill').forEach(el => { el.dataset.active = g; });

    // 3) 滑块宽度需要按实际按钮宽度算（两个按钮文字长度不同）
    requestAnimationFrame(syncThumb);

    // 4) 形象元素跟随：头像字样
    const av = document.querySelector('.avatar');
    if (av) av.textContent = g === 'female' ? '她' : '镜';

    // 5) 持久化
    try { localStorage.setItem(GENDER_KEY, g); } catch (e) {}

    // 6) 已生成的报告要按新性别重算文案
    if (typeof CamUI !== 'undefined' && CamUI.renderReports) {
      try { CamUI.renderReports(); } catch (e) {}
    }

    if (!opts.silent) {
      toast(g === 'female'
        ? '已切换到女生模式 · 粉色主题已启用 🌸'
        : '已切换到男生模式 · 青金主题已启用');
    }
  }

  // 让滑块的宽度与位置贴合当前激活项（两个控件都处理）
  // 注意：位置必须用内联 transform 控制，不能用 CSS translateX(100%)，
  //      因为「男生/女生」两个按钮宽度不同，100% 会算错。
  function syncThumb() {
    const isFemale = document.body.dataset.gender === 'female';

    // (1) 品牌区分段开关
    document.querySelectorAll('.gs-seg').forEach(seg => {
      const opts = seg.querySelectorAll('.gs-opt');
      const act  = seg.querySelector('.gs-opt.on') || opts[0];
      const th   = seg.querySelector('.gs-thumb');
      if (!act || !th || !opts.length) return;
      const w = act.getBoundingClientRect().width;
      if (!w) return;
      th.style.width = w + 'px';
      const offset = (isFemale && opts[1])
        ? opts[1].getBoundingClientRect().left - opts[0].getBoundingClientRect().left
        : 0;
      th.style.transform = 'translateX(' + offset + 'px)';
    });

    // (2) 手机屏内胶囊（两个格子等宽，位移 = 单格宽度）
    document.querySelectorAll('.gender-pill').forEach(pill => {
      const opts = pill.querySelectorAll('.gp-opt');
      const th   = pill.querySelector('.gp-thumb');
      if (!opts.length || !th) return;
      const w = opts[0].getBoundingClientRect().width;
      th.style.width = w + 'px';
      th.style.transform = 'translateX(' + (isFemale ? w : 0) + 'px)';
    });
  }

  function initGender() {
    let saved = null;
    try { saved = localStorage.getItem(GENDER_KEY); } catch (e) {}
    // 支持 URL 参数 ?gender=female 便于截图 / 分享
    const qs = new URLSearchParams(location.search).get('gender');
    setGender(qs || saved || 'male', { silent: true });

    // 字体加载完 / 首帧布局完成后重算一次，避免按钮宽度为 0 时算错
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncThumb).catch(() => {});
    }
    window.addEventListener('load', syncThumb);
    setTimeout(syncThumb, 120);
    setTimeout(syncThumb, 600);
    window.addEventListener('resize', syncThumb);
  }

  /* ---------- 页面切换 ---------- */
  const PAGE_TAB = {
    home: 0, capture: 1, 'report-pose': 2, 'report-face': 3, health: 3, mirror: 3, analyze: -1
  };

  function go(id) {
    if (id === state.page) { console.log('[go] same page, skip:', id); return; }
    const cur = document.getElementById('p-' + state.page);
    const nxt = document.getElementById('p-' + id);
    if (!nxt) { console.log('[go] not found:', id); return; }

    if (cur) {
      cur.classList.remove('active');
      cur.classList.add('exit-left');
      const c = cur;
      setTimeout(() => c.classList.remove('exit-left'), 520);
    }
    // 复位滚动
    const sc = nxt.querySelector('.scroll');
    if (sc) sc.scrollTop = 0;

    nxt.classList.add('active');
    state.page = id;

    // 触发页面进入动画
    nxt.querySelectorAll('.fade-up').forEach((el, i) => {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    });

    // 离开拍摄页 → 释放摄像头
    if (state.page !== 'capture' && typeof CamUI !== "undefined") CamUI.shutdown();
    // 进入拍摄页 → 拉起摄像头
    if (id === 'capture') {
      setTimeout(() => { if (typeof CamUI !== "undefined") CamUI.boot(); }, 320);
    }

    // 进入分析页 → 启动作业
    if (id === 'analyze') runAnalyze();
    // 进入报告页 → 触发评分动画 + 语音播报
    if (id === 'report-pose') {
      setTimeout(animateScore, 280);
      setTimeout(() => { if (Voice.isSupported()) Voice.speak('report_pose');
                         else VoiceUI.simulate('report_pose'); }, 900);
    }
    // 进入美学报告 → 渲染真实数据 + 语音播报
    if (id === 'report-face') {
      if (typeof CamUI !== "undefined") CamUI.renderReports();
      setTimeout(() => { if (Voice.isSupported()) Voice.speak('report_face');
                         else VoiceUI.simulate('report_face'); }, 900);
    }
    // 进入健康方案 → 渲染 + 语音
    if (id === 'health') {
      if (typeof CamUI !== "undefined") CamUI.renderReports();
      setTimeout(() => { if (Voice.isSupported()) Voice.speak('health_plan'); }, 820);
    }
    // 进入镜面控制 → 简短提示
    if (id === 'mirror') {
      setTimeout(() => { if (Voice.isSupported()) Voice.speak('mirror_ready'); }, 800);
    }
  }

  /* ---------- 拍摄模式 ---------- */
  function setMode(m) {
    state.mode = m;
    document.getElementById('modeFront').classList.toggle('on', m === 'front');
    document.getElementById('modeSide').classList.toggle('on', m === 'side');
    document.getElementById('tipText').textContent =
      m === 'front' ? '请站入取景框，保持自然站立' : '请侧身站立，双手自然下垂';
    toast(m === 'front' ? '已切换至正面拍摄' : '已切换至侧面拍摄');
  }

  /* ---------- 开始分析 ---------- */
  function startAnalyze() {
    go('analyze');
  }

  function runAnalyze() {
    if (state.analyzing) return;
    state.analyzing = true;

    const ring  = document.getElementById('ringFg');
    const pctEl = document.getElementById('pctNum');
    const rows  = [...document.querySelectorAll('#stepsList .step-row')];
    const TOTAL = 596;
    let pct = 0;

    rows.forEach(r => { r.classList.remove('doing', 'done'); r.querySelector('.spct').textContent = '等待'; });

    // 每步占用的进度区间
    const marks = [0, 14, 34, 56, 76, 100];
    let curStep = -1;

    const timer = setInterval(() => {
      pct += Math.random() * 3.2 + 1.1;
      if (pct >= 100) { pct = 100; }

      pctEl.textContent = Math.floor(pct);
      ring.style.strokeDashoffset = TOTAL - (TOTAL * pct / 100);

      // 推进步骤
      for (let i = 0; i < 5; i++) {
        if (pct >= marks[i] && curStep < i) {
          if (curStep >= 0) {
            rows[curStep].classList.remove('doing');
            rows[curStep].classList.add('done');
            rows[curStep].querySelector('.si').textContent = '✓';
            rows[curStep].querySelector('.spct').textContent = '完成';
          }
          curStep = i;
          rows[i].classList.add('doing');
        }
      }
      // 当前步骤百分比
      if (curStep >= 0 && curStep < 5) {
        const s = marks[curStep], e = marks[curStep + 1];
        const sp = Math.min(100, Math.floor((pct - s) / (e - s) * 100));
        if (sp > 2) rows[curStep].querySelector('.spct').textContent = sp + '%';
      }

      if (pct >= 100) {
        clearInterval(timer);
        rows[4].classList.remove('doing');
        rows[4].classList.add('done');
        rows[4].querySelector('.si').textContent = '✓';
        rows[4].querySelector('.spct').textContent = '完成';
        state.analyzing = false;
        // 分析完成 → 语音提示
        if (Voice.isSupported()) Voice.speak('analyze_done');
        setTimeout(() => { toast('分析完成，正在生成报告…'); setTimeout(() => go('report-pose'), 620); }, 480);
      }
    }, 90);
  }

  /* ---------- 体态评分动画（v5.0：环 + 数字同步，expo-out 缓动） ---------- */
  function animateScore() {
    const el  = document.getElementById('scoreNum');
    const fg  = document.getElementById('scoreFg');
    const TOT = 289, target = 86;
    if (!fg) return;

    // 环：先归零再描边
    fg.style.transition = 'none';
    fg.style.strokeDashoffset = TOT;
    void fg.getBoundingClientRect();
    fg.style.transition = '';
    setTimeout(() => { fg.style.strokeDashoffset = TOT - TOT * target / 100; }, 60);

    // 数字：与环同步滚动
    if (el) {
      if (typeof FX !== 'undefined' && FX.rollNumber) FX.rollNumber(el, target, 1400);
      else {
        let cur = 0; const t = setInterval(() => {
          cur += 2; if (cur >= target) { cur = target; clearInterval(t); }
          el.textContent = cur;
        }, 26);
      }
    }
  }

  /* ---------- 镜面角度 ---------- */
  let curAngle = 40;
  function setAngle(deg, btn) {
    curAngle = deg;
    document.getElementById('degNum').textContent = (deg > 0 ? '+' : '') + deg;
    const panel = document.getElementById('mirrorPanel');
    const glass = document.getElementById('mirrorGlass');
    // 映射到 -70 ~ +70 的可视旋转
    const vis = Math.max(-70, Math.min(70, deg > 90 ? 140 - deg : deg));
    glass.style.transform = `rotateY(${vis}deg)`;
    glass.classList.remove('shine'); void glass.offsetWidth; glass.classList.add('shine');

    document.querySelectorAll('.angle-btn').forEach(b => b.classList.remove('on'));
    if (btn) btn.classList.add('on');
    toast('镜面已转至 ' + deg + '°');
  }

  /* ---------- 开关 ---------- */
  function toggleSwitch(el, name) {
    el.classList.toggle('on');
    toast(name + (el.classList.contains('on') ? ' 已开启' : ' 已关闭'));
  }

  /* ---------- 滑杆 ---------- */
  function slide(ev, kind, track) {
    const rect = track.getBoundingClientRect();
    let p = (ev.clientX - rect.left) / rect.width;
    p = Math.max(.04, Math.min(1, p));
    const fill = track.querySelector('.slider-fill');
    fill.style.width = (p * 100) + '%';

    if (kind === 'bright') {
      document.getElementById('vBright').textContent = Math.round(p * 100) + '%';
    } else {
      const k = Math.round(2800 + p * 4200);
      const lb = k < 4200 ? '暖光' : (k < 5800 ? '中性' : '冷白');
      document.getElementById('vWarm').textContent = lb + ' ' + k + 'K';
    }
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    document.getElementById('toastTxt').textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  /* ---------- 气质雷达图（v5.0） ---------- */
  // 六个维度：清晰 / 对比 / 通透 / 立体 / 匀净 / 光泽
  function buildRadar(vals) {
    const box = document.getElementById('radarChart');
    if (!box) return;
    const AX = ['清晰度', '对比度', '通透感', '立体感', '匀净度', '光泽度'];
    const V = (vals && vals.length === 6) ? vals : [72, 64, 80, 58, 76, 68];
    const R = 74, CX = 100, CY = 88, N = AX.length;
    const pt = (i, r) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / N;
      return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
    };
    // 网格（4 层）
    let grid = '';
    for (let ring = 1; ring <= 4; ring++) {
      const r = R * ring / 4;
      const d = Array.from({ length: N }, (_, i) => {
        const [x, y] = pt(i, r); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ') + ' Z';
      grid += `<path class="rd-grid" d="${d}"/>`;
    }
    // 轴线
    let spokes = '';
    for (let i = 0; i < N; i++) {
      const [x, y] = pt(i, R);
      spokes += `<line class="rd-grid" x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    }
    // 数据多边形
    const shape = V.map((v, i) => {
      const [x, y] = pt(i, R * Math.max(0.12, Math.min(1, v / 100)));
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ') + ' Z';
    // 顶点 + 标签
    let dots = '', labels = '';
    V.forEach((v, i) => {
      const [x, y] = pt(i, R * Math.max(0.12, Math.min(1, v / 100)));
      dots += `<circle class="rd-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"><title>${AX[i]} ${v}</title></circle>`;
      const [lx, ly] = pt(i, R + 15);
      const anchor = Math.abs(lx - CX) < 6 ? 'middle' : (lx > CX ? 'start' : 'end');
      labels += `<text class="rd-label" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}">${AX[i]} ${v}</text>`;
    });

    box.innerHTML = `
      <svg viewBox="0 0 200 186" role="img" aria-label="气质维度雷达图">
        ${grid}${spokes}
        <path class="rd-shape" d="${shape}"/>
        ${dots}${labels}
      </svg>`;
  }

  /* ---------- 趋势图（v5.0：自绘 SVG 折线 + 面积渐变 + 坐标 + 悬浮点） ---------- */
  function buildTrend() {
    const data   = [72, 75, 79, 82, 84, 86];
    const labels = ['7/2', '7/9', '7/16', '7/23', '7/30', '8/6'];
    const box = document.getElementById('trendChart');
    if (!box) return;

    const W = 272, H = 116, PL = 22, PR = 10, PT = 14, PB = 20;
    const iw = W - PL - PR, ih = H - PT - PB;
    const min = 60, max = 92;
    const X = i => PL + (data.length === 1 ? iw / 2 : i * iw / (data.length - 1));
    const Y = v => PT + ih - (v - min) / (max - min) * ih;
    const pts = data.map((v, i) => [X(i), Y(v)]);

    // 平滑折线（Catmull-Rom 转三次贝塞尔）
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    const area = `${d} L${pts[pts.length - 1][0]},${PT + ih} L${pts[0][0]},${PT + ih} Z`;

    // 网格线（3 条水平）
    let grid = '';
    for (let g = 0; g <= 3; g++) {
      const y = PT + ih * g / 3;
      grid += `<line class="tr-grid" x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}"/>`;
    }

    // 数据点 + 最后一颗高亮
    let dots = '', axis = '';
    pts.forEach((p, i) => {
      const last = i === pts.length - 1;
      dots += `<circle class="tr-dot${last ? ' tr-hot' : ''}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}"
               r="${last ? 3.6 : 2.6}" fill="${last ? '#fff' : 'var(--c-accent)'}"
               style="animation-delay:${(0.5 + i * 0.09).toFixed(2)}s">
               <title>${labels[i]} · ${data[i]} 分</title></circle>`;
      axis += `<text class="tr-axis" x="${p[0].toFixed(1)}" y="${H - 6}" text-anchor="middle">${labels[i]}</text>`;
    });

    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 6 次体态评分趋势">
        <defs>
          <linearGradient id="trFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--c-accent)" stop-opacity=".34"/>
            <stop offset="100%" stop-color="var(--c-accent)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${grid}
        <path class="tr-area" d="${area}" fill="url(#trFill)"/>
        <path class="tr-line" d="${d}" fill="none" stroke="var(--c-accent)" stroke-width="2.4"
              stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}${axis}
      </svg>`;
  }

  /* ---------- 时钟 ---------- */
  function clock() {
    const d = new Date();
    const s = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const el = document.getElementById('clock');
    if (el) el.textContent = s;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    buildTrend();
    buildRadar();
    clock();
    initGender();
    setInterval(clock, 20000);
    // 键盘演示支持
    document.addEventListener('keydown', e => {
      const map = { '1': 'home', '2': 'capture', '3': 'analyze', '4': 'report-pose', '5': 'report-face', '6': 'health', '7': 'mirror' };
      if (map[e.key]) go(map[e.key]);
      if (e.key === 'Enter' && state.page === 'capture') startAnalyze();
      if (e.key === 'v' || e.key === 'V') VoiceUI.togglePanel();
      if (e.key === 'r' || e.key === 'R') VoiceUI.replay();
      if (e.key === 'g' || e.key === 'G') setGender(state.gender === 'female' ? 'male' : 'female');
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { go, setMode, startAnalyze, setAngle, toggleSwitch, slide, toast, state, setGender, buildRadar, buildTrend };

})();
