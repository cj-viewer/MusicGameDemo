import Phaser from 'phaser';
import { PLAYER_DISPLAY_HEIGHT } from './playerAnimation';

export type GuardAction = 'idle' | 'run';
export type GuardAttackEffect = 'attack-light' | 'attack-hard';

export const GUARD_CHARACTER_FRAME_COUNT = 1;
/** 正式保安帧可见内容约 194px 高，校准到玩家约 76px 的场内视觉高度。 */
export const GUARD_REFERENCE_CONTENT_HEIGHT = 194;
export const GUARD_SPRITE_SCALE = (PLAYER_DISPLAY_HEIGHT / GUARD_REFERENCE_CONTENT_HEIGHT) * 1.25;
/** 警棍收进保安的身体侧边，避免像手持长矛一样跨过角色。 */
export const GUARD_WEAPON_SCALE = (PLAYER_DISPLAY_HEIGHT / GUARD_REFERENCE_CONTENT_HEIGHT) * 0.6 * 1.5 * 1.25;
/** 源图的电筒形握把位于右下，固定此点后可竖直贴在身体外侧。 */
export const GUARD_WEAPON_ORIGIN = { x: 104 / 128, y: 108 / 128 } as const;
/** 固定在透明画布内的可见躯干判定，避免整张 256px 画布参与碰撞。 */
export const GUARD_BODY_SOURCE_BOUNDS = {
  width: 130,
  height: 150,
  offsetX: 63,
  offsetY: 76
} as const;

export const GUARD_ATTACK_EFFECT_FRAMES: Record<GuardAttackEffect, readonly number[]> = {
  'attack-light': [3],
  'attack-hard': [3]
};

export const GUARD_ATTACK_DURATION_MS = 500;
export const GUARD_ATTACK_EFFECT_SCALE = GUARD_SPRITE_SCALE;
/**
 * 攻击特效按 256px 同画布对位。项目方提供的重击第 6 帧实际为
 * 255x255，因此逐帧按真实纹理尺寸补偿，避免该帧视觉上缩小 1px。
 */
const GUARD_ATTACK_EFFECT_SOURCE_SIZE = 256;

const attackEffectTimers = new WeakMap<Phaser.GameObjects.Sprite, Phaser.Time.TimerEvent>();
export function guardCharacterTextureKey(action: GuardAction, frame: number): string {
  return `npc-guard-${action}-${frame}`;
}

export function guardCharacterAssetPath(action: GuardAction, frame: number): string {
  const suffix = String(frame).padStart(2, '0');
  return `images/characters/npc/npc_guard01/${action}/npc_guard01_${action}_${suffix}.png`;
}

export function guardAttackEffectTextureKey(effect: GuardAttackEffect, frame: number): string {
  return `npc-guard-${effect}-fx-${frame}`;
}

export function guardAttackEffectAssetPath(effect: GuardAttackEffect, frame: number): string {
  const suffix = String(frame).padStart(2, '0');
  const directory = effect.replace('-', '_');
  return `images/characters/npc/npc_guard01/${directory}/npc_guard01_${directory}_${suffix}.png`;
}

/** 将正式保安 Idle / Run 纳入与粉丝、玩家一致的 Phaser 动画注册流程。 */
export function registerGuardAnimations(scene: Phaser.Scene): void {
  for (const action of ['idle', 'run'] as const) {
    for (let frame = 1; frame <= GUARD_CHARACTER_FRAME_COUNT; frame++) {
      scene.textures.get(guardCharacterTextureKey(action, frame)).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }
}

export function playGuardAnimation(
  sprite: Phaser.GameObjects.Sprite,
  action: GuardAction,
  _restart = false
): void {
  sprite.setScale(GUARD_SPRITE_SCALE);
  if (sprite.anims.isPlaying) sprite.anims.stop();
  const key = guardCharacterTextureKey(action, 1);
  if (sprite.texture.key !== key) sprite.setTexture(key);
}

/**
 * Guard attack PNGs are effect-only layers on the same 256 px canvas as the
 * character artwork. Keeping them on a separate sprite lets the body retain
 * its current animation while the effect mirrors with the attack direction.
 */
export function playGuardAttackEffect(
  sprite: Phaser.GameObjects.Sprite,
  effect: GuardAttackEffect
): void {
  attackEffectTimers.get(sprite)?.remove(false);
  const frames = GUARD_ATTACK_EFFECT_FRAMES[effect];
  const frameDuration = GUARD_ATTACK_DURATION_MS / frames.length;
  let frameIndex = 0;

  const setFrame = (frame: number): void => {
    sprite.setTexture(guardAttackEffectTextureKey(effect, frame));
    sprite.setScale(
      GUARD_ATTACK_EFFECT_SCALE * (GUARD_ATTACK_EFFECT_SOURCE_SIZE / sprite.frame.realWidth),
      GUARD_ATTACK_EFFECT_SCALE * (GUARD_ATTACK_EFFECT_SOURCE_SIZE / sprite.frame.realHeight)
    );
  };

  sprite.setVisible(true);
  setFrame(frames[frameIndex]);

  const advanceFrame = (): void => {
    if (!sprite.active) {
      attackEffectTimers.delete(sprite);
      return;
    }
    frameIndex++;
    if (frameIndex >= frames.length) {
      sprite.setVisible(false);
      attackEffectTimers.delete(sprite);
      return;
    }
    setFrame(frames[frameIndex]);
    attackEffectTimers.set(sprite, sprite.scene.time.delayedCall(frameDuration, advanceFrame));
  };

  attackEffectTimers.set(sprite, sprite.scene.time.delayedCall(frameDuration, advanceFrame));
}
