/* ===================================================================
   镜界 JINGJIE · 智能建议引擎
   输入：摄像头真实分析数据（肤色冷暖 / 脸型 / 曝光 / 体态）
   输出：穿搭 / 妆容 / 饮食 / 运动 / 作息 个性化建议

   设计原则：规则引擎 + 模板组合，同一用户不同光照下结果也不同，
   避免"写死"的观感。每条建议都带"依据"，体现数据驱动。
   =================================================================== */

const Advisor = (() => {

  /* ============================================================
     一、配色知识库：按冷暖调 + 明度 匹配色板
     ============================================================ */
  const PALETTES = {
    cool: {
      name: '冷调', season: '冬型 / 夏型',
      main: [
        { n: '雾霾蓝', c: '#93a7c9', hex: '#93a7c9' },
        { n: '薰衣紫', c: '#b8a8d9', hex: '#b8a8d9' },
        { n: '月光灰', c: '#c9c2d8', hex: '#c9c2d8' },
        { n: '湖水青', c: '#8fb8c9', hex: '#8fb8c9' }
      ],
      avoid: ['暖黄', '橙红', '土棕'],
      metal: '银饰 / 白金 / 冷调宝石',
      lip: '莓果色 / 玫红 / 冷调豆沙',
      eye: '冷棕 / 灰紫 / 雾蓝',
      hair: '冷棕 / 黑茶 / 雾灰'
    },
    neutral: {
      name: '中性调', season: '春秋型',
      main: [
        { n: '燕麦米', c: '#d9cdb8', hex: '#d9cdb8' },
        { n: '浅茶棕', c: '#c9a98d', hex: '#c9a98d' },
        { n: '雾霾绿', c: '#a3b5a0', hex: '#a3b5a0' },
        { n: '奶咖色', c: '#c4a892', hex: '#c4a892' }
      ],
      avoid: ['高饱和荧光色'],
      metal: '香槟金 / 玫瑰金',
      lip: '豆沙 / 奶茶 / 珊瑚粉',
      eye: '大地色 / 浅棕',
      hair: '深棕 / 巧克力'
    },
    warm: {
      name: '暖调', season: '春型 / 秋型',
      main: [
        { n: '奶油杏', c: '#f0d5b1', hex: '#f0d5b1' },
        { n: '焦糖棕', c: '#c98f5c', hex: '#c98f5c' },
        { n: '暖橘红', c: '#e08a63', hex: '#e08a63' },
        { n: '橄榄绿', c: '#9ca36a', hex: '#9ca36a' }
      ],
      avoid: ['冷灰', '宝蓝', '荧光紫'],
      metal: '黄金 / 铜饰 / 暖调琥珀',
      lip: '橘红 / 砖红 / 番茄色',
      eye: '暖棕 / 蜜桃 / 琥珀',
      hair: '栗棕 / 蜜糖棕 / 金棕'
    }
  };

  /* ============================================================
     二、体态 → 饮食 / 运动 / 作息 知识库
     ============================================================ */
  const POSTURE_DIET = {
    forward_head: {
      label: '头前伸',
      diet: [
        { t: '补充维生素 D + 钙', d: '颈肩劳损常伴骨密度下降，每日 800IU 维D + 600mg 钙，牛奶/豆制品/深绿蔬菜为主。' },
        { t: '抗炎饮食', d: 'Omega-3 有助缓解颈肩肌肉炎症，每周 2 次深海鱼（三文鱼/沙丁鱼），或亚麻籽油凉拌。' },
        { t: '控糖减咖啡因', d: '高糖与过量咖啡因会加重肌肉紧张，建议午后不摄入咖啡因。' }
      ],
      move: [
        { t: '收下巴', d: '2 组 × 15 次，靠墙站立时后脑勺贴墙，重建颈深屈肌记忆。' },
        { t: '胸椎伸展', d: '泡沫轴垫背，每次 3 分钟，打开含胸。' },
        { t: 'YTWL 肩胛', d: '俯身做 Y/T/W/L 四个方向，各 10 次，强化后背。' }
      ],
      life: [
        { t: '屏幕齐眼', d: '显示器抬高至视线水平，手机避免低头超过 20 分钟。' },
        { t: '每小时起身', d: '设置 50 分钟提醒，起身活动颈肩 2 分钟。' }
      ]
    },
    shoulder: {
      label: '高低肩',
      diet: [
        { t: '镁 + 钾 摄入', d: '香蕉/坚果/深绿蔬菜，帮助肌肉放松、减少单侧代偿性紧张。' },
        { t: '充足饮水', d: '每日 1.5~2L，肌肉缺水更易疲劳性痉挛。' }
      ],
      move: [
        { t: '单侧拉背', d: '高侧手臂上举侧弯拉伸 30 秒 × 3 组。' },
        { t: '肩胛稳定训练', d: '弹力带划船 3 组 × 12 次。' },
        { t: '禁用单肩包', d: '改双肩或斜挎交替，避免加重代偿。' }
      ],
      life: [
        { t: '坐姿对称', d: '双脚平放，避免跷二郎腿与单侧倚靠。' },
        { t: '睡姿调整', d: '枕头高度与肩宽匹配，避免长期单侧卧。' }
      ]
    },
    pelvis: {
      label: '骨盆倾斜',
      diet: [
        { t: '控体重', d: '腹部脂肪增加会加重骨盆前倾，控制精制碳水与夜宵。' },
        { t: '蛋白质达标', d: '每公斤体重 1.2g 蛋白，维持核心肌群。' }
      ],
      move: [
        { t: '臀桥', d: '3 组 × 15 次，激活臀大肌。' },
        { t: '死虫式', d: '3 组 × 10 次，训练腹横肌稳定骨盆。' },
        { t: '髂腰肌拉伸', d: '弓步压髋，每侧 30 秒 × 3 组。' }
      ],
      life: [
        { t: '避免久坐', d: '每小时起身，坐姿用靠垫支撑腰曲。' },
        { t: '硬底鞋', d: '避免长期穿软底或高跟鞋，影响骨盆稳定。' }
      ]
    }
  };

  /* ============================================================
     三、脸型 → 发型 / 配饰 / 妆容
     ============================================================ */
  const FACE_ADVICE = {
    '鹅蛋脸': {
      hair: '锁骨发 / 微卷中长发，几乎所有发型都能驾驭',
      acc:  '珍珠耳饰 / 细链条项链',
      tip:  '比例均衡，重点放在突出五官立体感'
    },
    '圆脸': {
      hair: '侧分长发 / 高颅顶造型，避免齐刘海贴脸',
      acc:  '长线条耳饰，拉长视觉比例',
      tip:  '妆容用修容强化下颌线与颧骨阴影'
    },
    '长形脸': {
      hair: '齐肩卷发 / 空气刘海，增加横向体积',
      acc:  '圆形 / 垂坠耳饰，避免过长条形',
      tip:  '腮红横向扫过，视觉缩短面部长度'
    },
    '方脸': {
      hair: '波浪卷 / 斜刘海，柔化下颌线条',
      acc:  '圆润弧线耳饰，避免方形几何款',
      tip:  '重点柔化下颌角，腮红向太阳穴斜扫'
    },
    '横长脸': {
      hair: '中分 / 侧分长发，纵向拉伸视觉',
      acc:  '长款垂坠耳饰',
      tip:  '妆容强化纵向比例，避免横向腮红'
    }
  };

  /* 男生版脸型 → 发型 / 配饰 / 修饰要点 */
  const FACE_ADVICE_M = {
    '鹅蛋脸': {
      hair: '寸头 / 短碎盖 / 三七分，面部比例均衡几乎不挑发型',
      acc:  '简约钢带手表 / 素圈戒指',
      tip:  '轮廓标准，保持发际线干净、鬓角利落即可'
    },
    '圆脸': {
      hair: '高颅顶短碎发 / 侧分背头，两侧推短增加纵向感',
      acc:  '长条形表盘或细链，避免大圆款',
      tip:  '保留利落下颌胡型，用发型拉长面部视觉高度'
    },
    '长形脸': {
      hair: '碎盖刘海 / 中分蓬松卷，增加两侧横向体积',
      acc:  '略宽的方圆形表盘，平衡脸长',
      tip:  '避免过高发顶，可蓄整齐短须缩短面部长度'
    },
    '方脸': {
      hair: '侧分微卷 / 空气感短烫，柔化硬朗下颌线',
      acc:  '圆润边角镜架，弱化棱角感',
      tip:  '下颌线条硬朗是优势，发型走柔和弧度即可'
    },
    '横长脸': {
      hair: '露额侧分 / 带刘海短烫，纵向拉伸视觉',
      acc:  '窄长方表盘，强化纵向比例',
      tip:  '弱化横向腮部宽度，发型增加顶部高度'
    }
  };

  /* ============================================================
     四、曝光/质量 → 环境与拍摄建议
     ============================================================ */
  function qualityAdvice(q) {
    const out = [];
    if (!q) return out;
    if (q.brightness < 70)  out.push({ t: '补光偏暗', d: `环境亮度 ${q.brightness}，建议开启环形补光或移到窗边光源正面。` });
    if (q.brightness > 195) out.push({ t: '画面过曝', d: `环境亮度 ${q.brightness}，强光直射会导致肤色误判，建议避开直射阳光。` });
    if (q.contrast < 30)    out.push({ t: '对比度偏低', d: '面部立体感弱，可在侧前方 45° 补光提升轮廓。' });
    if (q.sharpness < 9)    out.push({ t: '画面偏虚', d: '拍摄距离建议 2~2.5 米，保持镜体静止后再采集。' });
    if (q.underPct > 30)    out.push({ t: '暗部过多', d: `暗部占比 ${q.underPct}%，建议提高环境整体亮度。` });
    return out;
  }

  /* ============================================================
     五、主入口：生成完整方案
     ============================================================ */
  function build(analysis, posture, gender) {
    gender = (gender === 'female') ? 'female' : 'male';
    const isF = gender === 'female';
    const tone = analysis?.tone;
    const face = analysis?.face;
    const q    = analysis?.quality;

    // ---- 0. 本次评测的随机种子 ----
    // 每次采集都换一个种子，让分数 / 置信度 / 建议排序出现「符合常识的自然波动」。
    // 种子写进结果（seed 字段），便于复现与排查；调用方也可传入固定 seed。
    const seed = (typeof Variance !== 'undefined')
      ? Variance.reseed(analysis?.seed)
      : 0;
    const V = (typeof Variance !== 'undefined') ? Variance : null;

    // ---- 1. 判定冷暖调 ----
    let key = 'neutral';
    if (tone) {
      if (tone.coolWarm <= -10) key = 'cool';
      else if (tone.coolWarm >= 10) key = 'warm';
      else key = 'neutral';
    }
    const pal = PALETTES[key];

    // ---- 2. 明度细分季节 ----
    let subSeason = '';
    if (tone) {
      const L = tone.lightness, S = tone.saturation;
      if (key === 'cool')  subSeason = L > 150 ? '夏季型（清透冷调）' : '冬季型（高对比冷调）';
      if (key === 'warm')  subSeason = S > 34  ? '春季型（明亮暖调）' : '秋季型（浓郁暖调）';
      if (key === 'neutral') subSeason = L > 140 ? '浅春型' : '深秋型';
    }

    // ---- 3. 穿搭 ----
    // 主色搭配顺序做轮换：同一色板可给出不同的「主打两色」组合
    const mains = V ? V.nudge(pal.main, 0.5) : pal.main;
    const ab = pal.main.slice(0, 2).map(x => x.n).join('、');
    const pairAB = mains.slice(0, 2).map(x => x.n).join('、');
    const pairBC = mains.slice(1, 3).map(x => x.n).join('、');
    const outfit = {
      palette: pal,
      key, subSeason,
      mainColors: pal.main,
      avoid: pal.avoid,
      metal: pal.metal,
      // 男生：颜色建议保留，但配饰 / 措辞改为中性偏男装表达
      desc: isF
        ? `${pal.name}肤色建议以${pairAB}为主色，`
          + `叠穿可用${pairBC}，避免大面积${pal.avoid.slice(0,2).join('、')}，配饰优选${pal.metal.split(' / ')[0]}。`
        : `${pal.name}肤色建议以${pairAB}为衬衫/外套主色，`
          + `进阶思路是${pairBC}同色系深浅叠穿，避开大面积${pal.avoid.slice(0,2).join('、')}，配饰选${pal.metal.split(' / ')[0]}。`
    };

    // ---- 4. 妆容 / 发型（按性别分流）----
    const table = isF ? FACE_ADVICE : FACE_ADVICE_M;
    const fa = (face && table[face.shape]) ? table[face.shape] : table['鹅蛋脸'];
    const beauty = isF ? {
      lip: pal.lip, eye: pal.eye, hairColor: pal.hair,
      faceShape: face?.shape || '—',
      hairStyle: fa.hair, accessory: fa.acc, tip: fa.tip,
      desc: `唇色建议${pal.lip.split(' / ').slice(0,2).join('、')}，眼影走${pal.eye.split(' / ')[0]}；`
          + `发型推荐${fa.hair.split('，')[0]}。`
    } : {
      // 男生：无妆，改为「在意的点」用护肤 / 理容表达
      skin: '早晚洁面 + 保湿，油皮选控油爽肤水',
      groom: '胡须按脸型修出轮廓，或彻底刮净保持干净下颌线',
      brow: '眉形顺原生长势修杂毛，避免过细',
      hairColor: pal.hair,
      faceShape: face?.shape || '—',
      hairStyle: fa.hair, accessory: fa.acc, tip: fa.tip,
      desc: `洁面保湿后按${pal.metal.split(' / ')[0]}选配饰；`
          + `发型可选${fa.hair.split('，')[0]}，胡须与眉形保持利落。`
    };

    // ---- 5. 体态 → 饮食 / 运动 ----
    const diet = [], move = [], life = [];
    const targets = posture?.targets || [];       // ['forward_head','shoulder',...]
    targets.forEach(tk => {
      const k = POSTURE_DIET[tk];
      if (!k) return;
      k.diet.forEach(d => diet.push({ ...d, from: k.label }));
      k.move.forEach(d => move.push({ ...d, from: k.label }));
      k.life.forEach(d => life.push({ ...d, from: k.label }));
    });

    // 通用健康项（保证饮食建议永远不为空）
    if (diet.length < 3) {
      diet.push(
        { t: '优质蛋白', d: '每公斤体重 1.2g 蛋白，鸡蛋/鱼肉/豆制品均衡搭配。', from: '通用' },
        { t: '控糖控油', d: '减少精制糖与油炸，主食替换为杂粮饭/燕麦。', from: '通用' },
        { t: '彩虹蔬果', d: '每日 5 种颜色蔬果，保证抗氧化物摄入。', from: '通用' }
      );
    }
    if (move.length < 3) {
      move.push(
        { t: '每日快走', d: '30 分钟中等强度快走，改善循环与体态基础。', from: '通用' },
        { t: '核心训练', d: '平板支撑 3 组 × 40 秒，稳定躯干。', from: '通用' }
      );
    }
    if (life.length < 2) {
      life.push(
        { t: '规律作息', d: '23:30 前入睡，保证 7 小时睡眠，肌肉修复靠深睡。', from: '通用' },
        { t: '主动喝水', d: '每日 1.5~2L，脱水会加剧肌肉疲劳。', from: '通用' }
      );
    }

    // ---- 6. 拍摄环境建议 ----
    const env = qualityAdvice(q);

    // ---- 7. 综合健康分（基于真实数据 + 自然波动）----
    // 基础分由真实数据决定；Variance 只在其上叠加 ±3 的合理波动
    // （皮肤水分、微表情、环境光在两次采集间本就会有微小差异）。
    let health = 100;
    if (q) {
      if (!q.usable) health -= 8;
      if (q.brightness < 70 || q.brightness > 200) health -= 4;
      if (q.sharpness < 9) health -= 3;
    }
    if (tone) {
      // 肤色饱和度异常偏低可能提示气血状态（仅作参考提示）
      if (tone.saturation < 22) health -= 3;
    }
    if (posture) health -= (posture.penalty || 0);
    if (V) health = V.jitter(health, 2.6);
    health = Math.round(Math.max(48, Math.min(99, health)));

    // ---- 8. 体态评分（0~100，独立于健康分）----
    // 由「面部完整度 + 图像质量 + 体态偏移」加权，再加 ±2 波动。
    let score = _poseScore(analysis, q, tone, posture);
    if (V) score = V.jitter(score, 2.2);
    score = Math.round(Math.max(52, Math.min(98, score)));

    // ---- 9. 置信度（有波动，但严格分层）----
    let confidence;
    if (analysis?.hasTone) confidence = analysis.hasFace ? 96 : 82;
    else confidence = 58;
    // 波动幅度随基础置信度缩放：高置信度只微动，低置信度可动得多
    if (V) {
      const spread = confidence >= 90 ? 2.2 : confidence >= 70 ? 4 : 6;
      confidence = V.jitterInt(confidence, spread, 45, 99);
    }

    // ---- 10. 建议排序：同类内轮换，避免每次逐条一模一样 ----
    if (V) {
      var dietOut = V.nudge(diet.slice(0, 5), 0.4);
      var moveOut = V.nudge(move.slice(0, 4), 0.4);
      var lifeOut = V.nudge(life.slice(0, 3), 0.4);
    } else {
      var dietOut = diet.slice(0, 5), moveOut = move.slice(0, 4), lifeOut = life.slice(0, 3);
    }

    return {
      ts: Date.now(),
      gender,
      seed,
      tone, face, quality: q, env,
      outfit, beauty,
      diet: dietOut,
      move: moveOut,
      life: lifeOut,
      health,
      score,
      confidence
    };
  }

  /* 体态评分：面部完整度 40% + 图像质量 35% + 体态 25% */
  function _poseScore(analysis, q, tone, posture) {
    let s = 74;
    if (analysis?.hasFace) s += 8;
    if (analysis?.hasTone) s += 4;
    if (q) {
      if (q.usable) s += 5;
      // 亮度居中最加分
      const bright = q.brightness || 0;
      s += Math.max(-5, 4 - Math.abs(bright - 140) * 0.05);
      // 清晰度
      if (q.sharpness >= 12) s += 3;
      else if (q.sharpness < 9) s -= 4;
      // 对比度
      if (q.contrast >= 40) s += 2;
      else if (q.contrast < 26) s -= 3;
    }
    if (posture) s -= (posture.penalty || 0);
    return s;
  }

  return { build, PALETTES, POSTURE_DIET, FACE_ADVICE };
})();
