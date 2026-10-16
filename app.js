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

  /* ---------- 体态评分动画 ---------- */
  function animateScore() {
    const el  = document.getElementById('scoreNum');
    const fg  = document.getElementById('scoreFg');
    const TOT = 289, target = 86;
    let cur = 0;
    fg.style.strokeDashoffset = TOT;

    setTimeout(() => { fg.style.strokeDashoffset = TOT - TOT * target / 100; }, 60);

    const t = setInterval(() => {
      cur += 2;
      if (cur >= target) { cur = target; clearInterval(t); }
      el.textContent = cur;
    }, 26);
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

  /* ---------- 趋势图 ---------- */
  function buildTrend() {
    const data = [72, 75, 79, 82, 84, 86];
    const labels = ['7/2', '7/9', '7/16', '7/23', '7/30', '8/6'];
    const box = document.getElementById('trendChart');
    if (!box) return;
    const max = 100, min = 60;
    box.innerHTML = data.map((v, i) => {
      const h = Math.max(12, (v - min) / (max - min) * 100);
      const hi = i === data.length - 1 ? ' hi' : '';
      return `<div class="bwrap">
        <div class="bar${hi}" style="height:${h}%" title="${v} 分"></div>
        <div class="bl">${labels[i]}</div>
      </div>`;
    }).join('');
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

  return { go, setMode, startAnalyze, setAngle, toggleSwitch, slide, toast, state, setGender };

})();
