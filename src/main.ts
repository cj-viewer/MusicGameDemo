import Phaser from 'phaser';
import { IntroScene } from './scenes/IntroScene';
import { MainScene } from './scenes/MainScene';
import { FpvMiniScene } from './scenes/FpvMiniScene';
import { VIEW_HEIGHT, VIEW_WIDTH } from './game/displayConfig';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  backgroundColor: '#1a1a2e',
  render: {
    antialias: false,
    pixelArt: true,
    roundPixels: true
  },
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

const physicalScreenWidth = window.screen.width * window.devicePixelRatio;
const physicalScreenHeight = window.screen.height * window.devicePixelRatio;

if (physicalScreenWidth < VIEW_WIDTH || physicalScreenHeight < VIEW_HEIGHT) {
  const warning = document.createElement('div');
  warning.className = 'resolution-warning';
  warning.innerHTML = [
    '<strong>需要 1920 × 1080 或更高分辨率</strong>',
    `<span>当前物理分辨率约为 ${Math.round(physicalScreenWidth)} × ${Math.round(physicalScreenHeight)}</span>`
  ].join('');
  document.querySelector('#game-container')?.appendChild(warning);
} else {
  const game = new Phaser.Game(config);
  // 原型调试句柄（便于控制台/自动化测试访问）
  (window as unknown as Record<string, unknown>).__game = game;
}
