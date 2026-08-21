import Phaser from 'phaser';
import type { Conductor } from '../core/Conductor';
import type { BeatKey } from './weapons';
import { MAIN_CAMERA_BASE_ZOOM, screenLayerOffset } from './cameraConfig';
import { UI_SCALE, VIEW_HEIGHT, VIEW_WIDTH } from './displayConfig';

const BAR_CENTER_X = 640;
const BAR_Y = 668;
const PANEL_WIDTH = 780;
/** 第一关 Combo / 武器框按最新黄框目标独立摆放；内容仍全部读取运行时状态。 */
const COMBO_PANEL_X = 510;
const COMBO_PANEL_Y = 594;
const COMBO_PANEL_WIDTH = 268;
const COMBO_PANEL_HEIGHT = 42;
/** 底部 Combo / 武器组保持像素细条高度，同时横向覆盖两侧石子之间的目标区。 */
const COMBO_PANEL_SCALE = 0.87;
const METER_RADIUS = 16;
type StatusPanelLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  meterRadius: number;
};

const TUTORIAL_STATUS_PANEL: StatusPanelLayout = {
  x: COMBO_PANEL_X,
  y: COMBO_PANEL_Y,
  width: COMBO_PANEL_WIDTH,
  height: COMBO_PANEL_HEIGHT,
  scale: COMBO_PANEL_SCALE,
  meterRadius: METER_RADIUS
};

const FORMAL_STATUS_PANEL: StatusPanelLayout = {
  x: 447,
  y: 651,
  width: 278,
  height: COMBO_PANEL_HEIGHT,
  scale: COMBO_PANEL_SCALE,
  meterRadius: METER_RADIUS
};

function statusCenterX(layout: StatusPanelLayout): number {
  return layout.x + layout.width / 2;
}

function statusCenterY(layout: StatusPanelLayout): number {
  return layout.y + layout.height / 2;
}

function statusMeterX(layout: StatusPanelLayout): number {
  return layout.x + layout.width * 0.25;
}

function statusMeterY(layout: StatusPanelLayout): number {
  return statusCenterY(layout);
}

function statusWeaponX(layout: StatusPanelLayout): number {
  return layout.x + layout.width * 0.75;
}
const STATE_X = BAR_CENTER_X + 400;
/** Wave 文本移到四拍原来的上方位置；下移后的四拍不会与其重叠。 */
const WAVE_X = 600;
const WAVE_Y = 19;
const COMBO_LABEL_Y = statusCenterY(FORMAL_STATUS_PANEL) - 12;
/** 角色头顶血条使用世界单位；最终屏幕足迹约为 153 × 53px。 */
const PLAYER_HP_FRAME_WIDTH = 144;
const PLAYER_HP_FRAME_HEIGHT = 50;
const PLAYER_HP_BAR_WIDTH = 128;
const PLAYER_HP_OFFSET_Y = 80;
const HUD_FRAME_COLOR = 0x426764;
const HUD_DARK_FRAME_COLOR = 0x284946;
const HUD_SHADOW_COLOR = 0x1f3a38;
const HUD_PANEL_COLOR = 0xcfdcb8;
const HUD_PANEL_PINK = 0xf0c9df;
const HUD_PANEL_PINK_LIGHT = 0xffe9f5;
const HUD_PANEL_PINK_DARK = 0x6b4b78;
const HUD_PANEL_PINK_SHADOW = 0x3f3154;
const COMBO_METER_PROGRESS_COLOR = 0x49c9c8;
const FORMAL_HUD_TEXT_COLOR = '#4f3b63';
const HUD_TEXT_COLOR = '#315d5a';
const HUD_MUTED_TEXT_COLOR = '#416965';
const HUD_FONT = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';

function fillHudPixelPanelPath(
  gfx: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  step: number
): void {
  const s = Math.max(2, step);
  const s2 = s * 2;
  gfx.beginPath();
  gfx.moveTo(x + s2, y);
  gfx.lineTo(x + width - s2, y);
  gfx.lineTo(x + width - s2, y + s);
  gfx.lineTo(x + width - s, y + s);
  gfx.lineTo(x + width - s, y + s2);
  gfx.lineTo(x + width, y + s2);
  gfx.lineTo(x + width, y + height - s2);
  gfx.lineTo(x + width - s, y + height - s2);
  gfx.lineTo(x + width - s, y + height - s);
  gfx.lineTo(x + width - s2, y + height - s);
  gfx.lineTo(x + width - s2, y + height);
  gfx.lineTo(x + s2, y + height);
  gfx.lineTo(x + s2, y + height - s);
  gfx.lineTo(x + s, y + height - s);
  gfx.lineTo(x + s, y + height - s2);
  gfx.lineTo(x, y + height - s2);
  gfx.lineTo(x, y + s2);
  gfx.lineTo(x + s, y + s2);
  gfx.lineTo(x + s, y + s);
  gfx.lineTo(x + s2, y + s);
  gfx.closePath();
}
/** 预览未来 3 拍（旧版 2 拍的 1.5 倍），相邻拍间距 120px；到达中心即拍点。 */
const LOOKAHEAD_BEATS = 3;
const NOTE_SPACING = 120;
const TRAVEL_DIST = LOOKAHEAD_BEATS * NOTE_SPACING;

interface NoteView {
  left: Phaser.GameObjects.Shape;
  right: Phaser.GameObjects.Shape;
  consumed: boolean;
}

interface MeasureDividerView {
  left: Phaser.GameObjects.Container;
  right: Phaser.GameObjects.Container;
}

/**
 * 战斗 HUD：
 * 判定条为单中心点样式——节奏块（○轻 ◆重）从两侧向中心移动，汇聚到中心点的瞬间即拍点。
 * 另含 ComboMeter 圆环（Fever 倒计时）、HP 条、波次/状态文本。
 */
