import Phaser from 'phaser';
import { GLOWSTICKS, type WeaponDef } from './weapons';
import type { MainScene } from '../scenes/MainScene';

export const PLAYER_RADIUS = 16;
const MOVE_SPEED = 260;
const DODGE_DISTANCE = 80;
const MAX_STAMINA = 90;
const STAMINA_REGEN_PER_BEAT = 10;
const DODGE_COST_OFFBEAT = 30;
const DODGE_COST_ONBEAT = 15;
/** 闪避踩拍判定窗口：拍点前后各 0.12 秒 */
const DODGE_BEAT_WINDOW = 0.12;
const SHOCKWAVE_RADIUS = 60;

/**
 * 精灵表（120x120/帧）中角色贴着帧底部绘制：占位约 x:47~74, y:65~120。
 * 取角色视觉中心 (60, 92) 作为锚点，物理圆形碰撞体以该点为圆心。
 */
const SPRITE_ANCHOR_X = 60;
const SPRITE_ANCHOR_Y = 92;
/** 倒地帧（第 7 行第 2 列） */
const FRAME_DOWN = 25;

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
  isDodging = false;

  private gfx: Phaser.GameObjects.Graphics;
  private keys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private invulnUntil = 0;
  private staminaFullSince = 0;
  private lastTrailAt = 0;
  private dead = false;

  constructor(scene: MainScene, x: number, y: number) {
    this.scene = scene;
    this.go = scene.add.sprite(x, y, 'girl', 0).setDepth(5);
    this.go.setOrigin(SPRITE_ANCHOR_X / 120, SPRITE_ANCHOR_Y / 120);
    scene.physics.add.existing(this.go);
    this.body = this.go.body as Phaser.Physics.Arcade.Body;
    this.body.setCircle(PLAYER_RADIUS, SPRITE_ANCHOR_X - PLAYER_RADIUS, SPRITE_ANCHOR_Y - PLAYER_RADIUS);
    this.body.setCollideWorldBounds(true);
    this.go.play('girl-idle');

    this.gfx = scene.add.graphics().setDepth(6);
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

  update(timeMs: number): void {
    if (this.dead) return;

    // 移动（闪避期间由 tween 控制位移）
    if (!this.isDodging) {
      const dir = this.moveDir();
      this.body.setVelocity(dir.x * MOVE_SPEED, dir.y * MOVE_SPEED);
    }

    // 瞄准
    const pointer = this.scene.input.activePointer;
    this.aimAngle = Phaser.Math.Angle.Between(this.x, this.y, pointer.worldX, pointer.worldY);

    // 朝向与走/停动画（素材面朝右，瞄准左侧时水平翻转）
    this.go.setFlipX(Math.cos(this.aimAngle) < 0);
    const moving = this.isDodging || this.body.velocity.lengthSq() > 1;
    this.go.play(moving ? 'girl-walk' : 'girl-idle', true);

    this.drawOverlay(timeMs);
  }

  onBeat(): void {
    this.stamina = Math.min(this.maxStamina, this.stamina + STAMINA_REGEN_PER_BEAT);

    // 踩拍律动：轻微的蹲弹，让角色跟着音乐"跳舞"
    if (!this.dead && !this.isDodging) {
      this.scene.tweens.add({
        targets: this.go,
        scaleX: { from: 1.08, to: 1 },
        scaleY: { from: 0.94, to: 1 },
        duration: 150,
        ease: 'Sine.easeOut'
      });
    }
  }

  tryDodge(): void {
    if (this.isDodging || this.dead) return;
    const conductor = this.scene.conductor;
    if (!conductor.started) return;

    const t = conductor.now();
    const { offset } = conductor.nearestBeat(t);
    const onBeat = Math.abs(offset) <= DODGE_BEAT_WINDOW;
    const cost = onBeat ? DODGE_COST_ONBEAT : DODGE_COST_OFFBEAT;
    if (this.stamina < cost) {
      this.scene.hud.flashStaminaWarning();
      return;
    }
    this.stamina -= cost;
    this.staminaFullSince = Infinity;

    let dir = this.moveDir();
    if (dir.lengthSq() === 0) {
      dir = new Phaser.Math.Vector2(Math.cos(this.aimAngle), Math.sin(this.aimAngle));
    }
    const bounds = this.scene.physics.world.bounds;
    const pad = PLAYER_RADIUS + 4;
    const tx = Phaser.Math.Clamp(this.x + dir.x * DODGE_DISTANCE, bounds.left + pad, bounds.right - pad);
    const ty = Phaser.Math.Clamp(this.y + dir.y * DODGE_DISTANCE, bounds.top + pad, bounds.bottom - pad);

    // 位移终点对齐下一个整数拍（原型限制在 0.12~0.5s 内保证手感）
    const duration = Phaser.Math.Clamp(conductor.timeToNextBeat(t), 0.12, 0.5) * 1000;

    this.isDodging = true;
    this.body.setVelocity(0, 0);
    this.body.enable = false;
    this.lastTrailAt = 0;

    this.scene.tweens.add({
      targets: this.go,
      x: tx,
      y: ty,
      duration,
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
  }

  takeDamage(amount: number): void {
    const now = this.scene.time.now;
    if (this.isDodging || this.dead || now < this.invulnUntil) return;
    this.hp = Math.max(0, this.hp - amount);
    this.invulnUntil = now + 600;
    this.scene.sfx.hurt();
    this.scene.hud.setHp(this.hp, this.maxHp);
    this.flash();
    this.scene.cameras.main.shake(120, 0.004);
    if (this.hp <= 0) {
      this.scene.onPlayerDied();
    }
  }

  /** 战败：倒地姿势 */
  die(): void {
    this.dead = true;
    this.body.setVelocity(0, 0);
    this.go.stop();
    this.go.setFrame(FRAME_DOWN);
    this.resetTint();
    this.go.setAlpha(0.9);
    this.gfx.clear();
  }

  /** 输入错误的噪音反馈 */
  errorFlash(): void {
    this.flash();
  }

  private flash(): void {
    if (this.dead) return;
    this.go.setTint(0xef4444).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(120, () => {
      if (!this.dead) this.resetTint();
    });
  }

  private resetTint(): void {
    this.go.clearTint();
    this.go.setTintMode(Phaser.TintModes.MULTIPLY);
  }

  private moveDir(): Phaser.Math.Vector2 {
    const dir = new Phaser.Math.Vector2(
      (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0),
      (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0)
    );
    return dir.lengthSq() > 0 ? dir.normalize() : dir;
  }

  private spawnTrail(): void {
    const now = this.scene.time.now;
    if (now - this.lastTrailAt < 50) return;
    this.lastTrailAt = now;
    const trail = this.scene.add
      .sprite(this.go.x, this.go.y, 'girl', this.go.frame.name)
      .setOrigin(this.go.originX, this.go.originY)
      .setFlipX(this.go.flipX)
      .setAlpha(0.55)
      .setTint(0x9be8ff)
      .setDepth(4);
    this.scene.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 100,
      onComplete: () => trail.destroy()
    });
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
