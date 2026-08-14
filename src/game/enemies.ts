import Phaser from 'phaser';
import type { BeatInfo } from '../core/Conductor';
import type { MainScene } from '../scenes/MainScene';
import { FAN_ATTACK_DURATION_MS, FAN_HURT_ROLL_DURATION_MS, playFanAnimation } from './fanAnimation';
import { worldDepth, worldSize } from './visualScale';

export type EnemyKind = 'smallGuard' | 'midGuard' | 'fan';

type EnemyVisual = Phaser.GameObjects.Shape | Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
type VisualWithBody = EnemyVisual & { body: Phaser.Physics.Arcade.Body };

/** 敌人基类：移动逐帧更新，攻击和方向重选由节拍驱动。 */
export abstract class Enemy {
  abstract readonly kind: EnemyKind;
  scene: MainScene;
  go: VisualWithBody;
  hp: number;
  maxHp: number;
  dead = false;

  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBar: Phaser.GameObjects.Rectangle;
  private baseColor: number;
  private knockbackUntil = 0;
  private knockbackVelocity = new Phaser.Math.Vector2();

  constructor(scene: MainScene, go: EnemyVisual, hp: number, color: number) {
    this.scene = scene;
    this.go = go as VisualWithBody;
    this.hp = hp;
    this.maxHp = hp;
    this.baseColor = color;
    go.setDepth(3);
    scene.physics.add.existing(go);
    // 受击判定统一用默认全帧矩形：刚好包裹整张图片，随图片缩放自动同步。
    // 新增角色一律沿用此默认，不要再手动 setCircle/setSize。
    this.go.body.setCollideWorldBounds(true);

    this.hpBarBg = scene.add.rectangle(go.x, go.y, worldSize(28), worldSize(4), 0x1f2937).setDepth(3).setOrigin(0, 0.5);
    this.hpBar = scene.add.rectangle(go.x, go.y, worldSize(28), worldSize(4), 0x86efac).setDepth(3).setOrigin(0, 0.5);
  }

  get x(): number {
    return this.go.x;
  }

  get y(): number {
    return this.go.y;
  }

  /** 逻辑判定半径（音波/近战范围用）：取包围盒半宽高的较大值，始终与当前判定框一致 */
  get radius(): number {
    return Math.max(this.go.body.halfWidth, this.go.body.halfHeight);
  }

  update(dtMs: number): void {
    if (this.dead) return;
    this.syncBodyToCurrentFrame();
    if (this.scene.time.now < this.knockbackUntil) {
      this.go.body.setVelocity(this.knockbackVelocity.x, this.knockbackVelocity.y);
    } else {
      this.move(dtMs);
    }
    const bx = this.go.x - worldSize(14);
    const by = this.go.y - this.radius - worldSize(12);
    const characterDepth = worldDepth(this.go.y + this.go.body.halfHeight);
    this.go.setDepth(characterDepth);
    this.hpBarBg.setDepth(characterDepth + 0.001);
    this.hpBar.setDepth(characterDepth + 0.002);
    this.hpBarBg.setPosition(bx, by);
    this.hpBar.setPosition(bx, by);
    this.hpBar.scaleX = this.hp / this.maxHp;
  }

  abstract onBeat(info: BeatInfo): void;
  protected abstract move(dtMs: number): void;

  /** 精灵动画换帧时源尺寸可能变化，同步 body 保证判定框始终等于当前显示图片 */
  private syncBodyToCurrentFrame(): void {
    if (!(this.go instanceof Phaser.GameObjects.Sprite)) return;
    const frame = this.go.frame;
    const body = this.go.body;
    if (body.sourceWidth !== frame.realWidth || body.sourceHeight !== frame.realHeight) {
      body.setSize(frame.realWidth, frame.realHeight, true);
    }
  }

