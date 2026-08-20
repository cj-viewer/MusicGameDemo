import Phaser from 'phaser';
import type { MainScene } from './MainScene';
import type { Enemy } from '../game/enemies';
import { VIEW_HEIGHT, VIEW_WIDTH, ui } from '../game/displayConfig';

/**
 * 右下角的只读 FPV 观察窗：沿用实验分支的针孔投影，但不改变主场景相机、
 * HUD、输入或判定。它只是同一战场的第二种观看方式。
 */
// 锚定屏幕右下角；旧 20px 外边距和 240×153 尺寸按 1.5 倍迁移。
const PANEL_W = ui(240);
const PANEL_H = ui(153);
const PANEL_X = VIEW_WIDTH - PANEL_W - ui(20);
const PANEL_Y = VIEW_HEIGHT - PANEL_H - ui(20);
const HORIZON_Y = ui(63);
const FOV = Phaser.Math.DegToRad(100);
const FOCAL = PANEL_W / 2 / Math.tan(FOV / 2);
const EYE_HEIGHT = ui(34.5);
const NEAR_CLIP = ui(24);
const ENEMY_POOL = 40;
const BULLET_POOL = 80;
const ARENA_LEFT = ui(94);
const ARENA_RIGHT = ui(1186);
const ARENA_TOP = ui(12);
const ARENA_BOTTOM = ui(626);

interface Projected {
  screenX: number;
  bottomY: number;
  width: number;
  height: number;
  dist: number;
}

export class FpvMiniScene extends Phaser.Scene {
  private enabled = false;
  private enemyBillboards = new Map<Enemy, Phaser.GameObjects.Image>();
  private freeEnemySprites: Phaser.GameObjects.Image[] = [];
  private bulletBillboards = new Map<Phaser.GameObjects.GameObject, Phaser.GameObjects.Rectangle>();
  private freeBulletSprites: Phaser.GameObjects.Rectangle[] = [];
  private posts: { x: number; y: number; marker: Phaser.GameObjects.Rectangle }[] = [];
  private beatRing!: Phaser.GameObjects.Arc;
  private compass!: Phaser.GameObjects.Text;

  constructor() {
    super('FpvMiniScene');
  }

  create(): void {
    this.cameras.main.setViewport(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);
    this.enemyBillboards.clear();
    this.freeEnemySprites = [];
    this.bulletBillboards.clear();
    this.freeBulletSprites = [];
    this.posts = [];

    this.add.rectangle(PANEL_W / 2, PANEL_H / 2, PANEL_W, PANEL_H, 0x0b1026, 0.98).setDepth(-10000);
    this.add.rectangle(PANEL_W / 2, (HORIZON_Y + PANEL_H) / 2, PANEL_W, PANEL_H - HORIZON_Y, 0x1f2937).setDepth(-10000);
    const ground = this.add.graphics().setDepth(-9000);
    ground.lineStyle(1, 0x334155, 0.72);
    for (const distance of [60, 100, 180, 320, 560]) {
      const y = HORIZON_Y + (EYE_HEIGHT * FOCAL) / distance;
      ground.lineBetween(0, y, PANEL_W, y);
    }
    this.add.rectangle(PANEL_W / 2, PANEL_H / 2, PANEL_W - 2, PANEL_H - 2).setStrokeStyle(1, 0xe879f9, 0.72).setFillStyle(0, 0).setDepth(10000);
    this.add.text(8, 7, 'FPV', { fontFamily: 'Arial', fontSize: '10px', color: '#f5d0fe' }).setDepth(10001);
    this.compass = this.add.text(PANEL_W / 2, 7, '—', { fontFamily: 'Arial', fontSize: '10px', color: '#d8b4fe' }).setOrigin(0.5).setDepth(10001);
    const crosshair = this.add.graphics().setDepth(10001);
    crosshair.lineStyle(1, 0xf5d0fe, 0.72);
    crosshair.lineBetween(PANEL_W / 2 - 6, HORIZON_Y, PANEL_W / 2 + 6, HORIZON_Y);
    crosshair.lineBetween(PANEL_W / 2, HORIZON_Y - 6, PANEL_W / 2, HORIZON_Y + 6);
    this.beatRing = this.add.circle(PANEL_W / 2, HORIZON_Y, 19.5).setStrokeStyle(1, 0xe879f9, 0.65).setDepth(10001);

    for (let index = 0; index < ENEMY_POOL; index++) {
      this.freeEnemySprites.push(this.add.image(0, 0, 'guard').setOrigin(0.5, 1).setVisible(false));
    }
    for (let index = 0; index < BULLET_POOL; index++) {
      this.freeBulletSprites.push(
        this.add
          .rectangle(0, 0, 4, 4, 0xffffff)
          .setBlendMode(Phaser.BlendModes.NORMAL)
          .setVisible(false)
      );
    }
    for (let x = ARENA_LEFT; x <= ARENA_RIGHT; x += ui(180)) this.addPost(x, ARENA_TOP), this.addPost(x, ARENA_BOTTOM);
    for (let y = ARENA_TOP + ui(160); y < ARENA_BOTTOM; y += ui(180)) this.addPost(ARENA_LEFT, y), this.addPost(ARENA_RIGHT, y);
  }

  setPanelEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const visible = this.canDisplayPanel();
    this.cameras.main.setVisible(visible);
    if (!visible) this.hideDynamicObjects();
  }

  /** 设置菜单覆盖主画面时暂时收起观察窗；关闭后回到暂停前的同一帧。 */
  setPanelPaused(paused: boolean): void {
    const visible = !paused && this.canDisplayPanel();
    this.cameras.main.setVisible(visible);
    if (!visible) this.hideDynamicObjects();
  }

  private canDisplayPanel(): boolean {
    const main = this.scene.get('MainScene') as MainScene | null;
    return Boolean(
      this.enabled &&
      main &&
      !main.isGamePaused &&
      main.conductor?.started &&
      !main.isTitleScreen &&
      !main.isTutorialStage
    );
  }

  onBeat(heavy: boolean): void {
    const inset = heavy ? 10 : 6;
    this.cameras.main.setViewport(PANEL_X, PANEL_Y + inset, PANEL_W, PANEL_H - inset * 2);
    this.tweens.addCounter({
      from: inset,
      to: 0,
      duration: heavy ? 260 : 190,
      ease: 'Back.easeOut',
      onUpdate: (tween) => {
        const currentInset = tween.getValue() ?? 0;
        this.cameras.main.setViewport(
          PANEL_X,
          PANEL_Y + currentInset,
          PANEL_W,
          PANEL_H - currentInset * 2
        );
      }
    });
  }

  update(): void {
    const main = this.scene.get('MainScene') as MainScene | null;
    if (
      !this.enabled ||
      !main ||
      main.isGamePaused ||
      !main.conductor?.started ||
      main.isTitleScreen ||
      main.isTutorialStage
    ) {
      this.cameras.main.setVisible(false);
      this.hideDynamicObjects();
      return;
    }
    this.cameras.main.setVisible(true);
    const player = main.player;
    // 观察窗只读玩家的自动锁定方向，不参与选敌或修改主场景状态。
    const angle = player.rawAimAngle;
    const conductor = main.conductor;
    const remain = conductor.timeToNextBeat(conductor.now()) / conductor.beatDur;
    this.beatRing.setVisible(true).setScale(0.35 + remain * 0.85).setAlpha(remain < 0.25 ? 1 : 0.45);
    this.compass.setText(`${Math.round(Phaser.Math.RadToDeg(angle))}°`);
    for (const post of this.posts) {
      const projected = this.project(player.x, player.y, angle, post.x, post.y, 8, 50);
      if (!projected) post.marker.setVisible(false);
      else post.marker.setVisible(true).setPosition(projected.screenX, projected.bottomY).setDisplaySize(Math.max(2, projected.width), Math.max(6, projected.height)).setDepth(-projected.dist - 0.5);
    }
    this.drawEnemies(main, player.x, player.y, angle);
    this.drawBullets(main, player.x, player.y, angle);
  }

  private addPost(x: number, y: number): void {
    this.posts.push({ x, y, marker: this.add.rectangle(0, 0, 4, 26, 0x64748b).setOrigin(0.5, 1).setVisible(false) });
  }

  private project(px: number, py: number, angle: number, tx: number, ty: number, worldW: number, worldH: number): Projected | null {
    const dist = Phaser.Math.Distance.Between(px, py, tx, ty);
    if (dist < NEAR_CLIP) return null;
    const relativeAngle = Phaser.Math.Angle.Wrap(Phaser.Math.Angle.Between(px, py, tx, ty) - angle);
    if (Math.abs(relativeAngle) > FOV / 2 + 0.5) return null;
    const depth = Math.max(dist * Math.cos(relativeAngle), NEAR_CLIP);
    return {
      screenX: PANEL_W / 2 + FOCAL * Math.tan(relativeAngle),
      bottomY: HORIZON_Y + (EYE_HEIGHT * FOCAL) / depth,
      width: (worldW * FOCAL) / depth,
      height: (worldH * FOCAL) / depth,
      dist
    };
  }

  private drawEnemies(main: MainScene, px: number, py: number, angle: number): void {
    const seen = new Set<Enemy>();
    for (const enemy of main.fpvEnemies) {
      if (enemy.dead) continue;
      seen.add(enemy);
      const visual = enemy.go as Phaser.GameObjects.Sprite;
      const projected = this.project(px, py, angle, enemy.x, enemy.y, visual.displayWidth, visual.displayHeight);
      let billboard = this.enemyBillboards.get(enemy);
      if (!projected) {
        billboard?.setVisible(false);
        continue;
      }
      if (!billboard) {
        billboard = this.freeEnemySprites.pop();
        if (!billboard) continue;
        this.enemyBillboards.set(enemy, billboard);
      }
      billboard
        .setVisible(true)
        .setTexture(visual.texture.key)
        .setPosition(projected.screenX, projected.bottomY)
        .setDisplaySize(projected.width, projected.height)
        .setFlipX(visual.flipX)
        .setDepth(-projected.dist);
    }
    for (const [enemy, billboard] of [...this.enemyBillboards]) {
      if (seen.has(enemy)) continue;
      billboard.setVisible(false);
      this.enemyBillboards.delete(enemy);
      this.freeEnemySprites.push(billboard);
    }
  }

  private drawBullets(main: MainScene, px: number, py: number, angle: number): void {
    const seen = new Set<Phaser.GameObjects.GameObject>();
    for (const group of [main.fpvEnemyBullets, main.fpvPlayerBullets]) {
      for (const object of group) {
        const bullet = object as Phaser.GameObjects.Rectangle;
        if (!bullet.active) continue;
        seen.add(bullet);
        const displayWidth =
          (bullet.getData('fpvDisplayWidth') as number | undefined) ?? bullet.displayWidth;
        const displayHeight =
          (bullet.getData('fpvDisplayHeight') as number | undefined) ?? bullet.displayHeight;
        const projected = this.project(px, py, angle, bullet.x, bullet.y, displayWidth, displayHeight);
        let billboard = this.bulletBillboards.get(bullet);
        if (!projected) {
          billboard?.setVisible(false);
          continue;
        }
        if (!billboard) {
          billboard = this.freeBulletSprites.pop();
          if (!billboard) continue;
          this.bulletBillboards.set(bullet, billboard);
        }
        const visualColor = (bullet.getData('visualColor') as number | undefined) ?? bullet.fillColor;
        const visualAlpha = bullet.getData('sourceKind') ? 0.78 : 0.84;
        billboard
          .setVisible(true)
          .setPosition(projected.screenX, HORIZON_Y + (projected.bottomY - HORIZON_Y) * 0.55)
          .setDisplaySize(Math.max(2, projected.width), Math.max(2, projected.height))
          .setFillStyle(visualColor, visualAlpha)
          .setStrokeStyle(1, visualColor, 1)
          .setDepth(-projected.dist);
      }
    }
    for (const [bullet, billboard] of [...this.bulletBillboards]) {
      if (seen.has(bullet)) continue;
      billboard.setVisible(false);
      this.bulletBillboards.delete(bullet);
      this.freeBulletSprites.push(billboard);
    }
  }

  private hideDynamicObjects(): void {
    this.beatRing?.setVisible(false);
    for (const post of this.posts) post.marker.setVisible(false);
    for (const sprite of this.enemyBillboards.values()) sprite.setVisible(false);
    for (const sprite of this.bulletBillboards.values()) sprite.setVisible(false);
  }
}
