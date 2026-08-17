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
  glowstickAttackSpeed = 1;
  batonSweepSpeed = 1;
  batonAttackSpeed = 1;
  smallGuardBulletSpeed = 144;
  smallGuardAttackFrequency = 1;
  fanBulletSpeed = 144;
  fanAttackFrequency = 1;
  weaponJudgementDamageMultipliers: Record<WeaponId, Record<AttackJudgement, number>> = {
    glowsticks: { perfect: 1.2, good: 1, poor: 0.5 },
    baton: { perfect: 1.2, good: 1, poor: 0.5 }
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
  levelBgmSlot = 0;

  private playerSpeedText: Phaser.GameObjects.Text;
  private enemySpeedText: Phaser.GameObjects.Text;
  private enemyBeatSurgeButton: Phaser.GameObjects.Rectangle;
  private enemyBeatSurgeText: Phaser.GameObjects.Text;
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

    addLabel(430, '教学关 BGM Slot');
    this.tutorialSlotText = scene.add.text(430, 430, '', {
      fontFamily: 'Arial', fontSize: '17px', color: '#fde68a'
    }).setOrigin(0.5);
    objects.push(this.tutorialSlotText);
    addButton(320, 430, '‹', () => this.cycleSlot('tutorial', -1));
    addButton(540, 430, '›', () => this.cycleSlot('tutorial', 1));

    addLabel(500, '正式关 BGM Slot');
    this.levelSlotText = scene.add.text(430, 500, '', {
      fontFamily: 'Arial', fontSize: '17px', color: '#fde68a'
    }).setOrigin(0.5);
    objects.push(this.levelSlotText);
    addButton(320, 500, '‹', () => this.cycleSlot('level', -1));
    addButton(540, 500, '›', () => this.cycleSlot('level', 1));


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

  getEnemyProjectileDamage(kind: TunableEnemyKind): number {
    return kind === 'fan' ? this.enemyProjectileDamage.fan : this.enemyProjectileDamage.smallGuard;
  }

  getWeaponDropChance(weaponId: WeaponId): number {
    return this.weaponDropChances[weaponId];
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
    this.playerSpeedText.setText(Math.round(this.playerBulletSpeed) + ' px/s');
    this.enemySpeedText.setText(Math.round(this.enemyBulletSpeed) + ' px/s');
    this.enemyBeatSurgeButton.setFillStyle(this.enemyBulletBeatSurgeEnabled ? 0x0f766e : 0x334155);
    this.enemyBeatSurgeText.setText(this.enemyBulletBeatSurgeEnabled ? '已开启' : '已关闭');
    this.tutorialSlotText.setText(this.trackLabels[this.tutorialBgmSlot]);
    this.levelSlotText.setText(this.trackLabels[this.levelBgmSlot]);
  }
}