export class HUD {
  private scene: Phaser.Scene;
  private conductor: Conductor;

  private notes = new Map<number, NoteView>();
  private measureDividers = new Map<number, MeasureDividerView>();
  private pattern: BeatKey[] = ['L', 'L', 'L', 'L'];
  private weaponName = '';
  private beatGuideVisible = false;

  private centerMark: Phaser.GameObjects.Arc;
  private centerLine: Phaser.GameObjects.Line;
  private meterGfx: Phaser.GameObjects.Graphics;
  private meterText: Phaser.GameObjects.Text;
  private meterBeatRing: Phaser.GameObjects.Arc;
  private hpLabel: Phaser.GameObjects.Text;
  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBar: Phaser.GameObjects.Rectangle;
  private hpText: Phaser.GameObjects.Text;
  private waveText: Phaser.GameObjects.Text;
  private stateText: Phaser.GameObjects.Text;
  private weaponText: Phaser.GameObjects.Text;
  private messageText: Phaser.GameObjects.Text;
  private victoryText: Phaser.GameObjects.Text;
  private victoryBackdrop: Phaser.GameObjects.Rectangle;
  private panel: Phaser.GameObjects.Rectangle;
  private feverText: Phaser.GameObjects.Text;
  private feverMode = false;
  private hpBaseColor = 0xd4f2df;
  private hpPulseUntil = 0;
  private screenLayer: Phaser.GameObjects.Container;
  private formalStatusLayer: Phaser.GameObjects.Container;
  private redrawStatusChrome: (tutorialStyle: boolean) => void = () => undefined;
  private playerHpLayer: Phaser.GameObjects.Container;
  private bossHealthLayer: Phaser.GameObjects.Container;
  private bossHealthFill: Phaser.GameObjects.Rectangle;
  private bossHealthValue: Phaser.GameObjects.Text;
  private gameplayHudVisible = true;
  private tutorialComboVisible = false;
  private statusMeterX = statusMeterX(FORMAL_STATUS_PANEL);
  private statusMeterY = statusMeterY(FORMAL_STATUS_PANEL);
  private statusMeterRadius = FORMAL_STATUS_PANEL.meterRadius;
  private comboProgress = 0;
  private comboLevel = 0;
  private feverRatio = 0;

