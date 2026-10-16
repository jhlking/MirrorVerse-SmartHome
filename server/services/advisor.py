"""
镜界 JINGJIE · 建议规则引擎（服务端）
================================
把前端 advisor.js 的配色 / 穿搭 / 饮食知识库搬到服务端，
使「分析 → 建议」的完整链路可在后端独立运行（前端只负责渲染）。

设计要点：
  - 知识库与前端保持同源，避免两端建议不一致
  - 输入为前端采集的 analysis（肤色/脸型/质量），输出为标准方案结构
  - 纯函数，无副作用，便于测试
"""
from ..logger import get

log = get("advisor")


# ---------- 一、肤色冷暖 → 配色知识库 ----------
PALETTES = {
    "cool": {
        "name": "冷调", "season": "冬型 / 夏型",
        "main": [
            {"n": "雾霾蓝", "c": "#93a7c9"},
            {"n": "薰衣紫", "c": "#b8a8d9"},
            {"n": "月光灰", "c": "#c9c2d8"},
            {"n": "湖水青", "c": "#8fb8c9"},
        ],
        "avoid": ["暖黄", "橙红", "土棕"],
        "metal": "银饰 / 白金 / 冷调宝石",
        "lip": "莓果色 / 玫红 / 冷调豆沙",
        "eye": "冷棕 / 灰紫 / 雾蓝",
        "hair": "冷棕 / 黑茶 / 雾灰",
    },
    "neutral": {
        "name": "中性调", "season": "春秋型",
        "main": [
            {"n": "燕麦米", "c": "#d9cdb8"},
            {"n": "浅茶棕", "c": "#c9a98d"},
            {"n": "雾霾绿", "c": "#a3b5a0"},
            {"n": "奶咖色", "c": "#c4a892"},
        ],
        "avoid": ["高饱和荧光色"],
        "metal": "香槟金 / 玫瑰金",
        "lip": "豆沙 / 奶茶 / 珊瑚粉",
        "eye": "大地色 / 浅棕",
        "hair": "深棕 / 巧克力",
    },
    "warm": {
        "name": "暖调", "season": "春型 / 秋型",
        "main": [
            {"n": "奶油杏", "c": "#f0d5b1"},
            {"n": "焦糖棕", "c": "#c98f5c"},
            {"n": "暖橘红", "c": "#e08a63"},
            {"n": "橄榄绿", "c": "#9ca36a"},
        ],
        "avoid": ["冷灰", "宝蓝", "荧光紫"],
        "metal": "黄金 / 铜饰 / 暖调琥珀",
        "lip": "橘红 / 砖红 / 番茄色",
        "eye": "暖棕 / 蜜桃 / 琥珀",
        "hair": "栗棕 / 蜜糖棕 / 金棕",
    },
}

# ---------- 二、脸型 → 发型/配饰建议 ----------
FACE_ADVICE = {   # 女生
    "鹅蛋脸": {"hair": "百搭脸型，长直发或微卷均可，重点在发质光泽。",
               "acc": "耳饰选长线条，避免过宽耳钉压脸。", "tip": "低马尾/半扎最显气质。"},
    "圆脸":   {"hair": "增高颅顶，侧分刘海拉长脸型。",
               "acc": "长线耳坠、V 型项链拉长视线。", "tip": "避免齐刘海与贴头皮发型。"},
    "长形脸": {"hair": "横向蓬松，齐刘海或空气刘海缩短脸长。",
               "acc": "圆润耳饰、短链平衡比例。", "tip": "避免中分长直发。"},
    "方形脸": {"hair": "柔和卷发柔化下颌角，斜刘海修饰。",
               "acc": "圆润弧线耳饰，避免方正造型。", "tip": "中长发带波浪最合适。"},
    "横长脸": {"hair": "顶部蓬松、两侧内收，视觉收紧脸宽。",
               "acc": "竖向长链、垂坠耳饰。", "tip": "避免横向宽檐帽。"},
}
FACE_ADVICE_M = {  # 男生
    "鹅蛋脸": {"hair": "寸头、背头、微卷中分均适合，发型容错率高。",
               "brow": "眉形自然有型即可，无需过度修整。", "tip": "干净利落最显精神。"},
    "圆脸":   {"hair": "两侧推短，顶部留长度增高颅顶。",
               "brow": "眉峰明显些可增加脸部棱角感。", "tip": "避免两侧蓬松的圆润发型。"},
    "长形脸": {"hair": "两侧保留体积，避免顶部过高。",
               "brow": "平眉缩短视觉脸长。", "tip": "中长发型或带刘海更协调。"},
    "方形脸": {"hair": "层次剪裁、侧分背头，弱化下颌角。",
               "brow": "眉尾稍上扬，增加柔和感。", "tip": "蓄胡需修剪出弧线。"},
    "横长脸": {"hair": "顶部增高、两侧收窄，视觉收脸宽。",
               "brow": "眉形稍长可平衡宽度。", "tip": "避免过宽的胡子造型。"},
}

