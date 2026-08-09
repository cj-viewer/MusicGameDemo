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

## 网页部署

推送 `dev-1.0` 后，[deploy-pages.yml](.github/workflows/deploy-pages.yml) 会执行 `npm ci`、生产构建并部署 `dist/` 到 GitHub Pages。Vite 使用相对基础路径，图片、音频和脚本可在仓库子路径下正常加载。

首次部署需要仓库管理员在 GitHub 的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**；后续推送会自动更新在线版本。

## 目录结构

```
index.html              入口 HTML
src/main.ts             游戏入口与 Phaser 配置（1280×720、Arcade 物理）
src/core/Conductor.ts   全局节拍时钟（WebAudio 精确计时 + 合成节拍器）
src/core/Sfx.ts         程序合成音效（无音频资源阶段）
src/game/               玩法系统（玩家 / 武器 / 敌人 / 连段判定 / HUD）
src/scenes/MainScene.ts 主场景（波次、攻击执行、弹幕、拾取）
docs/                   策划案
.claude/skills/         Phaser 官方 Claude Code 技能（28 个）
```
