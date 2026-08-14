import Phaser from 'phaser';
import { ArtAssetTool } from './game/ArtAssetTool';
import { DUAL_VIEW_HEIGHT, DUAL_VIEW_WIDTH } from './game/viewLayout';
import { MainScene } from './scenes/MainScene';
import { FpvMiniScene } from './scenes/FpvMiniScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: DUAL_VIEW_WIDTH,
  height: DUAL_VIEW_HEIGHT,
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
  // 右侧等大伪 3D 第三人称视口由设置面板开关；它只读取 MainScene 状态，不参与输入或玩法结算。
  scene: [MainScene, FpvMiniScene]
};

const game = new Phaser.Game(config);
new ArtAssetTool(game);

// 原型调试句柄（便于控制台/自动化测试访问）
(window as unknown as Record<string, unknown>).__game = game;
