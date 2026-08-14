import Phaser from 'phaser';
import { MAIN_CAMERA_BASE_ZOOM, screenLayerOffset } from './cameraConfig';

export class TuningEditor {
  readonly container: Phaser.GameObjects.Container;
  playerBulletSpeed = 360;
  enemyBulletSpeed = 144;
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
      scene.add.rectangle(640, 350, 650, 480, 0x0f172a, 0.98).setStrokeStyle(2, 0xf59e0b, 0.95),
      scene.add.text(640, 135, '调参 Editor', {
        fontFamily: 'Arial', fontSize: '28px', fontStyle: 'bold', color: '#ffffff'
      }).setOrigin(0.5),
      scene.add.text(640, 570, '按 P 关闭并应用当前参数', {
        fontFamily: 'Arial', fontSize: '14px', color: '#94a3b8'
      }).setOrigin(0.5)
    ];

    const addLabel = (y: number, label: string): void => {
      objects.push(scene.add.text(390, y, label, {
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
    this.playerSpeedText = scene.add.text(720, 240, '', {
      fontFamily: 'Arial', fontSize: '18px', color: '#67e8f9'
    }).setOrigin(0.5);
    objects.push(this.playerSpeedText);
    addButton(660, 240, '−', () => {
      this.playerBulletSpeed = Phaser.Math.Clamp(this.playerBulletSpeed - 20, 100, 800);
      this.refresh();
    });
    addButton(780, 240, '+', () => {
      this.playerBulletSpeed = Phaser.Math.Clamp(this.playerBulletSpeed + 20, 100, 800);
      this.refresh();
    });

    addLabel(300, '敌人弹速');
    this.enemySpeedText = scene.add.text(720, 300, '', {
      fontFamily: 'Arial', fontSize: '18px', color: '#fca5a5'
    }).setOrigin(0.5);
    objects.push(this.enemySpeedText);
    addButton(660, 300, '−', () => {
      this.enemyBulletSpeed = Phaser.Math.Clamp(this.enemyBulletSpeed - 20, 40, 600);
      this.refresh();
    });
    addButton(780, 300, '+', () => {
      this.enemyBulletSpeed = Phaser.Math.Clamp(this.enemyBulletSpeed + 20, 40, 600);
      this.refresh();
    });

    addLabel(360, '弹幕节拍突进');
    this.enemyBeatSurgeButton = scene.add.rectangle(720, 360, 140, 36, 0x0f766e)
      .setStrokeStyle(1, 0x94a3b8)
      .setInteractive({ useHandCursor: true });
    this.enemyBeatSurgeText = scene.add.text(720, 360, '', {
      fontFamily: 'Arial', fontSize: '17px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5);
    this.enemyBeatSurgeButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.enemyBulletBeatSurgeEnabled = !this.enemyBulletBeatSurgeEnabled;
      this.refresh();
    });
    objects.push(this.enemyBeatSurgeButton, this.enemyBeatSurgeText);

    addLabel(430, '教学关 BGM Slot');
    this.tutorialSlotText = scene.add.text(720, 430, '', {
      fontFamily: 'Arial', fontSize: '17px', color: '#fde68a'
    }).setOrigin(0.5);
    objects.push(this.tutorialSlotText);
    addButton(610, 430, '‹', () => this.cycleSlot('tutorial', -1));
    addButton(830, 430, '›', () => this.cycleSlot('tutorial', 1));

    addLabel(500, '正式关 BGM Slot');
    this.levelSlotText = scene.add.text(720, 500, '', {
      fontFamily: 'Arial', fontSize: '17px', color: '#fde68a'
    }).setOrigin(0.5);
    objects.push(this.levelSlotText);
    addButton(610, 500, '‹', () => this.cycleSlot('level', -1));
    addButton(830, 500, '›', () => this.cycleSlot('level', 1));

    this.container = scene.add
      .container(screenLayerOffset(1280), screenLayerOffset(720), objects)
      .setDepth(31)
      .setScale(1 / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0)
      .setVisible(false);
    this.refresh();
  }

  get visible(): boolean {
    return this.container.visible;
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