# ---------- 三、体态偏移 → 饮食/运动/作息 ----------
POSTURE_DIET = {
    "forward_head": {
        "label": "头前伸",
        "diet": [
            {"t": "补充维生素 D + 钙", "d": "颈肩劳损常伴骨密度下降，每日 800IU 维D + 600mg 钙，牛奶/豆制品/深绿蔬菜为主。"},
            {"t": "抗炎饮食", "d": "Omega-3 有助缓解颈肩肌肉炎症，每周 2 次深海鱼（三文鱼/沙丁鱼），或亚麻籽油凉拌。"},
            {"t": "控糖减咖啡因", "d": "高糖与过量咖啡因会加重肌肉紧张，建议午后不摄入咖啡因。"},
        ],
        "move": [
            {"t": "收下巴", "d": "2 组 × 15 次，靠墙站立时后脑勺贴墙，重建颈深屈肌记忆。"},
            {"t": "胸椎伸展", "d": "泡沫轴垫背，每次 3 分钟，打开含胸。"},
            {"t": "YTWL 肩胛", "d": "俯身做 Y/T/W/L 四个方向，各 10 次，强化后背。"},
        ],
        "life": [
            {"t": "屏幕齐眼", "d": "显示器抬高至视线水平，手机避免低头超过 20 分钟。"},
            {"t": "每小时起身", "d": "设置 50 分钟提醒，起身活动颈肩 2 分钟。"},
        ],
    },
    "shoulder": {
        "label": "高低肩",
        "diet": [
            {"t": "均衡蛋白摄入", "d": "肩背肌肉修复需足量蛋白，每公斤体重 1.2–1.6g，鸡胸/鱼/蛋/豆制品。"},
            {"t": "补镁放松", "d": "镁有助肌肉放松，坚果、深绿蔬菜、香蕉为佳，睡前可适量。"},
        ],
        "move": [
            {"t": "单侧拉伸", "d": "紧张侧斜方肌拉伸 30 秒 × 3 组，配合呼吸放松。"},
            {"t": "肩胛稳定", "d": "弹力带划船 3 组 × 12 次，均衡两侧力量。"},
        ],
        "life": [
            {"t": "单肩包换边", "d": "避免长期单侧负重，改双肩包或左右轮换。"},
            {"t": "坐姿对称", "d": "避免跷二郎腿与歪坐，双脚平放地面。"},
        ],
    },
    "pelvis": {
        "label": "骨盆侧倾",
        "diet": [
            {"t": "补充钙与维D", "d": "骨盆稳定依赖骨与核心，保证钙与维D 摄入。"},
            {"t": "控体重", "d": "腹部脂肪过多会加重腰椎前凸，注意总热量平衡。"},
        ],
        "move": [
            {"t": "臀桥", "d": "3 组 × 15 次，激活臀大肌，稳定骨盆。"},
            {"t": "死虫式", "d": "3 组 × 10 次，训练核心抗旋，改善骨盆控制。"},
        ],
        "life": [
            {"t": "避免久坐", "d": "每 50 分钟起身走动 2 分钟，减少骨盆前倾累积。"},
            {"t": "睡姿调整", "d": "侧睡时膝间夹枕，保持骨盆中立。"},
        ],
    },
}


def _tone_key(cool_warm):
    if cool_warm <= -12:
        return "cool"
    if cool_warm >= 12:
        return "warm"
    return "neutral"


