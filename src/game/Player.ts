import Phaser from 'phaser';
import { GLOWSTICKS, type WeaponDef } from './weapons';
import { applyStickDeadzone } from './GamepadControls';
import type { MainScene } from '../scenes/MainScene';
import { worldDepth, worldSize } from './visualScale';

export const PLAYER_RADIUS = worldSize(16);
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
const WEAPON_SWING_DURATION_MS = 200;
const BATON_SIDE_OFFSET = worldSize(17);
/** 分屏 FPV 瞄准：指针在右半屏偏离面板中心的量转为转向速度（弧度/秒，满偏时） */
const FPV_TURN_SPEED = 3.2;
const FPV_PANEL_LEFT = 640;
const FPV_PANEL_CENTER_X = 960;
const FPV_PANEL_HALF_W = 320;

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
    this.go = scene.add.image(x, y, 'player').setDisplaySize(worldSize(54), worldSize(82)).setDepth(5);
    scene.physics.add.existing(this.go);
    this.body = this.go.body as Phaser.Physics.Arcade.Body;
    // 受击判定使用默认全帧矩形：刚好包裹整张图片，且随图片缩放自动同步（body 世界尺寸 = 源帧尺寸 × scale）
    this.body.setCollideWorldBounds(true);

    this.gfx = scene.add.graphics().setDepth(6);
    this.weaponBars = [
      scene.add.rectangle(x, y, worldSize(20), worldSize(5), 0xef4444).setOrigin(0, 0.5).setDepth(7),
      scene.add.rectangle(x, y, worldSize(20), worldSize(5), 0xef4444).setOrigin(0, 0.5).setDepth(7)
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
    this.updateAim(dtMs);

    const playerDepth = worldDepth(this.y + this.body.halfHeight);
    this.go.setDepth(playerDepth);
    this.gfx.setDepth(playerDepth + 0.001);
    this.weaponBars.forEach((bar) => bar.setDepth(playerDepth + 0.002));
    this.updateWeaponVisual();
    this.drawOverlay(timeMs);
  }

  playAttackAnimation(aimAngle: number): void {
    this.scene.tweens.killTweensOf(this.weaponSwing);
    this.weaponSwing.progress = 0;
    this.weaponSwingActive = true;
    this.weaponSwingDirection = Math.cos(aimAngle) >= 0 ? 1 : -1;

    this.scene.tweens.add({
      targets: this.weaponSwing,
      progress: 1,
      duration: WEAPON_SWING_DURATION_MS,
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
    const padX = this.body.halfWidth + 4;
    const padY = this.body.halfHeight + 4;
    const tx = Phaser.Math.Clamp(this.x + dir.x * DODGE_DISTANCE, bounds.left + padX, bounds.right - padX);
    const ty = Phaser.Math.Clamp(this.y + dir.y * DODGE_DISTANCE, bounds.top + padY, bounds.bottom - padY);

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

  private updateAim(dtMs: number): void {
    if (this.scene.isSplitMode) {
      this.updateFpvAim(dtMs);
      return;
    }
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

  /**
   * 分屏 FPV 瞄准：只响应右半屏内的指针。指针偏离面板中心越远转向越快（平方响应，
   * 中心带小死区便于稳定持向），不做辅助瞄准以保证 FPV 视角平稳。
   */
  private updateFpvAim(dtMs: number): void {
    const pointer = this.scene.input.activePointer;
    if (pointer.x < FPV_PANEL_LEFT) return;
    const offset = Phaser.Math.Clamp((pointer.x - FPV_PANEL_CENTER_X) / FPV_PANEL_HALF_W, -1, 1);
    if (Math.abs(offset) < 0.08) return;
    const turn = offset * Math.abs(offset) * FPV_TURN_SPEED * (dtMs / 1000);
    this.aimAngle = Phaser.Math.Angle.Wrap(this.aimAngle + turn);
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

  /** 武器始终指向瞄准方向；挥击时绕瞄准方向从一侧扫到另一侧。 */
  private updateWeaponVisual(): void {
    const aim = this.aimAngle;
    const swingDegrees = this.weapon.id === 'baton' ? 50 : 30;
    const rotation = this.weaponSwingActive
      ? aim + this.weaponSwingDirection * Phaser.Math.DegToRad(swingDegrees) * (this.weaponSwing.progress * 2 - 1)
      : aim;
    const perpX = Math.cos(aim + Math.PI / 2);
    const perpY = Math.sin(aim + Math.PI / 2);
    const fwdX = Math.cos(aim);
    const fwdY = Math.sin(aim);

    if (this.weapon.id === 'glowsticks') {
      // 双持：两根荧光棒分列瞄准方向两侧，握把在角色边缘、棒身指向瞄准方向
      for (let i = 0; i < this.weaponBars.length; i++) {
        const side = i === 0 ? -1 : 1;
        this.weaponBars[i]
          .setVisible(true)
          .setFillStyle(0xef4444)
          .setDisplaySize(worldSize(30), worldSize(7.5))
          .setPosition(
            this.x + perpX * side * worldSize(14) + fwdX * worldSize(12),
            this.y + perpY * side * worldSize(14) + fwdY * worldSize(12)
          )
          .setRotation(rotation);
      }
    } else {
      this.weaponBars[0]
        .setVisible(true)
        .setFillStyle(0xa855f7)
        .setDisplaySize(worldSize(51), worldSize(9))
        .setPosition(this.x + fwdX * BATON_SIDE_OFFSET, this.y + fwdY * BATON_SIDE_OFFSET)
        .setRotation(rotation);
      this.weaponBars[1].setVisible(false);
    }
  }

  private drawOverlay(timeMs: number): void {
    this.gfx.clear();

    // 瞄准短线
    const fromX = this.x + Math.cos(this.aimAngle) * (PLAYER_RADIUS + worldSize(4));
    const fromY = this.y + Math.sin(this.aimAngle) * (PLAYER_RADIUS + worldSize(4));
    this.gfx.lineStyle(worldSize(3), 0xffffff, 0.9);
    this.gfx.lineBetween(
      fromX,
      fromY,
      fromX + Math.cos(this.aimAngle) * worldSize(14),
      fromY + Math.sin(this.aimAngle) * worldSize(14)
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
    const ringR = PLAYER_RADIUS + worldSize(8);
    this.gfx.lineStyle(worldSize(4), low ? 0x991b1b : 0xfacc15, 0.9);
    this.gfx.beginPath();
    this.gfx.arc(this.x, this.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
    this.gfx.strokePath();
  }
}
