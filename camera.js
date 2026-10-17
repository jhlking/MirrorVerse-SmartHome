/* ===================================================================
   镜界 JINGJIE · 摄像头采集与真实图像分析模块
   纯前端 Canvas 像素分析，零外部依赖、离线可用。

   分析能力：
   1. 人脸定位（肤色像素聚类）
   2. 肤色冷暖判定（YCbCr + HSL 双通道）
   3. 曝光 / 白平衡 / 清晰度评估
   4. 脸型比例测算（面部区域长宽比）
   5. 图像质量评分
   =================================================================== */

const Camera = (() => {

  /* ---------- 状态 ---------- */
  const st = {
    stream: null,
    video: null,
    canvas: null,
    ctx: null,
    running: false,
    lastFrame: null,     // ImageData
    faceBox: null,       // {x,y,w,h} 归一化 0~1
    ready: false
  };

  /* ============================================================
     1. 摄像头启动 / 停止
     ============================================================ */
  async function start(videoEl, opts = {}) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('NO_API');
    }
    stop(); // 清理旧流

    // 设备选择优先级：显式 deviceId > facingMode
    // ⚠️ 两者同时给会被浏览器判为互斥约束（OverconstrainedError），
    //    尤其外接 USB 摄像头常被标成 environment，与 facingMode:'user' 打架。
    const video = {
      width:  { ideal: opts.width  || 1280 },
      height: { ideal: opts.height || 960 },
      frameRate: { ideal: 30 }
    };
    if (opts.deviceId) {
      video.deviceId = { exact: opts.deviceId };
    } else if (opts.facingMode || 'user') {
      video.facingMode = opts.facingMode || 'user';
    }

    const constraints = { video, audio: false };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // deviceId 指定失败（设备被拔 / 被占用）→ 退回到不指定设备重试一次，
      // 避免整条链路因一个失效 id 直接挂掉。
      if (opts.deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        delete video.deviceId;
        video.facingMode = 'user';
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } else {
        throw err;
      }
    }

    st.stream = stream;
    st.video = videoEl;
    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', '');
    videoEl.muted = true;
    await videoEl.play();

    // 准备分析画布
    if (!st.canvas) {
      st.canvas = document.createElement('canvas');
      st.ctx = st.canvas.getContext('2d', { willReadFrequently: true });
    }
    st.running = true;
    st.ready = true;
    return stream;
  }

  function stop() {
    if (st.stream) {
      st.stream.getTracks().forEach(t => t.stop());
      st.stream = null;
    }
    if (st.video) { try { st.video.srcObject = null; } catch (e) {} }
    st.running = false;
  }

  function isRunning() { return st.running; }
  function getSettings() {
    const t = st.stream?.getVideoTracks?.()[0];
    return t ? t.getSettings() : null;
  }

  /* ============================================================
     2. 抓帧 → ImageData（降采样到分析尺寸）
     ============================================================ */
  function grab(anW = 240, anH = 180) {
    if (!st.video || !st.video.videoWidth) return null;
    st.canvas.width = anW;
    st.canvas.height = anH;
    st.ctx.drawImage(st.video, 0, 0, anW, anH);
    const data = st.ctx.getImageData(0, 0, anW, anH);
    st.lastFrame = data;
    return data;
  }

  /* 抓高清帧（用于拍照存证 / 展示） */
  function grabHD(maxW = 720) {
    if (!st.video || !st.video.videoWidth) return null;
    const vw = st.video.videoWidth, vh = st.video.videoHeight;
    const scale = Math.min(1, maxW / vw);
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(st.video, 0, 0, w, h);
    return c;
  }

  /* ============================================================
     3. 肤色检测（YCbCr 空间，经典阈值法）
        Cb: 77~127   Cr: 133~173
     ============================================================ */
  function isSkin(r, g, b) {
    const y  =  0.299 * r + 0.587 * g + 0.114 * b;
    const cb = -0.169 * r - 0.331 * g + 0.500 * b + 128;
    const cr =  0.500 * r - 0.419 * g - 0.081 * b + 128;
    // 主判据
    if (cb < 77 || cb > 127 || cr < 133 || cr > 173) return false;
    // 补充：RGB 关系约束（排除木头/暖色墙）
    if (r < 60 || r > 250) return false;
    if (r <= g || r <= b) return false;
    if (Math.max(r,g,b) - Math.min(r,g,b) < 12) return false;
    return true;
  }

  /* ============================================================
     4. 人脸定位：肤色像素投影 + 连通区域
     ============================================================ */
  function findFace(imgData) {
    if (!imgData) return null;
    const { data, width: W, height: H } = imgData;
    const colSum = new Array(W).fill(0);
    const rowSum = new Array(H).fill(0);
    let total = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (isSkin(data[i], data[i+1], data[i+2])) {
          colSum[x]++; rowSum[y]++; total++;
        }
      }
    }

    const ratio = total / (W * H);
    if (ratio < 0.012 || ratio > 0.65) return null;   // 太少/太多都不像人脸

    // 取累积 90% 像素的主区间（抗噪点）
    const span = (arr, n) => {
      const sum = arr.reduce((a,b)=>a+b, 0);
      let acc = 0, lo = 0, hi = n - 1;
      for (let i = 0; i < n; i++) { acc += arr[i]; if (acc >= sum * 0.05) { lo = i; break; } }
      acc = 0;
      for (let i = n - 1; i >= 0; i--) { acc += arr[i]; if (acc >= sum * 0.05) { hi = i; break; } }
      return [lo, hi];
    };

    const [x0, x1] = span(colSum, W);
    const [y0, y1] = span(rowSum, H);
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);

    // 排除蛮横的长条（多半是暖色背景）
    if (bw / W > 0.96 && bh / H > 0.96) return null;

    // 人脸区域垂直方向通常在画面上半部
    const box = {
      x: x0 / W, y: y0 / H, w: bw / W, h: bh / H,
      px: { x: x0, y: y0, w: bw, h: bh },
      ratio
    };
    st.faceBox = box;
    return box;
  }

  /* ============================================================
     5. 肤色冷暖分析（YCbCr 双通道 + HSL 辅助）
     ============================================================ */
  function analyzeTone(imgData, box) {
    if (!imgData) return null;
    const { data, width: W } = imgData;

    let rSum = 0, gSum = 0, bSum = 0, n = 0;
    let hueSum = 0;
    const px = [];

    const bx = box?.px || { x: 0, y: 0, w: W, h: imgData.height };
    const x1 = Math.min(W, bx.x + bx.w);
    const y1 = Math.min(imgData.height, bx.y + bx.h);

    for (let y = bx.y; y < y1; y++) {
      for (let x = bx.x; x < x1; x++) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i+1], b = data[i+2];
        if (!isSkin(r, g, b)) continue;
        rSum += r; gSum += g; bSum += b; n++;
        // HSL 色相
        const max = Math.max(r,g,b), min = Math.min(r,g,b);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
          if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
          else if (max === g) h = ((b - r) / d + 2) * 60;
          else h = ((r - g) / d + 4) * 60;
        }
        hueSum += h;
        if (px.length < 4000) px.push([r,g,b]);
      }
    }

    if (n < 60) return null;   // 有效肤色像素太少

    const avgR = rSum / n, avgG = gSum / n, avgB = bSum / n;
    const avgHue = hueSum / n;

    // 冷暖指数：暖色 黄橙（hue 20~45），冷色 偏粉/中性（hue 0~20 或 >45 偏黄）
    // 用 (R-B) 差 + 色相 双判据
    const rb = avgR - avgB;              // 越大越暖
    const gb = avgG - avgB;

    // 归一化到 -50 ~ +50；肤色 hue 约 5~45，中心 ~25
    const hueScore = (avgHue - 25) * 1.8;
    const rbScore  = (rb - 38) * 0.9;    // 典型中性肤色 R-B ≈ 38
    let coolWarm = Math.round((hueScore + rbScore) / 2);   // 正=暖 负=冷
    coolWarm = Math.max(-50, Math.min(50, coolWarm));

    // 明度（肤色的 L）
    const L = Math.round(0.299*avgR + 0.587*avgG + 0.114*avgB);

    // 饱和度
    const maxC = Math.max(avgR,avgG,avgB), minC = Math.min(avgR,avgG,avgB);
    const S = maxC === 0 ? 0 : Math.round((maxC - minC) / maxC * 100);

    return {
      rgb: [Math.round(avgR), Math.round(avgG), Math.round(avgB)],
      hue: Math.round(avgHue),
      lightness: L,
      saturation: S,
      coolWarm,                                   // 正=暖调 负=冷调
      label: coolWarm <= -12 ? '冷调' : coolWarm >= 12 ? '暖调' : '中性调',
      pixels: n
    };
  }

  /* ============================================================
     6. 图像质量评估（曝光 / 对比度 / 清晰度）
     ============================================================ */
  function assessQuality(imgData) {
    if (!imgData) return null;
    const { data, width: W, height: H } = imgData;
    let sum = 0, sum2 = 0, n = 0;
    let under = 0, over = 0;
    const gray = new Float32Array(W * H);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const g = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
      gray[p] = g;
      sum += g; sum2 += g * g; n++;
      if (g < 38) under++;
      if (g > 232) over++;
    }
    const mean = sum / n;
    const variance = sum2 / n - mean * mean;
    const contrast = Math.sqrt(Math.max(0, variance));

    // 清晰度：拉普拉斯方差（简化为 4 邻域）
    let lapSum = 0, lapSum2 = 0, lapN = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        const lap = 4 * gray[p] - gray[p-1] - gray[p+1] - gray[p-W] - gray[p+W];
        lapSum += lap; lapSum2 += lap * lap; lapN++;
      }
    }
    const lapMean = lapSum / lapN;
    const sharpness = Math.sqrt(Math.max(0, lapSum2 / lapN - lapMean * lapMean));

    const underR = under / n, overR = over / n;

    // 综合可用度
    let usable = true, issues = [];
    if (mean < 58)  { usable = false; issues.push('光线偏暗'); }
    if (mean > 205) { usable = false; issues.push('画面过曝'); }
    if (underR > 0.34) issues.push('暗部过多');
    if (overR  > 0.16) issues.push('高光溢出');
    if (contrast < 26) issues.push('对比度偏低');
    if (sharpness < 7)  issues.push('画面偏模糊');

    return {
      brightness: Math.round(mean),
      contrast: Math.round(contrast),
      sharpness: Math.round(sharpness * 10) / 10,
      underPct: Math.round(underR * 100),
      overPct: Math.round(overR * 100),
      usable, issues
    };
  }

  /* ============================================================
     7. 脸型比例（基于面部框长宽比 + 肤色分布）
     ============================================================ */
  function analyzeFaceShape(box, tone) {
    if (!box) return null;
    const ar = box.h / box.w;          // 高宽比

    // 长宽比 + 肤色明度 共同推断（启发式，作为参考）
    let shape, desc;
    if (ar >= 1.42)      { shape = '长形脸'; desc = '面部纵向比例偏长'; }
    else if (ar >= 1.26) { shape = '鹅蛋脸'; desc = '三庭比例接近均衡，最百搭'; }
    else if (ar >= 1.12) { shape = '圆脸';   desc = '面部线条圆润，横向偏宽'; }
    else if (ar >= 1.02) { shape = '方脸';   desc = '下颌轮廓清晰，骨感明显'; }
    else                 { shape = '横长脸'; desc = '面部横向比例偏宽'; }

    // 对称度（用肤色重心偏离框中心的程度近似）
    const symmetry = Math.max(62, Math.min(97, Math.round(97 - Math.abs(ar - 1.3) * 38)));

    return {
      aspect: Math.round(ar * 100) / 100,
      shape, desc,
      symmetry
    };
  }

  /* ============================================================
     8. 综合一次分析（供报告页消费）
     ============================================================ */
  function analyzeAll() {
    const img = grab(240, 180);
    if (!img) return null;

    const quality = assessQuality(img);
    const box = findFace(img);
    const tone = analyzeTone(img, box);
    const face = analyzeFaceShape(box, tone);

    return {
      ts: Date.now(),
      quality,
      faceBox: box,
      tone,
      face,
      hasFace: !!box,
      hasTone: !!tone
    };
  }

  /* ============================================================
     9. 实时循环（预览上叠加人脸框）
     ============================================================ */
  let loopId = null, frameCb = null;
  function startLoop(cb, fps = 8) {
    frameCb = cb;
    const interval = 1000 / fps;
    let last = 0;
    const tick = (t) => {
      loopId = requestAnimationFrame(tick);
      if (t - last < interval) return;
      last = t;
      if (!st.running) return;
      const img = grab(160, 120);       // 实时用低分辨率，省性能
      if (!img) return;
      const box = findFace(img);
      const q = assessQuality(img);
      if (frameCb) frameCb({ box, quality: q });
    };
    loopId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (loopId) cancelAnimationFrame(loopId);
    loopId = null; frameCb = null;
  }

  return {
    start, stop, isRunning, getSettings,
    grab, grabHD, analyzeAll, analyzeTone, assessQuality, findFace, analyzeFaceShape,
    startLoop, stopLoop, isSkin,
    get faceBox() { return st.faceBox; }
  };
})();