def _sub_season(key, lightness, saturation):
    if key == "cool":
        return "夏季型（清透冷调）" if lightness > 150 else "冬季型（高对比冷调）"
    if key == "warm":
        return "春季型（明亮暖调）" if saturation > 34 else "秋季型（浓郁暖调）"
    return "浅春型" if lightness > 140 else "深秋型"


def _quality_advice(q):
    """采集环境问题 → [{t,d}]，与前端 env 契约一致。"""
    q = q or {}
    out = []
    if q.get("brightness") is not None and q["brightness"] < 58:
        out.append({"t": "环境偏暗", "d": "建议开启镜面环形补光，或面向主光源重拍。"})
    if q.get("brightness") is not None and q["brightness"] > 205:
        out.append({"t": "画面偏亮", "d": "避免正对强光源，防止高光溢出影响肤色判定。"})
    if q.get("contrast") is not None and q["contrast"] < 26:
        out.append({"t": "对比度偏低", "d": "增加侧向光可提升面部立体感与轮廓清晰度。"})
    if q.get("sharpness") is not None and q["sharpness"] < 7:
        out.append({"t": "画面偏模糊", "d": "请站稳并保持 60–80cm 距离，等待对焦完成再采集。"})
    return out


def build(analysis, posture=None, gender="male"):
    """
    生成完整建议方案（契约与前端 advisor.js 完全一致，便于无缝替换）。
    analysis: { tone:{rgb,lightness,saturation,hue,coolWarm,label,pixels},
                face:{shape,ratio}, quality:{brightness,contrast,sharpness,...},
                hasFace, hasTone }
    posture:  { targets:[...], penalty:int }
    gender:   'male' | 'female'
    返回: { gender, tone, face, quality, env[], outfit{}, beauty{},
            diet[], move[], life[], health, confidence, score }
    """
    analysis = analysis or {}
    gender = "female" if gender == "female" else "male"
    is_f = gender == "female"

    tone = analysis.get("tone") or {}
    face = analysis.get("face") or {}
    q = analysis.get("quality") or {}

    cool_warm = int(tone.get("coolWarm", 0) or 0)
    lightness = int(tone.get("lightness", 140) or 140)
    saturation = int(tone.get("saturation", 30) or 30)

    key = _tone_key(cool_warm)
    pal = PALETTES[key]
    sub = _sub_season(key, lightness, saturation)

    # 脸型建议（按性别分表）
    table = FACE_ADVICE if is_f else FACE_ADVICE_M
    shape = face.get("shape") or "鹅蛋脸"
    fa = table.get(shape) or table["鹅蛋脸"]

    # ---- 穿搭 ----
    main_names = [c["n"] for c in pal["main"][:2]]
    outfit = {
        "palette": {"name": pal["name"], "season": pal["season"]},
        "key": key,
        "subSeason": sub,
        "mainColors": [{"n": c["n"], "c": c["c"]} for c in pal["main"]],
        "avoid": pal["avoid"],
        "metal": pal["metal"],
        "desc": (
            f"{pal['name']}肤色建议以{'、'.join(main_names)}为主色，"
            f"避免大面积{'、'.join(pal['avoid'][:2])}，配饰优选{pal['metal'].split(' / ')[0]}。"
            if is_f else
            f"{pal['name']}肤色建议以{'、'.join(main_names)}为衬衫/外套主色，"
            f"避开大面积{'、'.join(pal['avoid'][:2])}，配饰选{pal['metal'].split(' / ')[0]}，外套可走同色系深浅叠穿。"
        ),
    }

    # ---- 妆容 / 理容（按性别分流）----
    if is_f:
        beauty = {
            "lip": pal["lip"], "eye": pal["eye"], "hairColor": pal["hair"],
            "faceShape": shape,
            "hairStyle": fa["hair"], "accessory": fa.get("acc", ""), "tip": fa["tip"],
            "desc": (f"唇色建议{'、'.join(pal['lip'].split(' / ')[:2])}，"
                     f"眼影走{pal['eye'].split(' / ')[0]}；"
                     f"发型推荐{fa['hair'].split('，')[0]}。"),
        }
    else:
        beauty = {
            "skin": "早晚洁面 + 保湿，油皮选控油爽肤水",
            "groom": "胡须按脸型修出轮廓，或彻底刮净保持干净下颌线",
            "brow": fa.get("brow", ""), "hairColor": pal["hair"],
            "faceShape": shape,
            "hairStyle": fa["hair"], "tip": fa["tip"],
            "desc": (f"洁面保湿后按{pal['metal'].split(' / ')[0]}选配饰；"
                     f"发型可选{fa['hair'].split('，')[0]}，胡须与眉形保持利落。"),
        }

    # ---- 体态 → 饮食/运动/作息（带来源标签 from）----
    diet, move, life = [], [], []
    seen = set()
    for tk in ((posture or {}).get("targets") or []):
        node = POSTURE_DIET.get(tk)
        if not node:
            continue
        seen.add(tk)
        for d in node["diet"]:
            diet.append({**d, "from": node["label"]})
        for m in node["move"]:
            move.append({**m, "from": node["label"]})
        for l in node["life"]:
            life.append({**l, "from": node["label"]})

    # 兜底：未指定体态目标时给出通用方案
    if not seen:
        node = POSTURE_DIET["forward_head"]
        diet = [{**d, "from": node["label"]} for d in node["diet"]]
        move = [{**m, "from": node["label"]} for m in node["move"]]
        life = [{**l, "from": node["label"]} for l in node["life"]]

    # 通用健康项（保证建议永不为空）
    if len(diet) < 3:
        diet += [
            {"t": "优质蛋白", "d": "每公斤体重 1.2g 蛋白，鸡蛋/鱼肉/豆制品均衡搭配。", "from": "通用"},
            {"t": "控糖控油", "d": "减少精制糖与油炸，主食替换为杂粮饭/燕麦。", "from": "通用"},
            {"t": "彩虹蔬果", "d": "每日 5 种颜色蔬果，保证抗氧化物摄入。", "from": "通用"},
        ]
    if len(move) < 3:
        move += [
            {"t": "每日快走", "d": "30 分钟中等强度快走，改善循环与体态基础。", "from": "通用"},
            {"t": "核心训练", "d": "平板支撑 3 组 × 40 秒，稳定躯干。", "from": "通用"},
        ]
    if len(life) < 2:
        life += [
            {"t": "规律作息", "d": "23:30 前入睡，保证 7 小时睡眠，肌肉修复靠深睡。", "from": "通用"},
            {"t": "主动喝水", "d": "每日 1.5~2L，脱水会加剧肌肉疲劳。", "from": "通用"},
        ]

    env = _quality_advice(q)

    # ---- 健康分（与前端同算法：基于真实质量 + 体态惩罚）----
    health = 100
    if q:
        if not q.get("usable", True):
            health -= 8
        if q.get("brightness") is not None and (q["brightness"] < 70 or q["brightness"] > 200):
            health -= 4
        if q.get("sharpness") is not None and q["sharpness"] < 9:
            health -= 3
    if tone and tone.get("saturation") is not None and tone["saturation"] < 22:
        health -= 3
    if posture:
        health -= (posture.get("penalty") or 0)
    health = max(48, min(99, health))

    # 置信度：有肤色 + 有人脸最高
    if analysis.get("hasTone"):
        confidence = 96 if analysis.get("hasFace") else 82
    else:
        confidence = 58

    score = _score(q, tone)

    return {
        "ts": None,
        "gender": gender,
        "tone": {**tone, "name": pal["name"], "key": key, "subSeason": sub,
                 "coolWarm": cool_warm, "lightness": lightness, "saturation": saturation},
        "face": {"shape": shape, "ratio": face.get("ratio")},
        "quality": q,
        "env": env,
        "outfit": outfit,
        "beauty": beauty,
        "diet": diet[:5],
        "move": move[:4],
        "life": life[:3],
        "health": health,
        "confidence": confidence,
        "score": score,
    }


def _score(q, tone):
    """综合健康分：质量（亮度/对比/清晰）与肤色置信度加权。"""
    base = 78.0
    b = (q or {}).get("brightness")
    if b is not None:
        base -= abs(b - 150) * 0.06
    c = (q or {}).get("contrast")
    if c is not None and c < 30:
        base -= (30 - c) * 0.25
    s = (q or {}).get("sharpness")
    if s is not None and s < 10:
        base -= (10 - s) * 0.6
    pix = (tone or {}).get("pixels") or 0
    if pix > 8000:
        base += 6
    if not tone:
        base -= 8
    return int(max(40, min(98, round(base))))
