import Phaser from 'phaser';
import { PLAYER_SPRITE_SCALE } from './playerAnimation';

export type GuardAttackEffect = 'attack-light' | 'attack-hard';

export const GUARD_ATTACK_EFFECT_FRAMES: Record<GuardAttackEffect, readonly number[]> = {
  'attack-light': [1, 2, 3, 4, 5, 6, 7, 8],
  'attack-hard': [1, 2, 3, 4, 5, 6]
};

export const GUARD_ATTACK_DURATION_MS = 500;
export const GUARD_ATTACK_EFFECT_SCALE = PLAYER_SPRITE_SCALE;

const attackEffectTimers = new WeakMap<Phaser.GameObjects.Sprite, Phaser.Time.TimerEvent>();

export function guardAttackEffectTextureKey(effect: GuardAttackEffect, frame: number): string {
  return `npc-guard-${effect}-fx-${frame}`;
}

export function guardAttackEffectAssetPath(effect: GuardAttackEffect, frame: number): string {
  const suffix = String(frame).padStart(2, '0');
  const directory = effect.replace('-', '_');
  return `images/characters/npc/npc_guard01/${directory}/npc_guard01_${directory}_${suffix}.png`;
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

  sprite
    .setVisible(true)
    .setScale(GUARD_ATTACK_EFFECT_SCALE)
    .setTexture(guardAttackEffectTextureKey(effect, frames[frameIndex]));

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
    sprite.setTexture(guardAttackEffectTextureKey(effect, frames[frameIndex]));
    attackEffectTimers.set(sprite, sprite.scene.time.delayedCall(frameDuration, advanceFrame));
  };

  attackEffectTimers.set(sprite, sprite.scene.time.delayedCall(frameDuration, advanceFrame));
}
