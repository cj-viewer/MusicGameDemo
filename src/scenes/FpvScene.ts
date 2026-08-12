import Phaser from 'phaser';
import type { MainScene } from './MainScene';

/**
 * 实验性第一人称视角面板（右半屏）：不做真 3D，每帧读取 MainScene 状态，
 * 用针孔投影把敌人/子弹按距离透视缩放绘制成 billboard。
 * 设计与回退说明见 docs/split-coop-fpv.md。
 */

const PANEL_X = 640;
const PANEL_W = 640;
const PANEL_H = 720;
const HORIZON_Y = 300;
const FOV = Phaser.Math.DegToRad(100);
const FOCAL = PANEL_W / 2 / Math.tan(FOV / 2);
/** 视线高度（世界单位），决定地面透视密度 */
const EYE_HEIGHT = 46;
/** 近裁剪距离：过近的目标不绘制，避免撑爆画面 */
const NEAR_CLIP = 24;
const ENEMY_POOL = 40;
const BULLET_POOL = 80;
/** 每帧视角最大转动（弧度），平滑跟随瞄准角 */
const VIEW_TURN_STEP = 0.18;

interface Projected {
  screenX: number;
  bottomY: number;
  width: number;
  height: number;
  dist: number;
}

export class FpvScene extends Phaser.Scene {
  private enemySprites: Phaser.GameObjects.Image[] = [];
  private bulletSprites: Phaser.GameObjects.Rectangle[] = [];
  private beatRing!: Phaser.GameObjects.Arc;
  private viewAngle = 0;

  constructor() {
    super('FpvScene');
  }

  create(): void {
    this.cameras.main.setViewport(PANEL_X, 0, PANEL_W, PANEL_H);

    // 天空与地面
    this.add.rectangle(PANEL_W / 2, HORIZON_Y / 2, PANEL_W, HORIZON_Y, 0x0b1026).setDepth(-10000);
    this.add
      .rectangle(PANEL_W / 2, (HORIZON_Y + PANEL_H) / 2, PANEL_W, PANEL_H - HORIZON_Y, 0x1f2937)
      .setDepth(-10000);

    // 等距地面深度线：同一投影公式，越远越靠近地平线
    const ground = this.add.graphics().setDepth(-9000);
    ground.lineStyle(1, 0x334155, 0.8);
    for (const dist of [60, 90, 140, 220, 360, 600, 1000]) {
      const y = HORIZON_Y + (EYE_HEIGHT * FOCAL) / dist;
      ground.lineBetween(0, y, PANEL_W, y);
    }

    // 与左半屏的分隔线
    this.add.rectangle(1, PANEL_H / 2, 2, PANEL_H, 0x475569).setOrigin(0, 0.5).setDepth(10000);

    // 对象池
    this.enemySprites = [];
    for (let i = 0; i < ENEMY_POOL; i++) {
      this.enemySprites.push(this.add.image(0, 0, 'guard').setOrigin(0.5, 1).setVisible(false));
    }
    this.bulletSprites = [];
    for (let i = 0; i < BULLET_POOL; i++) {
      this.bulletSprites.push(this.add.rectangle(0, 0, 8, 8, 0xffffff).setVisible(false));
    }

    // 准星 + 节拍环（射击位的独立节奏提示）
    const crosshair = this.add.graphics().setDepth(9000);
    crosshair.lineStyle(2, 0xffffff, 0.9);
    crosshair.lineBetween(PANEL_W / 2 - 12, HORIZON_Y, PANEL_W / 2 - 4, HORIZON_Y);
    crosshair.lineBetween(PANEL_W / 2 + 4, HORIZON_Y, PANEL_W / 2 + 12, HORIZON_Y);
    crosshair.lineBetween(PANEL_W / 2, HORIZON_Y - 12, PANEL_W / 2, HORIZON_Y - 4);
    crosshair.lineBetween(PANEL_W / 2, HORIZON_Y + 4, PANEL_W / 2, HORIZON_Y + 12);
    this.beatRing = this.add.circle(PANEL_W / 2, HORIZON_Y, 60).setStrokeStyle(2, 0x67e8f9, 0.8).setDepth(9000);

    this.add
      .text(PANEL_W / 2, 30, '节奏射击位 · FPV 实验', { fontFamily: 'Arial', fontSize: '16px', color: '#94a3b8' })
      .setOrigin(0.5)
      .setDepth(9000);
  }

