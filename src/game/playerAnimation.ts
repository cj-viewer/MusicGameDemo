import Phaser from 'phaser';
import { WORLD_OBJECT_SCALE } from './visualScale';

export type PlayerAction = 'idle' | 'run' | 'down';

/** idle / run 帧统一内容高度（已裁掉透明边缘，脚底在帧底边） */
export const PLAYER_CONTENT_HEIGHT = 55;
/**
 * 与旧静态 player.png 的实际可见高度保持一致：
 * 旧图画布 321x456、可见内容 302x442，在 43.2x65.6px 显示尺寸下可见高度约 63.6px。
 */
export const PLAYER_DISPLAY_HEIGHT = 79.5 * WORLD_OBJECT_SCALE;
export const PLAYER_SPRITE_SCALE = PLAYER_DISPLAY_HEIGHT / PLAYER_CONTENT_HEIGHT;

/** 逐帧纹理键（与 preload 的加载键一致） */
export const PLAYER_TEXTURE_KEYS = [
  'player-idle-1',
  'player-idle-2',
  'player-run-1',
  'player-run-2',
  'player-run-3',
  'player-run-4',
  'player-down-1'
];

/**
 * 注册玩家动画并为像素素材关闭纹理平滑。
 * 素材为低分辨率像素图且放大约 1.16x 显示，NEAREST 才能保持像素锐利；
 * 只影响玩家纹理，不改动全局渲染配置。
 */
export function registerPlayerAnimations(scene: Phaser.Scene): void {
  for (const key of PLAYER_TEXTURE_KEYS) {
    scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  const create = (key: string, prefix: string, count: number, frameRate: number): void => {
    if (scene.anims.exists(key)) return;
    scene.anims.create({
      key,
      frames: Array.from({ length: count }, (_, i) => ({ key: `${prefix}-${i + 1}` })),
      frameRate,
      repeat: -1
    });
  };
  create('player-idle', 'player-idle', 2, 2.5);
  create('player-run', 'player-run', 4, 9);
}

/** down 为单帧倒地姿势，直接换纹理；idle / run 走循环动画 */
export function playPlayerAnimation(sprite: Phaser.GameObjects.Sprite, action: PlayerAction): void {
  sprite.setScale(PLAYER_SPRITE_SCALE);
  if (action === 'down') {
    sprite.stop();
    sprite.setTexture('player-down-1');
    return;
  }
  const key = action === 'idle' ? 'player-idle' : 'player-run';
  if (sprite.anims.currentAnim?.key !== key || !sprite.anims.isPlaying) sprite.play(key, true);
}
