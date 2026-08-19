import Phaser from 'phaser';
import type { BeatInfo } from '../core/Conductor';
import type { MainScene } from '../scenes/MainScene';
import {
  FAN_ATTACK_DURATION_MS,
  FAN_BODY_SOURCE_BOUNDS,
  FAN_SPRITE_SCALE,
  FAN_WEAPON_ORIGIN,
  FAN_WEAPON_SCALE,
  fanCharacterTextureKey,
  playFanAnimation,
  playFanAttackEffect
} from './fanAnimation';
import { worldDepth, worldSize } from './visualScale';

import {
  GUARD_BODY_SOURCE_BOUNDS,
  GUARD_ATTACK_DURATION_MS,
  GUARD_ATTACK_EFFECT_SCALE,
  GUARD_SPRITE_SCALE,
  GUARD_WEAPON_ORIGIN,
  GUARD_WEAPON_SCALE,
  guardCharacterTextureKey,
  playGuardAnimation,
  playGuardAttackEffect
} from './guardAnimation';
import { enableEmissiveBloom } from './EmissiveFx';
import {
  TUTORIAL_CHARACTER_ATTACK_DURATION_MS,
  TUTORIAL_CHARACTER_BODY_SOURCE_BOUNDS,
  TUTORIAL_CHARACTER_ROLL_DURATION_MS,
  TUTORIAL_CHARACTER_SPRITE_SCALE,
  playTutorialCharacterAnimation,
  playTutorialCharacterAttackEffect,
  tutorialCharacterTextureKey
} from './tutorialCharacterAnimation';

const GUARD_EMISSIVE_COLOR = 0x52efff;
const FAN_EMISSIVE_COLOR = 0xff543d;
const CHARACTER_SHADOW_ALPHA = 0.45;
const CHARACTER_SHADOW_DEPTH_OFFSET = 0.004;

export type EnemyKind = 'smallGuard' | 'midGuard' | 'fan';

type EnemyVisual = Phaser.GameObjects.Shape | Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
type VisualWithBody = EnemyVisual & { body: Phaser.Physics.Arcade.Body };
interface EnemyBodySourceBounds {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

interface EnemyShadowOptions {
  textureKey: string;
  scale: number;
  /** 仅保安使用：阴影沿当前朝向做轻微水平偏移。 */
  facingOffsetX?: number;
  /** 阴影落点的额外下移量。 */
  offsetY?: number;
}

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
  private bodySourceBounds?: EnemyBodySourceBounds;
  private knockbackUntil = 0;
  private knockbackVelocity = new Phaser.Math.Vector2();
  private readonly baseScaleX: number;
  private readonly baseScaleY: number;
  private readonly shadow?: Phaser.GameObjects.Image;
  private readonly shadowOptions?: EnemyShadowOptions;

