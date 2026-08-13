import Phaser from 'phaser';
import { IntroScene } from './scenes/IntroScene';
import { MainScene } from './scenes/MainScene';
import { FpvMiniScene } from './scenes/FpvMiniScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 1280,
  height: 720,
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  },
  input: {
    gamepad: true
  },
  // 开场视频播完再进入 MainScene 标题页；FPV 仍由 MainScene 启动。
  scene: [IntroScene, MainScene, FpvMiniScene]
};

const game = new Phaser.Game(config);

// 原型调试句柄（便于控制台/自动化测试访问）
(window as unknown as Record<string, unknown>).__game = game;
