import Phaser from 'phaser';
import type { Enemy } from '../game/enemies';
import { FPV_VIEW_X, VIEW_HEIGHT, VIEW_WIDTH } from '../game/viewLayout';
import type { MainScene } from './MainScene';

/**
 * 右侧只读的伪 3D 第三人称视口。
 * 场地、道路和纸片立牌都使用固定的主场景世界坐标，只有观察相机随玩家移动、转向。
 */
const PANEL_X = FPV_VIEW_X;
const PANEL_Y = 0;
const PANEL_W = VIEW_WIDTH;
const PANEL_H = VIEW_HEIGHT;
const HORIZON_Y = 226;
const FOV = Phaser.Math.DegToRad(82);
const HALF_FOV_TAN = Math.tan(FOV / 2);
const FOCAL = PANEL_W / 2 / HALF_FOV_TAN;
const CAMERA_BACK = 176;
const EYE_HEIGHT = 105;
const NEAR_CLIP = 34;
const ENEMY_POOL = 40;
const BULLET_POOL = 240;
const CARD_OUTLINE_PX = 6;
const LIGHT_X = 640;
const LIGHT_Y = 690;

type PropTexture =
  | 'storybook-stage'
  | 'storybook-pillar'
  | 'storybook-crate'
  | 'storybook-flowers'
  | 'storybook-tree'
  | 'storybook-tent'
  | 'storybook-lantern'
  | 'storybook-bench';

interface Projected {
  screenX: number;
  bottomY: number;
  width: number;
  height: number;
  dist: number;
  depth: number;
}

interface CardStandee {
  root: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Ellipse;
  outline: Phaser.GameObjects.Image;
  art: Phaser.GameObjects.Image;
  shade: Phaser.GameObjects.Image;
  footLine: Phaser.GameObjects.Rectangle;
}

interface EnvironmentStandee {
  x: number;
  y: number;
  worldHeight: number;
  texture: PropTexture;
  flipX: boolean;
  facing: number;
  panel: EnvironmentPanel;
}

interface EnvironmentPanel {
  outline: TintedMesh2D;
  art: TintedMesh2D;
  shadow: Phaser.GameObjects.Graphics;
}

type TintedMesh2D = Phaser.GameObjects.Mesh2D & { tint: number; tintMode: Phaser.TintModes };

interface BulletStandee {
  root: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Ellipse;
  outline: Phaser.GameObjects.Rectangle;
  core: Phaser.GameObjects.Rectangle;
}

interface CameraPoint {
  forward: number;
  side: number;
}

interface WorldPoint {
  x: number;
  y: number;
}

interface SkyDrifter {
  image: Phaser.GameObjects.Image;
  velocityX: number;
  baseY: number;
  bobAmount: number;
  bobSpeed: number;
  phase: number;
  wrapPadding: number;
}

interface ShootingStar {
  image: Phaser.GameObjects.Image;
  delay: number;
  duration: number;
  startX: number;
  startY: number;
  travelX: number;
  travelY: number;
}

export class FpvMiniScene extends Phaser.Scene {
  private enabled = true;
  private enemyBillboards = new Map<Enemy, CardStandee>();
  private freeEnemyStandees: CardStandee[] = [];
  private bulletBillboards = new Map<Phaser.GameObjects.GameObject, BulletStandee>();
  private freeBulletStandees: BulletStandee[] = [];
  private playerStandee!: CardStandee;
  private arenaProps: EnvironmentStandee[] = [];
  private grassDetails: WorldPoint[] = [];
  private terrainGfx!: Phaser.GameObjects.Graphics;
  private beatRing!: Phaser.GameObjects.Arc;
  private compass!: Phaser.GameObjects.Text;
  private skyDrifters: SkyDrifter[] = [];
  private shootingStars: ShootingStar[] = [];
  private skyElapsed = 0;

  constructor() {
    super('FpvMiniScene');
  }

  create(): void {
    this.cameras.main.setViewport(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);
    this.createStorybookBackdrop();
    this.playerStandee = this.createCardStandee('player-idle-1');
    for (let index = 0; index < ENEMY_POOL; index++) this.freeEnemyStandees.push(this.createCardStandee('guard'));
    for (let index = 0; index < BULLET_POOL; index++) this.freeBulletStandees.push(this.createBulletStandee());
    this.createArenaProps();
    this.createGrassDetails();
  }

  setPanelEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.cameras.main.setVisible(enabled);
    if (!enabled) this.hideDynamicObjects();
  }

  /** 设置菜单覆盖主画面时暂时收起第三人称视口；关闭后回到暂停前的同一帧。 */
  setPanelPaused(paused: boolean): void {
    this.cameras.main.setVisible(this.enabled && !paused);
  }

  update(_time: number, delta: number): void {
    const main = this.scene.get('MainScene') as MainScene | null;
    if (!this.enabled || !main || main.isGamePaused || !main.conductor?.started || main.isTitleScreen) {
      this.cameras.main.setVisible(false);
      this.hideDynamicObjects();
      return;
    }

    this.cameras.main.setVisible(true);
    const player = main.player;
    const angle = player.rawAimAngle;
    const cameraX = player.x - Math.cos(angle) * CAMERA_BACK;
    const cameraY = player.y - Math.sin(angle) * CAMERA_BACK;
    const conductor = main.conductor;
    const remain = conductor.timeToNextBeat(conductor.now()) / conductor.beatDur;
    this.beatRing.setVisible(true).setScale(0.45 + remain * 0.7).setAlpha(remain < 0.25 ? 0.95 : 0.4);
    this.compass.setText(`第三人称 · ${Math.round(Phaser.Math.RadToDeg(angle))}°`);

    this.updateSky(delta);
    this.drawWorldTerrain(cameraX, cameraY, angle);
    this.drawPlayer(main, cameraX, cameraY, angle);
    this.drawArenaProps(cameraX, cameraY, angle);
    this.drawEnemies(main, cameraX, cameraY, angle);
    this.drawBullets(main, cameraX, cameraY, angle);
  }

  private createStorybookBackdrop(): void {
    this.add.rectangle(PANEL_W / 2, PANEL_H / 2, PANEL_W, PANEL_H, 0x315f67).setDepth(-20000);
    const sky = this.add.graphics().setDepth(-19990);
    sky.fillGradientStyle(0x2c6870, 0x2c6870, 0xa7d6bd, 0xa7d6bd, 1, 1, 1, 1);
    sky.fillRect(0, 0, PANEL_W, HORIZON_Y + 34);
    sky.fillStyle(0xeef8dd, 0.08);
    sky.fillEllipse(PANEL_W * 0.28, 98, 540, 118);
    sky.fillEllipse(PANEL_W * 0.82, 126, 440, 92);
    sky.fillStyle(0x204b53, 0.5);
    sky.fillRect(0, HORIZON_Y - 8, PANEL_W, 16);

    this.createSkyDecorations();

    this.terrainGfx = this.add.graphics().setDepth(-15000);

    const frame = this.add.graphics().setDepth(9000);
    frame.lineStyle(28, 0x17383d, 0.2);
    frame.strokeRect(0, 0, PANEL_W, PANEL_H);
    this.add
      .rectangle(PANEL_W / 2, PANEL_H / 2, PANEL_W - 4, PANEL_H - 4)
      .setStrokeStyle(4, 0xf6f1df, 0.9)
      .setFillStyle(0, 0)
      .setDepth(10000);
    this.add
      .text(24, 20, '立体绘本舞台 · 固定世界', {
        fontFamily: 'Arial',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#fffdf0',
        stroke: '#31565a',
        strokeThickness: 5
      })
      .setDepth(10001);
    this.compass = this.add
      .text(PANEL_W / 2, 20, '第三人称', {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: '#fffdf0',
        stroke: '#31565a',
        strokeThickness: 5
      })
      .setOrigin(0.5, 0)
      .setDepth(10001);
    this.beatRing = this.add.circle(PANEL_W / 2, PANEL_H - 72, 42).setStrokeStyle(4, 0xffffff, 0.8).setDepth(10001);
  }

  private createSkyDecorations(): void {
    const addDrifter = (
      texture: string,
      x: number,
      y: number,
      width: number,
      alpha: number,
      velocityX: number,
      bobAmount: number,
      bobSpeed: number,
      phase: number,
      depth: number,
      flipX = false
    ): void => {
      const source = this.textures.get(texture).getSourceImage();
      const image = this.add
        .image(x, y, texture)
        .setDisplaySize(width, (width / source.width) * source.height)
        .setAlpha(alpha)
        .setFlipX(flipX)
        .setDepth(depth);
      this.skyDrifters.push({
        image,
        velocityX,
        baseY: y,
        bobAmount,
        bobSpeed,
        phase,
        wrapPadding: image.displayWidth * 0.55
      });
    };

    // 三层天空剪纸：远云最淡，近云和飞鸟速度略快，保留明显的空间层次。
    addDrifter('storybook-cloud-wide', 220, 112, 330, 0.68, 3.5, 3, 0.28, 0.4, -19978);
    addDrifter('storybook-cloud-medium', 720, 88, 220, 0.78, 5.5, 4, 0.34, 2.2, -19976, true);
    addDrifter('storybook-cloud-wisp', 1080, 148, 250, 0.56, 8, 3, 0.42, 4.6, -19974);
    addDrifter('storybook-bird-flock', 910, 104, 112, 0.9, -20, 5, 1.15, 0.8, -19968, true);
    addDrifter('storybook-bird-pair', 430, 156, 92, 0.86, 25, 6, 1.35, 3.1, -19966);

    const addMeteor = (
      delay: number,
      duration: number,
      startX: number,
      startY: number,
      travelX: number,
      travelY: number,
      width: number,
      alpha: number
    ): void => {
      const source = this.textures.get('storybook-shooting-star').getSourceImage();
      const image = this.add
        .image(startX, startY, 'storybook-shooting-star')
        .setDisplaySize(width, (width / source.width) * source.height)
        .setAlpha(alpha)
        .setVisible(false)
        .setDepth(-19962);
      image.setData('peakAlpha', alpha);
      this.shootingStars.push({ image, delay, duration, startX, startY, travelX, travelY });
    };

    // 两道错峰流星形成偶发层次，起点和终点都在天空边缘，循环时不会突兀跳变。
    addMeteor(0, 2.2, 1240, -5, -520, 230, 210, 0.96);
    addMeteor(3.2, 1.9, 920, -8, -370, 180, 160, 0.82);
  }

  private updateSky(delta: number): void {
    const deltaSeconds = Math.min(delta, 50) / 1000;
    this.skyElapsed += deltaSeconds;

    for (const drifter of this.skyDrifters) {
      drifter.image.x += drifter.velocityX * deltaSeconds;
      if (drifter.velocityX > 0 && drifter.image.x > PANEL_W + drifter.wrapPadding) {
        drifter.image.x = -drifter.wrapPadding;
      } else if (drifter.velocityX < 0 && drifter.image.x < -drifter.wrapPadding) {
        drifter.image.x = PANEL_W + drifter.wrapPadding;
      }
      drifter.image.y = drifter.baseY + Math.sin(this.skyElapsed * drifter.bobSpeed + drifter.phase) * drifter.bobAmount;
    }

    const meteorCycle = 6.4;
    for (const meteor of this.shootingStars) {
      const phase = Phaser.Math.Wrap(this.skyElapsed - meteor.delay, 0, meteorCycle);
      const active = phase < meteor.duration;
      meteor.image.setVisible(active);
      if (!active) continue;

      const progress = phase / meteor.duration;
      const edgeFade = Math.min(progress / 0.12, (1 - progress) / 0.22, 1);
      meteor.image
        .setPosition(meteor.startX + meteor.travelX * progress, meteor.startY + meteor.travelY * progress)
        .setAlpha((meteor.image.getData('peakAlpha') as number) * Math.max(0, edgeFade));
    }
  }

  private createCardStandee(texture: string): CardStandee {
    const root = this.add.container(0, 0).setVisible(false);
    const shadow = this.add.ellipse(0, 0, 54, 15, 0x142c28, 0.38).setOrigin(0.18, 0.5);
    const outline = this.add.image(0, 0, texture).setOrigin(0.5, 1).setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    const art = this.add.image(0, 0, texture).setOrigin(0.5, 1);
    const shade = this.add.image(0, 0, texture).setOrigin(0.5, 1).setTint(0x173b45).setAlpha(0.18);
    const footLine = this.add.rectangle(0, 0, 32, 3, 0xf8f2d8, 0.85).setOrigin(0.5, 0.5);
    root.add([shadow, outline, shade, art, footLine]);
    return { root, shadow, outline, art, shade, footLine };
  }

  private createBulletStandee(): BulletStandee {
    const root = this.add.container(0, 0).setVisible(false);
    const shadow = this.add.ellipse(0, 4, 15, 6, 0x17372c, 0.32);
    const outline = this.add.rectangle(0, 0, 12, 12, 0xffffff);
    const core = this.add.rectangle(0, 0, 7, 7, 0x67e8f9);
    root.add([shadow, outline, core]);
    return { root, shadow, outline, core };
  }

  private createEnvironmentPanel(texture: PropTexture): EnvironmentPanel {
    const vertices = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0];
    const indices = [0, 1, 2, 0, 1, 2, 3, 0];
    const outline = this.add.mesh2d(0, 0, texture, [...vertices], indices, true).setRenderAsTriangles(true).setVisible(false) as TintedMesh2D;
    outline.tint = 0xfffdf0;
    outline.tintMode = Phaser.TintModes.FILL;
    const art = this.add.mesh2d(0, 0, texture, [...vertices], indices, true).setRenderAsTriangles(true).setVisible(false) as TintedMesh2D;
    const shadow = this.add.graphics().setVisible(false);
    return { outline, art, shadow };
  }

  private createArenaProps(): void {
    const props: Array<[PropTexture, number, number, number, boolean?, number?]> = [
      // 南侧主舞台与舞台设备区。
      ['storybook-stage', 640, 660, 245, false, 0],
      ['storybook-tree', 390, 548, 158, false, Math.PI / 4],
      ['storybook-tree', 890, 548, 158, true, -Math.PI / 4],
      ['storybook-crate', 362, 586, 58, false, 0],
      ['storybook-crate', 918, 586, 58, true, 0],
      ['storybook-flowers', 248, 610, 48, false, Math.PI / 6],
      ['storybook-flowers', 1032, 610, 48, true, -Math.PI / 6],
      ['storybook-lantern', 326, 524, 74, false, 0],
      ['storybook-lantern', 954, 524, 74, false, 0],

      // 中部横向休憩广场：帐篷、长椅和花坛都与道路相连。
      ['storybook-tent', 242, 570, 112, false, Math.PI / 3],
      ['storybook-tent', 1038, 570, 112, true, -Math.PI / 3],
      ['storybook-bench', 418, 458, 58, false, Math.PI / 5],
      ['storybook-bench', 862, 458, 58, true, -Math.PI / 5],
      ['storybook-flowers', 324, 492, 44, false, Math.PI / 4],
      ['storybook-flowers', 956, 492, 44, true, -Math.PI / 4],
      ['storybook-lantern', 530, 468, 66, false, Math.PI / 8],
      ['storybook-lantern', 750, 468, 66, false, -Math.PI / 8],

      // 北侧入口花园，为转向后的视野提供完整的入口端景。
      ['storybook-pillar', 510, 104, 102, false, 0],
      ['storybook-pillar', 770, 104, 102, true, 0],
      ['storybook-tree', 126, 128, 132, false, -Math.PI / 4],
      ['storybook-tree', 1154, 128, 132, true, Math.PI / 4],
      ['storybook-lantern', 420, 158, 70, false, 0],
      ['storybook-lantern', 860, 158, 70, false, 0],
      ['storybook-bench', 292, 178, 52, false, -Math.PI / 5],
      ['storybook-bench', 988, 178, 52, true, Math.PI / 5],
      ['storybook-flowers', 560, 142, 40, false, 0],
      ['storybook-flowers', 720, 142, 40, true, 0]
    ];
    for (const [texture, x, y, height, flipX = false, facing = 0] of props) this.addArenaProp(texture, x, y, height, flipX, facing);
  }

  private addArenaProp(texture: PropTexture, x: number, y: number, worldHeight: number, flipX: boolean, facing: number): void {
    const panel = this.createEnvironmentPanel(texture);
    this.arenaProps.push({ x, y, worldHeight, texture, flipX, facing, panel });
  }

  private createGrassDetails(): void {
    for (let index = 0; index < 116; index++) {
      const point = {
        x: 58 + ((index * 137 + 41) % 1160),
        y: 38 + ((index * 83 + 29) % 620)
      };
      if (!this.isHardscape(point.x, point.y)) this.grassDetails.push(point);
    }
  }

  private isHardscape(x: number, y: number): boolean {
    const centralPath = x >= 566 && x <= 714 && y >= 70 && y <= 666;
    const crossPath = x >= 166 && x <= 1114 && y >= 382 && y <= 482;
    const stageApron = x >= 278 && x <= 1002 && y >= 548 && y <= 674;
    const northPlaza = x >= 430 && x <= 850 && y >= 62 && y <= 190;
    return centralPath || crossPath || stageApron || northPlaza;
  }

  private drawWorldTerrain(cameraX: number, cameraY: number, angle: number): void {
    this.terrainGfx.clear();

    // Arena turf is a real world polygon; the apparent movement is entirely camera parallax.
    this.drawWorldPolygon(cameraX, cameraY, angle, [
      { x: 36, y: 12 },
      { x: 1244, y: 12 },
      { x: 1244, y: 696 },
      { x: 36, y: 696 }
    ], 0x5d913f, 1, 0xc9e2a3, 4, 0.62);

    // Layered lawn beds keep the grass from reading as one flat green plane.
    this.drawWorldRect(cameraX, cameraY, angle, 56, 34, 344, 302, 0x477f3d, 0.78);
    this.drawWorldRect(cameraX, cameraY, angle, 880, 34, 344, 302, 0x477f3d, 0.78);
    this.drawWorldRect(cameraX, cameraY, angle, 62, 510, 292, 166, 0x4d8439, 0.9);
    this.drawWorldRect(cameraX, cameraY, angle, 926, 510, 292, 166, 0x4d8439, 0.9);

    // Paths and connected plazas establish a readable concert-park layout.
    this.drawWorldRect(cameraX, cameraY, angle, 558, 60, 164, 616, 0x7b9472, 1);
    this.drawWorldRect(cameraX, cameraY, angle, 570, 60, 140, 616, 0xd9d9b8, 1);
    this.drawWorldRect(cameraX, cameraY, angle, 154, 374, 972, 116, 0x7b9472, 1);
    this.drawWorldRect(cameraX, cameraY, angle, 166, 386, 948, 92, 0xc9d3ad, 1);
    this.drawWorldRect(cameraX, cameraY, angle, 266, 536, 748, 144, 0x6c8770, 1);
    this.drawWorldRect(cameraX, cameraY, angle, 278, 548, 724, 120, 0xe4ddbd, 1);
    this.drawWorldRect(cameraX, cameraY, angle, 418, 50, 444, 150, 0x718b72, 1);
    this.drawWorldRect(cameraX, cameraY, angle, 430, 62, 420, 126, 0xd7d9ba, 1);

    // The stage throws a broad connected shadow onto its apron; warm pools from
    // fixed lanterns and stage lamps break the flat ground into light zones.
    this.drawWorldPolygon(cameraX, cameraY, angle, [
      { x: 282, y: 646 },
      { x: 998, y: 646 },
      { x: 936, y: 606 },
      { x: 344, y: 606 }
    ], 0x183638, 0.34);
    this.drawWorldEllipse(cameraX, cameraY, angle, 640, 574, 330, 94, 0x9df7d9, 0.1);
    for (const point of [
      { x: 326, y: 524 },
      { x: 954, y: 524 },
      { x: 530, y: 468 },
      { x: 750, y: 468 },
      { x: 420, y: 158 },
      { x: 860, y: 158 }
    ]) {
      this.drawWorldEllipse(cameraX, cameraY, angle, point.x, point.y, 62, 42, 0xcffff0, 0.1);
    }

    // Mosaic inlays tie the paths back to the reference stage's crafted geometry.
    for (let y = 104; y <= 638; y += 72) {
      this.drawWorldRect(cameraX, cameraY, angle, 626, y, 28, 28, 0x79c9be, 0.8);
      this.drawWorldRect(cameraX, cameraY, angle, 632, y + 6, 16, 16, 0xf0eed1, 0.92);
    }
    for (let x = 222; x <= 1058; x += 92) {
      this.drawWorldRect(cameraX, cameraY, angle, x, 423, 22, 22, 0x6fb7aa, 0.72);
    }

    // Fixed grass marks reinforce parallax and the ground contact of every standee.
    for (let index = 0; index < this.grassDetails.length; index++) {
      const detail = this.projectGroundPoint(cameraX, cameraY, angle, this.grassDetails[index]);
      if (!detail) continue;
      const size = Phaser.Math.Clamp((11 * FOCAL) / detail.forward, 1, 8);
      this.terrainGfx.lineStyle(Math.max(1, size * 0.32), index % 3 === 0 ? 0xdaf0ad : 0x93c86e, 0.58);
      this.terrainGfx.lineBetween(detail.x - size, detail.y, detail.x, detail.y - size * 0.8);
      this.terrainGfx.lineBetween(detail.x, detail.y - size * 0.8, detail.x + size * 0.65, detail.y);
    }
  }

  private drawWorldRect(
    cameraX: number,
    cameraY: number,
    angle: number,
    x: number,
    y: number,
    width: number,
    height: number,
    color: number,
    alpha: number
  ): void {
    this.drawWorldPolygon(cameraX, cameraY, angle, [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height }
    ], color, alpha);
  }

  private drawWorldEllipse(
    cameraX: number,
    cameraY: number,
    angle: number,
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    color: number,
    alpha: number
  ): void {
    const points: WorldPoint[] = [];
    for (let index = 0; index < 20; index++) {
      const theta = (index / 20) * Math.PI * 2;
      points.push({ x: centerX + Math.cos(theta) * radiusX, y: centerY + Math.sin(theta) * radiusY });
    }
    this.drawWorldPolygon(cameraX, cameraY, angle, points, color, alpha);
  }

  private drawWorldPolygon(
    cameraX: number,
    cameraY: number,
    angle: number,
    points: WorldPoint[],
    color: number,
    alpha: number,
    strokeColor?: number,
    strokeWidth = 0,
    strokeAlpha = 1
  ): void {
    let cameraPoints = points.map((point) => this.toCameraPoint(cameraX, cameraY, angle, point.x, point.y));
    cameraPoints = this.clipCameraPolygon(cameraPoints, (point) => point.forward - NEAR_CLIP);
    cameraPoints = this.clipCameraPolygon(cameraPoints, (point) => point.forward * HALF_FOV_TAN - point.side);
    cameraPoints = this.clipCameraPolygon(cameraPoints, (point) => point.forward * HALF_FOV_TAN + point.side);
    if (cameraPoints.length < 3) return;
    const screenPoints = cameraPoints.map(
      (point) => new Phaser.Math.Vector2(PANEL_W / 2 + (point.side * FOCAL) / point.forward, HORIZON_Y + (EYE_HEIGHT * FOCAL) / point.forward)
    );
    this.terrainGfx.fillStyle(color, alpha);
    this.terrainGfx.fillPoints(screenPoints, true);
    if (strokeColor !== undefined && strokeWidth > 0) {
      this.terrainGfx.lineStyle(strokeWidth, strokeColor, strokeAlpha);
      this.terrainGfx.strokePoints(screenPoints, true);
    }
  }

  private clipCameraPolygon(points: CameraPoint[], signedDistance: (point: CameraPoint) => number): CameraPoint[] {
    if (points.length === 0) return points;
    const result: CameraPoint[] = [];
    for (let index = 0; index < points.length; index++) {
      const current = points[index];
      const previous = points[(index + points.length - 1) % points.length];
      const currentDistance = signedDistance(current);
      const previousDistance = signedDistance(previous);
      const currentInside = currentDistance >= 0;
      const previousInside = previousDistance >= 0;
      if (currentInside !== previousInside) {
        const ratio = previousDistance / (previousDistance - currentDistance);
        result.push({
          forward: Phaser.Math.Linear(previous.forward, current.forward, ratio),
          side: Phaser.Math.Linear(previous.side, current.side, ratio)
        });
      }
      if (currentInside) result.push(current);
    }
    return result;
  }

  private toCameraPoint(cameraX: number, cameraY: number, angle: number, x: number, y: number): CameraPoint {
    const dx = x - cameraX;
    const dy = y - cameraY;
    return {
      forward: dx * Math.cos(angle) + dy * Math.sin(angle),
      side: -dx * Math.sin(angle) + dy * Math.cos(angle)
    };
  }

  private projectGroundPoint(cameraX: number, cameraY: number, angle: number, point: WorldPoint): (WorldPoint & { forward: number }) | null {
    const cameraPoint = this.toCameraPoint(cameraX, cameraY, angle, point.x, point.y);
    if (cameraPoint.forward < NEAR_CLIP || Math.abs(cameraPoint.side) > cameraPoint.forward * HALF_FOV_TAN) return null;
    return {
      x: PANEL_W / 2 + (cameraPoint.side * FOCAL) / cameraPoint.forward,
      y: HORIZON_Y + (EYE_HEIGHT * FOCAL) / cameraPoint.forward,
      forward: cameraPoint.forward
    };
  }

  private project(cameraX: number, cameraY: number, angle: number, tx: number, ty: number, worldW: number, worldH: number): Projected | null {
    const cameraPoint = this.toCameraPoint(cameraX, cameraY, angle, tx, ty);
    if (cameraPoint.forward < NEAR_CLIP || Math.abs(Math.atan2(cameraPoint.side, cameraPoint.forward)) > FOV / 2 + 0.18) return null;
    const dx = tx - cameraX;
    const dy = ty - cameraY;
    return {
      screenX: PANEL_W / 2 + (cameraPoint.side * FOCAL) / cameraPoint.forward,
      bottomY: HORIZON_Y + (EYE_HEIGHT * FOCAL) / cameraPoint.forward,
      width: (worldW * FOCAL) / cameraPoint.forward,
      height: (worldH * FOCAL) / cameraPoint.forward,
      dist: Math.hypot(dx, dy),
      depth: cameraPoint.forward
    };
  }

  private drawPlayer(main: MainScene, cameraX: number, cameraY: number, angle: number): void {
    const visual = main.player.go;
    const size = this.getTextureWorldSize(visual.texture.key, visual.displayHeight);
    const projected = this.project(cameraX, cameraY, angle, main.player.x, main.player.y, size.width, size.height);
    if (!projected) {
      this.playerStandee.root.setVisible(false);
      return;
    }
    this.applyCardProjection(this.playerStandee, projected, visual.texture.key, true, visual.flipX, 1, 0.95);
  }

  private drawArenaProps(cameraX: number, cameraY: number, angle: number): void {
    for (const prop of this.arenaProps) {
      const size = this.getTextureWorldSize(prop.texture, prop.worldHeight);
      const projected = this.projectFixedPanel(cameraX, cameraY, angle, prop, size.width, size.height);
      if (!projected) continue;
      const lightAmount = this.getWorldLightAmount(prop.x, prop.y);
      this.applyEnvironmentPanel(prop, projected, lightAmount);
    }
  }

  private projectFixedPanel(
    cameraX: number,
    cameraY: number,
    angle: number,
    prop: EnvironmentStandee,
    worldWidth: number,
    worldHeight: number
  ): { vertices: number[]; depth: number; bottomCenter: WorldPoint; screenWidth: number; screenHeight: number } | null {
    const tangentX = Math.cos(prop.facing);
    const tangentY = Math.sin(prop.facing);
    const halfWidth = worldWidth / 2;
    const worldLeft = this.toCameraPoint(cameraX, cameraY, angle, prop.x - tangentX * halfWidth, prop.y - tangentY * halfWidth);
    const worldRight = this.toCameraPoint(cameraX, cameraY, angle, prop.x + tangentX * halfWidth, prop.y + tangentY * halfWidth);
    const clipped = this.clipPanelSegment(worldLeft, worldRight);
    if (!clipped) {
      prop.panel.outline.setVisible(false);
      prop.panel.art.setVisible(false);
      prop.panel.shadow.setVisible(false);
      return null;
    }

    const left = this.projectPanelCameraEdge(clipped.start, worldHeight);
    const right = this.projectPanelCameraEdge(clipped.end, worldHeight);
    const worldULeft = prop.flipX ? 1 : 0;
    const worldURight = prop.flipX ? 0 : 1;
    const uLeft = Phaser.Math.Linear(worldULeft, worldURight, clipped.startT);
    const uRight = Phaser.Math.Linear(worldULeft, worldURight, clipped.endT);
    const vertices = [
      left.bottom.x, left.bottom.y, uLeft, 1,
      right.bottom.x, right.bottom.y, uRight, 1,
      left.top.x, left.top.y, uLeft, 0,
      right.top.x, right.top.y, uRight, 0
    ];
    return {
      vertices,
      depth: (left.depth + right.depth) / 2,
      bottomCenter: { x: (left.bottom.x + right.bottom.x) / 2, y: (left.bottom.y + right.bottom.y) / 2 },
      screenWidth: Phaser.Math.Distance.Between(left.bottom.x, left.bottom.y, right.bottom.x, right.bottom.y),
      screenHeight: (Phaser.Math.Distance.Between(left.bottom.x, left.bottom.y, left.top.x, left.top.y) +
        Phaser.Math.Distance.Between(right.bottom.x, right.bottom.y, right.top.x, right.top.y)) / 2
    };
  }

  /**
   * 裁剪固定纸片的可见线段，而不是要求左右端点同时位于视锥内。
   * 大舞台或近景纸片掠过画面边缘时会连续保留屏内部分，不再整张跳隐。
   */
  private clipPanelSegment(
    start: CameraPoint,
    end: CameraPoint
  ): { start: CameraPoint; end: CameraPoint; startT: number; endT: number } | null {
    let startT = 0;
    let endT = 1;
    const sideLimit = HALF_FOV_TAN * 1.22;
    const planes = [
      (point: CameraPoint): number => point.forward - NEAR_CLIP,
      (point: CameraPoint): number => point.forward * sideLimit - point.side,
      (point: CameraPoint): number => point.forward * sideLimit + point.side
    ];

    for (const signedDistance of planes) {
      const startDistance = signedDistance(start);
      const endDistance = signedDistance(end);
      if (startDistance < 0 && endDistance < 0) return null;
      if (startDistance >= 0 && endDistance >= 0) continue;

      const intersectionT = startDistance / (startDistance - endDistance);
      if (startDistance < 0) startT = Math.max(startT, intersectionT);
      else endT = Math.min(endT, intersectionT);
      if (startT >= endT) return null;
    }

    return {
      start: {
        forward: Phaser.Math.Linear(start.forward, end.forward, startT),
        side: Phaser.Math.Linear(start.side, end.side, startT)
      },
      end: {
        forward: Phaser.Math.Linear(start.forward, end.forward, endT),
        side: Phaser.Math.Linear(start.side, end.side, endT)
      },
      startT,
      endT
    };
  }

  private projectPanelCameraEdge(point: CameraPoint, height: number): { bottom: WorldPoint; top: WorldPoint; depth: number } {
    const screenX = PANEL_W / 2 + (point.side * FOCAL) / point.forward;
    const bottomY = HORIZON_Y + (EYE_HEIGHT * FOCAL) / point.forward;
    const topY = bottomY - (height * FOCAL) / point.forward;
    return { bottom: { x: screenX, y: bottomY }, top: { x: screenX, y: topY }, depth: point.forward };
  }

  private applyEnvironmentPanel(
    prop: EnvironmentStandee,
    projected: { vertices: number[]; depth: number; bottomCenter: WorldPoint; screenWidth: number; screenHeight: number },
    lightAmount: number
  ): void {
    const outline = prop.panel.outline;
    const art = prop.panel.art;
    const shadow = prop.panel.shadow;
    const outlineVertices = [...projected.vertices];
    const expand = Phaser.Math.Clamp(CARD_OUTLINE_PX * (520 / Math.max(projected.depth, 160)), 2, 7);
    const centerX = projected.bottomCenter.x;
    outlineVertices[0] += Math.sign(outlineVertices[0] - centerX || -1) * expand;
    outlineVertices[4] += Math.sign(outlineVertices[4] - centerX || 1) * expand;
    outlineVertices[8] += Math.sign(outlineVertices[8] - centerX || -1) * expand;
    outlineVertices[12] += Math.sign(outlineVertices[12] - centerX || 1) * expand;
    outlineVertices[9] -= expand;
    outlineVertices[13] -= expand;
    outlineVertices[1] += expand * 0.2;
    outlineVertices[5] += expand * 0.2;

    outline.vertices = outlineVertices;
    art.vertices = projected.vertices;
    const bottomLeft = { x: projected.vertices[0], y: projected.vertices[1] };
    const bottomRight = { x: projected.vertices[4], y: projected.vertices[5] };
    const edgeX = bottomRight.x - bottomLeft.x;
    const edgeY = bottomRight.y - bottomLeft.y;
    const edgeLength = Math.max(2, Math.hypot(edgeX, edgeY));
    const normalX = -edgeY / edgeLength;
    const normalY = edgeX / edgeLength;
    const cast = Phaser.Math.Clamp(projected.screenHeight * 0.26, 8, 54);
    const castDirection = normalY >= 0 ? 1 : -1;
    const castX = normalX * cast * castDirection + cast * 0.35;
    const castY = Math.abs(normalY) * cast + cast * 0.24;
    shadow
      .clear()
      .fillStyle(0x173733, Phaser.Math.Clamp(0.24 + (1 - lightAmount) * 0.18, 0.24, 0.42))
      .fillPoints([
        new Phaser.Math.Vector2(bottomLeft.x, bottomLeft.y),
        new Phaser.Math.Vector2(bottomRight.x, bottomRight.y),
        new Phaser.Math.Vector2(bottomRight.x + castX, bottomRight.y + castY),
        new Phaser.Math.Vector2(bottomLeft.x + castX, bottomLeft.y + castY)
      ], true)
      .setVisible(true)
      .setDepth(-projected.depth - 0.03);
    outline.setVisible(true).setDepth(-projected.depth - 0.01);
    art.setVisible(true).setDepth(-projected.depth);
    art.tint = this.getPanelTint(lightAmount);
  }

  private getPanelTint(lightAmount: number): number {
    const value = Math.round(Phaser.Math.Linear(190, 255, lightAmount));
    const green = Math.round(Phaser.Math.Linear(204, 255, lightAmount));
    return (value << 16) | (green << 8) | value;
  }

  private drawEnemies(main: MainScene, cameraX: number, cameraY: number, angle: number): void {
    const seen = new Set<Enemy>();
    for (const enemy of main.fpvEnemies) {
      if (enemy.dead) continue;
      seen.add(enemy);
      const visual = enemy.go as Phaser.GameObjects.Sprite;
      const size = this.getTextureWorldSize(visual.texture.key, visual.displayHeight);
      const projected = this.project(cameraX, cameraY, angle, enemy.x, enemy.y, size.width, size.height);
      let standee = this.enemyBillboards.get(enemy);
      if (!projected) {
        standee?.root.setVisible(false);
        continue;
      }
      if (!standee) {
        standee = this.freeEnemyStandees.pop();
        if (!standee) continue;
        this.enemyBillboards.set(enemy, standee);
      }
      this.applyCardProjection(standee, projected, visual.texture.key, false, visual.flipX, 1, this.getWorldLightAmount(enemy.x, enemy.y));
    }
    for (const [enemy, standee] of [...this.enemyBillboards]) {
      if (seen.has(enemy)) continue;
      standee.root.setVisible(false);
      this.enemyBillboards.delete(enemy);
      this.freeEnemyStandees.push(standee);
    }
  }

  private applyCardProjection(
    standee: CardStandee,
    projected: Projected,
    texture: string,
    isPlayer: boolean,
    flipX: boolean,
    viewCompression = 1,
    lightAmount = 0.75
  ): void {
    const visibleWidth = Math.max(4, projected.width * viewCompression);
    const visibleHeight = Math.max(8, projected.height);
    standee.root.setVisible(true).setPosition(projected.screenX, projected.bottomY).setDepth(-projected.depth + (isPlayer ? 0.2 : 0));
    standee.art.setTexture(texture).setFlipX(flipX).setDisplaySize(visibleWidth, visibleHeight);
    standee.outline
      .setTexture(texture)
      .setFlipX(flipX)
      .setDisplaySize(Math.max(7, visibleWidth + CARD_OUTLINE_PX * 2), Math.max(11, visibleHeight + CARD_OUTLINE_PX * 2));
    standee.shade
      .setTexture(texture)
      .setFlipX(flipX)
      .setDisplaySize(visibleWidth, visibleHeight)
      .setAlpha(Phaser.Math.Clamp(0.3 - lightAmount * 0.2, 0.06, 0.23));
    standee.art.setAlpha(Phaser.Math.Clamp(0.82 + lightAmount * 0.18, 0.82, 1));
    standee.footLine.setDisplaySize(Math.max(7, visibleWidth * 0.54), Phaser.Math.Clamp(visibleHeight * 0.018, 2, 5));
    this.applyGroundShadow(standee, projected, viewCompression, false, 1, lightAmount);
  }

  private applyGroundShadow(
    standee: CardStandee,
    projected: Projected,
    viewCompression: number,
    isStage: boolean,
    direction: number,
    lightAmount: number
  ): void {
    const baseWidth = Math.max(12, projected.width * viewCompression);
    const shadowLength = isStage ? baseWidth * 0.32 : Phaser.Math.Clamp(projected.height * 0.34, 12, baseWidth * 0.9);
    const shadowHeight = isStage ? Math.max(5, projected.height * 0.055) : Phaser.Math.Clamp(projected.height * 0.1, 4, 20);
    standee.shadow
      .setOrigin(direction > 0 ? 0.12 : 0.88, 0.5)
      .setPosition(direction * baseWidth * 0.04, 0)
      .setRotation(direction * -0.1)
      .setDisplaySize(Math.max(baseWidth * (isStage ? 0.84 : 0.42), shadowLength), shadowHeight)
      .setAlpha(Phaser.Math.Clamp((isStage ? 0.34 : 0.3) + (1 - lightAmount) * 0.16, 0.25, 0.48));
  }

  private getWorldLightAmount(x: number, y: number): number {
    const stageDistance = Phaser.Math.Distance.Between(x, y, LIGHT_X, LIGHT_Y);
    const stageLight = Phaser.Math.Clamp(1 - stageDistance / 620, 0, 1);
    const centerFill = Phaser.Math.Clamp(1 - Phaser.Math.Distance.Between(x, y, 640, 390) / 520, 0, 1);
    return Phaser.Math.Clamp(0.38 + stageLight * 0.46 + centerFill * 0.18, 0.38, 1);
  }

  /** 只做统一透视缩放；宽度始终由素材原始纵横比和目标世界高度推导。 */
  private getTextureWorldSize(texture: string, worldHeight: number): { width: number; height: number } {
    const frame = this.textures.getFrame(texture);
    const sourceWidth = frame?.realWidth ?? 1;
    const sourceHeight = frame?.realHeight ?? 1;
    return { width: worldHeight * (sourceWidth / sourceHeight), height: worldHeight };
  }

  private drawBullets(main: MainScene, cameraX: number, cameraY: number, angle: number): void {
    const seen = new Set<Phaser.GameObjects.GameObject>();
    for (const group of [main.fpvEnemyBullets, main.fpvPlayerBullets]) {
      for (const object of group) {
        const bullet = object as Phaser.GameObjects.Rectangle;
        if (!bullet.active) continue;
        seen.add(bullet);
        const projected = this.project(cameraX, cameraY, angle, bullet.x, bullet.y, bullet.displayWidth, Math.max(10, bullet.displayHeight));
        let standee = this.bulletBillboards.get(bullet);
        if (!projected) {
          standee?.root.setVisible(false);
          continue;
        }
        if (!standee) {
          standee = this.freeBulletStandees.pop();
          if (!standee) continue;
          this.bulletBillboards.set(bullet, standee);
        }
        const size = Phaser.Math.Clamp(Math.max(projected.width, projected.height), 5, 32);
        standee.root.setVisible(true).setPosition(projected.screenX, projected.bottomY - size * 0.45).setDepth(-projected.depth + 0.1);
        standee.outline.setDisplaySize(size + 7, size + 7);
        standee.core.setDisplaySize(size, size).setFillStyle(bullet.fillColor);
        standee.shadow.setPosition(0, size * 0.55).setDisplaySize(size * 1.25, size * 0.38);
      }
    }
    for (const [bullet, standee] of [...this.bulletBillboards]) {
      if (seen.has(bullet)) continue;
      standee.root.setVisible(false);
      this.bulletBillboards.delete(bullet);
      this.freeBulletStandees.push(standee);
    }
  }

  private hideDynamicObjects(): void {
    this.beatRing?.setVisible(false);
    this.playerStandee?.root.setVisible(false);
    this.terrainGfx?.clear();
    for (const prop of this.arenaProps) {
      prop.panel.outline.setVisible(false);
      prop.panel.art.setVisible(false);
      prop.panel.shadow.setVisible(false);
    }
    for (const standee of this.enemyBillboards.values()) standee.root.setVisible(false);
    for (const standee of this.bulletBillboards.values()) standee.root.setVisible(false);
  }
}
