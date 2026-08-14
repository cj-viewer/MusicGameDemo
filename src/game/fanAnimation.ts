import Phaser from 'phaser';
import { PLAYER_SPRITE_SCALE, PLAYER_WEAPON_SCALE } from './playerAnimation';

export type FanAction = 'idle' | 'run';
export type FanAttackEffect = 'attack-light' | 'attack-hard';

export const FAN_CHARACTER_FRAME_COUNT = 8;
export const FAN_ATTACK_EFFECT_FRAMES: Record<FanAttackEffect, readonly number[]> = {
  'attack-light': [2, 3, 4, 5, 6],
  'attack-hard': [2, 3, 4, 5, 6, 7]
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

const characterAnimationKey: Record<FanAction, string> = {
  idle: 'fan-idle',
  run: 'fan-run'
};

const attackEffectTimers = new WeakMap<Phaser.GameObjects.Sprite, Phaser.Time.TimerEvent>();

export function fanCharacterTextureKey(action: FanAction, frame: number): string {
  return `npc-fan-${action}-${frame}`;
}

export function fanCharacterAssetPath(action: FanAction, frame: number): string {
  const suffix = String(frame).padStart(2, '0');
  return `images/characters/npc/npc_fan01/animation/${action}/npc_fan01_${action}_${suffix}.png`;
}

export function fanAttackEffectTextureKey(effect: FanAttackEffect, frame: number): string {
  return `npc-fan-${effect}-fx-${frame}`;
}

export function fanAttackEffectAssetPath(effect: FanAttackEffect, frame: number): string {
  const suffix = String(frame).padStart(2, '0');
  return `images/characters/npc/npc_fan01/animation/${effect}/npc_fan01_${effect.replace('-', '_')}_${suffix}.png`;
}

export function registerFanAnimations(scene: Phaser.Scene): void {
  const create = (
    key: string,
    frames: Phaser.Types.Animations.AnimationFrame[],
    frameRate: number,
    repeat: number
  ): void => {
    if (scene.anims.exists(key)) return;
    scene.anims.create({ key, frames, frameRate, repeat });
  };

  for (const action of ['idle', 'run'] as const) {
    create(
      characterAnimationKey[action],
      Array.from({ length: FAN_CHARACTER_FRAME_COUNT }, (_, index) => ({
        key: fanCharacterTextureKey(action, index + 1)
      })),
      action === 'run' ? 10 : 8,
      -1
    );
  }

}

export function playFanAnimation(sprite: Phaser.GameObjects.Sprite, action: FanAction, restart = false): void {
  sprite.setScale(FAN_SPRITE_SCALE);
  const key = characterAnimationKey[action];
  if (restart || sprite.anims.currentAnim?.key !== key) sprite.play(key, true);
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
