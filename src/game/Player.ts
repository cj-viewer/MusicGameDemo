import Phaser from 'phaser';
import { GLOWSTICKS, type WeaponDef } from './weapons';
import { applyStickDeadzone } from './GamepadControls';
import {
  PLAYER_BODY_SOURCE_HEIGHT,
  PLAYER_BODY_SOURCE_OFFSET_X,
  PLAYER_BODY_SOURCE_OFFSET_Y,
  PLAYER_BODY_SOURCE_WIDTH,
  PLAYER_CHARACTER_SCALE,
  PLAYER_SPRITE_SCALE,
  playPlayerAttackEffect,
  playPlayerAnimation,
  type PlayerAction
} from './playerAnimation';
import type { MainScene } from '../scenes/MainScene';
import { worldDepth, worldSize } from './visualScale';

export const PLAYER_RADIUS = worldSize(16) * PLAYER_CHARACTER_SCALE;
const MOVE_SPEED = 260;
const MOVE_ACCELERATION = 1050;
const MOVE_DECELERATION = 720;
const DODGE_DISTANCE = 160;
const DODGE_DURATION_MS = 140;
/** 闪避踩拍判定窗口：拍点前后各 0.12 秒 */
const DODGE_BEAT_WINDOW = 0.12;
const ATTACK_EFFECT_DURATION_MS = 200;
const PLAYER_WEAPON_SCALE = PLAYER_SPRITE_SCALE * 0.8;
const PLAYER_WEAPON_SIDE_OFFSET = worldSize(14) * PLAYER_CHARACTER_SCALE;
const PLAYER_WEAPON_WAIST_OFFSET_Y = worldSize(6) * PLAYER_CHARACTER_SCALE;
const PLAYER_ATTACK_SIDE_OFFSET = worldSize(8) * PLAYER_CHARACTER_SCALE;
const PLAYER_ATTACK_FX_END_SCALE = PLAYER_SPRITE_SCALE * 1.35;

export class Player {
  scene: MainScene;
  go: Phaser.GameObjects.Sprite;
  body: Phaser.Physics.Arcade.Body;

  hp = 100;
  readonly maxHp = 100;
  weapon: WeaponDef = GLOWSTICKS;
  aimAngle = 0;
  /** 当前自动锁定方向，供只读 FPV 观察窗使用。 */
  rawAimAngle = 0;
  isDodging = false;

  private attackFx: Phaser.GameObjects.Sprite;
  private weaponSprite: Phaser.GameObjects.Image;
  private keys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private invulnUntil = 0;
  private lastTrailAt = 0;
  private lastMoveAngle = 0;
  private action: PlayerAction = 'idle';
  private actionLockedUntil = 0;
  private dead = false;

