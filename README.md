# MusicGameDemo

> 实机规则、落地细节和强制维护的调整记录见 [docs/实机落地与调整记录.md](docs/实机落地与调整记录.md)。任何玩法或表现改动都必须同步更新该文档。

基于 **Phaser 4 + Vite + TypeScript** 的 2D 音乐弹幕游戏原型。

在线试玩：[https://cj-viewer.github.io/MusicGameDemo/](https://cj-viewer.github.io/MusicGameDemo/)

策划案见 [docs/2D音乐弹幕游戏策划案 (持续更新).md](<docs/2D音乐弹幕游戏策划案 (持续更新).md>)，
原型实现范围见 [docs/简化玩法策划案（原型版）.md](docs/简化玩法策划案（原型版）.md)。

## 环境配置

| 依赖 | 要求 |
|---|---|
| Node.js | >= 20 |
| npm | 随 Node 附带 |
| 浏览器 | 支持 WebGL + Web Audio 的现代浏览器（Chrome / Edge） |

## 获取和启动

```powershell
git clone --branch dev-1.0 https://github.com/cj-viewer/MusicGameDemo.git
Set-Location MusicGameDemo
npm ci
npm run dev
```

启动后访问 **http://localhost:5173**，点击画面即可开始（首次点击同时用于解锁浏览器音频）。

### 全部脚本

| 指令 | 作用 |
|---|---|
| `npm ci` | 按 `package-lock.json` 安装锁定依赖 |
| `npm run dev` | 启动开发服务器（默认端口 5173，支持热更新） |
| `npm run build` | TypeScript 类型检查 + 生产构建，输出到 `dist/` |
| `npm run preview` | 本地预览 `dist/` 生产构建 |

端口在 [vite.config.ts](vite.config.ts) 的 `server.port` 中修改；如被占用可临时用 `npm run dev -- --port 5174`。

## 操作方式

| 输入 | 作用 |
|---|---|
| `W A S D` | 八向自由移动（不受节拍限制） |
| 鼠标 | 自由瞄准 |
| 鼠标左键 | 轻攻击（按节拍连段） |
| 鼠标右键 | 重攻击（按节拍连段） |
| `Shift` | 沿当前移动方向闪避（踩拍消耗减半并释放清弹震荡波） |
| 手柄左摇杆 | 模拟量移动 |
| 手柄右摇杆 | 瞄准；松开后保持最后方向，移动鼠标可切回鼠标瞄准 |
| 手柄 `LB` | 闪避 |
| 手柄 `RB` | 攻击；自动采用当前拍要求的轻/重输入 |
| `R` | 重新开始 |
| `F` | 【调试】直接充满 ComboMeter，立即触发 Fever Time |

`RB` 正确攻击时按当前拍类型给予反馈：轻拍小震动、重拍大震动。手柄闪避成功时会触发中等短震动。震动需要手柄和浏览器共同支持 Web Gamepad Haptics；不支持时输入仍可正常使用。

ComboMeter 满 100% 自动进入 **Fever Time**（4 小节）：期间攻击附带清屏音波（轻攻击=扇形、重攻击=圆形），判定条与场地边框随节拍闪烁。

武器连段：双持荧光棒 `轻→轻→重→轻`；伸缩警棍 `轻→重→重→轻`。保安掉落伸缩警棍，粉丝掉落双持荧光棒；地面武器随拍浮动并闪白，拾取后自动演示一小节。

## 可调参数（原型调参入口）

| 参数 | 默认值 | 位置 |
|---|---|---|
| BPM / 节拍 | `120`（4/4 拍） | [MainScene.ts](src/scenes/MainScene.ts) `BPM` |
| 攻击判定窗口 | 拍点 ±0.2s | [ComboSystem.ts](src/game/ComboSystem.ts) `INPUT_WINDOW` |
| 闪避踩拍窗口 | 拍点 ±0.12s | [Player.ts](src/game/Player.ts) `DODGE_BEAT_WINDOW` |
| 节奏块提前量/移动距离 | 2 拍 / 210px | [HUD.ts](src/game/HUD.ts) `LOOKAHEAD_BEATS` / `TRAVEL_DIST` |
| 玩家移速 / 闪避距离 / 体力 | `260` / `80` / `90` | [Player.ts](src/game/Player.ts) 顶部常量 |
| 武器连段与伤害 | 见 `ATTACK_TABLE` | [weapons.ts](src/game/weapons.ts) |
| ComboMeter 伤害加成 | 5 级 +10%~+30% | [ComboSystem.ts](src/game/ComboSystem.ts) `LEVEL_DAMAGE_BONUS` |
| Fever Time 时长 | 16 拍（4 小节） | [ComboSystem.ts](src/game/ComboSystem.ts) `FEVER_DURATION_BEATS` |
| Fever 音波范围/伤害 | 扇形 230/10 · 圆形 190/14 | [MainScene.ts](src/scenes/MainScene.ts) `performWeaponAttack` |
| 敌人数值 / 波次构成 | 见各类定义 / `WAVE_ENEMY_COUNTS` | [enemies.ts](src/game/enemies.ts) / [MainScene.ts](src/scenes/MainScene.ts) |

调试句柄：控制台可通过 `window.__game` 访问 Phaser Game 实例（`__game.scene.getScene('MainScene')`）。

## 资源与资产上传规则

所有运行时资源统一放在 `public/assets/` 下，构建时由 Vite 原样复制到 `dist/assets/`。`docs/图片和附件/` 只存放策划参考和美术附件，不参与构建，禁止从代码中引用。

### 目录约定

```text
public/assets/
├── images/
│   ├── characters/   角色、敌人、Boss（含序列帧与图集）
│   ├── weapons/      武器与地面掉落物
│   ├── effects/      弹幕、音波、粒子、命中反馈等特效贴图
│   ├── backgrounds/  场地、关卡背景、随拍律动的背景物件
│   └── ui/           HUD、判定条图标、ComboMeter、小地图、过场/剧情图
├── audio/
│   ├── bgm/          关卡音乐
│   └── sfx/          音效（节拍喊声、事件音、UI 音）
├── fonts/            字体（TTF / OTF / WOFF2）
└── data/             谱面、关卡、数值、剧情等数据文件
```

### 各类型上传规则

| 资产类型 | 目录 | 允许格式 | 命名规范 | 规格限制 | 说明 |
|---|---|---|---|---|---|
| 角色 / 敌人 | `images/characters/` | PNG / WebP（透明） | `char-<角色>-<动作>-<序号>`，序号两位补零，如 `char-player-idle-00.png` | 单帧 ≤ 1MB | 只画一个朝向（默认朝右），左右翻转由代码处理；序列帧优先合成图集 |
| 武器 | `images/weapons/` | PNG / WebP（透明） | `weapon-<名称>-<状态>`，如 `weapon-glowstick-idle.png` | 单文件 ≤ 1MB | 待机、挥动/攻击、地面掉落物各一张 |
| 弹幕 / 特效 | `images/effects/` | PNG / WebP（透明） | `fx-<名称>-<变体>`，如 `fx-soundwave-circle.png` | 单文件 ≤ 500KB，建议 ≤ 512×512 | 能用程序图形表达的先保持程序生成，需要贴图时再上传 |
| 背景 / 场景 | `images/backgrounds/` | PNG / WebP；不透明背景可用 JPG | `bg-<关卡/场景>-<名称>`，如 `bg-level1-security.png` | 宽度 ≤ 2560，单文件 ≤ 2MB | 逻辑分辨率 1280×720，建议按 2x 绘制；随拍摆动的背景物件也放这里 |
| UI / 图标 / 过场 | `images/ui/` | PNG / WebP；矢量图标可用 SVG | `ui-<用途>-<名称>`，如 `ui-icon-light-attack.png` | 单文件 ≤ 500KB；图标建议 64/128/256 | 轻/重/长按判定图标、ComboMeter、小地图、歌手小卡、动态四格漫画 |
| 关卡音乐 | `audio/bgm/` | MP3（首选）/ OGG / M4A | `bgm-<关卡>-<名称>`，如 `bgm-level1.mp3` | 单曲 ≤ 8MB，44.1kHz 立体声 | 必须与游戏 BPM 对齐；上传时注明 BPM、拍号和循环方式 |
| 音效 | `audio/sfx/` | MP3（首选）/ OGG / WAV | `sfx-<名称>-<变体>`，如 `sfx-beat-light.mp3` | 单文件 ≤ 500KB，≤ 3s（长欢呼等除外） | 节拍喊声缓存键固定为 `beat-light` / `beat-heavy`，对应 `sfx-beat-light.mp3` / `sfx-beat-heavy.mp3` |
| 字体 | `fonts/` | TTF / OTF / WOFF2 | `font-<名称>`，如 `font-arcade.ttf` | 中文子集化后 ≤ 5MB | 复古街机风 UI 字体 |
| 数据 | `data/` | JSON（首选）/ CSV | `data-<用途>-<名称>`，如 `data-chart-level1.json` | 单文件 ≤ 1MB | 谱面、波次、数值、剧情等运行时数据 |

### 命名与引用总则

- 文件名全部小写 kebab-case：小写英文 + 数字 + `-`，禁止空格、中文、括号、大写字母。
- 同一资产的新版本直接覆盖旧文件，历史由 Git 保留；不要加 `-final`、`-new`、`-v2` 等后缀。
- 代码统一通过 `import.meta.env.BASE_URL` 拼接 `assets/<类型>/<文件>` 加载，禁止硬编码 `/assets/...` 根路径（GitHub Pages 子路径下会 404）。
- Phaser 缓存键保持全小写 kebab-case，与文件名（去扩展名）一致，便于排查。

### 上传流程

1. 原始/参考素材先放入 `docs/图片和附件/` 存档，再按上表导出到 `public/assets/` 对应目录。
2. 检查命名、格式、透明背景和大小是否符合上表。
3. 在加载代码（目前为 [MainScene.ts](src/scenes/MainScene.ts) 的 `preload`）注册资源键与路径。
4. `npm run dev` 确认资源 HTTP 200、控制台无 error/404；修改加载代码后运行 `npm run build`。
5. 同步更新 README、简化策划案与实机记录中涉及的素材描述。
6. 提交时不要把 `dist/` 和本地临时文件带入仓库（见 `.gitignore`）。

### 禁止事项

- 不要把 `docs/图片和附件/` 的原始图片原样丢进 `public/assets/`（体积大、未切图、无透明底）。
- 不要上传中文或未命名文件（如 `image 5.png`、`未命名.png`）。
- 不要上传与玩法无关的临时图（截图、下载残留），无用资源及时删除。
- 不要在代码中写死 `/assets/` 根路径。

## 网页部署

推送 `main` 后，[deploy-pages.yml](.github/workflows/deploy-pages.yml) 会执行 `npm ci`、生产构建并部署 `dist/` 到 GitHub Pages。`dev-1.0` 推送不会自动部署（可通过 `workflow_dispatch` 手动触发）。Vite 使用相对基础路径，图片、音频和脚本可在仓库子路径下正常加载。

首次部署需要仓库管理员在 GitHub 的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**；后续推送会自动更新在线版本。

## 目录结构

```
index.html              入口 HTML
src/main.ts             游戏入口与 Phaser 配置（1280×720、Arcade 物理）
src/core/Conductor.ts   全局节拍时钟（WebAudio 精确计时 + 合成节拍器）
src/core/Sfx.ts         程序合成音效（战斗反馈；节拍喊声用 public/assets 采样）
src/game/               玩法系统（玩家 / 武器 / 敌人 / 连段判定 / HUD）
src/scenes/MainScene.ts 主场景（波次、攻击执行、弹幕、拾取）
public/assets/          运行时资源（图片 / 音频 / 字体 / 数据，见“资源与资产上传规则”）
docs/                   策划案
.claude/skills/         Phaser 官方 Claude Code 技能（28 个）
.agents/skills/         共享 agent 技能（.claude/skills 的副本，供各 agent 使用）
```
