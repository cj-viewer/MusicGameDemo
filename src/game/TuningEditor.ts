import Phaser from 'phaser';
import { MAIN_CAMERA_BASE_ZOOM, screenLayerOffset } from './cameraConfig';
import { UI_SCALE, VIEW_HEIGHT, VIEW_WIDTH } from './displayConfig';
import type { AttackJudgement } from './ComboSystem';
import type { WeaponId } from './weapons';

export type TunableEnemyKind = 'smallGuard' | 'midGuard' | 'fan';

export function passesDropChance(chance: number, roll = Math.random()): boolean {
  const clampedChance = Phaser.Math.Clamp(chance, 0, 1);
  if (clampedChance <= 0) return false;
  if (clampedChance >= 1) return true;
  return roll < clampedChance;
}

export class TuningEditor {
  readonly container: Phaser.GameObjects.Container;
  glowstickBulletSpeed = 360;
  glowstickInfiniteRange = true;
  glowstickMaxRange = 164;
  glowstickAttackSpeed = 1;
  glowstickLightAttackSpeed = 1;
  glowstickHeavyAttackSpeed = 1;
  batonSweepSpeed = 1;
  batonAttackSpeed = 1;
  batonLightAttackSpeed = 1;
  batonHeavyAttackSpeed = 1;
  glowstickHeavyLaserEnabled = true;
  batonHeavyCrescentEnabled = true;
  glowstickHeavyChargeDelayMs = 0;
  glowstickHeavyLaserThickness = 56;
  batonHeavyCrescentRange = 424;
  batonLightSweepAngle = 180;
  batonLightSweepRange = 111;
  smallGuardBulletSpeed = 144;
  smallGuardAttackFrequency = 1;
  fanBulletSpeed = 144;
  fanAttackFrequency = 0.25;
  enemyDeathVolume = 1;
  fanSpiralAttackChance = 0.1;
  weaponJudgementDamageMultipliers: Record<WeaponId, Record<AttackJudgement, number>> = {
    glowsticks: { perfect: 1.2, good: 1, poor: 0.5 },
    baton: { perfect: 1.2, good: 1, poor: 0.5 }
  };
  weaponAttackDamage: Record<WeaponId, { light: number; heavy: number }> = {
    glowsticks: { light: 10, heavy: 18 },
    baton: { light: 12, heavy: 26 }
  };
  enemyProjectileDamage = {
    smallGuard: 12,
    fan: 12
  };
  weaponDropChances: Record<WeaponId, number> = {
    glowsticks: 1,
    baton: 1
  };
  enemyBulletBeatSurgeEnabled = false;
  tutorialBgmSlot = 3;
  levelBgmSlot = 1;

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
    const objects: Phaser.GameObjects.GameObject[] = [
      scene.add.rectangle(640, 360, 1280, 720, 0x000000, 0.62),
      scene.add.rectangle(640, 360, 1180, 650, 0x0f172a, 0.98).setStrokeStyle(2, 0xf59e0b, 0.95),
      scene.add.text(640, 52, 'DEBUG MENU', {
        fontFamily: 'Arial', fontSize: '28px', fontStyle: 'bold', color: '#ffffff'
      }).setOrigin(0.5),
      scene.add.text(640, 660, '按 P 关闭并应用当前参数', {
        fontFamily: 'Arial', fontSize: '14px', color: '#94a3b8'
      }).setOrigin(0.5)
    ];

