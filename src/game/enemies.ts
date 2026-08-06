import Phaser from 'phaser';
import type { BeatInfo } from '../core/Conductor';
import type { MainScene } from '../scenes/MainScene';

export type EnemyKind = 'smallGuard' | 'midGuard' | 'bigFan';

interface ShapeWithBody extends Phaser.GameObjects.Shape {
  body: Phaser.Physics.Arcade.Body;
}

/**
 * 敌人基类：自由移动（每帧 update），攻击行为由节拍驱动（onBeat）。
 */
export abstract class Enemy {
  abstract readonly kind: EnemyKind;
  scene: MainScene;
  go: ShapeWithBody;
  hp: number;
  maxHp: number;
  radius: number;
  dead = false;

  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBar: Phaser.GameObjects.Rectangle;
  private baseColor: number;

  constructor(scene: MainScene, go: Phaser.GameObjects.Shape, hp: number, radius: number, color: number) {
    this.scene = scene;
    this.go = go as ShapeWithBody;
    this.hp = hp;
    this.maxHp = hp;
    this.radius = radius;
    this.baseColor = color;
    go.setDepth(3);
    scene.physics.add.existing(go);
    this.go.body.setCollideWorldBounds(true);

    this.hpBarBg = scene.add.rectangle(go.x, go.y, 28, 4, 0x1f2937).setDepth(3).setOrigin(0, 0.5);
    this.hpBar = scene.add.rectangle(go.x, go.y, 28, 4, 0x86efac).setDepth(3).setOrigin(0, 0.5);
  }

  get x(): number {
    return this.go.x;
  }

  get y(): number {
    return this.go.y;
  }

  update(dtMs: number): void {
    if (this.dead) return;
    this.move(dtMs);
    const bx = this.go.x - 14;
    const by = this.go.y - this.radius - 12;
    this.hpBarBg.setPosition(bx, by);
    this.hpBar.setPosition(bx, by);
    this.hpBar.scaleX = this.hp / this.maxHp;
  }

  abstract onBeat(info: BeatInfo): void;
  protected abstract move(dtMs: number): void;

  takeDamage(amount: number): void {
    if (this.dead) return;
    this.hp -= amount;
    this.go.setFillStyle(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (!this.dead) this.go.setFillStyle(this.baseColor);
    });
    if (this.hp <= 0) {
      this.die();
    }
  }

  protected die(): void {
    this.dead = true;
    this.scene.sfx.enemyDie();
    this.hpBarBg.destroy();
    this.hpBar.destroy();
    this.go.body.enable = false;
    this.scene.tweens.add({
      targets: this.go,
      alpha: 0,
      scale: 1.6,
      duration: 200,
      onComplete: () => this.go.destroy()
    });
    this.scene.onEnemyKilled(this);
  }

  destroy(): void {
    this.hpBarBg.destroy();
    this.hpBar.destroy();
    this.go.destroy();
  }

  protected distToPlayer(): number {
    const p = this.scene.player;
    return Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
  }

  protected angleToPlayer(): number {
    const p = this.scene.player;
    return Phaser.Math.Angle.Between(this.x, this.y, p.x, p.y);
  }

  /** 蓄力/预警闪烁 */
  protected telegraph(): void {
    this.go.setFillStyle(0xffffff);
    this.scene.tweens.add({
      targets: this.go,
      alpha: 0.5,
      yoyo: true,
      duration: 100,
      repeat: 1,
      onComplete: () => {
        if (!this.dead) {
          this.go.setFillStyle(this.baseColor);
          this.go.setAlpha(1);
        }
      }
    });
  }
}

/**
 * 小型保安（蓝色方块）：追击玩家。
 * 节拍行为：1拍横扫 → 2拍蓄力 → 3拍突进 → 4拍终点重击。
 */
export class SmallGuard extends Enemy {
  readonly kind = 'smallGuard';
  private static readonly CHASE_SPEED = 90;
  private dashUntil = 0;

  constructor(scene: MainScene, x: number, y: number) {
    super(scene, scene.add.rectangle(x, y, 26, 26, 0x60a5fa), 40, 15, 0x60a5fa);
  }

  onBeat(info: BeatInfo): void {
    if (this.dead) return;
    const angle = this.angleToPlayer();
    switch (info.beatInMeasure) {
      case 0: // 横扫
        this.scene.spawnArcFx(this.x, this.y, angle, 60, 60, 0xf87171);
        if (this.distToPlayer() < 60 + 16) this.scene.player.takeDamage(10);
        break;
      case 1: // 蓄力预警
        this.telegraph();
        break;
      case 2: { // 突进
        const v = this.scene.physics.velocityFromRotation(angle, 380);
        this.go.body.setVelocity(v.x, v.y);
        this.dashUntil = this.scene.time.now + 250;
        break;
      }
      case 3: // 终点重击
        this.scene.spawnArcFx(this.x, this.y, angle, 75, 70, 0xef4444);
        if (this.distToPlayer() < 75 + 16) this.scene.player.takeDamage(15);
        break;
    }
  }