  constructor(scene: Phaser.Scene, conductor: Conductor) {
    this.scene = scene;
    this.conductor = conductor;

    // 全局 HUD 统一为参考图的像素面板：教学走浅绿系，正式关底部 HUD 走粉紫系。
    const hudChrome = scene.add.graphics().setDepth(9);
    const drawFormalFrame = (x: number, y: number, width: number, height: number): void => {
      const corner = 12;
      hudChrome.fillStyle(HUD_PANEL_PINK_SHADOW, 0.44);
      fillHudPixelPanelPath(hudChrome, x + 4, y + 4, width, height, 8);
      hudChrome.fillPath();
      hudChrome.fillStyle(HUD_PANEL_PINK, 0.9);
      fillHudPixelPanelPath(hudChrome, x, y, width, height, 8);
      hudChrome.fillPath();
      hudChrome.fillStyle(HUD_PANEL_PINK_LIGHT, 0.48);
      hudChrome.fillRect(x + 4, y + 4, width - 8, Math.max(6, Math.floor(height * 0.36)));
      hudChrome.lineStyle(4, HUD_PANEL_PINK_DARK, 0.96);
      fillHudPixelPanelPath(hudChrome, x, y, width, height, 8);
      hudChrome.strokePath();
      hudChrome.lineStyle(2, 0xfff3fb, 0.78);
      fillHudPixelPanelPath(hudChrome, x + 4, y + 4, width - 8, height - 8, 4);
      hudChrome.strokePath();
      hudChrome.fillStyle(HUD_PANEL_PINK_DARK, 0.88);
      hudChrome.fillRect(x + 12, y - 4, 8, 4);
      hudChrome.fillRect(x + width - 20, y - 4, 8, 4);
      hudChrome.fillRect(x + 12, y + height, 8, 4);
      hudChrome.fillRect(x + width - 20, y + height, 8, 4);
      hudChrome.fillRect(x - 4, y + 16, 4, 10);
      hudChrome.fillRect(x + width, y + 16, 4, 10);
      hudChrome.fillRect(x - 4, y + height - 26, 4, 10);
      hudChrome.fillRect(x + width, y + height - 26, 4, 10);
      hudChrome.lineStyle(3, 0xfff4fb, 0.9);
      hudChrome.lineBetween(x, y, x + corner, y);
      hudChrome.lineBetween(x, y, x, y + corner);
      hudChrome.lineBetween(x + width - corner, y, x + width, y);
      hudChrome.lineBetween(x + width, y, x + width, y + corner);
      hudChrome.lineBetween(x, y + height - corner, x, y + height);
      hudChrome.lineBetween(x, y + height, x + corner, y + height);
      hudChrome.lineBetween(x + width, y + height - corner, x + width, y + height);
      hudChrome.lineBetween(x + width - corner, y + height, x + width, y + height);
    };
    const drawTutorialFrame = (x: number, y: number, width: number, height: number): void => {
      const corner = 10;
      hudChrome.fillStyle(HUD_SHADOW_COLOR, 0.42);
      fillHudPixelPanelPath(hudChrome, x + 4, y + 4, width, height, 8);
      hudChrome.fillPath();
      hudChrome.fillStyle(HUD_PANEL_COLOR, 0.9);
      fillHudPixelPanelPath(hudChrome, x, y, width, height, 8);
      hudChrome.fillPath();
      hudChrome.fillStyle(0xe9f1ce, 0.42);
      hudChrome.fillRect(x + 4, y + 4, width - 8, Math.max(6, Math.floor(height * 0.36)));
      hudChrome.lineStyle(4, HUD_DARK_FRAME_COLOR, 0.96);
      fillHudPixelPanelPath(hudChrome, x, y, width, height, 8);
      hudChrome.strokePath();
      hudChrome.lineStyle(2, 0xf4f8df, 0.8);
      fillHudPixelPanelPath(hudChrome, x + 4, y + 4, width - 8, height - 8, 4);
      hudChrome.strokePath();
      hudChrome.fillStyle(HUD_DARK_FRAME_COLOR, 0.9);
      hudChrome.fillRect(x + 12, y - 4, 8, 4);
      hudChrome.fillRect(x + width - 20, y - 4, 8, 4);
      hudChrome.fillRect(x + 12, y + height, 8, 4);
      hudChrome.fillRect(x + width - 20, y + height, 8, 4);
      hudChrome.fillRect(x - 4, y + 16, 4, 10);
      hudChrome.fillRect(x + width, y + 16, 4, 10);
      hudChrome.fillRect(x - 4, y + height - 26, 4, 10);
      hudChrome.fillRect(x + width, y + height - 26, 4, 10);
      hudChrome.lineStyle(3, 0xf4f8df, 0.92);
      hudChrome.lineBetween(x, y, x + corner, y);
      hudChrome.lineBetween(x, y, x, y + corner);
      hudChrome.lineBetween(x + width - corner, y, x + width, y);
      hudChrome.lineBetween(x + width, y, x + width, y + corner);
      hudChrome.lineBetween(x, y + height - corner, x, y + height);
      hudChrome.lineBetween(x, y + height, x + corner, y + height);
      hudChrome.lineBetween(x + width, y + height - corner, x + width, y + height);
      hudChrome.lineBetween(x + width - corner, y + height, x + width, y + height);
    };

    const playerHpChrome = scene.add.graphics().setDepth(9);
    const hpLeft = -PLAYER_HP_FRAME_WIDTH / 2;
    const hpTop = -PLAYER_HP_FRAME_HEIGHT / 2;
    const hpCorner = 8;
    playerHpChrome.fillStyle(HUD_SHADOW_COLOR, 0.34);
    playerHpChrome.fillRect(hpLeft + 3, hpTop + 3, PLAYER_HP_FRAME_WIDTH, PLAYER_HP_FRAME_HEIGHT);
    playerHpChrome.fillStyle(HUD_PANEL_PINK, 0.88);
    playerHpChrome.fillRect(hpLeft, hpTop, PLAYER_HP_FRAME_WIDTH, PLAYER_HP_FRAME_HEIGHT);
    playerHpChrome.fillStyle(0xffeef7, 0.36);
    playerHpChrome.fillRect(hpLeft + 4, hpTop + 4, PLAYER_HP_FRAME_WIDTH - 8, 15);
    playerHpChrome.lineStyle(3, HUD_PANEL_PINK_DARK, 0.92);
    playerHpChrome.strokeRect(hpLeft, hpTop, PLAYER_HP_FRAME_WIDTH, PLAYER_HP_FRAME_HEIGHT);
    playerHpChrome.lineStyle(2, 0xfff5fd, 0.82);
    playerHpChrome.lineBetween(hpLeft, hpTop, hpLeft + hpCorner, hpTop);
    playerHpChrome.lineBetween(hpLeft, hpTop, hpLeft, hpTop + hpCorner);
    playerHpChrome.lineBetween(-hpLeft - hpCorner, hpTop, -hpLeft, hpTop);
    playerHpChrome.lineBetween(-hpLeft, hpTop, -hpLeft, hpTop + hpCorner);
    playerHpChrome.lineBetween(hpLeft, -hpTop - hpCorner, hpLeft, -hpTop);
    playerHpChrome.lineBetween(hpLeft, -hpTop, hpLeft + hpCorner, -hpTop);
    playerHpChrome.lineBetween(-hpLeft, -hpTop - hpCorner, -hpLeft, -hpTop);
    playerHpChrome.lineBetween(-hpLeft - hpCorner, -hpTop, -hpLeft, -hpTop);

    // 判定条背板
    this.panel = scene.add
      .rectangle(BAR_CENTER_X, BAR_Y, PANEL_WIDTH, 60, HUD_PANEL_COLOR, 0.84)
      .setStrokeStyle(3, HUD_DARK_FRAME_COLOR, 0.9)
      .setDepth(10);

    // 中心判定点
    this.centerMark = scene.add
      .circle(BAR_CENTER_X, BAR_Y, 16)
      .setStrokeStyle(3, 0xffffff, 0.9)
      .setDepth(11);
    this.centerLine = scene.add
      .line(0, 0, BAR_CENTER_X, BAR_Y - 26, BAR_CENTER_X, BAR_Y + 26, 0xffffff, 0.35)
      .setOrigin(0)
      .setDepth(10);

    this.feverText = scene.add
      .text(statusMeterX(FORMAL_STATUS_PANEL), COMBO_LABEL_Y, '', {
        fontFamily: HUD_FONT,
        fontSize: '12px',
        color: FORMAL_HUD_TEXT_COLOR,
        letterSpacing: 1,
        resolution: 2,
        shadow: { offsetX: 1, offsetY: 1, color: 'rgba(255, 239, 250, 0.62)', blur: 0, fill: true }
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setVisible(false);

    this.meterGfx = scene.add.graphics().setDepth(10);
    this.meterBeatRing = scene.add
      .circle(this.statusMeterX, this.statusMeterY, this.statusMeterRadius)
      .setStrokeStyle(2, HUD_PANEL_PINK_DARK, 0.72)
      .setFillStyle(0, 0)
      .setDepth(10);
    this.meterText = scene.add
      .text(statusMeterX(FORMAL_STATUS_PANEL), statusMeterY(FORMAL_STATUS_PANEL), '0%', {
        fontFamily: HUD_FONT,
        fontSize: '12px',
        fontStyle: 'bold',
        color: FORMAL_HUD_TEXT_COLOR,
        stroke: '#fff0fa',
        strokeThickness: 1,
        resolution: 2
      })
      .setOrigin(0.5)
      .setDepth(11);

    // HP
    this.hpLabel = scene.add
      .text(-PLAYER_HP_BAR_WIDTH / 2, -13, 'HP', {
        fontFamily: HUD_FONT,
        fontSize: '14px',
        color: HUD_TEXT_COLOR,
        letterSpacing: 1,
        resolution: 2,
        shadow: { offsetX: 1, offsetY: 1, color: 'rgba(255, 248, 238, 0.65)', blur: 0, fill: true }
      })
      .setOrigin(0, 0.5)
      .setDepth(11);
    this.hpBarBg = scene.add
      .rectangle(-PLAYER_HP_BAR_WIDTH / 2 - 2, 10, PLAYER_HP_BAR_WIDTH + 4, 16, 0x6f5482, 0.22)
      .setOrigin(0, 0.5)
      .setStrokeStyle(1, HUD_FRAME_COLOR, 0.52)
      .setDepth(10);
    this.hpBar = scene.add
      .rectangle(-PLAYER_HP_BAR_WIDTH / 2, 10, PLAYER_HP_BAR_WIDTH, 10, 0x9ee8a8)
      .setOrigin(0, 0.5)
      .setAlpha(0.9)
      .setDepth(10);
    this.hpText = scene.add
      .text(PLAYER_HP_BAR_WIDTH / 2, -13, '', {
        fontFamily: HUD_FONT,
        fontSize: '13px',
        color: HUD_MUTED_TEXT_COLOR,
        resolution: 2,
        shadow: { offsetX: 1, offsetY: 1, color: 'rgba(255, 248, 238, 0.6)', blur: 0, fill: true }
      })
      .setOrigin(1, 0.5)
      .setDepth(10);

    this.waveText = scene.add
      .text(WAVE_X, WAVE_Y, '', {
        fontFamily: HUD_FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#4f3b63',
        resolution: 2
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.weaponText = scene.add
      .text(statusWeaponX(FORMAL_STATUS_PANEL), statusMeterY(FORMAL_STATUS_PANEL), '', {
        fontFamily: HUD_FONT,
        fontSize: '20px',
        fontStyle: 'bold',
        color: FORMAL_HUD_TEXT_COLOR,
        stroke: '#fff0fa',
        strokeThickness: 1,
        letterSpacing: 1,
        resolution: 2,
        shadow: { offsetX: 1, offsetY: 1, color: 'rgba(255, 248, 238, 0.68)', blur: 0, fill: true }
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.redrawStatusChrome = (tutorialStyle: boolean): void => {
      const layout = tutorialStyle ? TUTORIAL_STATUS_PANEL : FORMAL_STATUS_PANEL;
      this.statusMeterX = statusMeterX(layout);
      this.statusMeterY = statusMeterY(layout);
      this.statusMeterRadius = layout.meterRadius;
      if (this.formalStatusLayer) {
        this.formalStatusLayer
          .setPosition(statusCenterX(layout) * (1 - layout.scale), statusCenterY(layout) * (1 - layout.scale))
          .setScale(layout.scale);
      }
      this.feverText.setPosition(this.statusMeterX, statusCenterY(layout) - 12);
      this.meterBeatRing.setPosition(this.statusMeterX, this.statusMeterY);
      this.meterBeatRing.setRadius(this.statusMeterRadius);
      this.meterText.setPosition(this.statusMeterX, this.statusMeterY);
      this.weaponText.setPosition(statusWeaponX(layout), this.statusMeterY);
      hudChrome.clear();
      if (tutorialStyle) {
        drawTutorialFrame(layout.x, layout.y, layout.width, layout.height);
      } else {
        drawFormalFrame(layout.x, layout.y, layout.width, layout.height);
      }
      hudChrome.lineStyle(2, tutorialStyle ? HUD_DARK_FRAME_COLOR : HUD_PANEL_PINK_DARK, 0.42);
      hudChrome.lineBetween(
        statusCenterX(layout),
        layout.y + 7,
        statusCenterX(layout),
        layout.y + layout.height - 7
      );
      this.meterBeatRing.setStrokeStyle(2, tutorialStyle ? HUD_DARK_FRAME_COLOR : HUD_PANEL_PINK_DARK, 0.72);
      this.meterText.setColor(tutorialStyle ? HUD_TEXT_COLOR : FORMAL_HUD_TEXT_COLOR);
      this.meterText.setStroke(tutorialStyle ? '#eff6d7' : '#fff0fa', 1);
      this.weaponText.setColor(tutorialStyle ? HUD_TEXT_COLOR : FORMAL_HUD_TEXT_COLOR);
      this.weaponText.setStroke(tutorialStyle ? '#eff6d7' : '#fff0fa', 1);
      this.redrawMeter();
    };
    this.redrawStatusChrome(false);

    this.stateText = scene.add
      .text(STATE_X, BAR_Y, '', { fontFamily: HUD_FONT, fontSize: '15px', fontStyle: 'bold', color: '#a87922', resolution: 2 })
      .setOrigin(0, 0.5)
      .setDepth(10);

    this.messageText = scene.add
      .text(640, 320, '', {
        fontFamily: HUD_FONT,
        fontSize: '52px',
        color: HUD_TEXT_COLOR,
        align: 'center',
        stroke: '#f4f2dc',
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(20);

    this.victoryBackdrop = scene.add
      .rectangle(VIEW_WIDTH / 2, UI_SCALE * 320, UI_SCALE * 430, UI_SCALE * 116, HUD_PANEL_PINK, 0.9)
      .setStrokeStyle(4, HUD_PANEL_PINK_DARK, 0.9)
      .setDepth(0.2)
      .setVisible(false);
    this.victoryText = scene.add
      .text(VIEW_WIDTH / 2, UI_SCALE * 320, 'VICTORY', {
        fontFamily: HUD_FONT,
        fontSize: `${64 * UI_SCALE}px`,
        fontStyle: 'bold',
        color: '#5b3f72',
        stroke: '#ffeaf6',
        strokeThickness: 3
      })
      .setOrigin(0.5)
      .setDepth(0.21)
      .setAlpha(0.82)
      .setVisible(false);

    // 主场景镜头会做轻微前探和拉远；用独立屏幕层抵消 scroll 与 zoom，保留旧 HUD 像素布局。
    this.formalStatusLayer = scene.add
      .container(
        statusCenterX(FORMAL_STATUS_PANEL) * (1 - FORMAL_STATUS_PANEL.scale),
        statusCenterY(FORMAL_STATUS_PANEL) * (1 - FORMAL_STATUS_PANEL.scale),
        [hudChrome, this.feverText, this.meterGfx, this.meterBeatRing, this.meterText, this.weaponText]
      )
      .setScale(FORMAL_STATUS_PANEL.scale);

    this.screenLayer = scene.add
      .container(screenLayerOffset(VIEW_WIDTH), screenLayerOffset(VIEW_HEIGHT))
      .setDepth(10)
      .setScale(UI_SCALE / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0);
    this.screenLayer.add([
      this.formalStatusLayer,
      this.panel,
      this.centerMark,
      this.centerLine,
      this.waveText,
      this.stateText,
      this.messageText
    ]);

    const bossBarWidth = 760;
    const bossBarY = 610;
    const bossBackdrop = scene.add
      .rectangle(640, bossBarY, bossBarWidth + 12, 24, HUD_PANEL_PINK, 0.9)
      .setStrokeStyle(3, HUD_PANEL_PINK_DARK, 0.88);
    this.bossHealthFill = scene.add
      .rectangle(640 - bossBarWidth / 2, bossBarY, bossBarWidth, 14, 0x991b1b, 1)
      .setOrigin(0, 0.5);
    const bossName = scene.add.text(640 - bossBarWidth / 2, bossBarY - 26, '警卫长', {
      fontFamily: HUD_FONT,
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#fff7ed',
      resolution: 2
    }).setOrigin(0, 0.5);
    this.bossHealthValue = scene.add.text(640 + bossBarWidth / 2, bossBarY - 26, '', {
      fontFamily: HUD_FONT,
      fontSize: '13px',
      color: '#fecaca',
      resolution: 2
    }).setOrigin(1, 0.5);
    this.bossHealthLayer = scene.add
      .container(0, 0, [bossBackdrop, this.bossHealthFill, bossName, this.bossHealthValue])
      .setVisible(false);
    this.screenLayer.add(this.bossHealthLayer);

    this.playerHpLayer = scene.add
      .container(0, 0, [playerHpChrome, this.hpLabel, this.hpBarBg, this.hpBar, this.hpText])
      .setDepth(9);

    this.setCombo(0, 0);
    this.setBeatGuideVisible(false);
  }

  // ---------- 节奏块（两侧向中心汇聚） ----------

  /** 每帧调用：按 Conductor 时钟生成/移动/清理节奏块 */
  update(): void {
    if (!this.conductor.started) return;
    const now = this.conductor.now();
    const bf = this.conductor.beatFloatAt(now);
    this.updateHpAnticipation(now, bf);
    if (!this.beatGuideVisible) return;

    // 补充未来 LOOKAHEAD 内的节奏块
    const first = Math.max(0, Math.ceil(bf));
    const last = Math.max(0, Math.floor(bf + LOOKAHEAD_BEATS));
    for (let n = first; n <= last; n++) {
      if (!this.notes.has(n)) this.spawnNote(n);
    }

    const firstMeasure = Math.max(1, Math.ceil((bf + 0.5) / 4));
    const lastMeasure = Math.floor((bf + LOOKAHEAD_BEATS + 0.5) / 4);
    for (let measure = firstMeasure; measure <= lastMeasure; measure++) {
      if (!this.measureDividers.has(measure)) this.spawnMeasureDivider(measure);
    }

    for (const [n, note] of [...this.notes]) {
      if (note.consumed) continue;
      const beatTime = this.conductor.timeOfBeat(n);
      // 拍点过后 0.25s 仍未被击中 → 淡出移除
      if (now > beatTime + 0.25) {
        this.killNote(n);
        continue;
      }
      const progress = Math.max(0, (beatTime - now) / (this.conductor.beatDur * LOOKAHEAD_BEATS));
      const dx = TRAVEL_DIST * progress;
      note.left.x = BAR_CENTER_X - dx;
      note.right.x = BAR_CENTER_X + dx;
      note.left.setAlpha(0.95);
      note.right.setAlpha(0.95);
    }

    for (const [measure, divider] of [...this.measureDividers]) {
      const boundaryBeat = measure * 4 - 0.5;
      const boundaryTime = this.conductor.timeOfBeat(boundaryBeat);
      if (now > boundaryTime + 0.25) {
        this.killMeasureDivider(measure);
        continue;
      }
      const progress = Math.max(0, (boundaryTime - now) / (this.conductor.beatDur * LOOKAHEAD_BEATS));
      const dx = TRAVEL_DIST * progress;
      divider.left.x = BAR_CENTER_X - dx;
      divider.right.x = BAR_CENTER_X + dx;
      divider.left.setAlpha(1);
      divider.right.setAlpha(1);
    }
  }

  private spawnNote(n: number): void {
    const key = this.pattern[n % 4];
    const make = (): Phaser.GameObjects.Shape =>
      key === 'L'
        ? this.scene.add.circle(0, BAR_Y, 10).setStrokeStyle(3, 0x67e8f9).setDepth(11).setScrollFactor(0)
        : this.scene.add.rectangle(0, BAR_Y, 16, 16, 0xfbbf24).setAngle(45).setDepth(11).setScrollFactor(0);
    const left = make();
    const right = make();
    this.screenLayer.add([left, right]);
    this.notes.set(n, { left, right, consumed: false });
  }

  private killNote(n: number): void {
    const note = this.notes.get(n);
    if (!note) return;
    this.notes.delete(n);
    this.scene.tweens.add({
      targets: [note.left, note.right],
      alpha: 0,
      duration: 120,
      onComplete: () => {
        note.left.destroy();
        note.right.destroy();
      }
    });
  }

  private spawnMeasureDivider(measure: number): void {
    const make = (): Phaser.GameObjects.Container => {
      const lineA = this.scene.add.rectangle(-4, 0, 4, 44, 0xf472b6).setStrokeStyle(1, 0xffffff, 0.9);
      const lineB = this.scene.add.rectangle(4, 0, 4, 44, 0xa855f7).setStrokeStyle(1, 0xffffff, 0.9);
      const divider = this.scene.add.container(0, BAR_Y, [lineA, lineB]).setDepth(12);
      this.screenLayer.add(divider);
      return divider;
    };
    this.measureDividers.set(measure, { left: make(), right: make() });
  }

  private killMeasureDivider(measure: number): void {
    const divider = this.measureDividers.get(measure);
    if (!divider) return;
    this.measureDividers.delete(measure);
    this.scene.tweens.add({
      targets: [divider.left, divider.right],
      alpha: 0,
      duration: 120,
      onComplete: () => {
        divider.left.destroy(true);
        divider.right.destroy(true);
      }
    });
  }

  /** 成功命中：对应节奏块在中心合并爆闪 */
  flashSuccess(globalBeat: number): void {
    if (!this.beatGuideVisible) return;
    const note = this.notes.get(globalBeat);
    if (note && !note.consumed) {
      note.consumed = true;
      this.notes.delete(globalBeat);
      this.scene.tweens.add({
        targets: [note.left, note.right],
        x: BAR_CENTER_X,
        scaleX: 1.6,
        scaleY: 1.6,
        alpha: 0,
        duration: 130,
        onComplete: () => {
          note.left.destroy();
          note.right.destroy();
        }
      });
    }
    const burst = this.scene.add
      .circle(BAR_CENTER_X, BAR_Y, 16)
      .setStrokeStyle(3, 0xffffff, 0.9)
      .setDepth(11);
    this.screenLayer.add(burst);
    this.scene.tweens.add({
      targets: burst,
      scale: 2.2,
      alpha: 0,
      duration: 200,
      onComplete: () => burst.destroy()
    });
  }

  /** 错误输入只提供瞬时反馈，不再锁定本小节。 */
  flashError(): void {
    if (this.beatGuideVisible) this.centerMark.setStrokeStyle(3, 0xef4444, 0.9);
    if (this.beatGuideVisible) {
      this.scene.time.delayedCall(180, () => this.centerMark.setStrokeStyle(3, 0xffffff, 0.9));
    }
  }

  setPattern(pattern: BeatKey[], weaponName: string): void {
    this.pattern = pattern;
    this.weaponName = weaponName;
    // 已生成的节奏块按旧连段显示，直接清掉按新连段重新生成
    for (const n of [...this.notes.keys()]) this.killNote(n);
    this.refreshWeaponText();
  }

  /** 上下节拍提示只在教学中显示；正式游戏仅保留武器名和 ComboMeter。 */
  setBeatGuideVisible(visible: boolean): void {
    this.beatGuideVisible = visible;
    this.panel.setVisible(visible);
    this.centerMark.setVisible(visible);
    this.centerLine.setVisible(visible);
    this.refreshWeaponText();

    if (visible) return;
    for (const note of this.notes.values()) {
      note.left.destroy();
      note.right.destroy();
    }
    this.notes.clear();
    for (const divider of this.measureDividers.values()) {
      divider.left.destroy(true);
      divider.right.destroy(true);
    }
    this.measureDividers.clear();
  }

  /** 教学关只复用正式关的 ComboMeter；正式关显示完整动态 HUD。 */
  setGameplayHudVisible(visible: boolean): void {
    this.gameplayHudVisible = visible;
    this.refreshHudVisibility();
  }

  setTutorialComboVisible(visible: boolean): void {
    this.tutorialComboVisible = visible;
    this.redrawStatusChrome(visible);
    this.refreshHudVisibility();
  }

  private refreshHudVisibility(): void {
    this.screenLayer.setVisible(this.gameplayHudVisible || this.tutorialComboVisible);
    this.formalStatusLayer.setVisible(this.gameplayHudVisible || this.tutorialComboVisible);
    this.playerHpLayer.setVisible(this.gameplayHudVisible);
    this.waveText.setVisible(this.gameplayHudVisible);
    this.stateText.setVisible(this.gameplayHudVisible);
    this.messageText.setVisible(this.gameplayHudVisible);
  }

  /** 正式关每帧调用：HP 是玩家正式 HUD 中唯一使用世界坐标的组件。 */
  updatePlayerHpPosition(playerX: number, playerY: number): void {
    this.playerHpLayer.setPosition(playerX, playerY - PLAYER_HP_OFFSET_Y);
  }

  private refreshWeaponText(): void {
    if (!this.weaponName) {
      this.weaponText.setText('');
      return;
    }
    const patternText = this.pattern.map((key) => (key === 'L' ? '轻' : '重')).join(' → ');
    this.weaponText.setText(this.beatGuideVisible ? `${this.weaponName}　${patternText}` : this.weaponName);
    this.weaponText.setColor(this.tutorialComboVisible ? HUD_TEXT_COLOR : FORMAL_HUD_TEXT_COLOR);
  }

  onBeat(beatInMeasure: number): void {
    if (this.beatGuideVisible) {
      // 教学中的底部中心点随节拍脉冲
      this.centerMark.setScale(1.35);
      this.scene.tweens.add({ targets: this.centerMark, scaleX: 1, scaleY: 1, duration: 160 });
    }

    const heavy = this.pattern[beatInMeasure] === 'H';
    this.pulseVictory(heavy);
    const pulseScale = heavy ? 1.16 : 1.1;
    this.scene.tweens.killTweensOf([this.meterBeatRing, this.meterText, this.feverText, this.weaponText, this.waveText]);
    this.meterBeatRing.setStrokeStyle(heavy ? 3 : 2, heavy ? 0xe2b844 : HUD_PANEL_PINK_DARK, 0.92);
    for (const target of [this.meterBeatRing, this.meterText, this.feverText, this.weaponText, this.waveText]) {
      target.setScale(pulseScale);
    }
    this.scene.tweens.add({
      targets: [this.meterBeatRing, this.meterText, this.feverText, this.weaponText, this.waveText],
      scaleX: 1,
      scaleY: 1,
      duration: heavy ? 260 : 190,
      ease: 'Back.easeOut'
    });
    this.scene.tweens.killTweensOf([this.hpBarBg, this.hpBar]);
    this.hpPulseUntil = this.scene.time.now + (heavy ? 250 : 195);
    this.hpBarBg.scaleY = heavy ? 1.5 : 1.26;
    this.hpBar.scaleY = heavy ? 1.5 : 1.26;
    this.hpBar.setFillStyle(this.shiftColor(this.hpBaseColor, heavy ? 5 : 3, heavy ? 5 : 3));
    this.scene.tweens.add({
      targets: [this.hpBarBg, this.hpBar],
      scaleY: 1,
      duration: heavy ? 250 : 195,
      ease: 'Back.easeOut',
      onComplete: () => this.hpBar.setFillStyle(this.hpBaseColor)
    });
  }

  private updateHpAnticipation(now: number, beatFloat: number): void {
    if (this.scene.time.now < this.hpPulseUntil) return;
    const timeToBeat = this.conductor.timeToNextBeat(now);
    const anticipationWindow = this.conductor.beatDur * 0.42;
    const progress = Phaser.Math.Clamp(1 - timeToBeat / anticipationWindow, 0, 1);
    const eased = progress * progress;
    const nextBeat = Math.floor(beatFloat) + 1;
    const beatInMeasure = ((nextBeat % 4) + 4) % 4;
    const heavy = this.pattern[beatInMeasure] === 'H';
    const compressedScale = heavy ? 0.62 : 0.84;
    const scaleY = Phaser.Math.Linear(1, compressedScale, eased);
    this.hpBarBg.scaleY = scaleY;
    this.hpBar.scaleY = scaleY;
    const targetColor = this.shiftColor(this.hpBaseColor, heavy ? 5 : 3, heavy ? 5 : 3);
    this.hpBar.setFillStyle(this.interpolateRgb(this.hpBaseColor, targetColor, eased));
  }

  private shiftColor(colorValue: number, lighten: number, desaturate: number): number {
    const color = Phaser.Display.Color.ValueToColor(colorValue);
    color.lighten(lighten);
    color.desaturate(desaturate);
    return color.color;
  }

  private interpolateRgb(from: number, to: number, amount: number): number {
    const fromR = (from >> 16) & 0xff;
    const fromG = (from >> 8) & 0xff;
    const fromB = from & 0xff;
    const toR = (to >> 16) & 0xff;
    const toG = (to >> 8) & 0xff;
    const toB = to & 0xff;
    const r = Math.round(Phaser.Math.Linear(fromR, toR, amount));
    const g = Math.round(Phaser.Math.Linear(fromG, toG, amount));
    const b = Math.round(Phaser.Math.Linear(fromB, toB, amount));
    return (r << 16) | (g << 8) | b;
  }

  // ---------- ComboMeter / Fever ----------

  /**
   * 节拍脉冲：在 ComboMeter 处随节拍扩散圆环，等级越高越亮越大（积累感）；
   * Fever 期间脉冲最强并同步闪烁判定条边框。
   */
  beatPulse(level: number, fever: boolean): void {
    if (level <= 0 && !fever) return;
    const colors = [HUD_PANEL_PINK_DARK, 0x4ec8c9, 0x4ec8c9, 0xe0b744, 0xe0b744, 0xd9823a];
    const color = fever ? 0xf97316 : colors[level];
    const ring = this.scene.add
      .circle(this.statusMeterX, this.statusMeterY, this.statusMeterRadius)
      .setStrokeStyle(fever ? 4 : 2 + level * 0.4, color, 0.9)
      .setDepth(10);
    this.formalStatusLayer.add(ring);
    this.scene.tweens.add({
      targets: ring,
      scale: fever ? 2.6 : 1.3 + level * 0.2,
      alpha: 0,
      duration: fever ? 400 : 300,
      onComplete: () => ring.destroy()
    });
    if (fever && this.beatGuideVisible) {
      this.panel.setStrokeStyle(3, 0xf97316, 1);
      this.scene.tweens.add({
        targets: this.feverText,
        scaleX: 1.4,
        scaleY: 1.4,
        yoyo: true,
        duration: 120
      });
    }
  }

  /** 进入 Fever Time 的爆发演出 */
  feverBurst(): void {
    const burst = this.scene.add
      .text(640, 360, 'FEVER TIME!', {
        fontFamily: HUD_FONT,
        fontSize: '72px',
        fontStyle: 'bold',
        color: '#d9823a',
        stroke: '#fff3dc',
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setScale(0.3)
      .setAlpha(0);
    this.screenLayer.add(burst);
    this.scene.tweens.add({
      targets: burst,
      scale: 1,
      alpha: 1,
      duration: 250,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: burst,
          alpha: 0,
          y: 320,
          delay: 700,
          duration: 400,
          onComplete: () => burst.destroy()
        });
      }
    });
    // 判定条处的入场冲击环
    for (let i = 0; i < 3; i++) {
      const ring = this.scene.add
        .circle(this.statusMeterX, this.statusMeterY, this.statusMeterRadius)
        .setStrokeStyle(5, 0xf97316, 0.9)
        .setDepth(10);
      this.formalStatusLayer.add(ring);
      this.scene.tweens.add({
        targets: ring,
        scale: 4 + i * 2,
        alpha: 0,
        duration: 500,
        delay: i * 120,
        onComplete: () => ring.destroy()
      });
    }
  }

  private redrawMeter(): void {
    this.meterGfx.clear();
    this.meterGfx.lineStyle(2, HUD_PANEL_PINK_DARK, 0.28);
    this.meterGfx.strokeCircle(this.statusMeterX, this.statusMeterY, this.statusMeterRadius);
    const ratio = this.feverMode
      ? this.feverRatio
      : this.comboLevel >= 5
        ? 1
        : (this.comboProgress - this.comboLevel * 20) / 20;
    if (ratio > 0) {
      this.meterGfx.lineStyle(this.feverMode ? 4 : 3, COMBO_METER_PROGRESS_COLOR, 0.95);
      this.meterGfx.beginPath();
      this.meterGfx.arc(
        this.statusMeterX,
        this.statusMeterY,
        this.statusMeterRadius,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * Phaser.Math.Clamp(ratio, 0, 1),
        false
      );
      this.meterGfx.strokePath();
    }
  }

  setFever(active: boolean): void {
    this.feverMode = active;
    if (!active) {
      if (this.beatGuideVisible) this.panel.setStrokeStyle(3, HUD_DARK_FRAME_COLOR, 0.9);
      this.feverText.setColor(FORMAL_HUD_TEXT_COLOR);
      this.meterText.setColor(FORMAL_HUD_TEXT_COLOR);
    } else {
      this.feverText.setColor('#ffe39a');
      this.meterText.setColor('#ffe39a');
    }
    this.redrawMeter();
  }

  /** Fever 倒计时环（替代常规进度环） */
  setFeverCountdown(ratio: number): void {
    this.feverRatio = ratio;
    if (!this.feverMode) return;
    this.redrawMeter();
    this.meterText.setText(`${Math.round(Phaser.Math.Clamp(ratio, 0, 1) * 100)}%`);
  }

  setCombo(progress: number, level: number): void {
    this.comboProgress = progress;
    this.comboLevel = level;
    if (this.feverMode) return;
    this.redrawMeter();
    this.meterText.setText(`${Math.round(Phaser.Math.Clamp(progress, 0, 100))}%`);
  }

  pulseCombo(): void {
    this.scene.tweens.add({
      targets: this.meterText,
      scaleX: 1.6,
      scaleY: 1.6,
      yoyo: true,
      duration: 120
    });
  }

  flashComboInsufficient(): void {
    if (!this.formalStatusLayer.visible || !this.screenLayer.visible) return;
    const target = this.formalStatusLayer;
    this.scene.tweens.killTweensOf(target);
    target.setAngle(-1.5);
    this.scene.tweens.add({
      targets: target,
      angle: 0,
      duration: 180,
      ease: 'Bounce.easeOut'
    });
    this.meterText.setColor('#dc2626');
    this.scene.time.delayedCall(220, () => {
      this.meterText.setColor(this.feverMode ? '#ffe39a' : FORMAL_HUD_TEXT_COLOR);
    });
  }

  // ---------- 其他 ----------

  setState(text: string): void {
    this.stateText.setText(text);
  }

  setHp(hp: number, maxHp: number): void {
    this.hpBar.scaleX = Math.max(0, hp / maxHp);
    this.hpBaseColor = hp <= 30 ? 0xf59f9f : 0xd4f2df;
    if (this.scene.time.now >= this.hpPulseUntil) this.hpBar.setFillStyle(this.hpBaseColor);
    this.hpText.setText(`${hp} / ${maxHp}`);
  }

  setWave(text: string): void {
    this.waveText.setText(text);
  }

  setBossHealth(hp: number, maxHp: number): void {
    const safeMax = Math.max(1, maxHp);
    this.bossHealthFill.scaleX = Phaser.Math.Clamp(hp / safeMax, 0, 1);
    this.bossHealthValue.setText(`${Math.ceil(Math.max(0, hp))} / ${Math.ceil(safeMax)}`);
  }

  setBossHealthVisible(visible: boolean): void {
    this.bossHealthLayer.setVisible(visible);
  }

  /** 胜利后让场景底层标记继续跟拍呼吸，但不改变其底层 depth。 */
  private pulseVictory(heavy: boolean): void {
    if (!this.victoryBackdrop.visible || !this.victoryText.visible) return;
    this.scene.tweens.killTweensOf([this.victoryBackdrop, this.victoryText]);
    this.victoryBackdrop.setScale(heavy ? 1.045 : 1.025).setAlpha(1);
    this.victoryText.setScale(heavy ? 1.1 : 1.06).setAlpha(1);
    this.scene.tweens.add({
      targets: this.victoryBackdrop,
      scaleX: 1,
      scaleY: 1,
      alpha: 0.92,
      duration: heavy ? 320 : 240,
      ease: 'Back.easeOut'
    });
    this.scene.tweens.add({
      targets: this.victoryText,
      scaleX: 1,
      scaleY: 1,
      alpha: 0.82,
      duration: heavy ? 300 : 220,
      ease: 'Back.easeOut'
    });
  }

  setVictoryVisible(visible: boolean): void {
    this.scene.tweens.killTweensOf([this.victoryBackdrop, this.victoryText]);
    this.victoryBackdrop.setVisible(visible).setScale(1).setAlpha(0.92);
    this.victoryText.setVisible(visible).setScale(1).setAlpha(0.82);
  }

  message(text: string): void {
    this.messageText.setText(text);
  }

}
