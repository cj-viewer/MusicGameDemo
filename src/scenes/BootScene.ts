import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    // 在这里加载全局资源（音频、图集等）
  }

  create(): void {
    this.scene.start('MainScene');
  }
}
