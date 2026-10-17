/* ===================================================================
   镜界 JINGJIE · 评测变化引擎（Variance Engine）
   ---------------------------------------------------------------
   目的：让「每一次测评效果都不一样」。

   为什么需要它？
   分析链路（肤色 / 脸型 / 质量）本身只对「画面内容」敏感。
   同一个人、同一光照、同一姿势，连拍两次的原始数据几乎相同，
   于是分数、置信度、建议文案逐字一致 —— 观感像「写死的」。

   本模块提供三层「合理变化」，且**全部可复现**（同一 seed 同结果）：

   1. seed 种子     —— 每次采集生成一个随机 seed，贯穿整次测评
   2. jitter()      —— 带上下限的有界抖动，用于分数 / 指标微调
   3. pickVary()    —— 从候选集里做「轮换优先」选择，避免连续重复

   关键约束：变化幅度必须**小到符合生理与物理常识**
   （皮肤状态、光照、姿态本来就有自然波动），
   绝不为了"不一样"而胡编乱造。
   =================================================================== */

const Variance = (() => {

  /* ---------------- 1. 种子 PRNG（mulberry32） ----------------
     轻量、快、分布均匀；同一 seed 产出同一序列，便于复现与调试。 */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let _rng = Math.random;      // 默认用系统随机
  let _seed = 0;

  /** 用新种子重置序列。seed 省略时自动取随机值并返回。 */
  function reseed(seed) {
    _seed = (seed == null) ? (Math.floor(Math.random() * 0xffffffff) >>> 0) : (seed >>> 0);
    _rng = mulberry32(_seed);
    return _seed;
  }

  function seed() { return _seed; }

  /** [0,1) 随机数（受种子控制） */
  function rnd() { return _rng(); }

  /** [min,max) 之间的浮点 */
  function range(min, max) { return min + _rng() * (max - min); }

  /** [min,max] 之间的整数（含两端） */
  function intRange(min, max) { return Math.floor(min + _rng() * (max - min + 1)); }

  /* ---------------- 2. 有界抖动 ----------------
     value 为中心值，spread 为最大偏移（对称），
     lo/hi 为绝对允许范围（先夹取，防止越界到不合常理的值）。 */
  function jitter(value, spread, lo = -Infinity, hi = Infinity) {
    const v = value + (_rng() * 2 - 1) * spread;
    return Math.max(lo, Math.min(hi, v));
  }

  /** 整数版抖动 */
  function jitterInt(value, spread, lo = -Infinity, hi = Infinity) {
    return Math.round(jitter(value, spread, lo, hi));
  }

  /* ---------------- 3. 轮换优先选择 ----------------
     从 candidates 里选一个，但**尽量不连续选同一个**。
     会参考上一次选中的索引，在其邻域内随机取一个新的。 */
  const _lastPick = {};
  function pickVary(key, candidates) {
    const n = candidates.length;
    if (!n) return undefined;
    if (n === 1) return candidates[0];
    const last = _lastPick[key];
    let idx = Math.floor(_rng() * n);
    if (idx === last) idx = (idx + 1 + Math.floor(_rng() * (n - 1))) % n;
    _lastPick[key] = idx;
    return candidates[idx];
  }

  /** 从数组里随机取 count 个（不重复，顺序随机） */
  function sample(arr, count) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(_rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, Math.min(count, a.length));
  }

  /** 按「微扰权重」重排数组：每项取一个随机键，叠加一点原始顺序偏置，
      使得顺序确实会变、但整体大致保持原有优先级倾向。
      bias 越小 → 越接近完全随机；bias 越大 → 越贴近原顺序。 */
  function nudge(arr, bias = 0.5) {
    const n = arr.length || 1;
    return arr
      .map((v, i) => ({ v, k: _rng() + (i / n) * bias }))
      .sort((a, b) => a.k - b.k)
      .map(o => o.v);
  }

  return {
    reseed, seed, rnd, range, intRange,
    jitter, jitterInt, pickVary, sample, nudge
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Variance;