  protected move(_dtMs: number): void {
    if (this.scene.time.now < this.dashUntil) return; // 突进期间保持冲刺速度
    const dist = this.distToPlayer();
    if (dist > 55) {
      const v = this.scene.physics.velocityFromRotation(this.angleToPlayer(), SmallGuard.CHASE_SPEED);
      this.go.body.setVelocity(v.x, v.y);
    } else {
      this.go.body.setVelocity(0, 0);
    }
  }
}

/**
 * 中型保安（蓝色三角）：保持中距离。
 * 节拍行为：1拍激光锁定跟踪 → 2拍固定方向发射直线弹幕 → 3拍再锁定 → 4拍再发射。
 */
export class MidGuard extends Enemy {
  readonly kind = 'midGuard';
  private aiming = false;
  private laserGfx: Phaser.GameObjects.Graphics;

  constructor(scene: MainScene, x: number, y: number) {
    super(scene, scene.add.triangle(x, y, 0, 32, 16, 0, 32, 32, 0x3b82f6), 60, 18, 0x3b82f6);
    this.laserGfx = scene.add.graphics().setDepth(2);
  }

  onBeat(info: BeatInfo): void {
    if (this.dead) return;
    if (info.beatInMeasure === 0 || info.beatInMeasure === 2) {
      this.aiming = true;
    } else {
      // 固定当前方向发射一组聚焦弹幕
      this.aiming = false;
      const angle = this.angleToPlayer();
      for (let i = 0; i < 3; i++) {
        const offset = i * 16;
        this.scene.spawnBullet(
          this.x + Math.cos(angle) * (this.radius + 6 + offset),
          this.y + Math.sin(angle) * (this.radius + 6 + offset),
          angle,
          300,
          10,
          0xfb7185
        );
      }
      this.flashLaser(angle);
    }
  }

  update(dtMs: number): void {
    super.update(dtMs);
    this.laserGfx.clear();
    if (!this.dead && this.aiming) {
      const p = this.scene.player;
      this.laserGfx.lineStyle(2, 0xff4444, 0.35);
      this.laserGfx.lineBetween(this.x, this.y, p.x, p.y);
    }
  }

  protected move(_dtMs: number): void {
    const dist = this.distToPlayer();
    const angle = this.angleToPlayer();
    if (dist > 340) {
      const v = this.scene.physics.velocityFromRotation(angle, 80);
      this.go.body.setVelocity(v.x, v.y);
    } else if (dist < 240) {
      const v = this.scene.physics.velocityFromRotation(angle + Math.PI, 80);
      this.go.body.setVelocity(v.x, v.y);
    } else {
      this.go.body.setVelocity(0, 0);
    }
  }

  protected die(): void {
    this.laserGfx.destroy();
    super.die();
  }

  destroy(): void {
    this.laserGfx.destroy();
    super.destroy();
  }

  private flashLaser(angle: number): void {
    const len = 900;
    const line = this.scene.add
      .line(0, 0, this.x, this.y, this.x + Math.cos(angle) * len, this.y + Math.sin(angle) * len, 0xff6666)
      .setOrigin(0, 0)
      .setLineWidth(2)
      .setAlpha(0.8)
      .setDepth(2);
    this.scene.tweens.add({ targets: line, alpha: 0, duration: 150, onComplete: () => line.destroy() });
  }
}

/**
 * 大型粉丝（粉色大圆）：保持远距离。
 * 节拍行为：1~3拍每拍朝玩家发射 1 枚直线弹幕 → 4拍发射扇形弹幕（5 枚）。
 */
export class BigFan extends Enemy {
  readonly kind = 'bigFan';

  constructor(scene: MainScene, x: number, y: number) {
    super(scene, scene.add.circle(x, y, 28, 0xf472b6), 90, 28, 0xf472b6);
    this.go.body.setCircle(28);
  }

  onBeat(info: BeatInfo): void {
    if (this.dead) return;
    const angle = this.angleToPlayer();
    const spawnX = this.x + Math.cos(angle) * (this.radius + 8);
    const spawnY = this.y + Math.sin(angle) * (this.radius + 8);
    if (info.beatInMeasure < 3) {
      this.scene.spawnBullet(spawnX, spawnY, angle, 200, 10, 0xfb7185);
      if (info.beatInMeasure === 2) this.telegraph(); // 对焦闪烁，预告扇形弹幕
    } else {
      for (let i = -2; i <= 2; i++) {
        const a = angle + Phaser.Math.DegToRad(i * 20);
        this.scene.spawnBullet(
          this.x + Math.cos(a) * (this.radius + 8),
          this.y + Math.sin(a) * (this.radius + 8),
          a,
          220,
          12,
          0xfda4af
        );
      }
    }
  }

  protected move(_dtMs: number): void {
    const dist = this.distToPlayer();
    const angle = this.angleToPlayer();
    if (dist > 430) {
      const v = this.scene.physics.velocityFromRotation(angle, 50);
      this.go.body.setVelocity(v.x, v.y);
    } else if (dist < 330) {
      const v = this.scene.physics.velocityFromRotation(angle + Math.PI, 50);
      this.go.body.setVelocity(v.x, v.y);
    } else {
      this.go.body.setVelocity(0, 0);
    }
  }
}
