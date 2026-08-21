import Phaser from 'phaser';
import { PLAYER_SPRITE_SCALE } from './playerAnimation';

export type TutorialCharacterAction = 'idle' | 'run' | 'roll';
export type TutorialCharacterAttackEffect = 'attack-light' | 'attack-hard';

export const TUTORIAL_CHARACTER_FRAME_COUNTS: Record<TutorialCharacterAction, number> = {
  idle: 4,
  run: 4,
  roll: 6
};

export const TUTORIAL_CHARACTER_ATTACK_EFFECT_FRAMES: Record<
  TutorialCharacterAttackEffect,
  readonly number[]
> = {
  'attack-light': [1, 2, 3, 4, 5],
  'attack-hard': [1, 2, 3, 4, 5, 6]
};

/** 教学角色、攻击特效与阴影共用 256 x 256 画布及同一运行时倍率。 */
export const TUTORIAL_CHARACTER_SPRITE_SCALE = PLAYER_SPRITE_SCALE;
export const TUTORIAL_CHARACTER_ATTACK_DURATION_MS = 500;
export const TUTORIAL_CHARACTER_ROLL_DURATION_MS = 520;
export const TUTORIAL_CHARACTER_BODY_SOURCE_BOUNDS = {
  width: 108,
  height: 106,
  offsetX: 77,
  offsetY: 80
} as const;

const attackEffectTimers = new WeakMap<Phaser.GameObjects.Sprite, Phaser.Time.TimerEvent>();
const characterAnimationKey: Record<TutorialCharacterAction, string> = {
  idle: 'tutorial-character-idle',
  run: 'tutorial-character-run',
  roll: 'tutorial-character-roll'
};

export function tutorialCharacterTextureKey(action: TutorialCharacterAction, frame: number): string {
  return `tutorial-character-${action}-${frame}`;
}

export function tutorialCharacterAssetPath(action: TutorialCharacterAction, frame: number): string {
  const suffix = String(frame).padStart(2, '0');
  return `images/characters/npc/npc_tutorial01/${action}/npc_tutorial01_${action}_${suffix}.png`;
}

export function tutorialCharacterAttackEffectTextureKey(
  effect: TutorialCharacterAttackEffect,
  frame: number
): string {
  return `tutorial-character-${effect}-fx-${frame}`;
}

export function tutorialCharacterAttackEffectAssetPath(
  effect: TutorialCharacterAttackEffect,
  frame: number
): string {
  const suffix = String(frame).padStart(2, '0');
  const directory = effect.replace('-', '_');
  return `images/characters/npc/npc_tutorial01/${directory}/npc_tutorial01_${directory}_${suffix}.png`;
}

export function registerTutorialCharacterAnimations(scene: Phaser.Scene): void {
  for (const action of ['idle', 'run', 'roll'] as const) {
    for (let frame = 1; frame <= TUTORIAL_CHARACTER_FRAME_COUNTS[action]; frame++) {
      scene.textures
        .get(tutorialCharacterTextureKey(action, frame))
        .setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    const key = characterAnimationKey[action];
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: Array.from({ length: TUTORIAL_CHARACTER_FRAME_COUNTS[action] }, (_, index) => ({
        key: tutorialCharacterTextureKey(action, index + 1)
      })),
      ...(action === 'roll'
        ? { duration: TUTORIAL_CHARACTER_ROLL_DURATION_MS, repeat: 0 }
        : { frameRate: action === 'run' ? 10 : 8, repeat: -1 })
    });
  }
}

export function playTutorialCharacterAnimation(
  sprite: Phaser.GameObjects.Sprite,
  action: TutorialCharacterAction,
  restart = false
): void {
  sprite.setScale(TUTORIAL_CHARACTER_SPRITE_SCALE);
  const key = characterAnimationKey[action];
  if (restart || sprite.anims.currentAnim?.key !== key || !sprite.anims.isPlaying) {
    sprite.play(key, true);
  }
}

/** Phaser 4.2.1 的独立特效动画路径曾卡住主线程，沿用场景时钟手动推进帧。 */
export function playTutorialCharacterAttackEffect(
  sprite: Phaser.GameObjects.Sprite,
  effect: TutorialCharacterAttackEffect
): void {
  attackEffectTimers.get(sprite)?.remove(false);
  const frames = TUTORIAL_CHARACTER_ATTACK_EFFECT_FRAMES[effect];
  const frameDuration = TUTORIAL_CHARACTER_ATTACK_DURATION_MS / frames.length;
  let frameIndex = 0;

  sprite
    .setVisible(true)
    .setScale(TUTORIAL_CHARACTER_SPRITE_SCALE)
    .setTexture(tutorialCharacterAttackEffectTextureKey(effect, frames[frameIndex]));

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
    sprite.setTexture(tutorialCharacterAttackEffectTextureKey(effect, frames[frameIndex]));
    attackEffectTimers.set(sprite, sprite.scene.time.delayedCall(frameDuration, advanceFrame));
  };

  attackEffectTimers.set(sprite, sprite.scene.time.delayedCall(frameDuration, advanceFrame));
}
