import Phaser from 'phaser';
import { PLAYER_SPRITE_SCALE, PLAYER_WEAPON_SCALE } from './playerAnimation';

export type FanAction = 'idle' | 'run';
export type FanAttackEffect = 'attack-light' | 'attack-hard';

export const FAN_CHARACTER_FRAME_COUNT = 1;
export const FAN_ATTACK_EFFECT_FRAMES: Record<FanAttackEffect, readonly number[]> = {
  'attack-light': [3],
  'attack-hard': [3]
};

/**
 * 正式橙色粉丝和对应特效均使用 256 x 256 画布；武器使用 128 x 128 画布。
 * 与玩家使用相同画布规格，因此直接复用玩家本体和武器倍率，保持二者比例完全一致。
 */
export const FAN_SPRITE_SCALE = PLAYER_SPRITE_SCALE;
export const FAN_WEAPON_SCALE = PLAYER_WEAPON_SCALE;
export const FAN_ATTACK_DURATION_MS = 500;
export const FAN_BODY_SOURCE_BOUNDS = {
  width: 87,
  height: 82,
  offsetX: 84,
  offsetY: 87
} as const;
export const FAN_WEAPON_ORIGIN = { x: 101 / 128, y: 98 / 128 } as const;

const attackEffectTimers = new WeakMap<Phaser.GameObjects.Sprite, Phaser.Time.TimerEvent>();

export function fanCharacterTextureKey(action: FanAction, frame: number): string {
  return `npc-fan-${action}-${frame}`;
}

export function fanCharacterAssetPath(action: FanAction, frame: number): string {
  const suffix = String(frame).padStart(2, '0');
  return `images/characters/npc/npc_fan01/${action}/npc_fan01_${action}_${suffix}.png`;
}

export function fanAttackEffectTextureKey(effect: FanAttackEffect, frame: number): string {
  return `npc-fan-${effect}-fx-${frame}`;
}

export function fanAttackEffectAssetPath(effect: FanAttackEffect, frame: number): string {
  const suffix = String(frame).padStart(2, '0');
  const directory = effect.replace('-', '_');
  return `images/characters/npc/npc_fan01/${directory}/npc_fan01_${directory}_${suffix}.png`;
}

export function registerFanAnimations(scene: Phaser.Scene): void {
  for (const action of ['idle', 'run'] as const) {
    scene.textures.get(fanCharacterTextureKey(action, 1)).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
}

export function playFanAnimation(sprite: Phaser.GameObjects.Sprite, action: FanAction, _restart = false): void {
  sprite.setScale(FAN_SPRITE_SCALE);
  if (sprite.anims.isPlaying) sprite.anims.stop();
  const key = fanCharacterTextureKey(action, 1);
  if (sprite.texture.key !== key) sprite.setTexture(key);
}

export function playFanAttackEffect(sprite: Phaser.GameObjects.Sprite, effect: FanAttackEffect): void {
  attackEffectTimers.get(sprite)?.remove(false);
  const frames = FAN_ATTACK_EFFECT_FRAMES[effect];
  const frameDuration = FAN_ATTACK_DURATION_MS / frames.length;
  let frameIndex = 0;

  sprite
    .setVisible(true)
    .setScale(FAN_SPRITE_SCALE)
    .setTexture(fanAttackEffectTextureKey(effect, frames[frameIndex]));

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
    sprite.setTexture(fanAttackEffectTextureKey(effect, frames[frameIndex]));
    attackEffectTimers.set(sprite, sprite.scene.time.delayedCall(frameDuration, advanceFrame));
  };

  attackEffectTimers.set(sprite, sprite.scene.time.delayedCall(frameDuration, advanceFrame));
}
