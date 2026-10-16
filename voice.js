/* ===================================================================
   镜界 JINGJIE · AI 语音播报引擎
   基于 Web Speech API (speechSynthesis)，零依赖、离线可用。
   演示时播报文稿提前写死，保证现场稳定。
   =================================================================== */

const Voice = (() => {

  /* ---------- 播报文稿（提前写死，现场演示用） ---------- */
  const SCRIPTS = {
    /* 分析完成 */
    analyze_done: {
      title: '分析完成',
      text: '分析完成。已提取三十三个骨骼关键点与六十八个面部特征点，正在为您生成个性化形象方案。'
    },

    /* 体态报告自动播报 */
    report_pose: {
      title: '体态健康报告',
      text: '您好，这是您的体态健康报告。本次体态综合评分八十六分，整体状态良好。' +
            '检测到两项轻度偏移：头前伸四度二，属于中度偏移，建议优先改善；' +
            '肩线倾斜二度一，属于轻度偏移。骨盆倾斜与脊柱侧弯均在正常范围。' +
            '建议每日进行两组收下巴训练，配合靠墙站立三分钟，重建颈深屈肌记忆。' +
            '本报告仅作居家风险预警，不作为医疗诊断。'
    },

    /* 美学报告播报 */
    report_face: {
      title: '面部美学报告',
      text: '接下来是面部美学报告。经色彩空间分析，您的肤色为冷调冬型，冷暖指数负二十四，偏冷。' +
            '脸型为鹅蛋脸偏长，三庭五眼比例协调，面部对称度良好。' +
            '建议主色选择雾霾蓝、薰衣紫等冷调低饱和色系，避免大面积暖黄。' +
            '穿搭推荐雾霾蓝针织搭配月光灰阔腿裤；妆容建议莓果色系唇妆，搭配冷棕调眼影。' +
            '配饰方面，银饰优于金饰，推荐珍珠或冷调宝石。'
    },

    /* 健康方案播报 */
    health_plan: {
      title: '健康调理方案',
      text: '根据本次采集结果，为您生成健康调理方案。' +
            '综合健康指数处于良好区间。饮食方面，建议补充维生素D与钙，' +
            '每周两次深海鱼补充欧米伽三，有助缓解颈肩肌肉紧张；同时控制精制糖与咖啡因摄入。' +
            '运动方面，每日两组收下巴训练，配合胸椎伸展与肩胛稳定训练。' +
            '作息方面，屏幕抬至视线水平，每五十分钟起身活动，二十三点半前入睡，保证七小时睡眠。'
    },

    /* 镜面控制回应 */
    mirror_ready: {
      title: '镜面就绪',
      text: '镜面控制已就绪。您可以旋转镜面观察侧面姿态，或调整补光参数获得更好的拍摄效果。'
    },

    /* 首页欢迎 */
    home_welcome: {
      title: '欢迎回来',
      text: '欢迎回来。镜界智能落地镜已连接，位于玄关零一号。点击开始形象检测，三十秒获取您的体态与美学报告。'
    }
  };

  /* ---------- 状态 ---------- */
  const state = {
    enabled: true,        // 语音总开关
    supported: false,     // 浏览器是否支持
    speaking: false,
    voice: null,          // 选中的中文女声
    rate: 1.0,
    pitch: 1.06,
    queue: [],            // 待播报队列
    currentKey: null,
    onStateChange: null,  // 回调：状态变化通知 UI
    onBoundary: null      // 回调：逐字边界（做字幕）
  };

  /* ---------- 优选中文女声 ---------- */
  function pickVoice() {
    if (!window.speechSynthesis) return null;
    const vs = speechSynthesis.getVoices();
    if (!vs.length) return null;

    // 优先级：中文女声 > 中文任意 > 默认
    const zh = vs.filter(v => /zh|cmn|Chinese/i.test(v.lang));
    const prefer = [
      /Xiaoxiao|晓晓/i, /Xiaoyi|晓伊/i, /Huihui|慧慧/i, /Yaoyao|瑶瑶/i,
      /female|女/i, /Tingting|婷婷/i, /Google.*普通话/i
    ];
    for (const re of prefer) {
      const hit = zh.find(v => re.test(v.name));
      if (hit) return hit;
    }
    // 中文女声启发式（名称常见女性名）
    const fz = zh.find(v => /Xiao|Ya|Hui|Mei|Ting|Lin|Yan/i.test(v.name));
    if (fz) return fz;
    return zh[0] || vs[0];
  }

  /* ---------- 初始化 ---------- */
  function init() {
    state.supported = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
    if (!state.supported) {
      console.warn('[Voice] 当前浏览器不支持语音合成');
      return;
    }
    const load = () => { state.voice = pickVoice(); };
    load();
    speechSynthesis.onvoiceschanged = load;
    // 某些浏览器首次调用需预热
    setTimeout(() => { if (state.voice === null) load(); }, 600);
    armUnlock();
  }

  /* ---------- 语音解锁（绕过浏览器自动播放策略） ---------- */
  let unlocked = false;
  function armUnlock() {
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      try {
        // 用一段空文本触发，让浏览器把后续播报视为"用户触发的用户交互链"
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        speechSynthesis.speak(u);
        speechSynthesis.cancel();
      } catch (e) { /* 忽略 */ }
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }

  /* ---------- 核心播报 ---------- */
  function speak(key, opts = {}) {
    if (!state.supported) return false;
    const script = typeof key === 'string' ? SCRIPTS[key] : key;
    if (!script) return false;

    const text = opts.text || script.text;

    if (!state.enabled && !opts.force) {
      // 静音时只做字幕，不出声
      state.speaking = true;
      state.currentKey = typeof key === 'string' ? key : null;
      emitState({ speaking: true, silent: true, text, title: script.title || opts.title, key: state.currentKey });
      // 静音模式下的字幕由 UI 层处理，这里只广播状态
      return true;
    }

    // 打断上一句（直接 cancel，不走 stop() 以免重复广播/清队列）
    try { speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }

    const u = new SpeechSynthesisUtterance(text);
    if (state.voice) { u.voice = state.voice; u.lang = state.voice.lang; }
    else { u.lang = 'zh-CN'; }
    u.rate  = opts.rate  ?? state.rate;
    u.pitch = opts.pitch ?? state.pitch;
    u.volume = 1;

    state.speaking = true;
    state.currentKey = typeof key === 'string' ? key : null;

    // 立即广播（不依赖 onstart 时机，UI 响应更快）
    emitState({ speaking: true, silent: false, text, title: script.title || opts.title, key: state.currentKey });

    u.onstart = () => {
      emitState({ speaking: true, silent: false, text, title: script.title || opts.title, key: state.currentKey });
    };
    u.onend = () => {
      state.speaking = false;
      emitState({ speaking: false, text: '', title: '' });
      if (opts.onEnd) opts.onEnd();
      // 处理队列
      if (state.queue.length) {
        const nx = state.queue.shift();
        speak(nx.key, nx.opts);
      }
    };
    u.onerror = (e) => {
      const err = e.error;
      if (err === 'interrupted' || err === 'canceled') return;

      // 偶发竞态：稍等后自动重试一次
      if (err === 'synthesis-failed' && !opts._retried) {
        console.warn('[Voice] 播报重试（' + err + '）');
        setTimeout(() => {
          try { speechSynthesis.cancel(); } catch (_) {}
          speak(key, { ...opts, _retried: true });
        }, 220);
        return;
      }

      console.warn('[Voice] 播报错误', err);
      state.speaking = false;
      emitState({ speaking: false, text: '', title: '' });
    };

    // 逐字边界（部分浏览器支持）
    u.onboundary = (e) => {
      if (state.onBoundary && e.name === 'word') state.onBoundary(e.charIndex);
    };

    speechSynthesis.speak(u);
    return true;
  }

  /* ---------- 排队播报 ---------- */
  function enqueue(key, opts = {}) {
    if (state.speaking) state.queue.push({ key, opts });
    else speak(key, opts);
  }

  /* ---------- 停止 ---------- */
  function stop() {
    if (!state.supported) return;
    state.queue.length = 0;
    speechSynthesis.cancel();
    state.speaking = false;
    emitState({ speaking: false, text: '', title: '' });
  }

  /* ---------- 开关 ---------- */
  function setEnabled(on) {
    state.enabled = !!on;
    if (!on) stop();
    emitState({ enabled: state.enabled });
  }
  function toggle() { setEnabled(!state.enabled); return state.enabled; }

  /* ---------- 状态广播 ---------- */
  let last = {};
  function emitState(patch) {
    Object.assign(last, patch);
    if (state.onStateChange) state.onStateChange({ ...last, supported: state.supported });
  }

  /* ---------- 可用性 ---------- */
  function isSupported() { return state.supported; }
  function isSpeaking()  { return state.speaking; }
  function isEnabled()   { return state.enabled; }

  /* ---------- 获取文稿（供 UI 展示全文） ---------- */
  function getScript(key) { return SCRIPTS[key] || null; }
  function listScripts()  { return Object.keys(SCRIPTS); }

  return {
    init, speak, enqueue, stop, setEnabled, toggle,
    isSupported, isSpeaking, isEnabled,
    getScript, listScripts, SCRIPTS,
    set onStateChange(fn) { state.onStateChange = fn; },
    get onStateChange() { return state.onStateChange; }
  };
})();
