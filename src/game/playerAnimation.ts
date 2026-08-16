import Phaser from 'phaser';
import { UI_SCALE } from './displayConfig';

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
/** 维持旧 720p 原型的屏幕占比：50.88px × 1.5 = 76.32px。 */
export const PLAYER_REFERENCE_CONTENT_HEIGHT = 108;
const LEGACY_PLAYER_DISPLAY_HEIGHT = 79.5 * 0.8 * 0.8;
export const PLAYER_DISPLAY_HEIGHT = LEGACY_PLAYER_DISPLAY_HEIGHT * UI_SCALE;
export const PLAYER_SPRITE_SCALE = PLAYER_DISPLAY_HEIGHT / PLAYER_REFERENCE_CONTENT_HEIGHT;
/** 128 x 128 手持武器相对 256 x 256 角色画布的统一显示倍率。 */
export const PLAYER_WEAPON_SCALE = PLAYER_SPRITE_SCALE * 0.8;
/** 140 ms movement plus 220 ms of slower visual follow-through after the dash lands. */
export const PLAYER_DASH_ANIMATION_DURATION_MS = 360;
export const PLAYER_DEATH_ANIMATION_DURATION_MS = 800;

/** 固定角色受击体，避免 256px 透明画布被误当成碰撞范围。 */
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

/** 注册正式玩家状态机动画；全局与单纹理均使用 NEAREST。 */
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
  create('dash', 12, { duration: PLAYER_DASH_ANIMATION_DURATION_MS, repeat: 0 });
  create('attack-light', 5, { duration: 200, repeat: 0 });
  create('attack-hard', 5, { duration: 200, repeat: 0 });
  create('death-1', 8, { duration: PLAYER_DEATH_ANIMATION_DURATION_MS, repeat: 0 });
  create('death-2', 8, { duration: PLAYER_DEATH_ANIMATION_DURATION_MS, repeat: 0 });
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

/** 在独立 Sprite 上播放轻 / 重攻击特效，和角色 256px 画布同中心完全重叠。 */
export function playPlayerAttackEffect(
  sprite: Phaser.GameObjects.Sprite,
  action: PlayerAttackAction,
  timeScale = 1
): void {
  sprite.anims.timeScale = Math.max(0.1, timeScale);
  sprite
    .setVisible(true)
    .setScale(PLAYER_SPRITE_SCALE)
    .play(playerAnimationKey(action), true);
}
