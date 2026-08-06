# MusicGameDemo

基于 **Phaser 4 + Vite + TypeScript** 的 2D 音乐弹幕游戏原型。

**🎮 在线试玩：<https://cj-viewer.github.io/MusicGameDemo/>**（push 到 main 后由 GitHub Actions 自动部署）

策划案见 [docs/2D音乐弹幕游戏策划案 (持续更新).md](<docs/2D音乐弹幕游戏策划案 (持续更新).md>)，
原型实现范围见 [docs/简化玩法策划案（原型版）.md](docs/简化玩法策划案（原型版）.md)。

## 环境配置

| 依赖 | 要求 |
|---|---|
| Node.js | >= 20（本机安装于 `D:\Tools\NodeJS`，v24.18.0） |
| npm | 随 Node 附带 |
| 浏览器 | 支持 WebGL + Web Audio 的现代浏览器（Chrome / Edge） |

如果 Node 不在系统 PATH 中（本机默认不在），先执行：

```powershell
# PowerShell
$env:Path = "D:\Tools\NodeJS;$env:Path"
```

```bat
:: CMD（或直接运行 D:\Tools\NodeJS\nodevars.bat）
set PATH=D:\Tools\NodeJS;%PATH%
```

## 启动游戏

```bash
npm install
```

```bash
npm run dev
```

启动后访问 **http://localhost:5173**，点击画面即可开始（首次点击同时用于解锁浏览器音频）。

### 全部脚本

| 指令 | 作用 |
|---|---|
| `npm install` | 安装依赖（phaser / vite / typescript） |
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
| `空格` | 闪避（踩拍消耗减半并释放清弹震荡波） |
| `R` | 重新开始 |
| `F` | 【调试】直接充满 ComboMeter，立即触发 Fever Time |

ComboMeter 满 100% 自动进入 **Fever Time**（4 小节）：期间攻击附带清屏音波（轻攻击=扇形、重攻击=圆形），判定条与场地边框随节拍闪烁。

武器连段：双持荧光棒 `轻→轻→重→轻`；伸缩警棍 `轻→重→重→轻`（击杀小型保安掉落，拾取后自动演示一小节）。

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
| 敌人数值 / 波次构成 | 见各类定义 / `WAVES` | [enemies.ts](src/game/enemies.ts) / [MainScene.ts](src/scenes/MainScene.ts) |

调试句柄：控制台可通过 `window.__game` 访问 Phaser Game 实例（`__game.scene.getScene('MainScene')`）。

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
