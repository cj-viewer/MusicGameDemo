import Phaser from 'phaser';
import { WORLD_OBJECT_SCALE } from './visualScale';

export type PlayerAction =
  | 'idle'
  | 'run'
  | 'dash'
  | 'attack-light'
  | 'attack-hard'
  | 'death-1'
  | 'death-2';

export type PlayerAttackAction = Extract<PlayerAction, 'attack-light' | 'attack-hard'>;

export interface PlayerAnimationAssetSpec {
  action: PlayerAction;
  directory: string;
  filePrefix: string;
  frameCount: number;
  paddedIndex: boolean;
}

/** 远端正式玩家素材：统一为 256px 方形画布，透明内容脚底约位于源图 y=186。 */
export const PLAYER_SOURCE_FRAME_SIZE = 256;
export const PLAYER_SOURCE_BASELINE_Y = 186;
/** 以 Idle / Run 的约 108px 内容高度作为视觉标尺，保持上一版约 63.6px 的场内高度。 */
export const PLAYER_REFERENCE_CONTENT_HEIGHT = 108;
/** 本轮在既有统一场内缩放基础上，再把玩家本体缩至当前的 0.8 倍。 */
export const PLAYER_CHARACTER_SCALE = 0.8;
export const PLAYER_DISPLAY_HEIGHT = 79.5 * WORLD_OBJECT_SCALE * PLAYER_CHARACTER_SCALE;
export const PLAYER_SPRITE_SCALE = PLAYER_DISPLAY_HEIGHT / PLAYER_REFERENCE_CONTENT_HEIGHT;

/** 固定角色受击体，避免 256px 透明画布被误当成碰撞范围。缩放后约为 24.7 x 63.6px。 */
export const PLAYER_BODY_SOURCE_WIDTH = 42;
export const PLAYER_BODY_SOURCE_HEIGHT = 108;
export const PLAYER_BODY_SOURCE_OFFSET_X = (PLAYER_SOURCE_FRAME_SIZE - PLAYER_BODY_SOURCE_WIDTH) / 2;
export const PLAYER_BODY_SOURCE_OFFSET_Y = PLAYER_SOURCE_BASELINE_Y - PLAYER_BODY_SOURCE_HEIGHT;

export const PLAYER_ANIMATION_ASSETS: PlayerAnimationAssetSpec[] = [
  { action: 'idle', directory: 'idle', filePrefix: 'player_idle-', frameCount: 8, paddedIndex: false },
  { action: 'run', directory: 'run', filePrefix: 'player_run_', frameCount: 8, paddedIndex: true },
  { action: 'dash', directory: 'dash', filePrefix: 'player_dash_', frameCount: 12, paddedIndex: true },
  { action: 'attack-light', directory: 'attack_light', filePrefix: 'player_attack_light_', frameCount: 5, paddedIndex: true },
  { action: 'attack-hard', directory: 'attack_hard', filePrefix: 'player_attack_hard_', frameCount: 5, paddedIndex: true },
  { action: 'death-1', directory: 'death01', filePrefix: 'player_death01_', frameCount: 8, paddedIndex: true },
  { action: 'death-2', directory: 'death02', filePrefix: 'player_death02_', frameCount: 8, paddedIndex: true }
];

export function playerTextureKey(action: PlayerAction, frame: number): string {
  return `player-${action}-${frame}`;
}

export function playerAnimationKey(action: PlayerAction): string {
  return `player-${action}`;
}

export function playerAssetPath(spec: PlayerAnimationAssetSpec, frame: number): string {
  const index = spec.paddedIndex ? String(frame).padStart(2, '0') : String(frame);
  return `images/characters/player/animation/${spec.directory}/${spec.filePrefix}${index}.png`;
}

/** 注册正式玩家状态机动画，并只对这些像素纹理启用 NEAREST。 */
export function registerPlayerAnimations(scene: Phaser.Scene): void {
  for (const spec of PLAYER_ANIMATION_ASSETS) {
    for (let frame = 1; frame <= spec.frameCount; frame++) {
      scene.textures.get(playerTextureKey(spec.action, frame)).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }

  const create = (
    action: PlayerAction,
    frameCount: number,
    options: { frameRate?: number; duration?: number; repeat: number }
  ): void => {
    const key = playerAnimationKey(action);
    if (scene.anims.exists(key)) return;
    scene.anims.create({
      key,
      frames: Array.from({ length: frameCount }, (_, index) => ({
        key: playerTextureKey(action, index + 1)
      })),
      ...options
    });
  };

  create('idle', 8, { frameRate: 8, repeat: -1 });
  create('run', 8, { frameRate: 12, repeat: -1 });
  create('dash', 12, { duration: 140, repeat: 0 });
  create('attack-light', 5, { duration: 200, repeat: 0 });
  create('attack-hard', 5, { duration: 200, repeat: 0 });
  create('death-1', 8, { frameRate: 12, repeat: 0 });
  create('death-2', 8, { frameRate: 12, repeat: 0 });
}

export function playPlayerAnimation(
  sprite: Phaser.GameObjects.Sprite,
  action: PlayerAction,
  forceRestart = false
): void {
  sprite.setScale(PLAYER_SPRITE_SCALE);
  // 轻重攻击 PNG 是纯特效层，不能替换角色本体纹理。
  if (action === 'attack-light' || action === 'attack-hard') return;
  const key = playerAnimationKey(action);
  if (forceRestart || sprite.anims.currentAnim?.key !== key || !sprite.anims.isPlaying) {
    sprite.play(key, true);
  }
}

/** 在独立 Sprite 上播放攻击特效，角色本体继续保留当前 Idle / Run 帧。 */
export function playPlayerAttackEffect(
  sprite: Phaser.GameObjects.Sprite,
  action: PlayerAttackAction
): void {
  sprite
    .setVisible(true)
    .setScale(PLAYER_SPRITE_SCALE)
    .play(playerAnimationKey(action), true);
}
