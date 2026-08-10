import Phaser from 'phaser';
import { GLOWSTICKS, type WeaponDef } from './weapons';
import { applyStickDeadzone } from './GamepadControls';
import type { MainScene } from '../scenes/MainScene';

export const PLAYER_RADIUS = 16;
const MOVE_SPEED = 260;
const MOVE_ACCELERATION = 1050;
const MOVE_DECELERATION = 720;
const DODGE_DISTANCE = 80;
const DODGE_DURATION_MS = 300;
const MAX_STAMINA = 90;
const STAMINA_REGEN_PER_BEAT = 10;
const DODGE_COST_OFFBEAT = 30;
const DODGE_COST_ONBEAT = 15;
/** 闪避踩拍判定窗口：拍点前后各 0.12 秒 */
const DODGE_BEAT_WINDOW = 0.12;
const SHOCKWAVE_RADIUS = 60;

export class Player {
  scene: MainScene;
  go: Phaser.GameObjects.Image;
  body: Phaser.Physics.Arcade.Body;

  hp = 100;
  readonly maxHp = 100;
  stamina = MAX_STAMINA;
  readonly maxStamina = MAX_STAMINA;
  weapon: WeaponDef = GLOWSTICKS;
  aimAngle = 0;
  isDodging = false;

  private gfx: Phaser.GameObjects.Graphics;
  private weaponBars: Phaser.GameObjects.Rectangle[];
  private weaponSwing = { progress: 1 };
  private weaponSwingActive = false;
  private weaponSwingDirection: -1 | 1 = 1;
  private keys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private invulnUntil = 0;
  private staminaFullSince = 0;
  private lastTrailAt = 0;
  private gamepadAimActive = false;
  private gamepadAimAngle = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;

  constructor(scene: MainScene, x: number, y: number) {
    this.scene = scene;
    this.go = scene.add.image(x, y, 'player').setDisplaySize(54, 82).setDepth(5);
    scene.physics.add.existing(this.go);
    this.body = this.go.body as Phaser.Physics.Arcade.Body;
    this.body.setCircle(PLAYER_RADIUS);
    this.body.setCollideWorldBounds(true);

    this.gfx = scene.add.graphics().setDepth(6);
    this.weaponBars = [
      scene.add.rectangle(x, y, 20, 5, 0xef4444).setOrigin(0, 0.5).setDepth(7),
      scene.add.rectangle(x, y, 20, 5, 0xef4444).setOrigin(0, 0.5).setDepth(7)
    ];
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D') as Record<
      'W' | 'A' | 'S' | 'D',
      Phaser.Input.Keyboard.Key
    >;
    this.lastPointerX = scene.input.activePointer.x;
    this.lastPointerY = scene.input.activePointer.y;
  }

  get x(): number {
    return this.go.x;
  }

  get y(): number {
    return this.go.y;
  }

  update(timeMs: number, dtMs: number): void {
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

    // 瞄准
    this.updateAim();

    this.updateWeaponVisual();
    this.drawOverlay(timeMs);
  }

