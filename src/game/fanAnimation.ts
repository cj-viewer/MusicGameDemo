import Phaser from 'phaser';

export type FanAction = 'run' | 'roll' | 'attack';

export const FAN_RUN_FRAME_HEIGHT = 445;
export const FAN_RUN_DISPLAY_HEIGHT = 73;
export const FAN_SPRITE_SCALE = FAN_RUN_DISPLAY_HEIGHT / FAN_RUN_FRAME_HEIGHT;
export const FAN_ATTACK_DURATION_MS = 500;
export const FAN_HURT_ROLL_DURATION_MS = 260;

const animationKey: Record<FanAction, string> = {
  run: 'fan-run',
  roll: 'fan-roll',
  attack: 'fan-attack'
};

/**
 * 每个动作内部已统一内容高度：run=445px、roll=415px、attack=500px。
 * 以旧粉丝静态图约 73px 的可见高度为跑步缩放基准；翻滚略微收缩，近战适度放大，宽度始终等比变化。
 */
export function playFanAnimation(sprite: Phaser.GameObjects.Sprite, action: FanAction, restart = false): void {
  sprite.setScale(FAN_SPRITE_SCALE);
  const key = animationKey[action];
  if (restart || sprite.anims.currentAnim?.key !== key) sprite.play(key, true);
}