    const addLabel = (y: number, label: string): void => {
      objects.push(scene.add.text(80, y, label, {
        fontFamily: 'Arial', fontSize: '18px', color: '#cbd5e1'
      }).setOrigin(0, 0.5));
    };
    const addButton = (x: number, y: number, label: string, onClick: () => void): void => {
      const rect = scene.add.rectangle(x, y, 42, 34, 0x334155).setStrokeStyle(1, 0x94a3b8)
        .setInteractive({ useHandCursor: true });
      const text = scene.add.text(x, y, label, {
        fontFamily: 'Arial', fontSize: '20px', color: '#ffffff'
      }).setOrigin(0.5);
      rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointer.event.stopPropagation();
        onClick();
      });
      objects.push(rect, text);
    };

    addLabel(120, '玩家远程无限射程');
    this.playerInfiniteRangeButton = scene.add.rectangle(430, 120, 180, 36, 0x334155)
      .setStrokeStyle(1, 0x94a3b8)
      .setInteractive({ useHandCursor: true });
    this.playerInfiniteRangeText = scene.add.text(430, 120, '', {
      fontFamily: 'Arial', fontSize: '17px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5);
    this.playerInfiniteRangeButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.glowstickInfiniteRange = !this.glowstickInfiniteRange;
      this.refresh();
    });
    objects.push(this.playerInfiniteRangeButton, this.playerInfiniteRangeText);

    addLabel(180, '玩家最远射程');
    this.playerMaxRangeText = scene.add.text(430, 180, '', {
      fontFamily: 'Arial', fontSize: '18px', color: '#67e8f9'
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
      fontFamily: 'Arial', fontSize: '18px', color: '#67e8f9'
    }).setOrigin(0.5);
    objects.push(this.playerSpeedText);
    addButton(370, 240, '−', () => {
      this.playerBulletSpeed = Phaser.Math.Clamp(this.playerBulletSpeed - 20, 100, 800);
      this.refresh();
    });
    addButton(490, 240, '+', () => {
      this.playerBulletSpeed = Phaser.Math.Clamp(this.playerBulletSpeed + 20, 100, 800);
      this.refresh();
    });

    addLabel(300, '敌人弹速');
    this.enemySpeedText = scene.add.text(430, 300, '', {
      fontFamily: 'Arial', fontSize: '18px', color: '#fca5a5'
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
    this.enemyBeatSurgeButton = scene.add.rectangle(430, 360, 140, 36, 0x0f766e)
      .setStrokeStyle(1, 0x94a3b8)
      .setInteractive({ useHandCursor: true });
    this.enemyBeatSurgeText = scene.add.text(430, 360, '', {
      fontFamily: 'Arial', fontSize: '17px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5);
    this.enemyBeatSurgeButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.enemyBulletBeatSurgeEnabled = !this.enemyBulletBeatSurgeEnabled;
      this.refresh();
    });
    objects.push(this.enemyBeatSurgeButton, this.enemyBeatSurgeText);

    addLabel(420, '粉丝三向螺旋概率');
    this.fanSpiralAttackChanceText = scene.add.text(430, 420, '', {
      fontFamily: 'Arial', fontSize: '18px', color: '#fca5a5'
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
      fontFamily: 'Arial', fontSize: '17px', color: '#fde68a'
    }).setOrigin(0.5);
    objects.push(this.tutorialSlotText);
    addButton(320, 500, '‹', () => this.cycleSlot('tutorial', -1));
    addButton(540, 500, '›', () => this.cycleSlot('tutorial', 1));

    addLabel(580, '正式关 BGM Slot');
    this.levelSlotText = scene.add.text(430, 580, '', {
      fontFamily: 'Arial', fontSize: '17px', color: '#fde68a'
    }).setOrigin(0.5);
    objects.push(this.levelSlotText);
    addButton(320, 580, '‹', () => this.cycleSlot('level', -1));
    addButton(540, 580, '›', () => this.cycleSlot('level', 1));


    this.container = scene.add
      .container(screenLayerOffset(VIEW_WIDTH), screenLayerOffset(VIEW_HEIGHT), objects)
      .setDepth(31)
      .setScale(UI_SCALE / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0)
      .setVisible(false);
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

  getWeaponDropChance(weaponId: WeaponId): number {
    return this.weaponDropChances[weaponId];
  }

  /**
   * 用稳定键名记录所有玩家/敌人战斗调参；保留小数原值，便于把 TXT 回传后直接改成默认值。
   * BGM 与纯显示设置不属于战斗参数，因此不写入本文件。
   */
  buildCombatConfigText(generatedAt = new Date()): string {
    const lines = [
      '# MusicGameDemo 战斗参数快照',
      'schemaVersion=1',
      `generatedAt=${generatedAt.toISOString()}`,
      '',
      '[player]',
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
      '[enemy]',
      `smallGuardBulletSpeed=${this.smallGuardBulletSpeed}`,
      `smallGuardAttackFrequency=${this.smallGuardAttackFrequency}`,
      `fanBulletSpeed=${this.fanBulletSpeed}`,
      `fanAttackFrequency=${this.fanAttackFrequency}`,
      `smallGuardProjectileDamage=${this.enemyProjectileDamage.smallGuard}`,
      `fanProjectileDamage=${this.enemyProjectileDamage.fan}`,
      `enemyBulletBeatSurgeEnabled=${this.enemyBulletBeatSurgeEnabled}`,
      `enemyDeathVolume=${this.enemyDeathVolume}`,
      `fanSpiralAttackChance=${this.fanSpiralAttackChance}`,
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

  private refresh(): void {
    this.playerInfiniteRangeButton.setFillStyle(this.glowstickInfiniteRange ? 0x0f766e : 0x334155);
    this.playerInfiniteRangeText.setText(this.glowstickInfiniteRange ? '已开启' : '已关闭');
    this.playerMaxRangeText.setText(`${Math.round(this.glowstickMaxRange)} px`);
    this.playerSpeedText.setText(Math.round(this.playerBulletSpeed) + ' px/s');
    this.enemySpeedText.setText(Math.round(this.enemyBulletSpeed) + ' px/s');
    this.enemyBeatSurgeButton.setFillStyle(this.enemyBulletBeatSurgeEnabled ? 0x0f766e : 0x334155);
    this.enemyBeatSurgeText.setText(this.enemyBulletBeatSurgeEnabled ? '已开启' : '已关闭');
    this.fanSpiralAttackChanceText.setText(`${Math.round(this.fanSpiralAttackChance * 100)}%`);
    this.tutorialSlotText.setText(this.trackLabels[this.tutorialBgmSlot]);
    this.levelSlotText.setText(this.trackLabels[this.levelBgmSlot]);
  }
}
