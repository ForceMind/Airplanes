# Airplanes

**一座机库，两种飞行体验。** 在原版像素海岛上自在飞行，或者驾驶英国与德国的螺旋桨战斗机，进入 1940 风格的海峡空战。

This repository preserves Dash's Fly demonstration and adds an original, playable RAF / Luftwaffe arcade-combat mode. See [third-party notices](THIRD_PARTY_NOTICES.md) before reusing upstream code.

[打开开发试玩](https://airplanes-skies-1940.kenneth42.chatgpt.site)（当前仅项目所有者可访问）。

## 当前版本：0.2.0

### 净空体验

- 从作者公开试玩站迁入的原版世界、喷气机、云层、阴影、尾迹和座舱。
- 俯视、追尾、座舱三种视角及连续过渡。
- 白昼、黄昏、夜航；原版加三套自由飞行配色。
- 原始 revision 35 快照与 SHA-256 记录独立保存在 `vendor/upstream/fly-v35/`。
- 默认迁移渲染器与原始代码在三种视角做逐像素回归。

### 1940 · 海峡空战

- 单人对 AI，可选 RAF / Luftwaffe 阵营。
- 按 1940 年型号重做的程序化像素 **Spitfire Mk Ia** 与 **Bf 109 E-4**：椭圆翼与梯形翼、座舱、尾翼、散热器和机体比例分别建模。
- 每型四款皮肤，共八款；阵营、涂装、任务、难度与最佳成绩保存在浏览器本地。
- 三个可完成的任务：海峡巡逻（三波六击落）、自由猎杀（三波八击落）、守住长空（180 秒）。
- 初次出击 / 王牌两种难度；AI 接敌、追击、规避、射击、脱离与增援。
- 喷火式八挺 .303 Browning（每翼四挺）；Bf 109 E-4 两挺机鼻 MG 17 加两门翼装 MG FF/M 20 mm 机炮。独立枪口、射速与间隔曳光弹，所有实弹均参与连续碰撞检测。
- 三叶螺旋桨绕真实机轴转动，共用机体姿态与深度遮挡；二战模式无喷气尾焰，切换模式时清除旧火焰缓冲。
- 敌机在实际相机画面外生成，从远处连续飞入；雷达提前提示，不在画面中心刷新。
- 轻度辅助瞄准、武器过热、受伤、击落、爆炸、雷达、结算和重开。
- 首版战斗采用俯视视角；净空体验保留三视角。
- 桌面键鼠、手机摇杆与射击/加速按钮；暂停、离开页面自动暂停；可选程序生成音效。

机型尺寸、三叶桨与武器布局有明确参考，见 [机型参考与建模边界](docs/AIRCRAFT_REFERENCE.md)。像素模型仍是按参考制作的低分辨率近似，不是扫描模型。玩法为街机设定，任务为虚构情景；每型包含历史风格及明确标注的创意涂装。当前不包含联网多人、精确飞行性能模拟、真实英吉利海峡地形或正式战役还原。

## 本地运行

需要 Node.js 22 或更高。**运行游戏不需要安装任何 npm 包。**

```bash
git clone https://github.com/ForceMind/Airplanes.git
cd Airplanes
npm run dev
```

打开 `http://localhost:4173`。可以使用 `PORT=8080 npm run dev` 改端口。网页使用 ES modules，请通过 HTTP 运行，不要直接双击 `index.html`。

### 构建静态站

```bash
npm run build
```

把 `dist/` 放到任意支持静态文件的服务器即可。游戏自身不调用第三方 CDN，不依赖 Forge 账号、React 运行时或后端服务。URL 入口：

- `/#home`：版本选择。
- `/#free`：净空体验。
- `/#hangar`：二战机库。
- `/#combat`：按本地选项开始空战。

所有资源使用相对路径，也支持部署到仓库子路径。

## 操作

| 功能 | 净空体验 | 海峡空战 |
| --- | --- | --- |
| 转向 | 鼠标指向 / A、D / 左右方向键 | A、D / 左右方向键 / 触摸摇杆 |
| 升降 | W、S / 上下方向键，保留原版飞行杆方向 | W / ↑ 上升，S / ↓ 下降 |
| 加速 | Shift / 按住鼠标 / 触摸加速 | Shift / 触摸加速 |
| 射击 | 无战斗 | 按住空格 / 鼠标左键 / 触摸射击 |
| 翻滚 | 点击鼠标 / 触摸翻滚 | 随转向侧倾 |
| 视角 | 空格 / 视角按钮 | 首版固定俯视 |
| 暂停 | P / Esc / 暂停按钮 | P / Esc / 暂停按钮 |

## 项目结构

```text
index.html                   版本入口、机库、飞行界面
src/app.js                   输入、画布、界面与生命周期集成
src/engine/                  迁移的原版软件渲染器及外部体素桥接
src/game/combat.js           独立、可测试的战斗模拟
src/game/aircraft.js         两种二战飞机的独立几何与涂装
src/game/aircraft-specs.js   型号、尺寸、螺旋桨与武器安装点
src/game/ordnance.js         共用枪口变换与街机弹道参数
src/engine/propeller.js      三叶桨几何与时间驱动旋转
src/game/audio.js            程序音效
src/game/preferences.js      本地选择与成绩
vendor/upstream/fly-v35/     原始快照与清单
tests/                       规则、模型、回归与浏览器流程验证
docs/                        来源、架构与后续研发记录
scripts/                     开发服务器、构建、语法校验
```

## 验证

```bash
npm test
npm run check
npm run build
```

浏览器流程验证需要 Playwright 和 Chromium：

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

浏览器验证会启动本地 HTTP 服务，检查版本入口、原版视角、机库、战斗、射击与暂停、手机布局，并将截图写入 `test-results/`。GitHub Actions 运行同样的验证并保存结果。

## 来源与许可证状态

原版 Fly / fighter 由 **Dash / @creativedash** 创建。作者公开允许 remix 和修改，本仓库保留来源与未修改快照。没有为上游代码虚构 MIT 或其他标准许可证；详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [docs/UPSTREAM.md](docs/UPSTREAM.md)。

## 继续研发

请先阅读 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。当前版本可实际游玩；后续优先实机手感、机体受损效果、关卡与地形扩展，再评估战斗追尾视角和多人服务。不要把后续候选功能表述为已交付。
