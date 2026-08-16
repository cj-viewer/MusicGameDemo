import Phaser from 'phaser';
import { GLOWSTICKS, type WeaponDef } from './weapons';
import { applyStickDeadzone } from './GamepadControls';
import {
  PLAYER_BODY_SOURCE_HEIGHT,
  PLAYER_BODY_SOURCE_OFFSET_X,
  PLAYER_BODY_SOURCE_OFFSET_Y,
  PLAYER_BODY_SOURCE_WIDTH,
  PLAYER_DASH_ANIMATION_DURATION_MS,
  PLAYER_SPRITE_SCALE,
  PLAYER_WEAPON_SCALE,
  playPlayerAttackEffect,
  playPlayerAnimation,
  type PlayerAction
} from './playerAnimation';
import type { MainScene } from '../scenes/MainScene';
import { UI_SCALE } from './displayConfig';
import { worldDepth, worldSize } from './visualScale';

export const PLAYER_RADIUS = worldSize(16);
const MOVE_SPEED = 260;
const MOVE_ACCELERATION = 1050;
const MOVE_DECELERATION = 720;
const DODGE_DISTANCE = 160;
const DODGE_DURATION_MS = 140;
const DODGE_ANIMATION_FOLLOW_THROUGH_MS = PLAYER_DASH_ANIMATION_DURATION_MS - DODGE_DURATION_MS;
/** Dash 位移过程中的角色残影采样间隔。 */
const DODGE_TRAIL_INTERVAL_MS = 10;
/** 两倍原始 0.55 会超过 Phaser 的上限，因此取最大可见值。 */
const DODGE_TRAIL_INITIAL_ALPHA = 1;
const EMPTY_COMBO_DODGE_INTERVAL_MS = 500;
/** 闪避踩拍判定窗口：拍点前后各 0.12 秒 */
const DODGE_BEAT_WINDOW = 0.12;
const ATTACK_EFFECT_DURATION_MS = 200;
const PLAYER_ATTACK_SIDE_OFFSET = 5.12 * 1.5;
const PLAYER_WEAPON_WAIST_OFFSET_Y = 15 * UI_SCALE;
const LIGHT_ATTACK_EFFECT_ALPHA = 0.45;
const HARD_ATTACK_EFFECT_SCALE = 1.18;
const LIGHT_ATTACK_GLOW_ALPHA = 0.3;
const HARD_ATTACK_GLOW_ALPHA = 0.68;
/** 复用边缘律动的轻 / 重拍层级，但将角色本体的缩放压低到克制可见。 */
const CHARACTER_BEAT_PULSE_LIGHT_SCALE = 1.035;
const CHARACTER_BEAT_PULSE_HEAVY_SCALE = 1.075;
const CHARACTER_BEAT_PULSE_LIGHT_DURATION_MS = 170;
const CHARACTER_BEAT_PULSE_HEAVY_DURATION_MS = 220;
/** 武器透明内容的握把末端；旋转与镜像都必须围绕此点。 */
const LIGHT_STICK_ORIGIN = { x: 101 / 128, y: 98 / 128 };
const BATON_ORIGIN = { x: 123 / 128, y: 121 / 128 };

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
  private attackGlowFx: Phaser.GameObjects.Sprite;
  private weaponSprite: Phaser.GameObjects.Image;
  private keys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private invulnUntil = 0;
  private lastTrailAt = 0;
  private lastMoveAngle = 0;
  private action: PlayerAction = 'idle';
  private actionLockedUntil = 0;
  private weaponAttackUntil = 0;
  private lastDodgeAt = -Infinity;
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
    this.attackGlowFx = scene.add
      .sprite(x, y, 'player-attack-light-1')
      .setScale(PLAYER_SPRITE_SCALE)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.attackGlowFx.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      () => this.attackGlowFx.setVisible(false)
    );
    this.weaponSprite = scene.add
      .image(x, y, 'player-weapon-glowsticks')
      .setOrigin(LIGHT_STICK_ORIGIN.x, LIGHT_STICK_ORIGIN.y)
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
    this.weaponSprite.setDepth(playerDepth + 0.002);
    if (this.attackFx.visible) {
      this.attackFx
        .setPosition(this.x, this.y)
        .setFlipX(this.go.flipX)
        .setDepth(playerDepth - 0.002);
    }
    if (this.attackGlowFx.visible) {
      this.attackGlowFx
        .setPosition(this.x, this.y)
        .setFlipX(this.go.flipX)
        .setDepth(playerDepth - 0.003);
    }
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
      const playerDepth = worldDepth(this.y + this.body.halfHeight);
      const attackSpeed = this.scene.getPlayerWeaponAttackSpeed(this.weapon.id);
      const attackDuration = ATTACK_EFFECT_DURATION_MS / attackSpeed;
      this.actionLockedUntil = this.scene.time.now + attackDuration;
      this.setAction(attackAction, true);
      this.scene.tweens.killTweensOf(this.attackFx);
      this.scene.tweens.killTweensOf(this.attackGlowFx);
      playPlayerAttackEffect(this.attackFx, attackAction, attackSpeed);
      playPlayerAttackEffect(this.attackGlowFx, attackAction, attackSpeed);
      this.attackFx
        .setPosition(this.x, this.y)
        .setFlipX(this.go.flipX)
        .setScale(PLAYER_SPRITE_SCALE * (heavy ? HARD_ATTACK_EFFECT_SCALE : 1))
        .setAlpha(heavy ? 1 : LIGHT_ATTACK_EFFECT_ALPHA)
        .setDepth(playerDepth - 0.002);
      const glowStartScale = PLAYER_SPRITE_SCALE * (heavy ? HARD_ATTACK_EFFECT_SCALE * 1.08 : 1.04);
      this.attackGlowFx
        .setPosition(this.x, this.y)
        .setFlipX(this.go.flipX)
        .setScale(glowStartScale)
        .setAlpha(heavy ? HARD_ATTACK_GLOW_ALPHA : LIGHT_ATTACK_GLOW_ALPHA)
        .setTint(heavy ? 0xffb347 : 0xb9f8ff)
        .setDepth(playerDepth - 0.003);
      this.scene.tweens.add({
        targets: this.attackGlowFx,
        scaleX: glowStartScale * (heavy ? 1.28 : 1.14),
        scaleY: glowStartScale * (heavy ? 1.28 : 1.14),
        alpha: 0,
        duration: attackDuration,
        ease: 'Cubic.easeOut',
        onComplete: () => this.attackGlowFx.setVisible(false)
      });
      this.playWeaponAttackMotion(heavy, attackDuration);
    }
  }

  onBeat(heavy: boolean): void {
    if (this.dead) return;
    const scale = heavy ? CHARACTER_BEAT_PULSE_HEAVY_SCALE : CHARACTER_BEAT_PULSE_LIGHT_SCALE;
    this.scene.tweens.killTweensOf(this.go);
    this.go.setScale(PLAYER_SPRITE_SCALE * scale);
    this.scene.tweens.add({
      targets: this.go,
      scaleX: PLAYER_SPRITE_SCALE,
      scaleY: PLAYER_SPRITE_SCALE,
      duration: heavy ? CHARACTER_BEAT_PULSE_HEAVY_DURATION_MS : CHARACTER_BEAT_PULSE_LIGHT_DURATION_MS,
      ease: 'Back.easeOut'
    });
  }

  tryDodge(): boolean {
    if (this.isDodging || this.dead) return false;
    const conductor = this.scene.conductor;
    if (!conductor.started) return false;

    const dodgeStartedAt = this.scene.time.now;
    if (
      this.scene.combo.progress <= 0 &&
      dodgeStartedAt - this.lastDodgeAt < EMPTY_COMBO_DODGE_INTERVAL_MS
    ) return false;

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
    this.lastDodgeAt = dodgeStartedAt;
    this.actionLockedUntil = dodgeStartedAt + DODGE_DURATION_MS + DODGE_ANIMATION_FOLLOW_THROUGH_MS;
    this.setAction('dash', true);
    this.body.setVelocity(0, 0);
    this.body.enable = false;
    const trailStartX = this.go.x;
    const trailStartY = this.go.y;
    this.lastTrailAt = dodgeStartedAt;
    this.spawnTrail(trailStartX, trailStartY);
    let waveReleased = false;

    this.scene.tweens.add({
      targets: this.go,
      x: tx,
      y: ty,
      duration: DODGE_DURATION_MS,
      ease: 'Quint.easeOut',
      onUpdate: (tween) => {
        this.spawnDodgeTrailSamples(dodgeStartedAt, trailStartX, trailStartY, tx, ty);
        if (!waveReleased && tween.progress >= 2 / 3) {
          waveReleased = true;
          this.scene.triggerDodgeFeverWave(this.go.x, this.go.y);
        }
      },
      onComplete: () => {
        this.spawnDodgeTrailSamples(dodgeStartedAt, trailStartX, trailStartY, tx, ty);
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
    this.flashHitWhite();
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
    this.go.setAlpha(1);
    this.attackFx.setVisible(false);
    this.attackGlowFx.setVisible(false);
    this.weaponSprite.setVisible(false);
  }

  /** 游戏结束时保留角色在场景中，停止位移并循环 Idle。 */
  enterGameOverIdle(): void {
    this.dead = true;
    this.isDodging = false;
    this.scene.tweens.killTweensOf([this.go, this.weaponSprite, this.attackFx, this.attackGlowFx]);
    this.body.setVelocity(0, 0);
    this.body.enable = false;
    this.actionLockedUntil = Infinity;
    this.action = 'idle';
    playPlayerAnimation(this.go, 'idle', true);
    this.go.setAlpha(1);
    this.attackFx.setVisible(false);
    this.attackGlowFx.setVisible(false);
    this.weaponSprite.setVisible(true).setRotation(0);
    this.updateWeaponVisual();
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

  private flashHitWhite(): void {
    this.go.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.weaponSprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(140, () => {
      if (this.go.active) this.go.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      if (this.weaponSprite.active) {
        this.weaponSprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      }
    });
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

  /**
   * 按固定的 10ms 时间轴补齐残影。渲染帧跨过多个采样点时，仍按 Quint.easeOut
   * 位移曲线在对应的历史位置生成残影，而不是将多个残影堆叠在当前帧位置。
   */
  private spawnDodgeTrailSamples(
    dodgeStartedAt: number,
    startX: number,
    startY: number,
    targetX: number,
    targetY: number
  ): void {
    const dodgeEndsAt = dodgeStartedAt + DODGE_DURATION_MS;
    const sampleUntil = Math.min(this.scene.time.now, dodgeEndsAt);
    while (this.lastTrailAt + DODGE_TRAIL_INTERVAL_MS <= sampleUntil) {
      this.lastTrailAt += DODGE_TRAIL_INTERVAL_MS;
      const progress = Phaser.Math.Clamp((this.lastTrailAt - dodgeStartedAt) / DODGE_DURATION_MS, 0, 1);
      const easedProgress = 1 - (1 - progress) ** 5; // Quint.easeOut
      this.spawnTrail(
        Phaser.Math.Linear(startX, targetX, easedProgress),
        Phaser.Math.Linear(startY, targetY, easedProgress)
      );
    }
  }

  private spawnTrail(x: number, y: number): void {
    const trail = this.scene.add
      .sprite(x, y, this.go.texture.key)
      .setScale(this.go.scaleX, this.go.scaleY)
      .setFlipX(this.go.flipX)
      .setAlpha(DODGE_TRAIL_INITIAL_ALPHA)
      .setTint(0x9be8ff)
      .setDepth(this.go.depth - 0.0005);
    this.scene.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 100,
      onComplete: () => trail.destroy()
    });
  }

  /** 玩家棍状武器位于角色前方；握把末端固定在腰部中线，左右严格镜像。 */
  private updateWeaponVisual(): void {
    const facingRight = Math.cos(this.aimAngle) >= 0;
    const isBaton = this.weapon.id === 'baton';
    this.weaponSprite
      .setVisible(true)
      .setTexture(isBaton ? 'player-weapon-baton' : 'player-weapon-glowsticks')
      .setOrigin(
        isBaton ? BATON_ORIGIN.x : LIGHT_STICK_ORIGIN.x,
        isBaton ? BATON_ORIGIN.y : LIGHT_STICK_ORIGIN.y
      )
      .setPosition(
        this.x,
        this.y + PLAYER_WEAPON_WAIST_OFFSET_Y
      )
      // Phaser 的 flipX 只翻纹理 UV，非中心 Origin 会随之换到另一端。
      // 使用负 scaleX 才能围绕握把 Origin 做真正的几何镜像。
      .setFlipX(false)
      .setScale(
        facingRight ? -PLAYER_WEAPON_SCALE : PLAYER_WEAPON_SCALE,
        PLAYER_WEAPON_SCALE
      );
    if (this.scene.time.now >= this.weaponAttackUntil) this.weaponSprite.setRotation(0);
  }

  /** 轻 / 重攻击使用不同幅度的非线性挥击，200ms 内回到握持角。 */
  private playWeaponAttackMotion(heavy: boolean, attackDuration: number): void {
    const downwardDirection = this.go.flipX ? 1 : -1;
    const windup = Phaser.Math.DegToRad((heavy ? -14 : -9) * downwardDirection);
    const strike = Phaser.Math.DegToRad((heavy ? 76 : 62) * downwardDirection);
    const windupRatio = heavy ? 72 / ATTACK_EFFECT_DURATION_MS : 54 / ATTACK_EFFECT_DURATION_MS;
    const windupMs = attackDuration * windupRatio;
    this.weaponAttackUntil = this.scene.time.now + attackDuration;
    this.scene.tweens.killTweensOf(this.weaponSprite);
    this.weaponSprite.setRotation(windup);
    this.scene.tweens.add({
      targets: this.weaponSprite,
      rotation: strike,
      duration: windupMs,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.weaponSprite,
          rotation: 0,
          duration: attackDuration - windupMs,
          ease: heavy ? 'Back.easeOut' : 'Quad.easeOut'
        });
      }
    });
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
