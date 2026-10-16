<div align="center">

# 镜界 JINGJIE

### AI 智美形象管家 · 高保真交互原型

**一面会思考的落地镜**

一次全身人像采集，同步完成 **AI 体态风险筛查** + **面部美学诊断**，
输出体态矫正、穿搭配色、妆容理容、饮食运动作息全套个性化方案。

<br>

[![Zero Dependencies](https://img.shields.io/badge/依赖-零外部依赖-3fb950?style=flat-square)](#技术栈)
[![Vanilla JS](https://img.shields.io/badge/原生-HTML%20%2F%20CSS%20%2F%20JS-f7df1e?style=flat-square)](#技术栈)
[![No Build](https://img.shields.io/badge/构建-无需构建-blue?style=flat-square)](#运行方式)
[![Version](https://img.shields.io/badge/版本-v4.0-ff8fb8?style=flat-square)](#版本记录)
[![License](https://img.shields.io/badge/许可-MIT-7ee8dd?style=flat-square)](#许可)

<br>

<img src="preview_hero.webp" alt="镜界 JINGJIE 界面预览：首页 / 实时采集 / 体态报告 / 女生主题" width="88%">

<sub>首页 · 实时人脸跟踪采集 · 体态健康报告 · 女生粉色主题</sub>

<br>

**[🚀 快速开始](#-快速开始)** &nbsp;·&nbsp;
**[📸 截图总览](gallery.html)** &nbsp;·&nbsp;
**[🧠 算法细节](#-核心算法)** &nbsp;·&nbsp;
**[🎨 双主题](#-男生--女生双主题)**

</div>

---

## ✨ 这是什么

镜界是一整套「智能落地镜」产品的高保真**软件原型**。硬件侧为电控旋转底座 + 环形补光 + 高清摄像头 + 实木收纳镜背；本仓库实现的是其中的**软件交互与 AI 分析链路**，可直接在浏览器运行。

它**不是 PPT 里的静态图**，而是一个能跑起来的应用：

- 🎥 **真的打开摄像头**，用 `getUserMedia` 实时采集
- 🧮 **真的做像素级分析** —— YCbCr 肤色检测、人脸包围盒投影、拉普拉斯清晰度、冷暖色调判定，全部由数学计算得出，**同一用户在不同光照下结果不同**
- 🗣️ **真的会说话** —— Web Speech API 中文语音播报 + 实时打字机字幕
- 🎨 **一键换肤** —— 男生/女生双主题，零重载切换整套配色与文案
- 📦 **零外部依赖** —— 无框架、无 CDN、无构建步骤，8 个源文件即全部

---

## 🚀 快速开始

摄像头 API 要求**安全上下文**（`https://` 或 `localhost`），`file://` 下无法授权。因此推荐用 HTTP 打开：

```bash
git clone https://github.com/jhlking/MirrorVerse-SmartHome.git
cd MirrorVerse-SmartHome
python -m http.server 8899
```

然后浏览器访问 **http://127.0.0.1:8899/index.html**，点击「开启摄像头」即可体验完整分析链路。

<details>
<summary><b>其他打开方式</b></summary>

| 方式 | 说明 |
|---|---|
| 双击 `index.html` | 直接 `file://` 打开，**摄像头不可用**，自动降级为剪影演示模式，其余页面正常 |
| 双击 `gallery.html` | 28 张演示截图总览，无需服务 |
| 任意静态服务器 | `npx serve` / `php -S` / VS Code Live Server 均可 |

</details>

> 💡 **没有摄像头？** 用 Edge/Chrome 的假摄像头参数也能跑通全链路：
> ```
> msedge --use-fake-ui-for-media-stream --use-fake-device-for-media-stream ^
>        --use-file-for-fake-video-capture=fakeface.y4m
> ```
> 仓库内附 `fakeface.y4m`（合成人像测试素材）。

---

## 🗺️ 交互流程

```
       ┌─────────┐   点击     ┌──────────┐  自动   ┌──────────┐
       │  首页   │ ─────────→ │  拍摄页  │ ──────→ │  分析中  │
       │  欢迎   │  开启摄像头 │ 实时取景 │  快门   │  进度条  │
       └─────────┘            └──────────┘         └────┬─────┘
                                                          │ 自动跳转
                            ┌─────────────────────────────┴──────────┐
                            ↓                                        ↓
                    ┌───────────────┐                      ┌─────────────────┐
                    │   体态报告    │ ──→ ┌──────────────┐ │   健康调理方案  │
                    │  评分 + 风险  │     │  面部美学报告 │ │ 饮食/运动/作息  │
                    └───────────────┘     │ 肤色/脸型/配色│ └─────────────────┘
                                          └──────────────┘
                            ┌───────────────────────┐
                            │      镜面控制         │  电控旋转底座 / 角度调节
                            └───────────────────────┘
```

7 个页面均为单页应用内的「手机屏」，带入场动画与页面过渡。

---

## 🧠 核心算法

全部为纯前端实现，无机器学习依赖。以下代码逻辑均在 `camera.js` / `advisor.js` 中。

<table>
<tr><th width="22%">模块</th><th>方法</th></tr>

<tr><td><b>肤色检测</b></td><td>

**YCbCr 阈值法** + RGB 关系约束，排除木质/暖色墙面误检
```
Cb = -0.169R - 0.331G + 0.500B + 128    要求 77 ≤ Cb ≤ 127
Cr =  0.500R - 0.419G - 0.081B + 128    要求 133 ≤ Cr ≤ 173
约束：R > G、R > B、max-min ≥ 12、60 < R ≤ 250
```
</td></tr>

<tr><td><b>人脸包围盒</b></td><td>

肤色像素**列/行投影** → 各取累积 5%~95% 主区间（抗噪）→ 归一化。
有效性校验：肤色占比 1.2%~65%，且不能横纵同时占满 96%。
</td></tr>

<tr><td><b>冷暖判定</b></td><td>

```
hueScore = (平均色相 - 25) × 1.8
rbScore  = (平均R-B - 38) × 0.9        典型中性肤色 R-B ≈ 38
冷暖指数  = clamp((hueScore + rbScore) / 2, -50, +50)
≤ -12 冷调 ／ ≥ +12 暖调 ／ 其余 中性调
```
</td></tr>

<tr><td><b>质量评估</b></td><td>

亮度（灰度均值）、对比度（灰度标准差）、**清晰度（拉普拉斯方差，4 邻域）**、暗部/高光占比。
</td></tr>

<tr><td><b>多帧融合</b></td><td>

快门连抓 5 帧，对肤色 RGB / 明度 / 饱和度 / 冷暖指数**取中位数**，抗单帧抖动。
</td></tr>

<tr><td><b>实时跟踪</b></td><td>

`startLoop()` 以 8 fps 抽 160×120 低分辨率帧做肤色投影，CSS 0.35 插值平滑跟随绘制检测框。
</td></tr>

</table>

### 建议规则引擎

```
肤色冷暖 ──┬─→ 配色知识库 PALETTES{cool, neutral, warm}
           │     → 主色色卡 / 规避色 / 金属 / 唇色 / 眼影 / 发色
           └─→ 明度 + 饱和度 → 四季细分（春 / 夏 / 秋 / 冬型）

脸型比例 ──┬─→ FACE_ADVICE   {鹅蛋/圆/长形/方/横长}  （女生：发型 / 配饰 / 妆容）
           └─→ FACE_ADVICE_M {鹅蛋/圆/长形/方/横长}  （男生：发型 / 配饰 / 修饰）

性别 ────────→ 妆容分支（唇色 / 眼影） 或 理容分支（护肤 / 胡须 / 眉形）

体态偏移 ──→ POSTURE_DIET{forward_head, shoulder, pelvis}
           → 饮食（维D+钙 / Omega-3 / 控糖控咖啡因）
           → 运动（收下巴 / 胸椎伸展 / 肩胛稳定）
           → 作息（屏幕齐眼 / 每小时起身 / 23:30 前入睡）

环境质量 ──→ 补光 / 距离 / 对比度 实拍诊断
```

---

## 🎨 男生 / 女生双主题

一键切换整套视觉与文案，**同一个页面零重载换肤**。所有颜色收敛为 CSS 变量，主题只是变量覆盖：

```css
:root[data-gender="male"]   { --c-accent: #7ee8dd;  /* 青 */  --c-bg: #05070d; }
:root[data-gender="female"] { --c-accent: #ff8fb8;  /* 玫瑰粉 */ --c-bg: #0d060c; }
```

<table>
<tr>
<td width="50%" align="center">

**男生 · 青主题**
<br>
<img src="shots/29_male_full_ui.webp" width="100%">

</td>
<td width="50%" align="center">

**女生 · 粉主题**
<br>
<img src="shots/28_female_full_ui.webp" width="100%">

</td>
</tr>
</table>

**切换入口**（两处，共用 `J.setGender()`）：

| 位置 | 控件 |
|---|---|
| 左侧品牌区 | `.gs-seg` 分段开关「♂ 男生 / ♀ 女生」 |
| 手机屏内右上 | `.gender-pill` 图标胶囊 |

**同步改变的内容**：

- **配色** — 舞台光晕、极光背景、手机金属边框（转玫瑰金）、头像、主按钮、卡片描边、文字色系
- **图标文字** — 头像字样 `镜` ⇄ `她`；报告区块标题 `妆容` ⇄ `理容`；图标 `💄` ⇄ `🧔`
- **建议文案** — 女生输出唇色/眼影/发色色号；男生输出护肤/胡须/眉形要点
- **持久化** — 写入 `localStorage['jingjie.gender']`，刷新保持；也支持 `?gender=female` URL 参数

> 性别主题**只改变配色与建议措辞，不改变分析算法**（肤色与脸型判定与性别无关）。

---

## 🗣️ 语音助手

基于浏览器原生 **Web Speech API**，零依赖中文播报（本机命中 `Microsoft Huihui` 音色）。

- 5 段写死的专业播报文稿（欢迎 / 体态 / 美学 / 健康 / 镜控），也可按真实分析结果动态生成
- **实时字幕浮层** — 声波可视化 + 打字机逐字揭示（约 4.3 字/秒，匹配中文语速）+ 关键词高亮
- 支持静音模式（仅字幕，不受浏览器自动播放策略影响）

---

## ⌨️ 快捷键

| 键 | 作用 | 键 | 作用 |
|---|---|---|---|
| `1` ~ `7` | 跳转各页面 | `G` | 切换男生 / 女生主题 |
| `Enter` | 拍摄页 → 开始分析 | `V` | 开合语音助手面板 |
| | | `R` | 重播最近一段语音 |

---

## 📁 文件结构

```
MirrorVerse-SmartHome/
├── index.html           单页应用骨架，7 个「手机屏」页面
├── style.css            设计系统（玻璃拟态 / 极光渐变 / CSS 变量令牌 + 双主题）
├── app.js               页面路由 J.go()、步骤动画、镜面控制、性别主题 J.setGender()
├── camera.js            摄像头采集 + 像素级图像分析（零依赖）
├── advisor.js           建议规则引擎：肤色→配色 / 体态→饮食运动作息 / 性别分流
├── cam-ui.js            摄像头 UI 桥接：实时预览、人脸框、快门、报告渲染
├── voice.js             Web Speech API 中文语音播报
├── voice-ui.js          语音浮层：声波、打字机字幕、关键词高亮
├── gallery.html         演示截图总览页
├── preview_hero.webp    本 README 顶部横幅
├── shots/               28 张演示截图（含男生 / 女生两套，WebP 无损压缩）
├── fakeface.y4m         合成人像视频素材（供无头浏览器假摄像头测试）
└── .gitignore
```

### 技术栈

| | |
|---|---|
| **前端** | 原生 HTML5 / CSS3 / ES6+，**无框架、无构建、无 CDN** |
| **图形** | Canvas 2D 像素分析、SVG 矢量图标、CSS 变量驱动的主题系统 |
| **API** | `getUserMedia` · `MediaStream` · `Canvas.getImageData` · `SpeechSynthesis` · `localStorage` |
| **测试** | Edge 无头模式 + Chrome DevTools Protocol（Python 标准库自建 WebSocket 客户端） |

---

## 🧪 工程验证

原型用 **Edge 无头模式 + CDP** 做了数值化验收（不依赖人眼看图）：

- 摄像头全链路：开摄像头 → 实时跟踪 → 快门 → 报告，**23/23 通过**
- 性别双主题：配色分离度、控件对齐、文案分流，**30/30 通过**
- 综合校验：页面渲染、JS 报错、资源完整性，**14/14 通过**

实测数据（合成人像）：肤色 `RGB(196,153,125)`、冷暖 `+13`（暖调）、脸型长形脸、
单帧有效肤色像素 `20,640`、置信度 `96%`、**JS 报错 0**。

<details>
<summary><b>CDP 无头测试的 6 个坑（踩坑记录）</b></summary>

1. Edge 进程必须 `subprocess.Popen(..., creationflags=DETACHED_PROCESS)` 才能存活
2. 必须显式 `Page.navigate`，否则 target 停在 `about:blank`
3. 必须 `Page.setCacheDisabled`，否则改动不生效
4. **`const CamUI = ...` 不会挂到 `window`**，跨脚本引用要用 `typeof CamUI !== 'undefined'`
5. `Target.activateTarget` + `Page.bringToFront` 避免后台标签页节流
6. `Page.captureScreenshot` 用 CDP 而非 `--screenshot`（后者在本机静默失败）

</details>

---

## ⚠️ 已知边界

- 肤色检测为**启发式算法**，强逆光 / 红墙 / 木质背景可能误检；已用质量分与置信度提示
- 体态关键点目前仍为**原型演示数据**（未接入姿态估计模型），肤色与脸型为真实计算
- 脸型由面部框长宽比近似推断，非真实 68 点轮廓拟合
- 健康建议为通用科普性内容，**不构成医疗建议**
- 性别主题只改变配色与建议措辞，不改变分析算法

---

## 🗓️ 版本记录

| 版本 | 内容 |
|---|---|
| **v4.0** | 男生 / 女生双主题（粉色女生模式）、建议文案性别分流、`G` 快捷键 |
| **v3.0** | 真实摄像头采集 + 像素级图像分析 + 健康调理方案页 |
| **v2.0** | AI 语音播报 + 实时字幕浮层 |
| **v1.0** | 单页应用骨架、设计系统、页面路由与分析流程 |

---

## 📄 许可

本项目以 **MIT License** 开源，可用于学习、演示与二次开发。

<div align="center">
<br>
<sub>镜界 JINGJIE · 让每一次照镜，都成为一次自我升级</sub>
</div>