  update(): void {
    const main = this.scene.get('MainScene') as MainScene | null;
    if (!main || !main.player || !main.conductor) {
      this.hideAll();
      return;
    }

    const player = main.player;
    this.viewAngle = Phaser.Math.Angle.RotateTo(this.viewAngle, player.aimAngle, VIEW_TURN_STEP);

    // 节拍环：向拍点收缩，踩拍时最小最亮
    const conductor = main.conductor;
    if (conductor.started) {
      const remain = conductor.timeToNextBeat(conductor.now()) / conductor.beatDur;
      this.beatRing.setVisible(true);
      this.beatRing.setScale(0.35 + remain * 0.85);
      this.beatRing.setAlpha(remain < 0.25 ? 1 : 0.45);
    } else {
      this.beatRing.setVisible(false);
    }

    this.drawEnemies(main, player.x, player.y);
    this.drawBullets(main, player.x, player.y);
  }

  /** 针孔投影：世界坐标 → 面板坐标；不可见（视野外/过近）返回 null */
  private project(px: number, py: number, tx: number, ty: number, worldW: number, worldH: number): Projected | null {
    const dist = Phaser.Math.Distance.Between(px, py, tx, ty);
    if (dist < NEAR_CLIP) return null;
    const rel = Phaser.Math.Angle.Wrap(Phaser.Math.Angle.Between(px, py, tx, ty) - this.viewAngle);
    if (Math.abs(rel) > FOV / 2 + 0.35) return null;
    // 深度用视线方向分量，避免边缘目标被 tan 拉伸得过大
    const depth = Math.max(dist * Math.cos(rel), NEAR_CLIP);
    return {
      screenX: PANEL_W / 2 + FOCAL * Math.tan(rel),
      bottomY: HORIZON_Y + (EYE_HEIGHT * FOCAL) / depth,
      width: (worldW * FOCAL) / depth,
      height: (worldH * FOCAL) / depth,
      dist
    };
  }

  private drawEnemies(main: MainScene, px: number, py: number): void {
    const projected: { p: Projected; tex: string }[] = [];
    for (const enemy of main.fpvEnemies) {
      if (enemy.dead) continue;
      const go = enemy.go as Phaser.GameObjects.Image;
      const p = this.project(px, py, enemy.x, enemy.y, go.displayWidth, go.displayHeight);
      if (p) projected.push({ p, tex: go.texture?.key ?? 'guard' });
    }
    // 远的先画（深度小），近的盖在上面
    projected.sort((a, b) => b.p.dist - a.p.dist);

    for (let i = 0; i < this.enemySprites.length; i++) {
      const sprite = this.enemySprites[i];
      const item = projected[i];
      if (!item) {
        sprite.setVisible(false);
        continue;
      }
      sprite
        .setVisible(true)
        .setTexture(item.tex)
        .setPosition(item.p.screenX, item.p.bottomY)
        .setDisplaySize(item.p.width, item.p.height)
        .setDepth(-item.p.dist);
    }
  }

  private drawBullets(main: MainScene, px: number, py: number): void {
    const all: { p: Projected; color: number }[] = [];
    for (const group of [main.fpvEnemyBullets, main.fpvPlayerBullets]) {
      for (const obj of group) {
        const bullet = obj as Phaser.GameObjects.Rectangle;
        if (!bullet.active) continue;
        const p = this.project(px, py, bullet.x, bullet.y, bullet.displayWidth, bullet.displayHeight);
        if (p) all.push({ p, color: bullet.fillColor });
      }
    }
    all.sort((a, b) => b.p.dist - a.p.dist);

    for (let i = 0; i < this.bulletSprites.length; i++) {
      const sprite = this.bulletSprites[i];
      const item = all[i];
      if (!item) {
        sprite.setVisible(false);
        continue;
      }
      // 子弹按飞行高度悬浮在地面与地平线之间
      const y = HORIZON_Y + (item.p.bottomY - HORIZON_Y) * 0.55;
      sprite
        .setVisible(true)
        .setPosition(item.p.screenX, y)
        .setDisplaySize(Math.max(3, item.p.width), Math.max(3, item.p.height))
        .setFillStyle(item.color)
        .setDepth(-item.p.dist);
    }
  }

  private hideAll(): void {
    for (const sprite of this.enemySprites) sprite.setVisible(false);
    for (const sprite of this.bulletSprites) sprite.setVisible(false);
    if (this.beatRing) this.beatRing.setVisible(false);
  }
}
