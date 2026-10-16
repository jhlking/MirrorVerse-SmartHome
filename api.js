/* ===================================================================
   镜界 JINGJIE · 后端 API 客户端（v6.0）
   ===================================================================
   职责：把前端的「分析结果 → 建议方案 / 历史记录 / 趋势 / 用户档案」
        这四类数据，透明地对接到 Python 后端（server.py）。

   设计要点 —— 优雅降级：
     · 后端在线  → 走真实 REST API，数据落库到 SQLite，跨会话留存；
     · 后端离线  → 自动回落到前端本地规则引擎（advisor.js）+ localStorage，
                  页面功能完全不掉线，只把数据源标记切到「本地」。

   判定逻辑：启动时探测一次 GET /api/health。
     · 命中且 ok:true  → online
     · 超时 / 报错     → offline（后续不再反复探测，避免拖慢交互）

   暴露：window.API
     · API.ready()                 → Promise<boolean>  是否可用
     · API.online                  → 当前是否在线（同步可读）
     · API.source                  → 'server' | 'local'
     · API.label()                 → 给 UI 显示的数据源文案
     · API.analyze(analysis,posture,gender)   → Promise<plan|null>
     · API.saveReport(analysis,posture,gender)→ Promise<{id,plan}|null>
     · API.history(limit,gender)              → Promise<rows[]>
     · API.trend(limit,gender)                → Promise<{labels,scores}|null>
     · API.stats()                            → Promise<{count,avgScore,latestScore}|null>
     · API.getProfile() / API.saveProfile(obj) → Promise<profile|null>
     · API.badge(hostEl)                      → 在指定容器挂载数据源胶囊
=================================================================== */

const API = (() => {
  // 后端地址：同源部署时留空即可；本地原型（file:// 或 静态服务器）指向 8899
  const BASE = (() => {
    try {
      if (location.protocol === 'file:') return 'http://127.0.0.1:8899';
      const h = location.hostname;
      if (h === '127.0.0.1' || h === 'localhost') {
        // 若静态服务器与后端同源（后端也托管了静态资源），直接用相对路径
        return location.port === '8899' ? '' : 'http://127.0.0.1:8899';
      }
      return 'http://127.0.0.1:8899';
    } catch (e) { return 'http://127.0.0.1:8899'; }
  })();

  const TIMEOUT = 2500;      // 探测超时（毫秒），短一点避免卡住首屏
  const REQ_TIMEOUT = 6000;  // 常规请求超时

  let _online = false;
  let _probed = false;
  let _probePromise = null;

  /* ---------- 底层请求：带超时的 fetch，失败即抛 ---------- */
  function _fetch(path, opts) {
    opts = opts || {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || REQ_TIMEOUT);
    const init = {
      method: opts.method || 'GET',
      signal: ctrl.signal,
      headers: Object.assign({ 'Accept': 'application/json' }, opts.headers || {}),
    };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(BASE + path, init)
      .then(r => {
        clearTimeout(timer);
        if (!r.ok) {
          // 4xx/5xx 也尽量解析出 error 文案
          return r.json().catch(() => ({})).then(j => {
            const msg = (j && j.error && j.error.message) || ('HTTP ' + r.status);
            const err = new Error(msg);
            err.status = r.status;
            throw err;
          });
        }
        return r.json();
      })
      .catch(e => { clearTimeout(timer); throw e; });
  }

  /* ---------- 探测后端是否在线（只探一次） ---------- */
  function ready() {
    if (_probed) return Promise.resolve(_online);
    if (_probePromise) return _probePromise;
    _probePromise = _fetch('/api/health', { timeout: TIMEOUT })
      .then(d => {
        _online = !!(d && d.ok);
        _probed = true;
        if (_online) console.info('[API] 后端在线 →', d.app, d.version, '· 数据源：服务端 SQLite');
        return _online;
      })
      .catch(() => {
        _online = false;
        _probed = true;
        console.info('[API] 后端离线 → 回落到本地规则引擎 + localStorage');
        return false;
      });
    return _probePromise;
  }

  /* ---------- 数据源标签 ---------- */
  function source() { return _online ? 'server' : 'local'; }
  function label() { return _online ? '服务端 · SQLite' : '本地模式'; }

  /* ---------- 数据源胶囊：挂到页面上，让「后端真的接进来了」可见 ---------- */
  function badge(hostEl) {
    const el = typeof hostEl === 'string' ? document.querySelector(hostEl) : hostEl;
    if (!el) return;
    ready().then(ok => {
      el.innerHTML = `<span class="ds-badge ${ok ? 'on' : 'off'}" title="${
        ok ? '数据由 Python 后端（SQLite）提供，跨会话留存' : '未检测到后端服务，已回落本地演示数据'
      }"><i></i>${ok ? '服务端 · SQLite' : '本地模式'}</span>`;
    });
  }

  /* ---------- 业务封装：在线走 API，离线返回 null 交给调用方兜底 ---------- */
  function analyze(analysis, posture, gender) {
    return ready().then(ok => {
      if (!ok) return null;
      return _fetch('/api/analyze', { method: 'POST', body: { analysis, posture, gender } })
        .then(d => d.plan || null)
        .catch(e => { console.warn('[API] analyze 失败，回落本地:', e.message); return null; });
    });
  }

  function saveReport(analysis, posture, gender) {
    return ready().then(ok => {
      if (!ok) return null;
      return _fetch('/api/reports', { method: 'POST', body: { analysis, posture, gender } })
        .catch(e => { console.warn('[API] saveReport 失败:', e.message); return null; });
    });
  }

  function history(limit, gender) {
    return ready().then(ok => {
      if (!ok) return [];
      const q = new URLSearchParams({ limit: String(limit || 20) });
      if (gender) q.set('gender', gender);
      return _fetch('/api/reports?' + q.toString())
        .then(d => (d && d.items) || [])
        .catch(() => []);
    });
  }

  function trend(limit, gender) {
    return ready().then(ok => {
      if (!ok) return null;
      // 先按性别过滤；若样本太少（<3 点）不足以成曲线，则回落为全部历史，
      // 避免「切换性别后趋势图几乎空白」的观感。两者都是用户自己的历史。
      const MIN_PTS = 3;
      const q1 = new URLSearchParams({ limit: String(limit || 6) });
      if (gender) q1.set('gender', gender);
      return _fetch('/api/trend?' + q1.toString())
        .then(d1 => {
          if (d1 && d1.scores && d1.scores.length >= MIN_PTS) return d1;
          return _fetch('/api/trend?limit=' + String(limit || 6))
            .then(d2 => (d2 && d2.scores && d2.scores.length >= (d1 ? d1.scores.length : 0) ? d2 : d1))
            .catch(() => d1);
        })
        .then(d => (d && d.scores && d.scores.length ? d : null))
        .catch(() => null);
    });
  }

  function stats() {
    return ready().then(ok => (!ok ? null : _fetch('/api/stats').catch(() => null)));
  }

  function getProfile() {
    return ready().then(ok => (!ok ? null : _fetch('/api/profile').catch(() => null)));
  }

  function saveProfile(obj) {
    return ready().then(ok => {
      if (!ok) return null;
      return _fetch('/api/profile', { method: 'PUT', body: obj }).catch(() => null);
    });
  }

  return {
    ready, source, label, badge,
    analyze, saveReport, history, trend, stats, getProfile, saveProfile,
    get online() { return _online; },
    BASE,
  };
})();

window.API = API;
