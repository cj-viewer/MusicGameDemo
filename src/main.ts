import Phaser from 'phaser';
import { IntroScene } from './scenes/IntroScene';
import { MainScene } from './scenes/MainScene';
import { FpvMiniScene } from './scenes/FpvMiniScene';
import { MultiplayerLobbyScene } from './scenes/MultiplayerLobbyScene';
import { MultiplayerScene } from './scenes/MultiplayerScene';
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
  // IntroScene 负责标题页与开场片头；MainScene 负责教学、教学结束过场与正式关，FPV 仍由 MainScene 启动。
  scene: [IntroScene, MainScene, FpvMiniScene, MultiplayerLobbyScene, MultiplayerScene]
};

const physicalScreenWidth = window.screen.width * window.devicePixelRatio;
const physicalScreenHeight = window.screen.height * window.devicePixelRatio;

if (physicalScreenWidth < VIEW_WIDTH || physicalScreenHeight < VIEW_HEIGHT) {
  console.warn(
    `当前物理分辨率约为 ${Math.round(physicalScreenWidth)} × ${Math.round(physicalScreenHeight)}；` +
    '游戏仍以 2560 × 1440 内部画布通过 FIT 缩放运行。'
  );
}
const game = new Phaser.Game(config);
// 原型调试句柄（便于控制台/自动化测试访问）
(window as unknown as Record<string, unknown>).__game = game;
