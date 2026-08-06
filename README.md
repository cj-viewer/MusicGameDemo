# MusicGameDemo

基于 **Phaser 4 + Vite + TypeScript** 的音乐游戏 Demo。

## 开发

```bash
npm install     # 安装依赖
npm run dev     # 启动开发服务器 (http://localhost:5173)
npm run build   # 类型检查 + 生产构建 (输出到 dist/)
npm run preview # 预览生产构建
```

## 目录结构

```
index.html            入口 HTML
src/main.ts           游戏入口与 Phaser 配置
src/scenes/           游戏场景 (BootScene / MainScene)
.claude/skills/       Phaser 官方 Claude Code 技能 (28 个)
```

## Claude Code 技能

`.claude/skills/` 内包含来自 [phaser 官方仓库](https://github.com/phaserjs/phaser) 的 28 个技能，
覆盖场景、音频、输入、Tween、物理、粒子、Tilemap、v4 新特性等主题，Claude Code 会在相关任务中自动使用。