  playAttackAnimation(aimAngle: number): void {
    this.scene.tweens.killTweensOf(this.weaponSwing);
    this.weaponSwing.progress = 0;
    this.weaponSwingActive = true;
    this.weaponSwingDirection = Math.cos(aimAngle) >= 0 ? 1 : -1;

    const beatFloat = this.scene.conductor.beatFloatAt(this.scene.conductor.now());
    const nextBeat = Math.floor(beatFloat) + 1;
    const duration = Math.max(1, (nextBeat - beatFloat) * this.scene.conductor.beatDur * 1000);
    this.scene.tweens.add({
      targets: this.weaponSwing,
      progress: 1,
      duration,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.weaponSwingActive = false;
      }
    });
  }

  onBeat(): void {
    this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN_PER_BEAT);
  }

  tryDodge(): boolean {
    if (this.isDodging) return false;
    const conductor = this.scene.conductor;
    if (!conductor.started) return false;

    const dir = this.moveDir();
    if (dir.lengthSq() === 0) return false;

    const t = conductor.now();
    const { offset } = conductor.nearestBeat(t);
    const onBeat = Math.abs(offset) <= DODGE_BEAT_WINDOW;
    const cost = onBeat ? DODGE_COST_ONBEAT : DODGE_COST_OFFBEAT;
    if (this.stamina < cost) {
      this.scene.hud.flashStaminaWarning();
      return false;
    }
    this.stamina -= cost;
    this.staminaFullSince = Infinity;

    const bounds = this.scene.physics.world.bounds;
    const pad = PLAYER_RADIUS + 4;
    const tx = Phaser.Math.Clamp(this.x + dir.x * DODGE_DISTANCE, bounds.left + pad, bounds.right - pad);
    const ty = Phaser.Math.Clamp(this.y + dir.y * DODGE_DISTANCE, bounds.top + pad, bounds.bottom - pad);

    this.isDodging = true;
    this.body.setVelocity(0, 0);
    this.body.enable = false;
    this.lastTrailAt = 0;

    this.scene.tweens.add({
      targets: this.go,
      x: tx,
      y: ty,
      duration: DODGE_DURATION_MS,
      ease: 'Quint.easeOut',
      onUpdate: () => this.spawnTrail(),
      onComplete: () => {
        this.isDodging = false;
        this.body.enable = true;
        this.body.reset(this.go.x, this.go.y);
        if (onBeat) {
          this.scene.triggerShockwave(this.go.x, this.go.y, SHOCKWAVE_RADIUS);
        }
      }
    });
    return true;
  }

  takeDamage(amount: number): void {
    const now = this.scene.time.now;
    if (this.isDodging || now < this.invulnUntil) return;
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

  /** 输入错误的噪音反馈 */
  errorFlash(): void {
    this.flash(0xef4444);
    const glitch = this.scene.add.graphics().setDepth(7);
    glitch.lineStyle(3, 0xef4444, 0.9);
    glitch.lineBetween(this.x - 25, this.y - 9, this.x + 18, this.y - 4);
    glitch.lineBetween(this.x - 14, this.y + 7, this.x + 27, this.y + 12);
    glitch.lineStyle(2, 0xffffff, 0.7);
    glitch.lineBetween(this.x - 20, this.y + 2, this.x + 10, this.y + 2);
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

  private updateAim(): void {
    const pointer = this.scene.input.activePointer;
    const pointerMoved = pointer.x !== this.lastPointerX || pointer.y !== this.lastPointerY;
    this.lastPointerX = pointer.x;
    this.lastPointerY = pointer.y;

    const pad = this.scene.input.gamepad?.pad1;
    if (pad) {
      const stick = applyStickDeadzone(pad.rightStick.x, pad.rightStick.y);
      if (stick.x !== 0 || stick.y !== 0) {
        this.gamepadAimActive = true;
        this.gamepadAimAngle = Math.atan2(stick.y, stick.x);
      } else if (pointerMoved) {
        this.gamepadAimActive = false;
      }
    } else {
      this.gamepadAimActive = false;
    }

    const rawAngle = this.gamepadAimActive
      ? this.gamepadAimAngle
      : Phaser.Math.Angle.Between(this.x, this.y, pointer.worldX, pointer.worldY);
    this.aimAngle = this.scene.getAssistedAimAngle(rawAngle);
  }

  private moveTowards(current: number, target: number, maxChange: number): number {
    if (Math.abs(target - current) <= maxChange) return target;
    return current + Math.sign(target - current) * maxChange;
  }

  private spawnTrail(): void {
    const now = this.scene.time.now;
    if (now - this.lastTrailAt < 50) return;
    this.lastTrailAt = now;
    const trail = this.scene.add
      .circle(this.go.x, this.go.y, PLAYER_RADIUS, 0x4ade80, 0.7)
      .setDepth(4);
    this.scene.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 100,
      onComplete: () => trail.destroy()
    });
  }

  private updateWeaponVisual(): void {
    if (!this.weaponSwingActive) {
      if (this.weapon.id === 'glowsticks') {
        this.weaponBars[0]
          .setVisible(true)
          .setFillStyle(0xef4444)
          .setDisplaySize(30, 7.5)
          .setPosition(this.x - 17, this.y + 20)
          .setRotation(-Math.PI / 2);
        this.weaponBars[1]
          .setVisible(true)
          .setFillStyle(0xef4444)
          .setDisplaySize(30, 7.5)
          .setPosition(this.x + 17, this.y + 20)
          .setRotation(-Math.PI / 2);
      } else {
        this.weaponBars[0]
          .setVisible(true)
          .setFillStyle(0xa855f7)
          .setDisplaySize(51, 9)
          .setPosition(this.x, this.y + 30.5)
          .setRotation(-Math.PI / 2);
        this.weaponBars[1].setVisible(false);
      }
      return;
    }

    const swingDegrees = this.weapon.id === 'baton' ? 50 : 30;
    const angle = -Math.PI / 2 +
      this.weaponSwingDirection * Phaser.Math.DegToRad(swingDegrees) * this.weaponSwing.progress;

    if (this.weapon.id === 'glowsticks') {
      for (let i = 0; i < this.weaponBars.length; i++) {
        const pivotX = this.x + (i === 0 ? -17 : 17);
        this.weaponBars[i]
          .setVisible(true)
          .setFillStyle(0xef4444)
          .setDisplaySize(30, 7.5)
          .setPosition(pivotX, this.y + 20)
          .setRotation(angle);
      }
    } else {
      this.weaponBars[0]
        .setVisible(true)
        .setFillStyle(0xa855f7)
        .setDisplaySize(51, 9)
        .setPosition(this.x, this.y + 30.5)
        .setRotation(angle);
      this.weaponBars[1].setVisible(false);
    }
  }

  private drawOverlay(timeMs: number): void {
    this.gfx.clear();

    // 瞄准短线
    const fromX = this.x + Math.cos(this.aimAngle) * (PLAYER_RADIUS + 4);
    const fromY = this.y + Math.sin(this.aimAngle) * (PLAYER_RADIUS + 4);
    this.gfx.lineStyle(3, 0xffffff, 0.9);
    this.gfx.lineBetween(
      fromX,
      fromY,
      fromX + Math.cos(this.aimAngle) * 14,
      fromY + Math.sin(this.aimAngle) * 14
    );

    // 受击无敌闪烁
    if (this.scene.time.now < this.invulnUntil && !this.isDodging) {
      this.go.setAlpha(Math.sin(timeMs * 0.04) > 0 ? 1 : 0.4);
    } else {
      this.go.setAlpha(1);
    }

    // 闪避体力环：体力未满时显示，回满 1 秒后隐藏
    if (this.stamina >= this.maxStamina) {
      if (this.staminaFullSince === Infinity) this.staminaFullSince = timeMs;
      if (timeMs - this.staminaFullSince > 1000) return;
    }
    const low = this.stamina < 30;
    const ratio = this.stamina / this.maxStamina;
    const ringR = PLAYER_RADIUS + 8;
    this.gfx.lineStyle(4, low ? 0x991b1b : 0xfacc15, 0.9);
    this.gfx.beginPath();
    this.gfx.arc(this.x, this.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
    this.gfx.strokePath();
  }
}
