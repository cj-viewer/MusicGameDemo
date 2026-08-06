import Phaser from 'phaser';

export class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2, 'Music Game Demo\nPhaser ' + Phaser.VERSION, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '48px',
        color: '#ffffff',
        align: 'center'
      })
      .setOrigin(0.5);
  }
}
