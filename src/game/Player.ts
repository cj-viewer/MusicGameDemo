import Phaser from 'phaser';
import { GLOWSTICKS, type WeaponDef } from './weapons';
import { applyStickDeadzone } from './GamepadControls';
import { PLAYER_SPRITE_SCALE, playPlayerAnimation, type PlayerAction } from './playerAnimation';
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
/** 握把到角色中心的距离：与瞄准线起点一致，使武器与白色瞄准短线重合 */
const WEAPON_GRIP_DIST = PLAYER_RADIUS + worldSize(4);

export class Player {
  scene: MainScene;
  go: Phaser.GameObjects.Sprite;
  body: Phaser.Physics.Arcade.Body;

  hp = 100;
  readonly maxHp = 100;
  stamina = MAX_STAMINA;
  readonly maxStamina = MAX_STAMINA;
  weapon: WeaponDef = GLOWSTICKS;
  aimAngle = 0;
  /** 未经辅助瞄准修正的原始指向，供纯视觉观察窗使用。 */
  rawAimAngle = 0;
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
  private action: PlayerAction = 'idle';
  private dead = false;

  constructor(scene: MainScene, x: number, y: number) {
    this.scene = scene;
    this.go = scene.add.sprite(x, y, 'player-idle-1').setDepth(5);
    playPlayerAnimation(this.go, 'idle');
    scene.physics.add.existing(this.go);
    this.body = this.go.body as Phaser.Physics.Arcade.Body;
    // 受击判定使用默认全帧矩形：刚好包裹裁切后的角色内容，且随缩放自动同步（body 世界尺寸 = 源帧尺寸 × scale）
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

    // 瞄准
    this.updateAim();

    // 朝向与走/停动画：素材只绘制朝右版本，瞄准左侧时水平翻转（与武器持有侧一致）
    this.go.setFlipX(Math.cos(this.aimAngle) < 0);
    const moving = this.isDodging || this.body.velocity.length() > 20;
    this.setAction(moving ? 'run' : 'idle');

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

  /** 战败：倒地姿势并隐藏手持武器 */
  die(): void {
    this.dead = true;
    this.body.setVelocity(0, 0);
    this.setAction('down');
    this.go.clearTint();
    this.go.setAlpha(0.85);
    this.gfx.clear();
    this.weaponBars.forEach((bar) => bar.setVisible(false));
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
    this.rawAimAngle = rawAngle;
    this.aimAngle = this.scene.getAssistedAimAngle(rawAngle);
  }

  private moveTowards(current: number, target: number, maxChange: number): number {
    if (Math.abs(target - current) <= maxChange) return target;
    return current + Math.sign(target - current) * maxChange;
  }

  /** 动作切换（同动作直接返回，避免每帧重置动画与缩放） */
  private setAction(action: PlayerAction): void {
    if (this.action === action) return;
    this.action = action;
    playPlayerAnimation(this.go, action);
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

  /**
   * 武器示意跟随鼠标：握把固定在瞄准线起点、棒身指向瞄准方向，与白色瞄准短线重合。
   * 挥击时从偏转角在 200ms 内收敛回瞄准线（朝指向劈下的观感），无结束跳变。
   */
  private updateWeaponVisual(): void {
    const gripX = this.x + Math.cos(this.aimAngle) * WEAPON_GRIP_DIST;
    const gripY = this.y + Math.sin(this.aimAngle) * WEAPON_GRIP_DIST;
    const swingDegrees = this.weapon.id === 'baton' ? 50 : 30;
    const swingAngle = this.weaponSwingActive
      ? this.weaponSwingDirection * Phaser.Math.DegToRad(swingDegrees) * (1 - this.weaponSwing.progress)
      : 0;
    const baseAngle = this.aimAngle + swingAngle;

    // 两种武器都显示为握在瞄准线上的单根短棒，只在颜色和长度上区分
    const isBaton = this.weapon.id === 'baton';
    this.weaponBars[0]
      .setVisible(true)
      .setFillStyle(isBaton ? 0xa855f7 : 0xef4444)
      .setDisplaySize(worldSize(isBaton ? 51 : 30), worldSize(isBaton ? 9 : 7.5))
      .setPosition(gripX, gripY)
      .setRotation(baseAngle);
    this.weaponBars[1].setVisible(false);
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