  takeDamage(amount: number, knockbackAngle?: number, knockbackSpeed = 0): void {
    if (this.dead) return;
    this.hp -= amount;
    if (knockbackAngle !== undefined && knockbackSpeed > 0) {
      this.knockbackVelocity.setToPolar(knockbackAngle, knockbackSpeed);
      this.knockbackUntil = this.scene.time.now + 160;
      this.go.body.setVelocity(this.knockbackVelocity.x, this.knockbackVelocity.y);
    }
    this.scene.queueBeatSfx('enemyHurt');
    this.scene.spawnImpactFx(this.x, this.y, 0xef4444, false);
    this.setVisualColor(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (!this.dead) this.restoreVisualColor();
    });
    if (this.hp <= 0) {
      this.die();
    }
  }

  protected die(): void {
    this.dead = true;
    this.hpBarBg.destroy();
    this.hpBar.destroy();
    this.go.body.enable = false;
    this.scene.tweens.add({
      targets: this.go,
      alpha: 0,
      scaleX: this.go.scaleX * 1.6,
      scaleY: this.go.scaleY * 1.6,
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

  protected approachVelocity(targetX: number, targetY: number, dtMs: number, acceleration: number): void {
    const maxChange = acceleration * Math.min(dtMs, 50) / 1000;
    const velocity = this.go.body.velocity;
    this.go.body.setVelocity(
      this.moveTowards(velocity.x, targetX, maxChange),
      this.moveTowards(velocity.y, targetY, maxChange)
    );
  }

  private moveTowards(current: number, target: number, maxChange: number): number {
    if (Math.abs(target - current) <= maxChange) return target;
    return current + Math.sign(target - current) * maxChange;
  }

  /** 蓄力/预警闪烁 */
  protected telegraph(): void {
    this.setVisualColor(0xffd166);
    this.scene.tweens.add({
      targets: this.go,
      alpha: 0.5,
      yoyo: true,
      duration: 100,
      repeat: 1,
      onComplete: () => {
        if (!this.dead) {
          this.restoreVisualColor();
          this.go.setAlpha(1);
        }
      }
    });
  }

  private setVisualColor(color: number): void {
    if (this.go instanceof Phaser.GameObjects.Shape) this.go.setFillStyle(color);
    else this.go.setTint(color);
  }

  private restoreVisualColor(): void {
    if (this.go instanceof Phaser.GameObjects.Shape) this.go.setFillStyle(this.baseColor);
    else this.go.clearTint();
  }
}

/** 小型保安：卡拍追击，每小节第 1 拍发射一枚直线弹。 */
export class SmallGuard extends Enemy {
  readonly kind = 'smallGuard';
  private static readonly DRIFT_SPEED = 30;
  private static readonly BEAT_STEP_SPEED = 105;
  private static readonly OLD_BEAT_STEP_WINDOW = 0.1;
  private movementAngle = 0;

  constructor(scene: MainScene, x: number, y: number) {
    super(scene, scene.add.image(x, y, 'guard').setDisplaySize(worldSize(46), worldSize(70)), 40, 0xffffff);
    this.chooseMovementAngle();
  }

  onBeat(info: BeatInfo): void {
    if (this.dead) return;
    this.chooseMovementAngle();
    if (info.beatInMeasure !== 0) return;
    const angle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
    this.scene.spawnEnemyProjectile(this.x, this.y, angle, 12, 0x3b82f6);
  }

  protected move(dtMs: number): void {
    const beatDuration = this.scene.conductor.beatDur;
    const oldDistancePerBeat = SmallGuard.DRIFT_SPEED * Math.max(0, beatDuration - SmallGuard.OLD_BEAT_STEP_WINDOW)
      + SmallGuard.BEAT_STEP_SPEED * Math.min(beatDuration, SmallGuard.OLD_BEAT_STEP_WINDOW);
    const speed = (oldDistancePerBeat / beatDuration) * this.scene.getNormalizedBeatMovementMultiplier(dtMs);
    const v = this.scene.physics.velocityFromRotation(this.movementAngle, speed);
    this.go.body.setVelocity(v.x, v.y);
  }

  private chooseMovementAngle(): void {
    // 近身时扩大离散角，避免大批保安持续瞄准同一点并排成规则圆环。
    const maxOffset = this.distToPlayer() < 90 ? 70 : 24;
    const offset = Phaser.Math.FloatBetween(-maxOffset, maxOffset);
    this.movementAngle = this.angleToPlayer() + Phaser.Math.DegToRad(offset);
  }
}

/**
 * 中型保安（蓝色三角）：保持中距离。
 * 节拍行为：1拍激光锁定跟踪 → 2拍固定方向发射直线弹幕 → 3拍再锁定 → 4拍再发射。
 */
export class MidGuard extends Enemy {
  readonly kind = 'midGuard';
  private aiming = false;
  private lockedAngle = 0;
  private laserGfx: Phaser.GameObjects.Graphics;

  constructor(scene: MainScene, x: number, y: number) {
    super(scene, scene.add.image(x, y, 'guard').setDisplaySize(worldSize(52), worldSize(78)), 60, 0xffffff);
    this.lockedAngle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
    this.laserGfx = scene.add.graphics().setDepth(2);
  }

  onBeat(info: BeatInfo): void {
    if (this.dead || info.beatInMeasure !== 0) return;
    this.lockedAngle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
    this.aiming = false;
    this.scene.spawnEnemyProjectile(this.x, this.y, this.lockedAngle, 12, 0x3b82f6);
    this.flashLaser(this.lockedAngle);
  }

  update(dtMs: number): void {
    super.update(dtMs);
    this.laserGfx.clear();
    if (!this.dead && this.aiming) {
      this.lockedAngle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
      this.laserGfx.lineStyle(2, 0xff4444, 0.35);
      const length = 900;
      this.laserGfx.lineBetween(
        this.x,
        this.y,
        this.x + Math.cos(this.lockedAngle) * length,
        this.y + Math.sin(this.lockedAngle) * length
      );
    }
  }

  protected move(dtMs: number): void {
    const dist = this.distToPlayer();
    const angle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
    if (dist > 340) {
      const v = this.scene.physics.velocityFromRotation(angle, 80);
      this.approachVelocity(v.x, v.y, dtMs, 140);
    } else if (dist < 240) {
      const v = this.scene.physics.velocityFromRotation(angle + Math.PI, 80);
      this.approachVelocity(v.x, v.y, dtMs, 140);
    } else {
      this.approachVelocity(0, 0, dtMs, 170);
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

/** 粉丝临时复用小型保安的卡拍移动与每小节单发攻击。 */
export class FanEnemy extends Enemy {
  readonly kind = 'fan';
  private static readonly DRIFT_SPEED = 30;
  private static readonly BEAT_STEP_SPEED = 210;
  private static readonly OLD_BEAT_STEP_WINDOW = 0.1;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private movementAngle = 0;
  private attackUntil = 0;
  private hurtRollUntil = 0;

  constructor(scene: MainScene, x: number, y: number) {
    const sprite = scene.add.sprite(x, y, 'fan-run-2');
    super(scene, sprite, 40, 0xffffff);
    this.sprite = sprite;
    playFanAnimation(this.sprite, 'run');
    this.chooseMovementAngle();
  }

  takeDamage(amount: number, knockbackAngle?: number, knockbackSpeed = 0): void {
    super.takeDamage(amount, knockbackAngle, knockbackSpeed);
    if (this.dead) return;
    this.hurtRollUntil = this.scene.time.now + FAN_HURT_ROLL_DURATION_MS;
    playFanAnimation(this.sprite, 'roll', true);
  }

  onBeat(info: BeatInfo): void {
    if (this.dead) return;
    this.chooseMovementAngle();
    if (info.beatInMeasure !== 0) return;
    const angle = this.angleToPlayer();
    this.updateFacing(Math.cos(angle));
    this.playAttack();
    this.scene.spawnEnemyProjectile(this.x, this.y, angle, 12, 0x3b82f6);
  }

  protected move(dtMs: number): void {
    const progress = 1 - this.scene.conductor.timeToNextBeat(this.scene.conductor.now()) / this.scene.conductor.beatDur;
    const rolling = progress >= 0.5;
    const beatDuration = this.scene.conductor.beatDur;
    const oldDistancePerBeat = FanEnemy.DRIFT_SPEED * Math.max(0, beatDuration - FanEnemy.OLD_BEAT_STEP_WINDOW)
      + FanEnemy.BEAT_STEP_SPEED * Math.min(beatDuration, FanEnemy.OLD_BEAT_STEP_WINDOW);
    const speed = (oldDistancePerBeat / beatDuration) * this.scene.getNormalizedBeatMovementMultiplier(dtMs);
    const v = this.scene.physics.velocityFromRotation(this.movementAngle, speed);
    this.go.body.setVelocity(v.x, v.y);
    this.updateFacing(v.x);
    this.updateAnimation(rolling);
  }

  private playAttack(): void {
    this.attackUntil = this.scene.time.now + FAN_ATTACK_DURATION_MS;
    playFanAnimation(this.sprite, 'attack', true);
  }

  private updateAnimation(rolling: boolean): void {
    if (this.scene.time.now < this.hurtRollUntil) return;
    if (this.scene.time.now < this.attackUntil) return;
    const action = rolling ? 'roll' : 'run';
    const animation = rolling ? 'fan-roll' : 'fan-run';
    if (this.sprite.anims.currentAnim?.key !== animation || !this.sprite.anims.isPlaying) {
      playFanAnimation(this.sprite, action, true);
    }
  }

  private updateFacing(horizontalVelocity: number): void {
    if (Math.abs(horizontalVelocity) > 1) this.sprite.setFlipX(horizontalVelocity < 0);
  }

  private chooseMovementAngle(): void {
    const maxOffset = this.distToPlayer() < 90 ? 70 : 24;
    const offset = Phaser.Math.FloatBetween(-maxOffset, maxOffset);
    this.movementAngle = this.angleToPlayer() + Phaser.Math.DegToRad(offset);
  }
}
