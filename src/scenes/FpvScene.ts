import Phaser from 'phaser';
import type { MainScene } from './MainScene';
import type { Enemy } from '../game/enemies';

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
/** 场地边界（与 MainScene 的 ARENA 一致） */
const ARENA_LEFT = 12;
const ARENA_RIGHT = 1268;
const ARENA_TOP = 12;
const ARENA_BOTTOM = 708;
/** 边界立柱间距与地面网格步长（世界单位） */
const POST_SPACING = 157;
const FLOOR_GRID_STEP = 140;

interface Projected {
  screenX: number;
  bottomY: number;
  width: number;
  height: number;
  dist: number;
}

export class FpvScene extends Phaser.Scene {
  // billboard 与实体固定绑定（而非每帧按排序重新分配），避免池位轮换造成的频闪
  private enemyBillboards = new Map<Enemy, Phaser.GameObjects.Image>();
  private freeEnemySprites: Phaser.GameObjects.Image[] = [];
  private bulletBillboards = new Map<Phaser.GameObjects.GameObject, Phaser.GameObjects.Rectangle>();
  private freeBulletSprites: Phaser.GameObjects.Rectangle[] = [];
  private beatRing!: Phaser.GameObjects.Arc;
  private viewAngle = 0;

  // 参照物：边界立柱与地面网格标记（世界坐标固定，按索引稳定绑定显示对象）
  private postPositions: { x: number; y: number }[] = [];
  private postMarkers: Phaser.GameObjects.Rectangle[] = [];
  private floorPositions: { x: number; y: number }[] = [];
  private floorMarkers: Phaser.GameObjects.Rectangle[] = [];
  // 顶部罗盘：每 30° 一格刻度 + 四向字母
  private compassTicks: Phaser.GameObjects.Rectangle[] = [];
  private compassLabels: { angle: number; text: Phaser.GameObjects.Text }[] = [];
  // 节奏点条（分屏时从左侧移过来）
  private patternIcons: Phaser.GameObjects.Shape[] = [];
  private patternKey = '';

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
    this.enemyBillboards.clear();
    this.freeEnemySprites = [];
    for (let i = 0; i < ENEMY_POOL; i++) {
      this.freeEnemySprites.push(this.add.image(0, 0, 'guard').setOrigin(0.5, 1).setVisible(false));
    }
    this.bulletBillboards.clear();
    this.freeBulletSprites = [];
    for (let i = 0; i < BULLET_POOL; i++) {
      this.freeBulletSprites.push(this.add.rectangle(0, 0, 8, 8, 0xffffff).setVisible(false));
    }

    // 参照物：沿场地边界的立柱 + 场内地面网格点，转身/移动时产生视差，让旋转可感知
    this.postPositions = [];
    for (let x = ARENA_LEFT; x <= ARENA_RIGHT; x += POST_SPACING) {
      this.postPositions.push({ x, y: ARENA_TOP }, { x, y: ARENA_BOTTOM });
    }
    for (let y = ARENA_TOP + POST_SPACING; y <= ARENA_BOTTOM - 100; y += POST_SPACING) {
      this.postPositions.push({ x: ARENA_LEFT, y }, { x: ARENA_RIGHT, y });
    }
    this.postMarkers = this.postPositions.map(() =>
      this.add.rectangle(0, 0, 8, 60, 0x64748b).setOrigin(0.5, 1).setVisible(false)
    );

    this.floorPositions = [];
    for (let x = ARENA_LEFT + 70; x < ARENA_RIGHT; x += FLOOR_GRID_STEP) {
      for (let y = ARENA_TOP + 70; y < ARENA_BOTTOM; y += FLOOR_GRID_STEP) {
        this.floorPositions.push({ x, y });
      }
    }
    this.floorMarkers = this.floorPositions.map(() =>
      this.add.rectangle(0, 0, 10, 3, 0x475569).setVisible(false)
    );