  constructor(scene: MainScene, x: number, y: number) {
    this.scene = scene;
    this.go = scene.add.sprite(x, y, 'player-idle-1').setDepth(5);
    playPlayerAnimation(this.go, 'idle');
    scene.physics.add.existing(this.go);
    this.body = this.go.body as Phaser.Physics.Arcade.Body;
    // 正式素材使用 256px 透明画布；碰撞体按可见角色内容固定，不能使用整张画布。
    this.body
      .setSize(PLAYER_BODY_SOURCE_WIDTH, PLAYER_BODY_SOURCE_HEIGHT, false)
      .setOffset(PLAYER_BODY_SOURCE_OFFSET_X, PLAYER_BODY_SOURCE_OFFSET_Y);
    this.body.setCollideWorldBounds(true);

    this.attackFx = scene.add
      .sprite(x, y, 'player-attack-light-1')
      .setScale(PLAYER_SPRITE_SCALE)
      .setVisible(false);
    this.attackFx.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.attackFx.setVisible(false));
    this.weaponSprite = scene.add
      .image(x, y, 'player-weapon-glowsticks')
      .setOrigin(0.5, 0.5)
      .setScale(PLAYER_WEAPON_SCALE);
    scene.textures.get('player-weapon-glowsticks').setFilter(Phaser.Textures.FilterMode.NEAREST);
    scene.textures.get('player-weapon-baton').setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D') as Record<
      'W' | 'A' | 'S' | 'D',
      Phaser.Input.Keyboard.Key
    >;
  }

  get x(): number {
    return this.go.x;
  }

  get y(): number {
    return this.go.y;
  }

  update(timeMs: number, dtMs: number): void {
    if (this.dead) return;

    // 移动（闪避期间由 tween 控制位移）
    if (!this.isDodging) {
      const dir = this.moveDir();
      const acceleration = dir.lengthSq() > 0 ? MOVE_ACCELERATION : MOVE_DECELERATION;
      const maxChange = acceleration * Math.min(dtMs, 50) / 1000;
      this.body.setVelocity(
        this.moveTowards(this.body.velocity.x, dir.x * MOVE_SPEED, maxChange),
        this.moveTowards(this.body.velocity.y, dir.y * MOVE_SPEED, maxChange)
      );
    }

    // 自动瞄准：移动方向前方扇区内的目标享受两倍距离权重。
    this.updateAutoAim();

    // 正式素材默认朝左；锁定方向在右侧时水平翻转。
    this.go.setFlipX(Math.cos(this.aimAngle) >= 0);
    const moving = this.isDodging || this.body.velocity.length() > 20;
    if (this.isDodging) {
      this.setAction('dash');
    } else if (timeMs >= this.actionLockedUntil) {
      this.setAction(moving ? 'run' : 'idle');
    }

    const playerDepth = worldDepth(this.y + this.body.halfHeight);
    this.go.setDepth(playerDepth);
    this.weaponSprite.setDepth(playerDepth - 0.001);
    this.updateWeaponVisual();
    this.updateInvulnerabilityBlink(timeMs);
  }

  /** 角色攻击统一从中心向当前朝向侧轻移，弹幕、扫击和特效共享该锚点。 */
  getAttackOrigin(): { x: number; y: number } {
    const side = Math.cos(this.aimAngle) >= 0 ? 1 : -1;
    return { x: this.x + side * PLAYER_ATTACK_SIDE_OFFSET, y: this.y };
  }

  playAttackAnimation(heavy: boolean): void {
    if (!this.isDodging) {
      const attackAction = heavy ? 'attack-hard' : 'attack-light';
      const origin = this.getAttackOrigin();
      const playerDepth = worldDepth(this.y + this.body.halfHeight);
      this.actionLockedUntil = this.scene.time.now + ATTACK_EFFECT_DURATION_MS;
      this.setAction(attackAction, true);
      this.scene.tweens.killTweensOf(this.attackFx);
      playPlayerAttackEffect(this.attackFx, attackAction);
      this.attackFx
        .setPosition(origin.x, origin.y)
        .setFlipX(this.go.flipX)
        .setScale(PLAYER_SPRITE_SCALE)
        .setAlpha(0.95)
        .setDepth(playerDepth - 0.002);
      this.scene.tweens.add({
        targets: this.attackFx,
        scaleX: PLAYER_ATTACK_FX_END_SCALE,
        scaleY: PLAYER_ATTACK_FX_END_SCALE,
        alpha: 0,
        duration: ATTACK_EFFECT_DURATION_MS,
        ease: 'Quad.easeOut',
        onComplete: () => this.attackFx.setVisible(false)
      });
    }
  }

  onBeat(): void {
    // 踩拍律动：轻微蹲弹，与场边律动带、HP 血条的节拍呼吸保持一致
    if (!this.dead && !this.isDodging) {
      this.scene.tweens.add({
        targets: this.go,
        scaleX: { from: PLAYER_SPRITE_SCALE * 1.06, to: PLAYER_SPRITE_SCALE },
        scaleY: { from: PLAYER_SPRITE_SCALE * 0.95, to: PLAYER_SPRITE_SCALE },
        duration: 150,
        ease: 'Sine.easeOut'
      });
    }
  }

  tryDodge(): boolean {
    if (this.isDodging || this.dead) return false;
    const conductor = this.scene.conductor;
    if (!conductor.started) return false;

    const dir = this.moveDir();
    if (dir.lengthSq() === 0) return false;

    const t = conductor.now();
    const { offset } = conductor.nearestBeat(t);
    const onBeat = Math.abs(offset) <= DODGE_BEAT_WINDOW;
    this.scene.consumeDodgeComboMeter(onBeat);

    const bounds = this.scene.physics.world.bounds;
    const padX = this.body.halfWidth + 4;
    const padY = this.body.halfHeight + 4;
    const tx = Phaser.Math.Clamp(this.x + dir.x * DODGE_DISTANCE, bounds.left + padX, bounds.right - padX);
    const ty = Phaser.Math.Clamp(this.y + dir.y * DODGE_DISTANCE, bounds.top + padY, bounds.bottom - padY);

    this.isDodging = true;
    this.actionLockedUntil = 0;
    this.setAction('dash', true);
    this.body.setVelocity(0, 0);
    this.body.enable = false;
    this.lastTrailAt = 0;
    let waveReleased = false;

    this.scene.tweens.add({
      targets: this.go,
      x: tx,
      y: ty,
      duration: DODGE_DURATION_MS,
      ease: 'Quint.easeOut',
      onUpdate: (tween) => {
        this.spawnTrail();
        if (!waveReleased && tween.progress >= 2 / 3) {
          waveReleased = true;
          this.scene.triggerDodgeFeverWave(this.go.x, this.go.y);
        }
      },
      onComplete: () => {
        this.isDodging = false;
        this.body.enable = true;
        this.body.reset(this.go.x, this.go.y);
      }
    });
    return true;
  }

  takeDamage(amount: number): void {
    const now = this.scene.time.now;
    if (this.isDodging || this.dead || now < this.invulnUntil) return;
    this.hp = Math.max(0, this.hp - amount);
    this.invulnUntil = now + 600;
    this.scene.queueBeatSfx('playerHurt');
    this.scene.hud.setHp(this.hp, this.maxHp);
    this.flash(0xef4444);
    this.scene.spawnImpactFx(this.x, this.y, 0xef4444, true);
    if (this.hp <= 0) {
      this.scene.onPlayerDied();
    }
  }

  /** Fever Time 的正确输入恢复生命，不超过最大生命。 */
  heal(amount: number): void {
    if (this.dead || amount <= 0) return;
    const previousHp = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    if (this.hp === previousHp) return;
    this.scene.hud.setHp(this.hp, this.maxHp);
    this.flash(0x86efac);
  }

  /** 战败：两套完整死亡动画随机播放其一，并隐藏手持武器。 */
  die(): void {
    this.dead = true;
    this.body.setVelocity(0, 0);
    this.actionLockedUntil = Infinity;
    this.setAction(Math.random() < 0.5 ? 'death-1' : 'death-2', true);
    this.go.clearTint();
    this.go.setAlpha(0.85);
    this.attackFx.setVisible(false);
    this.weaponSprite.setVisible(false);
  }

  /** 输入错误的噪音反馈 */
  errorFlash(): void {
    this.flash(0xef4444);
    const glitch = this.scene.add.graphics().setDepth(7);
    glitch.lineStyle(worldSize(3), 0xef4444, 0.9);
    glitch.lineBetween(this.x - worldSize(25), this.y - worldSize(9), this.x + worldSize(18), this.y - worldSize(4));
    glitch.lineBetween(this.x - worldSize(14), this.y + worldSize(7), this.x + worldSize(27), this.y + worldSize(12));
    glitch.lineStyle(worldSize(2), 0xffffff, 0.7);
    glitch.lineBetween(this.x - worldSize(20), this.y + worldSize(2), this.x + worldSize(10), this.y + worldSize(2));
    this.scene.tweens.add({ targets: glitch, alpha: 0, duration: 180, onComplete: () => glitch.destroy() });
  }

  private flash(color: number): void {
    this.go.setTint(color);
    this.scene.time.delayedCall(120, () => this.go.clearTint());
  }

  private moveDir(): Phaser.Math.Vector2 {
    const pad = this.scene.input.gamepad?.pad1;
    if (pad) {
      const stick = applyStickDeadzone(pad.leftStick.x, pad.leftStick.y);
      if (stick.x !== 0 || stick.y !== 0) return new Phaser.Math.Vector2(stick.x, stick.y);
    }
    const dir = new Phaser.Math.Vector2(
      (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0),
      (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0)
    );
    return dir.lengthSq() > 0 ? dir.normalize() : dir;
  }

  private updateAutoAim(): void {
    const movement = this.moveDir();
    if (movement.lengthSq() > 0) this.lastMoveAngle = Math.atan2(movement.y, movement.x);
    this.aimAngle = this.scene.getAutoAimAngle(this.lastMoveAngle);
    this.rawAimAngle = this.aimAngle;
  }

  private moveTowards(current: number, target: number, maxChange: number): number {
    if (Math.abs(target - current) <= maxChange) return target;
    return current + Math.sign(target - current) * maxChange;
  }

  /** 动作切换（同动作直接返回，避免每帧重置动画与缩放） */
  private setAction(action: PlayerAction, forceRestart = false): void {
    if (this.action === action && !forceRestart) return;
    this.action = action;
    playPlayerAnimation(this.go, action, forceRestart);
  }

  private spawnTrail(): void {
    const now = this.scene.time.now;
    if (now - this.lastTrailAt < 50) return;
    this.lastTrailAt = now;
    const trail = this.scene.add
      .sprite(this.go.x, this.go.y, this.go.texture.key)
      .setScale(this.go.scaleX, this.go.scaleY)
      .setFlipX(this.go.flipX)
      .setAlpha(0.55)
      .setTint(0x9be8ff)
      .setDepth(this.go.depth - 0.0005);
    this.scene.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 100,
      onComplete: () => trail.destroy()
    });
  }

  /** 正式武器贴图固定在角色身后；角色朝左/右时瞬切到身体同侧并镜像。 */
  private updateWeaponVisual(): void {
    const facingRight = Math.cos(this.aimAngle) >= 0;
    const side = facingRight ? 1 : -1;
    const isBaton = this.weapon.id === 'baton';
    this.weaponSprite
      .setVisible(true)
      .setTexture(isBaton ? 'player-weapon-baton' : 'player-weapon-glowsticks')
      .setOrigin(0.5, 0.5)
      .setPosition(
        this.x + side * PLAYER_WEAPON_SIDE_OFFSET,
        this.y + PLAYER_WEAPON_WAIST_OFFSET_Y
      )
      .setScale(PLAYER_WEAPON_SCALE)
      .setFlipX(facingRight)
      .setRotation(0);
  }

  private updateInvulnerabilityBlink(timeMs: number): void {
    // 受击无敌闪烁
    if (this.scene.time.now < this.invulnUntil && !this.isDodging) {
      this.go.setAlpha(Math.sin(timeMs * 0.04) > 0 ? 1 : 0.4);
    } else {
      this.go.setAlpha(1);
    }

  }
}
