import Phaser from 'phaser';
import { MAIN_CAMERA_BASE_ZOOM, applyScreenLayerScrollFactor, screenLayerOffset } from './cameraConfig';
import { UI_SCALE, VIEW_HEIGHT, VIEW_WIDTH } from './displayConfig';
import type { AttackJudgement } from './ComboSystem';
import type { WeaponId } from './weapons';

export type TunableEnemyKind = 'smallGuard' | 'midGuard' | 'fan' | 'bossGuard';

const PERSISTED_TUNING_STORAGE_KEY = 'music-game-demo:tuning-config:v2';
const TUNING_UI_FONT = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const TUNING_PANEL = 0xcfdcb8;
const TUNING_PANEL_LIGHT = 0xe9efd8;
const TUNING_FRAME = 0x426764;
const TUNING_DARK = 0x2d5653;
const TUNING_ACCENT = 0x4ec8c9;
const TUNING_ACCENT_DARK = 0x1e7577;
const TUNING_TEXT = '#315d5a';
const TUNING_MUTED_TEXT = '#496e69';
const TUNING_ACCENT_TEXT = '#1e7577';
const TUNING_WARN_TEXT = '#8a6022';

function fillTuningPixelPanelPath(
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

function drawTuningPixelPanel(
  gfx: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const step = 10;
  gfx.fillStyle(TUNING_DARK, 0.28);
  fillTuningPixelPanelPath(gfx, x + 6, y + 6, width, height, step);
  gfx.fillPath();
  gfx.fillStyle(TUNING_PANEL, 0.96);
  fillTuningPixelPanelPath(gfx, x, y, width, height, step);
  gfx.fillPath();
  gfx.fillStyle(TUNING_PANEL_LIGHT, 0.4);
  gfx.fillRect(x + step, y + step, width - step * 2, 42);
  gfx.lineStyle(4, TUNING_DARK, 0.95);
  fillTuningPixelPanelPath(gfx, x, y, width, height, step);
  gfx.strokePath();
  gfx.lineStyle(2, TUNING_FRAME, 0.82);
  fillTuningPixelPanelPath(gfx, x + 6, y + 6, width - 12, height - 12, 5);
  gfx.strokePath();
  gfx.fillStyle(TUNING_DARK, 0.9);
  gfx.fillRect(x + 24, y - 5, 14, 5);
  gfx.fillRect(x + width - 38, y - 5, 14, 5);
  gfx.fillRect(x + 24, y + height, 14, 5);
  gfx.fillRect(x + width - 38, y + height, 14, 5);
  gfx.fillRect(x - 5, y + 24, 5, 18);
  gfx.fillRect(x + width, y + 24, 5, 18);
  gfx.fillRect(x - 5, y + height - 42, 5, 18);
  gfx.fillRect(x + width, y + height - 42, 5, 18);
}


interface PersistedTuningConfig {
  schemaVersion: 2;
  player: {
    moveSpeed: number;
    manualAimEnabled: boolean;
    glowstickBulletSpeed: number;
    glowstickInfiniteRange: boolean;
    glowstickMaxRange: number;
    glowstickAttackSpeed: number;
    glowstickLightAttackSpeed: number;
    glowstickHeavyAttackSpeed: number;
    batonSweepSpeed: number;
    batonAttackSpeed: number;
    batonLightAttackSpeed: number;
    batonHeavyAttackSpeed: number;
    batonHoldFireFrequency: number;
    glowstickHeavyLaserEnabled: boolean;
    batonHeavyCrescentEnabled: boolean;
    glowstickHeavyChargeDelayMs: number;
    glowstickHeavyLaserThickness: number;
    batonHeavyCrescentRange: number;
    batonLightSweepAngle: number;
    batonLightSweepRange: number;
  };
  enemy: {
    smallGuardBulletSpeed: number;
    smallGuardAttackFrequency: number;
    fanBulletSpeed: number;
    fanAttackFrequency: number;
    enemyStraightBulletSpeedMultiplier: number;
    enemyBulletSizeMultiplier: number;
    smallGuardBulletSizeMultiplier?: number;
    fanBulletSizeMultiplier?: number;
    bossBulletSizeMultiplier?: number;
    enemyDeathVolume: number;
    fanSpiralAttackChance: number;
    enemyBulletBeatSurgeEnabled: boolean;
  };
  waveSpawn: {
    minBatchSize: number;
    maxBatchSize: number;
    minIntervalSeconds: number;
    maxIntervalSeconds: number;
  };
  boss: {
    maxHp: number;
    sizeMultiplier: number;
    moveSpeed: number;
    attackIntervalBeats: number;
    projectileDamage: number;
    projectileSpeed: number;
    crescentSpeed: number;
    stompRadius: number;
    stompKnockback: number;
    noteFormationSpeed: number;
    noteFormationBulletSize: number;
    minionCount: number;
  };
  comboMeter: {
    perfectReward: number;
    goodReward: number;
    patternCompleteReward: number;
    decayPerSecond: number;
    dodgeOnBeatCost: number;
    dodgeOffBeatCost: number;
  };
  weaponJudgementDamageMultipliers: Record<WeaponId, Record<AttackJudgement, number>>;
  weaponAttackDamage: Record<WeaponId, { light: number; heavy: number }>;
  enemyProjectileDamage: { smallGuard: number; fan: number };
  weaponDropChances: Record<WeaponId, number>;
  bgm: {
    tutorialSlot: number;
    levelSlot: number;
    tutorialRhythmBpm: number;
    levelRhythmBpm: number;
    /** 歌曲本身的实际播放 BPM，独立于 tutorialRhythmBpm / levelRhythmBpm 的判定节拍。 */
    tutorialSongBpm: number;
    levelSongBpm: number;
    levelBeatAlignmentOffsetMs: number;
  };
}

export function passesDropChance(chance: number, roll = Math.random()): boolean {
  const clampedChance = Phaser.Math.Clamp(chance, 0, 1);
  if (clampedChance <= 0) return false;
  if (clampedChance >= 1) return true;
  return roll < clampedChance;
}

export class TuningEditor {
  readonly container: Phaser.GameObjects.Container;
  playerMoveSpeed = 320;
  manualAimEnabled = false;
  glowstickBulletSpeed = 1040;
  glowstickInfiniteRange = true;
  glowstickMaxRange = 164;
  glowstickAttackSpeed = 1;
  glowstickLightAttackSpeed = 1;
  glowstickHeavyAttackSpeed = 1;
  batonSweepSpeed = 1;
  batonAttackSpeed = 1;
  batonLightAttackSpeed = 1;
  batonHeavyAttackSpeed = 1;
  batonHoldFireFrequency = 7;
  glowstickHeavyLaserEnabled = true;
  batonHeavyCrescentEnabled = true;
  glowstickHeavyChargeDelayMs = 0;
  glowstickHeavyLaserThickness = 56;
  batonHeavyCrescentRange = 504;
  batonLightSweepAngle = 180;
  batonLightSweepRange = 300;
  smallGuardBulletSpeed = 184;
  smallGuardAttackFrequency = 0.8;
  fanBulletSpeed = 144;
  fanAttackFrequency = 0.2;
  enemyStraightBulletSpeedMultiplier = 1.25;
  /** 旧存档的统一敌弹倍率；只作为分敌人尺寸字段缺失时的迁移基准。 */
  enemyBulletSizeMultiplier = 1.5;
  smallGuardBulletSizeMultiplier = 2;
  fanBulletSizeMultiplier = 1.5;
  bossBulletSizeMultiplier = 2;
  enemyDeathVolume = 1;
  fanSpiralAttackChance = 0.3;
  waveSpawnMinBatchSize = 2;
  waveSpawnMaxBatchSize = 5;
  waveSpawnMinIntervalSeconds = 2;
  waveSpawnMaxIntervalSeconds = 4;
  comboPerfectReward = 4;
  comboGoodReward = 3;
  comboPatternCompleteReward = 10;
  comboDecayPerSecond = 1;
  /** 踩拍闪避消耗的 ComboMeter 百分比（0-100）。 */
  dodgeOnBeatCost = 5;
  /** 错拍闪避消耗的 ComboMeter 百分比（0-100）；错拍仍能触发闪避，只是代价更高。 */
  dodgeOffBeatCost = 20;
  bossMaxHp = 1200;
  bossSizeMultiplier = 4;
  bossMoveSpeed = 28;
  bossAttackIntervalBeats = 4;
  bossProjectileDamage = 20;
  bossProjectileSpeed = 280;
  bossCrescentSpeed = 240;
  bossStompRadius = 230;
  bossStompKnockback = 520;
  bossNoteFormationSpeed = 300;
  bossNoteFormationBulletSize = 1.3;
  bossMinionCount = 6;
  weaponJudgementDamageMultipliers: Record<WeaponId, Record<AttackJudgement, number>> = {
    glowsticks: { perfect: 1.2, good: 1, poor: 0.5 },
    baton: { perfect: 1.2, good: 1, poor: 0.5 }
  };
  weaponAttackDamage: Record<WeaponId, { light: number; heavy: number }> = {
    glowsticks: { light: 10, heavy: 18 },
    baton: { light: 16, heavy: 20 }
  };
  enemyProjectileDamage = {
    smallGuard: 12,
    fan: 8
  };
  weaponDropChances: Record<WeaponId, number> = {
    glowsticks: 1,
    baton: 1
  };
  enemyBulletBeatSurgeEnabled = false;
  tutorialBgmSlot = 3;
  levelBgmSlot = 0;
  tutorialRhythmBpm = 132;
  levelRhythmBpm = 132;
  /** 歌曲本身的实际播放 BPM；只影响 BGM 播放速度，不影响判定节拍。 */
  tutorialSongBpm = 132;
  levelSongBpm = 132;
  levelBeatAlignmentOffsetMs = 0;

  private playerSpeedText: Phaser.GameObjects.Text;
  private playerInfiniteRangeButton: Phaser.GameObjects.Rectangle;
  private playerInfiniteRangeText: Phaser.GameObjects.Text;
  private playerMaxRangeText: Phaser.GameObjects.Text;
  private enemySpeedText: Phaser.GameObjects.Text;
  private enemyBeatSurgeButton: Phaser.GameObjects.Rectangle;
  private enemyBeatSurgeText: Phaser.GameObjects.Text;
  private fanSpiralAttackChanceText: Phaser.GameObjects.Text;
  private tutorialSlotText: Phaser.GameObjects.Text;
  private levelSlotText: Phaser.GameObjects.Text;
  private readonly trackLabels: readonly string[];

  constructor(scene: Phaser.Scene, trackLabels: readonly string[]) {
    this.trackLabels = trackLabels;
    const panelGfx = scene.add.graphics();
    drawTuningPixelPanel(panelGfx, 50, 35, 1180, 650);
    const objects: Phaser.GameObjects.GameObject[] = [
      scene.add.rectangle(640, 360, 1280, 720, TUNING_PANEL, 0.24),
      panelGfx,
      scene.add.text(640, 52, 'DEBUG MENU', {
        fontFamily: TUNING_UI_FONT, fontSize: '28px', fontStyle: 'bold', color: TUNING_TEXT,
        stroke: '#eef4dc', strokeThickness: 2, resolution: 2
      }).setOrigin(0.5),
      scene.add.text(640, 660, '按 P 关闭并应用当前参数', {
        fontFamily: TUNING_UI_FONT, fontSize: '14px', color: TUNING_MUTED_TEXT, resolution: 2
      }).setOrigin(0.5)
    ];

    const addLabel = (y: number, label: string): void => {
      objects.push(scene.add.text(80, y, label, {
        fontFamily: TUNING_UI_FONT, fontSize: '18px', color: TUNING_TEXT, resolution: 2
      }).setOrigin(0, 0.5));
    };
    const addButton = (x: number, y: number, label: string, onClick: () => void): void => {
      const rect = scene.add.rectangle(x, y, 42, 34, TUNING_PANEL_LIGHT, 0.94).setStrokeStyle(2, TUNING_FRAME, 0.86)
        .setInteractive({ useHandCursor: true });
      const text = scene.add.text(x, y, label, {
        fontFamily: TUNING_UI_FONT, fontSize: '20px', fontStyle: 'bold', color: TUNING_TEXT, resolution: 2
      }).setOrigin(0.5);
      rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointer.event.stopPropagation();
        onClick();
      });
      objects.push(rect, text);
    };

    addLabel(120, '玩家远程无限射程');
    this.playerInfiniteRangeButton = scene.add.rectangle(430, 120, 180, 36, TUNING_PANEL_LIGHT, 0.94)
      .setStrokeStyle(2, TUNING_FRAME, 0.86)
      .setInteractive({ useHandCursor: true });
    this.playerInfiniteRangeText = scene.add.text(430, 120, '', {
      fontFamily: TUNING_UI_FONT, fontSize: '17px', fontStyle: 'bold', color: TUNING_TEXT, resolution: 2
    }).setOrigin(0.5);
    this.playerInfiniteRangeButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.glowstickInfiniteRange = !this.glowstickInfiniteRange;
      this.refresh();
    });
    objects.push(this.playerInfiniteRangeButton, this.playerInfiniteRangeText);

    addLabel(180, '玩家最远射程');
    this.playerMaxRangeText = scene.add.text(430, 180, '', {
      fontFamily: TUNING_UI_FONT, fontSize: '18px', fontStyle: 'bold', color: TUNING_ACCENT_TEXT, resolution: 2
    }).setOrigin(0.5);
    objects.push(this.playerMaxRangeText);
    addButton(370, 180, '−', () => {
      this.glowstickMaxRange = Phaser.Math.Clamp(this.glowstickMaxRange - 20, 40, 2000);
      this.refresh();
    });
    addButton(490, 180, '+', () => {
      this.glowstickMaxRange = Phaser.Math.Clamp(this.glowstickMaxRange + 20, 40, 2000);
      this.refresh();
    });

    addLabel(240, '玩家弹速');
    this.playerSpeedText = scene.add.text(430, 240, '', {
      fontFamily: TUNING_UI_FONT, fontSize: '18px', fontStyle: 'bold', color: TUNING_ACCENT_TEXT, resolution: 2
    }).setOrigin(0.5);
    objects.push(this.playerSpeedText);
    addButton(370, 240, '−', () => {
      this.playerBulletSpeed = Phaser.Math.Clamp(this.playerBulletSpeed - 20, 100, 1600);
      this.refresh();
    });
    addButton(490, 240, '+', () => {
      this.playerBulletSpeed = Phaser.Math.Clamp(this.playerBulletSpeed + 20, 100, 1600);
      this.refresh();
    });

    addLabel(300, '敌人弹速');
    this.enemySpeedText = scene.add.text(430, 300, '', {
      fontFamily: TUNING_UI_FONT, fontSize: '18px', fontStyle: 'bold', color: '#9f3d30', resolution: 2
    }).setOrigin(0.5);
    objects.push(this.enemySpeedText);
    addButton(370, 300, '−', () => {
      this.enemyBulletSpeed = Phaser.Math.Clamp(this.enemyBulletSpeed - 20, 40, 600);
      this.refresh();
    });
    addButton(490, 300, '+', () => {
      this.enemyBulletSpeed = Phaser.Math.Clamp(this.enemyBulletSpeed + 20, 40, 600);
      this.refresh();
    });

    addLabel(360, '弹幕节拍突进');
    this.enemyBeatSurgeButton = scene.add.rectangle(430, 360, 140, 36, TUNING_ACCENT, 0.9)
      .setStrokeStyle(2, TUNING_ACCENT_DARK, 0.9)
      .setInteractive({ useHandCursor: true });
    this.enemyBeatSurgeText = scene.add.text(430, 360, '', {
      fontFamily: TUNING_UI_FONT, fontSize: '17px', fontStyle: 'bold', color: TUNING_TEXT, resolution: 2
    }).setOrigin(0.5);
    this.enemyBeatSurgeButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.enemyBulletBeatSurgeEnabled = !this.enemyBulletBeatSurgeEnabled;
      this.refresh();
    });
    objects.push(this.enemyBeatSurgeButton, this.enemyBeatSurgeText);

    addLabel(420, '粉丝三向螺旋概率');
    this.fanSpiralAttackChanceText = scene.add.text(430, 420, '', {
      fontFamily: TUNING_UI_FONT, fontSize: '18px', fontStyle: 'bold', color: '#9f3d30', resolution: 2
    }).setOrigin(0.5);
    objects.push(this.fanSpiralAttackChanceText);
    addButton(370, 420, '−', () => {
      this.fanSpiralAttackChance = Phaser.Math.Clamp(this.fanSpiralAttackChance - 0.05, 0, 1);
      this.refresh();
    });
    addButton(490, 420, '+', () => {
      this.fanSpiralAttackChance = Phaser.Math.Clamp(this.fanSpiralAttackChance + 0.05, 0, 1);
      this.refresh();
    });

    addLabel(500, '教学关 BGM Slot');
    this.tutorialSlotText = scene.add.text(430, 500, '', {
      fontFamily: TUNING_UI_FONT, fontSize: '17px', fontStyle: 'bold', color: TUNING_WARN_TEXT, resolution: 2
    }).setOrigin(0.5);
    objects.push(this.tutorialSlotText);
    addButton(320, 500, '‹', () => this.cycleSlot('tutorial', -1));
    addButton(540, 500, '›', () => this.cycleSlot('tutorial', 1));

    addLabel(580, '正式关 BGM Slot');
    this.levelSlotText = scene.add.text(430, 580, '', {
      fontFamily: TUNING_UI_FONT, fontSize: '17px', fontStyle: 'bold', color: TUNING_WARN_TEXT, resolution: 2
    }).setOrigin(0.5);
    objects.push(this.levelSlotText);
    addButton(320, 580, '‹', () => this.cycleSlot('level', -1));
    addButton(540, 580, '›', () => this.cycleSlot('level', 1));


    this.container = scene.add
      .container(screenLayerOffset(VIEW_WIDTH), screenLayerOffset(VIEW_HEIGHT), objects)
      .setDepth(31)
      .setScale(UI_SCALE / MAIN_CAMERA_BASE_ZOOM)
      .setVisible(false);
    applyScreenLayerScrollFactor(this.container);
    this.refresh();
  }

  get visible(): boolean {
    return this.container.visible;
  }

  /** P 调试菜单统一承载快捷调参与各武器独立战斗参数；Esc 只保留音量设置。 */
  get playerBulletSpeed(): number {
    return this.glowstickBulletSpeed;
  }

  set playerBulletSpeed(value: number) {
    this.glowstickBulletSpeed = value;
  }


  get enemyBulletSpeed(): number {
    return this.smallGuardBulletSpeed;
  }

  set enemyBulletSpeed(value: number) {
    this.smallGuardBulletSpeed = value;
    this.fanBulletSpeed = value;
  }

  getWeaponJudgementDamageMultiplier(weaponId: WeaponId, judgement: AttackJudgement): number {
    return this.weaponJudgementDamageMultipliers[weaponId][judgement];
  }

  getWeaponAttackDamage(weaponId: WeaponId, heavy: boolean): number {
    return this.weaponAttackDamage[weaponId][heavy ? 'heavy' : 'light'];
  }

  getEnemyProjectileDamage(kind: TunableEnemyKind): number {
    return kind === 'fan' ? this.enemyProjectileDamage.fan : this.enemyProjectileDamage.smallGuard;
  }

  getEnemyBulletSizeMultiplier(kind: TunableEnemyKind): number {
    if (kind === 'fan') return this.fanBulletSizeMultiplier;
    if (kind === 'bossGuard') return this.bossBulletSizeMultiplier;
    return this.smallGuardBulletSizeMultiplier;
  }

  getWeaponDropChance(weaponId: WeaponId): number {
    return this.weaponDropChances[weaponId];
  }

  /** 把 P Menu 当前全部配置保存到本浏览器；刷新页面后由 loadPersistedConfig 恢复。 */
  savePersistedConfig(): boolean {
    try {
      localStorage.setItem(PERSISTED_TUNING_STORAGE_KEY, JSON.stringify(this.buildPersistedConfig()));
      return true;
    } catch (error) {
      console.warn('[TuningEditor] 无法保存本机调参配置。', error);
      return false;
    }
  }

  /** 在场景创建早期恢复本机配置；无记录、版本不符或数据损坏时保留代码默认值。 */
  loadPersistedConfig(): boolean {
    try {
      const raw = localStorage.getItem(PERSISTED_TUNING_STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw) as Partial<PersistedTuningConfig>;
      if (saved.schemaVersion !== 2) return false;
      this.applyPersistedConfig(saved);
      this.refresh();
      return true;
    } catch (error) {
      console.warn('[TuningEditor] 本机调参配置损坏，已沿用代码默认值。', error);
      return false;
    }
  }

  /**
   * 用稳定键名记录所有玩家/敌人战斗调参；保留小数原值，便于把 TXT 回传后直接改成默认值。
   * 正式关节拍对齐会影响判定听感，因此与战斗参数一并导出；纯显示设置仍不写入。
   */
  buildCombatConfigText(generatedAt = new Date()): string {
    const lines = [
      '# MusicGameDemo 战斗参数快照',
      'schemaVersion=2',
      `generatedAt=${generatedAt.toISOString()}`,
      '',
      '[player]',
      `moveSpeed=${this.playerMoveSpeed}`,
      `manualAimEnabled=${this.manualAimEnabled}`,
      `glowstickBulletSpeed=${this.glowstickBulletSpeed}`,
      `glowstickInfiniteRange=${this.glowstickInfiniteRange}`,
      `glowstickMaxRange=${this.glowstickMaxRange}`,
      `glowstickAttackSpeed=${this.glowstickAttackSpeed}`,
      `glowstickLightAttackSpeed=${this.glowstickLightAttackSpeed}`,
      `glowstickHeavyAttackSpeed=${this.glowstickHeavyAttackSpeed}`,
      `batonSweepSpeed=${this.batonSweepSpeed}`,
      `batonAttackSpeed=${this.batonAttackSpeed}`,
      `batonLightAttackSpeed=${this.batonLightAttackSpeed}`,
      `batonHeavyAttackSpeed=${this.batonHeavyAttackSpeed}`,
      `batonHoldFireFrequency=${this.batonHoldFireFrequency}`,
      `glowstickHeavyLaserEnabled=${this.glowstickHeavyLaserEnabled}`,
      `batonHeavyCrescentEnabled=${this.batonHeavyCrescentEnabled}`,
      `glowstickHeavyChargeDelayMs=${this.glowstickHeavyChargeDelayMs}`,
      `glowstickHeavyLaserThickness=${this.glowstickHeavyLaserThickness}`,
      `batonHeavyCrescentRange=${this.batonHeavyCrescentRange}`,
      `batonLightSweepAngle=${this.batonLightSweepAngle}`,
      `batonLightSweepRange=${this.batonLightSweepRange}`,
      '',
      '[weaponBaseDamage]',
      `glowsticks.light=${this.weaponAttackDamage.glowsticks.light}`,
      `glowsticks.heavy=${this.weaponAttackDamage.glowsticks.heavy}`,
      `baton.light=${this.weaponAttackDamage.baton.light}`,
      `baton.heavy=${this.weaponAttackDamage.baton.heavy}`,
      '',
      '[weaponDamageMultiplier]',
      `glowsticks.perfect=${this.weaponJudgementDamageMultipliers.glowsticks.perfect}`,
      `glowsticks.good=${this.weaponJudgementDamageMultipliers.glowsticks.good}`,
      `glowsticks.poor=${this.weaponJudgementDamageMultipliers.glowsticks.poor}`,
      `baton.perfect=${this.weaponJudgementDamageMultipliers.baton.perfect}`,
      `baton.good=${this.weaponJudgementDamageMultipliers.baton.good}`,
      `baton.poor=${this.weaponJudgementDamageMultipliers.baton.poor}`,
      '',
      '[comboMeter]',
      `perfectReward=${this.comboPerfectReward}`,
      `goodReward=${this.comboGoodReward}`,
      `patternCompleteReward=${this.comboPatternCompleteReward}`,
      `decayPerSecond=${this.comboDecayPerSecond}`,
      `dodgeOnBeatCost=${this.dodgeOnBeatCost}`,
      `dodgeOffBeatCost=${this.dodgeOffBeatCost}`,
      '',
      '[bgm]',
      `tutorialRhythmBpm=${this.tutorialRhythmBpm}`,
      `levelRhythmBpm=${this.levelRhythmBpm}`,
      `tutorialSongBpm=${this.tutorialSongBpm}`,
      `levelSongBpm=${this.levelSongBpm}`,
      `levelBeatAlignmentOffsetMs=${this.levelBeatAlignmentOffsetMs}`,
      '',
      '[enemy]',
      `smallGuardBulletSpeed=${this.smallGuardBulletSpeed}`,
      `smallGuardAttackFrequency=${this.smallGuardAttackFrequency}`,
      `fanBulletSpeed=${this.fanBulletSpeed}`,
      `fanAttackFrequency=${this.fanAttackFrequency}`,
      `enemyStraightBulletSpeedMultiplier=${this.enemyStraightBulletSpeedMultiplier}`,
      `smallGuardBulletSizeMultiplier=${this.smallGuardBulletSizeMultiplier}`,
      `fanBulletSizeMultiplier=${this.fanBulletSizeMultiplier}`,
      `bossBulletSizeMultiplier=${this.bossBulletSizeMultiplier}`,
      `smallGuardProjectileDamage=${this.enemyProjectileDamage.smallGuard}`,
      `fanProjectileDamage=${this.enemyProjectileDamage.fan}`,
      `enemyBulletBeatSurgeEnabled=${this.enemyBulletBeatSurgeEnabled}`,
      `enemyDeathVolume=${this.enemyDeathVolume}`,
      `fanSpiralAttackChance=${this.fanSpiralAttackChance}`,
      '',
      '[waveSpawn]',
      `minBatchSize=${this.waveSpawnMinBatchSize}`,
      `maxBatchSize=${this.waveSpawnMaxBatchSize}`,
      `minIntervalSeconds=${this.waveSpawnMinIntervalSeconds}`,
      `maxIntervalSeconds=${this.waveSpawnMaxIntervalSeconds}`,
      '',
      '[boss]',
      `maxHp=${this.bossMaxHp}`,
      `sizeMultiplier=${this.bossSizeMultiplier}`,
      `moveSpeed=${this.bossMoveSpeed}`,
      `attackIntervalBeats=${this.bossAttackIntervalBeats}`,
      `projectileDamage=${this.bossProjectileDamage}`,
      `projectileSpeed=${this.bossProjectileSpeed}`,
      `crescentSpeed=${this.bossCrescentSpeed}`,
      `stompRadius=${this.bossStompRadius}`,
      `stompKnockback=${this.bossStompKnockback}`,
      `noteFormationSpeed=${this.bossNoteFormationSpeed}`,
      `noteFormationBulletSize=${this.bossNoteFormationBulletSize}`,
      `minionCount=${this.bossMinionCount}`,
      '',
      '[dropChance]',
      `glowsticks=${this.weaponDropChances.glowsticks}`,
      `baton=${this.weaponDropChances.baton}`,
      ''
    ];
    return lines.join('\n');
  }

  downloadCombatConfigTxt(): string {
    const timestamp = new Date();
    const compactTime = timestamp.toISOString().replace(/[:.]/g, '-');
    const filename = `music-game-combat-config-${compactTime}.txt`;
    const blob = new Blob([`\uFEFF${this.buildCombatConfigText(timestamp)}`], {
      type: 'text/plain;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return filename;
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
    if (visible) this.refresh();
  }

  private cycleSlot(slot: 'tutorial' | 'level', delta: number): void {
    const current = slot === 'tutorial' ? this.tutorialBgmSlot : this.levelBgmSlot;
    const next = (current + delta + this.trackLabels.length) % this.trackLabels.length;
    if (slot === 'tutorial') this.tutorialBgmSlot = next;
    else this.levelBgmSlot = next;
    this.refresh();
  }

  private buildPersistedConfig(): PersistedTuningConfig {
    return {
      schemaVersion: 2,
      player: {
        moveSpeed: this.playerMoveSpeed,
        manualAimEnabled: this.manualAimEnabled,
        glowstickBulletSpeed: this.glowstickBulletSpeed,
        glowstickInfiniteRange: this.glowstickInfiniteRange,
        glowstickMaxRange: this.glowstickMaxRange,
        glowstickAttackSpeed: this.glowstickAttackSpeed,
        glowstickLightAttackSpeed: this.glowstickLightAttackSpeed,
        glowstickHeavyAttackSpeed: this.glowstickHeavyAttackSpeed,
        batonSweepSpeed: this.batonSweepSpeed,
        batonAttackSpeed: this.batonAttackSpeed,
        batonLightAttackSpeed: this.batonLightAttackSpeed,
        batonHeavyAttackSpeed: this.batonHeavyAttackSpeed,
        batonHoldFireFrequency: this.batonHoldFireFrequency,
        glowstickHeavyLaserEnabled: this.glowstickHeavyLaserEnabled,
        batonHeavyCrescentEnabled: this.batonHeavyCrescentEnabled,
        glowstickHeavyChargeDelayMs: this.glowstickHeavyChargeDelayMs,
        glowstickHeavyLaserThickness: this.glowstickHeavyLaserThickness,
        batonHeavyCrescentRange: this.batonHeavyCrescentRange,
        batonLightSweepAngle: this.batonLightSweepAngle,
        batonLightSweepRange: this.batonLightSweepRange
      },
      enemy: {
        smallGuardBulletSpeed: this.smallGuardBulletSpeed,
        smallGuardAttackFrequency: this.smallGuardAttackFrequency,
        fanBulletSpeed: this.fanBulletSpeed,
        fanAttackFrequency: this.fanAttackFrequency,
        enemyStraightBulletSpeedMultiplier: this.enemyStraightBulletSpeedMultiplier,
        enemyBulletSizeMultiplier: this.enemyBulletSizeMultiplier,
        smallGuardBulletSizeMultiplier: this.smallGuardBulletSizeMultiplier,
        fanBulletSizeMultiplier: this.fanBulletSizeMultiplier,
        bossBulletSizeMultiplier: this.bossBulletSizeMultiplier,
        enemyDeathVolume: this.enemyDeathVolume,
        fanSpiralAttackChance: this.fanSpiralAttackChance,
        enemyBulletBeatSurgeEnabled: this.enemyBulletBeatSurgeEnabled
      },
      waveSpawn: {
        minBatchSize: this.waveSpawnMinBatchSize,
        maxBatchSize: this.waveSpawnMaxBatchSize,
        minIntervalSeconds: this.waveSpawnMinIntervalSeconds,
        maxIntervalSeconds: this.waveSpawnMaxIntervalSeconds
      },
      boss: {
        maxHp: this.bossMaxHp,
        sizeMultiplier: this.bossSizeMultiplier,
        moveSpeed: this.bossMoveSpeed,
        attackIntervalBeats: this.bossAttackIntervalBeats,
        projectileDamage: this.bossProjectileDamage,
        projectileSpeed: this.bossProjectileSpeed,
        crescentSpeed: this.bossCrescentSpeed,
        stompRadius: this.bossStompRadius,
        stompKnockback: this.bossStompKnockback,
        noteFormationSpeed: this.bossNoteFormationSpeed,
        noteFormationBulletSize: this.bossNoteFormationBulletSize,
        minionCount: this.bossMinionCount
      },
      comboMeter: {
        perfectReward: this.comboPerfectReward,
        goodReward: this.comboGoodReward,
        patternCompleteReward: this.comboPatternCompleteReward,
        decayPerSecond: this.comboDecayPerSecond,
        dodgeOnBeatCost: this.dodgeOnBeatCost,
        dodgeOffBeatCost: this.dodgeOffBeatCost
      },
      weaponJudgementDamageMultipliers: structuredClone(this.weaponJudgementDamageMultipliers),
      weaponAttackDamage: structuredClone(this.weaponAttackDamage),
      enemyProjectileDamage: { ...this.enemyProjectileDamage },
      weaponDropChances: { ...this.weaponDropChances },
      bgm: {
        tutorialSlot: this.tutorialBgmSlot,
        levelSlot: this.levelBgmSlot,
        tutorialRhythmBpm: this.tutorialRhythmBpm,
        levelRhythmBpm: this.levelRhythmBpm,
        tutorialSongBpm: this.tutorialSongBpm,
        levelSongBpm: this.levelSongBpm,
        levelBeatAlignmentOffsetMs: this.levelBeatAlignmentOffsetMs
      }
    };
  }

  private applyPersistedConfig(saved: Partial<PersistedTuningConfig>): void {
    const numberValue = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const booleanValue = (value: unknown, fallback: boolean): boolean =>
      typeof value === 'boolean' ? value : fallback;
    const player = saved.player;
    if (player) {
      this.playerMoveSpeed = numberValue(player.moveSpeed, this.playerMoveSpeed);
      this.manualAimEnabled = booleanValue(player.manualAimEnabled, this.manualAimEnabled);
      this.glowstickBulletSpeed = numberValue(player.glowstickBulletSpeed, this.glowstickBulletSpeed);
      this.glowstickInfiniteRange = booleanValue(player.glowstickInfiniteRange, this.glowstickInfiniteRange);
      this.glowstickMaxRange = numberValue(player.glowstickMaxRange, this.glowstickMaxRange);
      this.glowstickAttackSpeed = numberValue(player.glowstickAttackSpeed, this.glowstickAttackSpeed);
      this.glowstickLightAttackSpeed = numberValue(player.glowstickLightAttackSpeed, this.glowstickLightAttackSpeed);
      this.glowstickHeavyAttackSpeed = numberValue(player.glowstickHeavyAttackSpeed, this.glowstickHeavyAttackSpeed);
      this.batonSweepSpeed = numberValue(player.batonSweepSpeed, this.batonSweepSpeed);
      this.batonAttackSpeed = numberValue(player.batonAttackSpeed, this.batonAttackSpeed);
      this.batonLightAttackSpeed = numberValue(player.batonLightAttackSpeed, this.batonLightAttackSpeed);
      this.batonHeavyAttackSpeed = numberValue(player.batonHeavyAttackSpeed, this.batonHeavyAttackSpeed);
      this.batonHoldFireFrequency = numberValue(player.batonHoldFireFrequency, this.batonHoldFireFrequency);
      this.glowstickHeavyLaserEnabled = booleanValue(
        player.glowstickHeavyLaserEnabled,
        this.glowstickHeavyLaserEnabled
      );
      this.batonHeavyCrescentEnabled = booleanValue(
        player.batonHeavyCrescentEnabled,
        this.batonHeavyCrescentEnabled
      );
      this.glowstickHeavyChargeDelayMs = numberValue(
        player.glowstickHeavyChargeDelayMs,
        this.glowstickHeavyChargeDelayMs
      );
      this.glowstickHeavyLaserThickness = numberValue(
        player.glowstickHeavyLaserThickness,
        this.glowstickHeavyLaserThickness
      );
      this.batonHeavyCrescentRange = numberValue(player.batonHeavyCrescentRange, this.batonHeavyCrescentRange);
      this.batonLightSweepAngle = numberValue(player.batonLightSweepAngle, this.batonLightSweepAngle);
      this.batonLightSweepRange = numberValue(player.batonLightSweepRange, this.batonLightSweepRange);
    }
    const enemy = saved.enemy;
    if (enemy) {
      this.smallGuardBulletSpeed = numberValue(enemy.smallGuardBulletSpeed, this.smallGuardBulletSpeed);
      this.smallGuardAttackFrequency = numberValue(enemy.smallGuardAttackFrequency, this.smallGuardAttackFrequency);
      this.fanBulletSpeed = numberValue(enemy.fanBulletSpeed, this.fanBulletSpeed);
      this.fanAttackFrequency = numberValue(enemy.fanAttackFrequency, this.fanAttackFrequency);
      this.enemyStraightBulletSpeedMultiplier = numberValue(
        enemy.enemyStraightBulletSpeedMultiplier,
        this.enemyStraightBulletSpeedMultiplier
      );
      const legacyBulletSize = numberValue(enemy.enemyBulletSizeMultiplier, this.enemyBulletSizeMultiplier);
      this.enemyBulletSizeMultiplier = legacyBulletSize;
      this.smallGuardBulletSizeMultiplier = numberValue(
        enemy.smallGuardBulletSizeMultiplier,
        legacyBulletSize
      );
      this.fanBulletSizeMultiplier = numberValue(enemy.fanBulletSizeMultiplier, legacyBulletSize);
      this.bossBulletSizeMultiplier = numberValue(enemy.bossBulletSizeMultiplier, legacyBulletSize);
      this.enemyDeathVolume = numberValue(enemy.enemyDeathVolume, this.enemyDeathVolume);
      this.fanSpiralAttackChance = numberValue(enemy.fanSpiralAttackChance, this.fanSpiralAttackChance);
      this.enemyBulletBeatSurgeEnabled = booleanValue(
        enemy.enemyBulletBeatSurgeEnabled,
        this.enemyBulletBeatSurgeEnabled
      );
    }
    const waveSpawn = saved.waveSpawn;
    if (waveSpawn) {
      const minBatchSize = Phaser.Math.Clamp(
        Math.round(numberValue(waveSpawn.minBatchSize, this.waveSpawnMinBatchSize)), 1, 20
      );
      const maxBatchSize = Phaser.Math.Clamp(
        Math.round(numberValue(waveSpawn.maxBatchSize, this.waveSpawnMaxBatchSize)), 1, 20
      );
      this.waveSpawnMinBatchSize = Math.min(minBatchSize, maxBatchSize);
      this.waveSpawnMaxBatchSize = Math.max(minBatchSize, maxBatchSize);
      const minInterval = Phaser.Math.Clamp(
        numberValue(waveSpawn.minIntervalSeconds, this.waveSpawnMinIntervalSeconds), 0.5, 30
      );
      const maxInterval = Phaser.Math.Clamp(
        numberValue(waveSpawn.maxIntervalSeconds, this.waveSpawnMaxIntervalSeconds), 0.5, 30
      );
      this.waveSpawnMinIntervalSeconds = Math.min(minInterval, maxInterval);
      this.waveSpawnMaxIntervalSeconds = Math.max(minInterval, maxInterval);
    }
    const boss = saved.boss;
    if (boss) {
      this.bossMaxHp = numberValue(boss.maxHp, this.bossMaxHp);
      this.bossSizeMultiplier = numberValue(boss.sizeMultiplier, this.bossSizeMultiplier);
      this.bossMoveSpeed = numberValue(boss.moveSpeed, this.bossMoveSpeed);
      this.bossAttackIntervalBeats = numberValue(boss.attackIntervalBeats, this.bossAttackIntervalBeats);
      this.bossProjectileDamage = numberValue(boss.projectileDamage, this.bossProjectileDamage);
      this.bossProjectileSpeed = numberValue(boss.projectileSpeed, this.bossProjectileSpeed);
      this.bossCrescentSpeed = numberValue(boss.crescentSpeed, this.bossCrescentSpeed);
      this.bossStompRadius = numberValue(boss.stompRadius, this.bossStompRadius);
      this.bossStompKnockback = numberValue(boss.stompKnockback, this.bossStompKnockback);
      this.bossNoteFormationSpeed = numberValue(boss.noteFormationSpeed, this.bossNoteFormationSpeed);
      this.bossNoteFormationBulletSize = numberValue(
        boss.noteFormationBulletSize,
        this.bossNoteFormationBulletSize
      );
      this.bossMinionCount = numberValue(boss.minionCount, this.bossMinionCount);
    }
    const comboMeter = saved.comboMeter;
    if (comboMeter) {
      this.comboPerfectReward = numberValue(comboMeter.perfectReward, this.comboPerfectReward);
      this.comboGoodReward = numberValue(comboMeter.goodReward, this.comboGoodReward);
      this.comboPatternCompleteReward = numberValue(
        comboMeter.patternCompleteReward,
        this.comboPatternCompleteReward
      );
      this.comboDecayPerSecond = Phaser.Math.Clamp(
        numberValue(comboMeter.decayPerSecond, this.comboDecayPerSecond), 0, 20
      );
      this.dodgeOnBeatCost = Phaser.Math.Clamp(
        numberValue(comboMeter.dodgeOnBeatCost, this.dodgeOnBeatCost), 0, 100
      );
      this.dodgeOffBeatCost = Phaser.Math.Clamp(
        numberValue(comboMeter.dodgeOffBeatCost, this.dodgeOffBeatCost), 0, 100
      );
    }
    for (const weaponId of ['glowsticks', 'baton'] as const) {
      for (const judgement of ['perfect', 'good', 'poor'] as const) {
        this.weaponJudgementDamageMultipliers[weaponId][judgement] = numberValue(
          saved.weaponJudgementDamageMultipliers?.[weaponId]?.[judgement],
          this.weaponJudgementDamageMultipliers[weaponId][judgement]
        );
      }
      this.weaponAttackDamage[weaponId].light = numberValue(
        saved.weaponAttackDamage?.[weaponId]?.light,
        this.weaponAttackDamage[weaponId].light
      );
      this.weaponAttackDamage[weaponId].heavy = numberValue(
        saved.weaponAttackDamage?.[weaponId]?.heavy,
        this.weaponAttackDamage[weaponId].heavy
      );
      this.weaponDropChances[weaponId] = numberValue(
        saved.weaponDropChances?.[weaponId],
        this.weaponDropChances[weaponId]
      );
    }
    this.enemyProjectileDamage.smallGuard = numberValue(
      saved.enemyProjectileDamage?.smallGuard,
      this.enemyProjectileDamage.smallGuard
    );
    this.enemyProjectileDamage.fan = numberValue(saved.enemyProjectileDamage?.fan, this.enemyProjectileDamage.fan);
    this.tutorialBgmSlot = Phaser.Math.Clamp(
      Math.round(numberValue(saved.bgm?.tutorialSlot, this.tutorialBgmSlot)),
      0,
      this.trackLabels.length - 1
    );
    this.levelBgmSlot = Phaser.Math.Clamp(
      Math.round(numberValue(saved.bgm?.levelSlot, this.levelBgmSlot)),
      0,
      this.trackLabels.length - 1
    );
    this.tutorialRhythmBpm = Phaser.Math.Clamp(
      numberValue(saved.bgm?.tutorialRhythmBpm, this.tutorialRhythmBpm),
      40,
      240
    );
    this.levelRhythmBpm = Phaser.Math.Clamp(
      numberValue(saved.bgm?.levelRhythmBpm, this.levelRhythmBpm),
      40,
      240
    );
    this.tutorialSongBpm = Phaser.Math.Clamp(
      numberValue(saved.bgm?.tutorialSongBpm, this.tutorialSongBpm),
      40,
      240
    );
    this.levelSongBpm = Phaser.Math.Clamp(
      numberValue(saved.bgm?.levelSongBpm, this.levelSongBpm),
      40,
      240
    );
    this.levelBeatAlignmentOffsetMs = Phaser.Math.Clamp(
      numberValue(saved.bgm?.levelBeatAlignmentOffsetMs, this.levelBeatAlignmentOffsetMs),
      -500,
      500
    );
  }

  private refresh(): void {
    this.playerInfiniteRangeButton
      .setFillStyle(this.glowstickInfiniteRange ? TUNING_ACCENT : TUNING_PANEL_LIGHT, this.glowstickInfiniteRange ? 0.9 : 0.94)
      .setStrokeStyle(2, this.glowstickInfiniteRange ? TUNING_ACCENT_DARK : TUNING_FRAME, 0.9);
    this.playerInfiniteRangeText.setText(this.glowstickInfiniteRange ? '已开启' : '已关闭');
    this.playerMaxRangeText.setText(`${Math.round(this.glowstickMaxRange)} px`);
    this.playerSpeedText.setText(Math.round(this.playerBulletSpeed) + ' px/s');
    this.enemySpeedText.setText(Math.round(this.enemyBulletSpeed) + ' px/s');
    this.enemyBeatSurgeButton
      .setFillStyle(this.enemyBulletBeatSurgeEnabled ? TUNING_ACCENT : TUNING_PANEL_LIGHT, this.enemyBulletBeatSurgeEnabled ? 0.9 : 0.94)
      .setStrokeStyle(2, this.enemyBulletBeatSurgeEnabled ? TUNING_ACCENT_DARK : TUNING_FRAME, 0.9);
    this.enemyBeatSurgeText.setText(this.enemyBulletBeatSurgeEnabled ? '已开启' : '已关闭');
    this.fanSpiralAttackChanceText.setText(`${Math.round(this.fanSpiralAttackChance * 100)}%`);
    this.tutorialSlotText.setText(this.trackLabels[this.tutorialBgmSlot]);
    this.levelSlotText.setText(this.trackLabels[this.levelBgmSlot]);
  }
}