    // 顶部罗盘：转身时刻度平移，是最直接的旋转反馈
    this.compassTicks = [];
    for (let i = 0; i < 12; i++) {
      this.compassTicks.push(this.add.rectangle(0, 58, 2, 10, 0x94a3b8).setDepth(9000).setVisible(false));
    }
    this.compassLabels = (
      [
        ['E', 0],
        ['S', Math.PI / 2],
        ['W', Math.PI],
        ['N', -Math.PI / 2]
      ] as [string, number][]
    ).map(([label, angle]) => ({
      angle,
      text: this.add
        .text(0, 44, label, { fontFamily: 'Arial', fontSize: '14px', color: '#cbd5e1' })
        .setOrigin(0.5)
        .setDepth(9000)
        .setVisible(false)
    }));

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
    // 视角与瞄准 1:1 同步：平滑滞后会产生"画面漂移"的眩晕感，去掉后转向即时可感
    this.viewAngle = player.aimAngle;

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

    this.drawReferenceMarkers(player.x, player.y);
    this.drawCompass();
    this.updatePatternStrip(main);
    this.drawEnemies(main, player.x, player.y);
    this.drawBullets(main, player.x, player.y);
  }

  /** 边界立柱与地面网格：按索引稳定绑定，无重分配 */
  private drawReferenceMarkers(px: number, py: number): void {
    for (let i = 0; i < this.postPositions.length; i++) {
      const pos = this.postPositions[i];
      const marker = this.postMarkers[i];
      const p = this.project(px, py, pos.x, pos.y, 10, 84);
      if (!p) {
        marker.setVisible(false);
        continue;
      }
      marker
        .setVisible(true)
        .setPosition(p.screenX, p.bottomY)
        .setDisplaySize(Math.max(2, p.width), Math.max(8, p.height))
        .setDepth(-p.dist - 0.5);
    }
    for (let i = 0; i < this.floorPositions.length; i++) {
      const pos = this.floorPositions[i];
      const marker = this.floorMarkers[i];
      const p = this.project(px, py, pos.x, pos.y, 18, 5);
      if (!p) {
        marker.setVisible(false);
        continue;
      }
      marker
        .setVisible(true)
        .setPosition(p.screenX, p.bottomY)
        .setDisplaySize(Math.max(3, p.width), Math.max(2, p.height))
        .setDepth(-p.dist - 1);
    }
  }

  /** 顶部罗盘：刻度与四向字母随视角平移 */
  private drawCompass(): void {
    const place = (angle: number, obj: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text): void => {
      const rel = Phaser.Math.Angle.Wrap(angle - this.viewAngle);
      if (Math.abs(rel) > FOV / 2) {
        obj.setVisible(false);
        return;
      }
      obj.setVisible(true);
      obj.x = PANEL_W / 2 + FOCAL * Math.tan(rel);
    };
    for (let i = 0; i < this.compassTicks.length; i++) {
      place(Phaser.Math.Angle.Wrap((i * Math.PI) / 6), this.compassTicks[i]);
    }
    for (const label of this.compassLabels) {
      place(label.angle, label.text);
    }
  }

  /** 节奏点条：显示当前武器连段（○轻 ◆重），当前拍随节拍脉冲；连段变化时重建 */
  private updatePatternStrip(main: MainScene): void {
    const pattern = main.combo.pattern;
    const key = pattern.join('');
    if (key !== this.patternKey) {
      this.patternKey = key;
      for (const icon of this.patternIcons) icon.destroy();
      this.patternIcons = pattern.map((k, i) => {
        const x = PANEL_W / 2 + (i - 1.5) * 56;
        return k === 'L'
          ? (this.add.circle(x, 96, 11).setStrokeStyle(3, 0x67e8f9).setDepth(9000) as Phaser.GameObjects.Shape)
          : (this.add.rectangle(x, 96, 18, 18, 0xfbbf24).setAngle(45).setDepth(9000) as Phaser.GameObjects.Shape);
      });
    }
    const conductor = main.conductor;
    if (!conductor.started) return;
    const beatFloat = conductor.beatFloatAt(conductor.now());
    const current = ((Math.floor(beatFloat) % 4) + 4) % 4;
    const frac = beatFloat - Math.floor(beatFloat);
    this.patternIcons.forEach((icon, i) => {
      const active = beatFloat >= 0 && i === current;
      icon.setScale(active ? 1.45 - 0.45 * frac : 1);
      icon.setAlpha(active ? 1 : 0.65);
    });
  }

  /** 针孔投影：世界坐标 → 面板坐标；不可见（视野外/过近）返回 null */
  private project(px: number, py: number, tx: number, ty: number, worldW: number, worldH: number): Projected | null {
    const dist = Phaser.Math.Distance.Between(px, py, tx, ty);
    if (dist < NEAR_CLIP) return null;
    const rel = Phaser.Math.Angle.Wrap(Phaser.Math.Angle.Between(px, py, tx, ty) - this.viewAngle);
    if (Math.abs(rel) > FOV / 2 + 0.6) return null;
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
    const seen = new Set<Enemy>();
    for (const enemy of main.fpvEnemies) {
      if (enemy.dead) continue;
      seen.add(enemy);
      const go = enemy.go as Phaser.GameObjects.Image;
      const p = this.project(px, py, enemy.x, enemy.y, go.displayWidth, go.displayHeight);
      let sprite = this.enemyBillboards.get(enemy);
      if (!p) {
        // 视野外：保留绑定只隐藏，回到视野时不换池位
        sprite?.setVisible(false);
        continue;
      }
      if (!sprite) {
        sprite = this.freeEnemySprites.pop();
        if (!sprite) continue;
        this.enemyBillboards.set(enemy, sprite);
      }
      sprite
        .setVisible(true)
        .setTexture(go.texture?.key ?? 'guard')
        .setPosition(p.screenX, p.bottomY)
        .setDisplaySize(p.width, p.height)
        .setDepth(-p.dist);
    }
    // 回收已死亡/移除的敌人的 billboard
    for (const [enemy, sprite] of [...this.enemyBillboards]) {
      if (!seen.has(enemy)) {
        sprite.setVisible(false);
        this.enemyBillboards.delete(enemy);
        this.freeEnemySprites.push(sprite);
      }
    }
  }

  private drawBullets(main: MainScene, px: number, py: number): void {
    const seen = new Set<Phaser.GameObjects.GameObject>();
    for (const group of [main.fpvEnemyBullets, main.fpvPlayerBullets]) {
      for (const obj of group) {
        const bullet = obj as Phaser.GameObjects.Rectangle;
        if (!bullet.active) continue;
        seen.add(bullet);
        const p = this.project(px, py, bullet.x, bullet.y, bullet.displayWidth, bullet.displayHeight);
        let sprite = this.bulletBillboards.get(bullet);
        if (!p) {
          sprite?.setVisible(false);
          continue;
        }
        if (!sprite) {
          sprite = this.freeBulletSprites.pop();
          if (!sprite) continue;
          this.bulletBillboards.set(bullet, sprite);
        }
        // 子弹按飞行高度悬浮在地面与地平线之间
        const y = HORIZON_Y + (p.bottomY - HORIZON_Y) * 0.55;
        sprite
          .setVisible(true)
          .setPosition(p.screenX, y)
          .setDisplaySize(Math.max(3, p.width), Math.max(3, p.height))
          .setFillStyle(bullet.fillColor)
          .setDepth(-p.dist);
      }
    }
    for (const [bullet, sprite] of [...this.bulletBillboards]) {
      if (!seen.has(bullet)) {
        sprite.setVisible(false);
        this.bulletBillboards.delete(bullet);
        this.freeBulletSprites.push(sprite);
      }
    }
  }

  private hideAll(): void {
    for (const [entity, sprite] of [...this.enemyBillboards]) {
      sprite.setVisible(false);
      this.enemyBillboards.delete(entity);
      this.freeEnemySprites.push(sprite);
    }
    for (const [entity, sprite] of [...this.bulletBillboards]) {
      sprite.setVisible(false);
      this.bulletBillboards.delete(entity);
      this.freeBulletSprites.push(sprite);
    }
    for (const marker of this.postMarkers) marker.setVisible(false);
    for (const marker of this.floorMarkers) marker.setVisible(false);
    for (const tick of this.compassTicks) tick.setVisible(false);
    for (const label of this.compassLabels) label.text.setVisible(false);
    for (const icon of this.patternIcons) icon.setVisible(false);
    if (this.beatRing) this.beatRing.setVisible(false);
  }
}