  constructor(
    scene: MainScene,
    go: EnemyVisual,
    hp: number,
    color: number,
    bodySourceBounds?: EnemyBodySourceBounds,
    shadowOptions?: EnemyShadowOptions
  ) {
    this.scene = scene;
    this.go = go as VisualWithBody;
    this.hp = hp;
    this.maxHp = hp;
    this.baseColor = color;
    this.bodySourceBounds = bodySourceBounds;
    this.baseScaleX = go.scaleX;
    this.baseScaleY = go.scaleY;
    this.shadowOptions = shadowOptions;
    if (shadowOptions) {
      this.shadow = scene.add
        .image(go.x, go.y, shadowOptions.textureKey)
        .setScale(shadowOptions.scale)
        .setAlpha(CHARACTER_SHADOW_ALPHA);
      scene.textures.get(shadowOptions.textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    go.setDepth(3);
    scene.physics.add.existing(go);
    if (bodySourceBounds) {
      this.go.body
        .setSize(bodySourceBounds.width, bodySourceBounds.height, false)
        .setOffset(bodySourceBounds.offsetX, bodySourceBounds.offsetY);
    }
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
    if (this.shadow) {
      const shadowY = this.go.y + (this.go.height * (Math.abs(this.go.scaleY) - this.baseScaleY)) / 2;
      const facingOffset = this.shadowOptions?.facingOffsetX
        ? ((this.go instanceof Phaser.GameObjects.Image || this.go instanceof Phaser.GameObjects.Sprite) && this.go.flipX ? 1 : -1)
          * this.shadowOptions.facingOffsetX
        : 0;
      this.shadow
        .setPosition(this.go.x + facingOffset, shadowY + (this.shadowOptions?.offsetY ?? 0))
        .setDepth(characterDepth - CHARACTER_SHADOW_DEPTH_OFFSET);
    }
    this.go.setDepth(characterDepth);
    this.hpBarBg.setDepth(characterDepth + 0.001);
    this.hpBar.setDepth(characterDepth + 0.002);
    this.hpBarBg.setPosition(bx, by);
    this.hpBar.setPosition(bx, by);
    this.hpBar.scaleX = this.hp / this.maxHp;
  }

  abstract onBeat(info: BeatInfo): void;
  protected abstract move(dtMs: number): void;

  /** 所有敌人按轻 / 重拍节奏脚底锚定，只做纵向上弹。 */
  pulseBeat(heavy: boolean): void {
    if (this.dead) return;
    const peakScaleY = heavy ? 1.1 : 1.05;
    const totalDuration = heavy ? 220 : 170;
    const baseY = this.go.y;
    const baseDisplayHeight = this.go.height * this.baseScaleY;
    const yForScale = (scaleY: number) => baseY + (baseDisplayHeight * (1 - scaleY)) / 2;
    this.scene.tweens.killTweensOf(this.go);
    // 横轴始终保持基础比例与镜像状态；Y 位移补偿令脚底在上弹和回落中不漂移。
    this.go.setScale(this.baseScaleX, this.baseScaleY * peakScaleY);
    this.go.setY(yForScale(peakScaleY));
    this.scene.tweens.add({
      targets: this.go,
      scaleY: this.baseScaleY,
      y: baseY,
      duration: totalDuration,
      ease: 'Back.easeOut'
    });
  }

  /** 物理组接管对象后执行一次，避免 Group 默认值覆盖出生时的初始运动状态。 */
  onSpawned(): void {}

  /** 游戏结束时停止物理与位移，保留单位原地播放可用的 Idle 表现。 */
  enterGameOverIdle(): void {
    if (this.dead) return;
    this.scene.tweens.killTweensOf(this.go);
    this.knockbackUntil = 0;
    this.knockbackVelocity.set(0, 0);
    this.go.body.setVelocity(0, 0);
    this.go.body.enable = false;
    this.onGameOverIdle();
  }

  protected onGameOverIdle(): void {}

  /** 精灵动画换帧时源尺寸可能变化，同步 body 保证判定框始终等于当前显示图片 */
  private syncBodyToCurrentFrame(): void {
    if (!(this.go instanceof Phaser.GameObjects.Sprite)) return;
    if (this.bodySourceBounds) {
      const bounds = this.bodySourceBounds;
      if (this.go.body.sourceWidth !== bounds.width || this.go.body.sourceHeight !== bounds.height) {
        this.go.body
          .setSize(bounds.width, bounds.height, false)
          .setOffset(bounds.offsetX, bounds.offsetY);
      }
      return;
    }
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
    this.scene.spawnImpactFx(this.x, this.y, 0xef4444, false);
    if (this.hp <= 0) {
      // 致死帧直接保持原贴图淡出；若先套纯白 FILL 再放大，会变成遮住弹体材质的大白剪影。
      this.restoreVisualColor();
      this.die();
      return;
    }
    this.showHitFlash();
    this.scene.time.delayedCall(120, () => {
      if (!this.dead) this.restoreVisualColor();
    });
  }

  protected die(): void {
    this.dead = true;
    this.hpBarBg.destroy();
    this.hpBar.destroy();
    this.scene.spawnEnemyDeathExplosion(this.x, this.y, this.kind);
    this.go.body.enable = false;
    if (this.shadow) {
      this.scene.tweens.add({
        targets: this.shadow,
        alpha: 0,
        duration: 200,
        onComplete: () => this.shadow?.destroy()
      });
    }
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

  /** 教学展示对象退场：保留死亡视觉，但不结算波次、掉落或击杀事件。 */
  protected retireWithoutReward(): void {
    if (this.dead) return;
    this.dead = true;
    this.hpBarBg.destroy();
    this.hpBar.destroy();
    this.scene.spawnEnemyDeathExplosion(this.x, this.y, this.kind);
    this.go.body.enable = false;
    if (this.shadow) {
      this.scene.tweens.add({
        targets: this.shadow,
        alpha: 0,
        duration: 200,
        onComplete: () => this.shadow?.destroy()
      });
    }
    this.scene.tweens.add({
      targets: this.go,
      alpha: 0,
      scaleX: this.go.scaleX * 1.35,
      scaleY: this.go.scaleY * 1.35,
      duration: 200,
      onComplete: () => this.go.destroy()
    });
  }

  destroy(): void {
    this.hpBarBg.destroy();
    this.hpBar.destroy();
    this.shadow?.destroy();
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

  protected setFacingFlip(angle: number): void {
    if (this.go instanceof Phaser.GameObjects.Image || this.go instanceof Phaser.GameObjects.Sprite) {
      this.go.setFlipX(Math.cos(angle) >= 0);
    }
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

  private showHitFlash(): void {
    if (this.go instanceof Phaser.GameObjects.Shape) this.go.setFillStyle(0xffc4bc);
    else this.go.setTint(0xffd0ca).setTintMode(Phaser.TintModes.MULTIPLY);
  }

  private restoreVisualColor(): void {
    if (this.go instanceof Phaser.GameObjects.Shape) this.go.setFillStyle(this.baseColor);
    else this.go.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
  }
}

/** 小型保安：按拍重选方向，拍间保持略低的匀速追击。 */
export class SmallGuard extends Enemy {
  readonly kind = 'smallGuard';
  private static readonly MOVE_SPEED = 44;
  /** 以握把锚点把警棍贴到保安当前朝向一侧，而非悬在身体外侧。 */
  private static readonly WEAPON_SIDE_OFFSET = 38 * GUARD_SPRITE_SCALE;
  private static readonly WEAPON_OFFSET_Y = 16 * GUARD_SPRITE_SCALE;
  private movementAngle = 0;
  private facingAngle = Math.PI;
  private attackFacingUntil = 0;
  private weaponAttackUntil = 0;
  private weaponBaseRotation = 0;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly attackFx: Phaser.GameObjects.Sprite;
  private readonly weaponSprite: Phaser.GameObjects.Image;

  constructor(scene: MainScene, x: number, y: number) {
    const sprite = scene.add
      .sprite(x, y, guardCharacterTextureKey('run', 1))
      .setScale(GUARD_SPRITE_SCALE);
    super(
      scene,
      sprite,
      40,
      0xffffff,
      GUARD_BODY_SOURCE_BOUNDS,
      {
        textureKey: 'npc-guard-shadow',
        scale: GUARD_SPRITE_SCALE,
        facingOffsetX: worldSize(6),
        offsetY: worldSize(7)
      }
    );
    this.sprite = sprite;
    this.attackFx = scene.add
      .sprite(x, y, 'npc-guard-attack-light-fx-1')
      .setScale(GUARD_ATTACK_EFFECT_SCALE)
      .setAlpha(0.82)
      .setVisible(false);
    enableEmissiveBloom(this.attackFx, GUARD_EMISSIVE_COLOR, {
      glowStrength: 0.2,
      innerStrength: 0.03,
      glowDistance: 19,
      glowQuality: 2,
      blurRadius: 8,
      bloomAmount: 0.05,
      threshold: 0.07
    });
    this.weaponSprite = scene.add
      .image(x, y, 'npc-guard-weapon-baton')
      .setOrigin(GUARD_WEAPON_ORIGIN.x, GUARD_WEAPON_ORIGIN.y)
      .setScale(GUARD_WEAPON_SCALE);
    scene.textures.get('npc-guard-weapon-baton').setFilter(Phaser.Textures.FilterMode.NEAREST);
    playGuardAnimation(this.sprite, 'run');
    this.chooseMovementAngle();
  }

  update(dtMs: number): void {
    super.update(dtMs);
    if (this.dead) return;
    if (this.scene.time.now >= this.attackFacingUntil) this.facingAngle = this.movementAngle;
    playGuardAnimation(this.sprite, 'run');
    const facingRight = Math.cos(this.facingAngle) >= 0;
    const characterDepth = worldDepth(this.go.y + this.go.body.halfHeight);
    this.setFacingFlip(this.facingAngle);
    this.attackFx
      .setPosition(this.x, this.y)
      // Attack FX source frames face right, while the guard body source faces left.
      .setFlipX(!facingRight)
      .setDepth(characterDepth - 0.002);
    const side = facingRight ? 1 : -1;
    // 把源图的斜向棍旋到竖直，贴在角色身体侧边；反向时同步取镜像角。
    // 源贴图的斜向与负 scaleX 镜像会反转视觉朝向，因此旋转符号须与角色朝向相反。
    // 源警棍以右下握把为锚点，默认已指向左上；镜像后自然指向右上。
    // 这样无需再叠加旋转，左朝向明确朝左上、右朝向朝右上。
    this.weaponBaseRotation = 0;
    this.weaponSprite
      .setVisible(true)
      .setPosition(
        this.x + side * SmallGuard.WEAPON_SIDE_OFFSET,
        this.y + SmallGuard.WEAPON_OFFSET_Y
      )
      .setFlipX(false)
      .setScale(
        facingRight ? -GUARD_WEAPON_SCALE : GUARD_WEAPON_SCALE,
        GUARD_WEAPON_SCALE
      )
      // 警棍随身体脚底深度排序，但始终在保安本体动画之后绘制。
      .setDepth(characterDepth - 0.003);
    if (this.scene.time.now >= this.weaponAttackUntil) this.weaponSprite.setRotation(this.weaponBaseRotation);
  }

  onBeat(info: BeatInfo): void {
    if (this.dead) return;
    this.chooseMovementAngle();
    this.scene.scheduleEnemyAttacks(this.kind, info.globalBeat, () => {
      if (this.dead) return;
      const angle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
      this.facingAngle = angle;
      this.attackFacingUntil = this.scene.time.now + GUARD_ATTACK_DURATION_MS;
      playGuardAttackEffect(this.attackFx, 'attack-light');
      this.playWeaponAttack(angle);
      this.scene.spawnEnemyProjectile(this.x, this.y, angle, this.kind);
    });
  }

  protected move(_dtMs: number): void {
    const v = this.scene.physics.velocityFromRotation(this.movementAngle, SmallGuard.MOVE_SPEED);
    this.go.body.setVelocity(v.x, v.y);
  }

  private chooseMovementAngle(): void {
    // 近身时扩大离散角，避免大批保安持续瞄准同一点并排成规则圆环。
    const maxOffset = this.distToPlayer() < 90 ? 70 : 24;
    const offset = Phaser.Math.FloatBetween(-maxOffset, maxOffset);
    this.movementAngle = this.angleToPlayer() + Phaser.Math.DegToRad(offset);
    if (this.scene.time.now >= this.attackFacingUntil) this.facingAngle = this.movementAngle;
  }

  protected die(): void {
    this.scene.tweens.killTweensOf(this.weaponSprite);
    if (this.attackFx.active) this.attackFx.destroy();
    if (this.weaponSprite.active) this.weaponSprite.destroy();
    super.die();
  }

  destroy(): void {
    if (this.attackFx.active) this.attackFx.destroy();
    if (this.weaponSprite.active) this.weaponSprite.destroy();
    super.destroy();
  }

  protected onGameOverIdle(): void {
    this.attackFx.setVisible(false);
    this.scene.tweens.killTweensOf(this.weaponSprite);
    this.weaponSprite.setRotation(this.weaponBaseRotation);
    playGuardAnimation(this.sprite, 'idle', true);
  }

  private playWeaponAttack(angle: number): void {
    const facingRight = Math.cos(angle) >= 0;
    const swingDirection = facingRight ? 1 : -1;
    const windup = this.weaponBaseRotation + Phaser.Math.DegToRad(-10 * swingDirection);
    const strike = this.weaponBaseRotation + Phaser.Math.DegToRad(42 * swingDirection);
    this.weaponAttackUntil = this.scene.time.now + 200;
    this.scene.tweens.killTweensOf(this.weaponSprite);
    this.weaponSprite.setRotation(windup);
    this.scene.tweens.add({
      targets: this.weaponSprite,
      rotation: strike,
      duration: 80,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.weaponSprite,
          rotation: this.weaponBaseRotation,
          duration: 120,
          ease: 'Back.easeOut'
        });
      }
    });
  }
}

/**
 * 中型保安（蓝色三角）：保持中距离。
 * 节拍行为：仅在每小节第 4 拍锁定八方向中线并发射直线弹幕。
 */
export class MidGuard extends Enemy {
  readonly kind = 'midGuard';
  private aiming = false;
  private lockedAngle = 0;
  private facingAngle = Math.PI;
  private attackFacingUntil = 0;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private laserGfx: Phaser.GameObjects.Graphics;

  constructor(scene: MainScene, x: number, y: number) {
    const sprite = scene.add
      .sprite(x, y, guardCharacterTextureKey('idle', 1))
      .setScale(GUARD_SPRITE_SCALE);
    super(
      scene,
      sprite,
      60,
      0xffffff,
      GUARD_BODY_SOURCE_BOUNDS,
      {
        textureKey: 'npc-guard-shadow',
        scale: GUARD_SPRITE_SCALE,
        facingOffsetX: worldSize(6),
        offsetY: worldSize(7)
      }
    );
    this.sprite = sprite;
    playGuardAnimation(this.sprite, 'idle');
    this.lockedAngle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
    this.laserGfx = scene.add.graphics().setDepth(2);
  }

  onBeat(info: BeatInfo): void {
    if (this.dead) return;
    this.scene.scheduleEnemyAttacks(this.kind, info.globalBeat, () => {
      if (this.dead) return;
      this.lockedAngle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
      this.facingAngle = this.lockedAngle;
      this.attackFacingUntil = this.scene.time.now + GUARD_ATTACK_DURATION_MS;
      this.aiming = false;
      this.scene.spawnEnemyProjectile(this.x, this.y, this.lockedAngle, this.kind);
      this.flashLaser(this.lockedAngle);
    });
  }

  update(dtMs: number): void {
    super.update(dtMs);
    if (this.dead) return;
    playGuardAnimation(this.sprite, this.go.body.velocity.lengthSq() > 1 ? 'run' : 'idle');
    if (this.scene.time.now >= this.attackFacingUntil) this.facingAngle = this.lockedAngle;
    this.setFacingFlip(this.facingAngle);
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

  protected move(_dtMs: number): void {
    const dist = this.distToPlayer();
    const angle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
    this.lockedAngle = angle;
    if (dist > 340) {
      const v = this.scene.physics.velocityFromRotation(angle, 72);
      this.go.body.setVelocity(v.x, v.y);
    } else if (dist < 240) {
      const v = this.scene.physics.velocityFromRotation(angle + Math.PI, 72);
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

  protected onGameOverIdle(): void {
    this.aiming = false;
    this.laserGfx.clear();
    playGuardAnimation(this.sprite, 'idle', true);
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

/** 橙色粉丝按拍重选方向，拍间匀速移动；第 4 拍使用正式重击特效和荧光棒攻击。 */
export class FanEnemy extends Enemy {
  readonly kind = 'fan';
  private static readonly MOVE_SPEED = 66;
  private static readonly WEAPON_SIDE_OFFSET = 34 * FAN_SPRITE_SCALE;
  private static readonly WEAPON_OFFSET_Y = 4 * FAN_SPRITE_SCALE;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly attackFx: Phaser.GameObjects.Sprite;
  private readonly weaponSprite: Phaser.GameObjects.Image;
  private movementAngle = 0;
  private attackUntil = 0;
  private weaponAttackUntil = 0;
  private aimAngle = Math.PI;

  constructor(scene: MainScene, x: number, y: number) {
    const sprite = scene.add
      .sprite(x, y, fanCharacterTextureKey('run', 1))
      .setScale(FAN_SPRITE_SCALE);
    super(
      scene,
      sprite,
      40,
      0xffffff,
      FAN_BODY_SOURCE_BOUNDS,
      { textureKey: 'npc-fan-shadow', scale: FAN_SPRITE_SCALE }
    );
    this.sprite = sprite;
    this.attackFx = scene.add
      .sprite(x, y, 'npc-fan-attack-hard-fx-2')
      .setScale(FAN_SPRITE_SCALE)
      .setAlpha(0.84)
      .setVisible(false);
    enableEmissiveBloom(this.attackFx, FAN_EMISSIVE_COLOR, {
      glowStrength: 0.22,
      innerStrength: 0.04,
      glowDistance: 21,
      glowQuality: 2,
      blurRadius: 9,
      bloomAmount: 0.055,
      threshold: 0.06
    });
    this.weaponSprite = scene.add
      .image(x, y, 'npc-fan-weapon-glowstick')
      .setOrigin(FAN_WEAPON_ORIGIN.x, FAN_WEAPON_ORIGIN.y)
      .setScale(FAN_WEAPON_SCALE);
    scene.textures.get('npc-fan-weapon-glowstick').setFilter(Phaser.Textures.FilterMode.NEAREST);
    playFanAnimation(this.sprite, 'run');
    this.chooseMovementAngle();
    this.applyMovementVelocity();
  }

  onSpawned(): void {
    this.chooseMovementAngle();
    this.applyMovementVelocity();
  }

  update(dtMs: number): void {
    super.update(dtMs);
    if (!this.dead) this.updateAttachedVisuals();
  }

  onBeat(info: BeatInfo): void {
    if (this.dead) return;
    this.chooseMovementAngle();
    this.scene.scheduleEnemyAttacks(this.kind, info.globalBeat, () => {
      if (this.dead) return;
      this.aimAngle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
      this.playAttack(this.aimAngle);
      this.scene.spawnEnemyProjectile(this.x, this.y, this.aimAngle, this.kind);
    });
  }

  protected move(_dtMs: number): void {
    this.applyMovementVelocity();
    if (this.scene.time.now >= this.attackUntil && this.sprite.anims.currentAnim?.key !== 'fan-run') {
      playFanAnimation(this.sprite, 'run', true);
    }
    if (this.scene.time.now >= this.attackUntil) this.aimAngle = this.movementAngle;
  }

  protected die(): void {
    this.scene.tweens.killTweensOf(this.weaponSprite);
    if (this.attackFx.active) this.attackFx.destroy();
    if (this.weaponSprite.active) this.weaponSprite.destroy();
    super.die();
  }

  destroy(): void {
    if (this.attackFx.active) this.attackFx.destroy();
    if (this.weaponSprite.active) this.weaponSprite.destroy();
    super.destroy();
  }

  protected onGameOverIdle(): void {
    this.scene.tweens.killTweensOf(this.weaponSprite);
    this.attackFx.setVisible(false);
    this.weaponSprite.setRotation(0);
    playFanAnimation(this.sprite, 'idle', true);
  }

  private playAttack(angle: number): void {
    this.attackUntil = this.scene.time.now + FAN_ATTACK_DURATION_MS;
    playFanAttackEffect(this.attackFx, 'attack-hard');
    const facingRight = Math.cos(angle) >= 0;
    const swingDirection = facingRight ? 1 : -1;
    const windup = Phaser.Math.DegToRad(-10 * swingDirection);
    const strike = Phaser.Math.DegToRad(68 * swingDirection);
    this.weaponAttackUntil = this.scene.time.now + 200;
    this.scene.tweens.killTweensOf(this.weaponSprite);
    this.weaponSprite.setRotation(windup);
    this.scene.tweens.add({
      targets: this.weaponSprite,
      rotation: strike,
      duration: 80,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.weaponSprite,
          rotation: 0,
          duration: 120,
          ease: 'Back.easeOut'
        });
      }
    });
  }

  private chooseMovementAngle(): void {
    const maxOffset = this.distToPlayer() < 90 ? 70 : 24;
    const offset = Phaser.Math.FloatBetween(-maxOffset, maxOffset);
    this.movementAngle = this.angleToPlayer() + Phaser.Math.DegToRad(offset);
  }

  private applyMovementVelocity(): void {
    const v = this.scene.physics.velocityFromRotation(this.movementAngle, FanEnemy.MOVE_SPEED);
    this.go.body.setVelocity(v.x, v.y);
  }

  private updateAttachedVisuals(): void {
    const facingRight = Math.cos(this.aimAngle) >= 0;
    const side = facingRight ? 1 : -1;
    const characterDepth = worldDepth(this.go.y + this.go.body.halfHeight);
    this.attackFx
      .setPosition(this.x, this.y)
      // Fan attack FX frames are authored toward the right side.
      .setFlipX(!facingRight)
      .setDepth(characterDepth - 0.002);
    this.sprite.setFlipX(facingRight);
    this.weaponSprite
      .setPosition(
        this.x + side * FanEnemy.WEAPON_SIDE_OFFSET,
        this.y + FanEnemy.WEAPON_OFFSET_Y
      )
      .setFlipX(false)
      .setScale(
        facingRight ? -FAN_WEAPON_SCALE : FAN_WEAPON_SCALE,
        FAN_WEAPON_SCALE
      )
      .setDepth(characterDepth - 0.001);
    if (this.scene.time.now >= this.weaponAttackUntil) this.weaponSprite.setRotation(0);
  }
}

/**
 * 教学池塘角色：无手持武器，使用 Idle / Run / Roll 本体动画，
 * 攻击时从嘴部位置发射粉丝系点弹并叠加独立轻 / 重特效。
 */
export class TutorialCharacter extends Enemy {
  readonly kind = 'fan';
  private static readonly MOVE_SPEED = 66 * 0.68;
  private static readonly IDLE_DISTANCE = worldSize(112);
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly attackFx: Phaser.GameObjects.Sprite;
  private movementAngle = 0;
  private aimAngle = Math.PI;
  private rollUntil = 0;
  private attackUntil = 0;
  private nextAttackIsHeavy = false;

  constructor(scene: MainScene, x: number, y: number) {
    const sprite = scene.add
      .sprite(x, y, tutorialCharacterTextureKey('roll', 1))
      .setScale(TUTORIAL_CHARACTER_SPRITE_SCALE);
    super(
      scene,
      sprite,
      40,
      0xffffff,
      TUTORIAL_CHARACTER_BODY_SOURCE_BOUNDS,
      { textureKey: 'tutorial-character-shadow', scale: TUTORIAL_CHARACTER_SPRITE_SCALE }
    );
    this.sprite = sprite;
    this.attackFx = scene.add
      .sprite(x, y, 'tutorial-character-attack-light-fx-1')
      .setScale(TUTORIAL_CHARACTER_SPRITE_SCALE)
      .setAlpha(0.84)
      .setVisible(false);
    enableEmissiveBloom(this.attackFx, FAN_EMISSIVE_COLOR, {
      glowStrength: 0.22,
      innerStrength: 0.04,
      glowDistance: 21,
      glowQuality: 2,
      blurRadius: 9,
      bloomAmount: 0.055,
      threshold: 0.06
    });
    this.chooseMovementAngle();
    this.rollUntil = scene.time.now + TUTORIAL_CHARACTER_ROLL_DURATION_MS;
    playTutorialCharacterAnimation(this.sprite, 'roll', true);
  }

  onSpawned(): void {
    this.chooseMovementAngle();
  }

  update(dtMs: number): void {
    super.update(dtMs);
    if (this.dead) return;
    const facingRight = Math.cos(this.aimAngle) >= 0;
    const characterDepth = worldDepth(this.go.y + this.go.body.halfHeight);
    // 教学角色与正式粉丝共用“右朝向为 flipX”的贴图约定。
    this.sprite.setFlipX(facingRight);
    this.attackFx
      .setPosition(this.x, this.y)
      .setFlipX(facingRight)
      .setDepth(characterDepth - 0.002);
  }

  onBeat(info: BeatInfo): void {
    if (this.dead || this.scene.time.now < this.rollUntil) return;
    this.chooseMovementAngle();
    this.scene.scheduleEnemyAttacks(this.kind, info.globalBeat, () => {
      if (this.dead) return;
      this.aimAngle = this.scene.quantizeEnemyAttackAngle(this.angleToPlayer());
      const heavy = this.nextAttackIsHeavy;
      this.nextAttackIsHeavy = !this.nextAttackIsHeavy;
      this.attackUntil = this.scene.time.now + TUTORIAL_CHARACTER_ATTACK_DURATION_MS;
      playTutorialCharacterAttackEffect(this.attackFx, heavy ? 'attack-hard' : 'attack-light');
      const side = Math.cos(this.aimAngle) >= 0 ? 1 : -1;
      this.scene.spawnEnemyProjectile(
        this.x + side * worldSize(18),
        this.y - worldSize(8),
        this.aimAngle,
        this.kind
      );
    });
  }

  protected move(_dtMs: number): void {
    if (this.scene.time.now < this.rollUntil) {
      const v = this.scene.physics.velocityFromRotation(
        this.movementAngle,
        TutorialCharacter.MOVE_SPEED * 1.35
      );
      this.go.body.setVelocity(v.x, v.y);
      return;
    }

    const distance = this.distToPlayer();
    if (distance <= TutorialCharacter.IDLE_DISTANCE) {
      this.go.body.setVelocity(0, 0);
      if (this.scene.time.now >= this.attackUntil) playTutorialCharacterAnimation(this.sprite, 'idle');
      return;
    }

    const v = this.scene.physics.velocityFromRotation(this.movementAngle, TutorialCharacter.MOVE_SPEED);
    this.go.body.setVelocity(v.x, v.y);
    if (this.scene.time.now >= this.attackUntil) playTutorialCharacterAnimation(this.sprite, 'run');
    this.aimAngle = this.movementAngle;
  }

  protected die(): void {
    if (this.attackFx.active) this.attackFx.destroy();
    super.retireWithoutReward();
  }

  /** 新一轮教学角色出现前，当前角色先播放无奖励的死亡退场。 */
  retire(): void {
    if (this.attackFx.active) this.attackFx.destroy();
    this.retireWithoutReward();
  }

  destroy(): void {
    if (this.attackFx.active) this.attackFx.destroy();
    super.destroy();
  }

  protected onGameOverIdle(): void {
    this.attackFx.setVisible(false);
    playTutorialCharacterAnimation(this.sprite, 'idle', true);
  }

  private chooseMovementAngle(): void {
    const maxOffset = this.distToPlayer() < 90 ? 38 : 18;
    this.movementAngle = this.angleToPlayer() + Phaser.Math.DegToRad(
      Phaser.Math.FloatBetween(-maxOffset, maxOffset)
    );
    if (this.scene.time.now >= this.attackUntil) this.aimAngle = this.movementAngle;
  }
}
