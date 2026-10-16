/* ===================================================================
   镜界 JINGJIE · AI 语音助手 UI 层
   浮层控制 / 声波联动 / 字幕打字机 / 关键词高亮
   =================================================================== */

const VoiceUI = (() => {

  const $ = id => document.getElementById(id);
  let panelOpen = false;
  let muteState = false;
  let typeTimer = null;
  let lastKey = 'report_pose';   // 默认重播体态报告

  /* ---------- 关键词高亮词典 ---------- */
  const HL = [
    { re: /(八十六|良好|正常范围|协调|优秀)/g, cls: 'hl-good' },
    { re: /(轻度|中度|偏移|建议|注意|偏冷)/g,  cls: 'hl-warn' },
    { re: /(头前伸|肩线倾斜|风险|预警|避免)/g, cls: 'hl-bad' },
    { re: /(\d+度\d+|\d+分|三十三|六十八|冷调冬型|雾霾蓝|薰衣紫|莓果)/g, cls: 'hl-key' }
  ];

  function highlight(text) {
    let html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 用占位避免嵌套替换冲突
    HL.forEach((h, i) => {
      html = html.replace(h.re, m => `\u0001${i}\u0001${m}\u0002`);
    });
    html = html.replace(/\u0001(\d+)\u0001([\s\S]*?)\u0002/g,
      (_, i, m) => `<span class="${HL[+i].cls}">${m}</span>`);
    return html;
  }

  /* ---------- 字幕打字机 ---------- */
  function showCaption(text, animate = true) {
    const el = $('vpCaption');
    if (!el) return;
    el.classList.remove('placeholder');
    clearInterval(typeTimer);

    if (!animate) {
      el.innerHTML = highlight(text);
      return;
    }

    // 让字幕总时长与语音播报时长接近：中文约 4.3 字/秒
    const CPS = 4.3;
    const step = Math.max(1, Math.round(CPS / 10));      // 每 100ms 揭示字数
    const interval = 100;
    let i = 0;
    const tick = () => {
      i += step;
      if (i > text.length) i = text.length;
      const partial = text.slice(0, i);
      el.innerHTML = highlight(partial) +
        (i < text.length ? '<span class="cursor"></span>' : '');
      el.scrollTop = el.scrollHeight;
      if (i >= text.length) clearInterval(typeTimer);
    };
    typeTimer = setInterval(tick, interval);
    tick();
  }

  function placeholder() {
    const el = $('vpCaption');
    if (!el) return;
    clearInterval(typeTimer);
    el.classList.add('placeholder');
    el.textContent = '点击下方按钮，或开始一次检测，我将为您播报体态与美学报告结论。';
  }

  /* ---------- 浮层开关 ---------- */
  function openPanel() {
    panelOpen = true;
    $('voicePanel').classList.add('show');
  }
  function closePanel() {
    panelOpen = false;
    $('voicePanel').classList.remove('show');
  }
  function togglePanel() {
    panelOpen ? closePanel() : openPanel();
  }

  /* ---------- 声波状态 ---------- */
  function setWave(active) {
    const w = $('vWave');
    if (w) w.classList.toggle('idle', !active);
  }

  /* ---------- FAB 状态 ---------- */
  function setFab(speaking, muted) {
    const f = $('voiceFab');
    if (!f) return;
    f.classList.toggle('speaking', !!speaking);
    f.classList.toggle('muted', !!muted);
  }

  /* ---------- 播放 / 停止 / 静音 ---------- */
  function play(key) {
    if (key) lastKey = key;
    openPanel();
    const s = Voice.getScript(lastKey);
    if (!s) return;

    $('vpPlayTxt').textContent = '重播';
    $('vpSub').textContent = s.title + ' · 正在播报';

    if (!Voice.isSupported()) {
      // 不支持语音合成：仅显示字幕
      showCaption(s.text);
      $('vpSub').textContent = '当前浏览器不支持语音，仅显示字幕';
      setWave(true);
      setFab(true, muteState);
      const dur = s.text.length / 4.3 * 1000 + 700;
      setTimeout(() => { setWave(false); setFab(false, muteState);
                         $('vpSub').textContent = '演示完成 · 点击可重播'; }, dur);
      return;
    }
    Voice.speak(lastKey);
  }

  function replay() { play(lastKey); }

  function stop() {
    Voice.stop();
    setWave(false);
    setFab(false, muteState);
    $('vpSub').textContent = '已停止播报';
    $('vpLive').style.display = 'none';
    clearInterval(typeTimer);
  }

  function toggleMute() {
    muteState = Voice.toggle();      // Voice.toggle 返回静音后的 enabled 状态
    const muted = !muteState;
    $('vpMute').textContent = muted ? '🔇' : '🔊';
    $('vpMute').classList.toggle('off', muted);
    setFab(Voice.isSpeaking(), muted);
    $('vpSub').textContent = muted
      ? '已静音 · 仅显示字幕'
      : '在线 · 随时为您播报检测结论';
  }

  /* ---------- 绑定 Voice 状态回调 ---------- */
  function bind() {
    Voice.onStateChange = (st) => {
      const live = $('vpLive');
      if (!live) return;

      if (st.speaking) {
        live.style.display = '';
        setWave(true);
        setFab(true, muteState);
        const changed = st.key && st.key !== lastKey;
        if (st.key) lastKey = st.key;
        const s = Voice.getScript(st.key) || (st.text ? { text: st.text, title: st.title } : null);
        $('vpSub').textContent = (st.title || '语音助手') + ' · 正在播报' + (st.silent ? '（静音·字幕）' : '');
        // 仅在切换到新文稿时重置字幕，避免重复广播打断打字机
        if (s && s.text && (changed || !$('vpCaption').dataset.playing)) {
          $('vpCaption').dataset.playing = '1';
          showCaption(s.text);
        }
        if (!panelOpen) openPanel();
      } else {
        live.style.display = 'none';
        setWave(false);
        setFab(false, muteState);
        const cap = $('vpCaption');
        if (cap) delete cap.dataset.playing;
        if (st.title === '' && st.text === '') {
          // 播报结束：确保字幕完整显示
          clearInterval(typeTimer);
          const s = Voice.getScript(lastKey);
          if (cap && s) cap.innerHTML = highlight(s.text);
          $('vpSub').textContent = muteState
            ? '已静音 · 仅显示字幕'
            : '播报完成 · 点击可重播';
        }
      }
    };

    // 兼容：speechSynthesis 未就绪时也允许点击
    if ($('vpMute') && !Voice.isSupported()) {
      $('vpMute').classList.add('off');
    }
  }

  /* ---------- 模拟打字机（无语音时的降级） ---------- */
  function simulate(key) {
    const s = Voice.getScript(key);
    if (!s) return;
    openPanel();
    $('vpSub').textContent = s.title + ' · 字幕演示';
    setWave(true);
    setFab(true, muteState);
    showCaption(s.text);
    const dur = s.text.length / 4.3 * 1000 + 800;
    setTimeout(() => {
      setWave(false);
      setFab(false, muteState);
      $('vpSub').textContent = '演示完成 · 点击可重播';
    }, dur);
  }

  function init() {
    Voice.init();
    bind();
    placeholder();
    setWave(false);
    // 默认静音图标状态
    if (!Voice.isEnabled()) $('vpMute').textContent = '🔇';
  }

  document.addEventListener('DOMContentLoaded', init);

  return { play, replay, stop, toggleMute, openPanel, closePanel, togglePanel,
           showCaption, placeholder, simulate, isMuted: () => muteState };
})();
