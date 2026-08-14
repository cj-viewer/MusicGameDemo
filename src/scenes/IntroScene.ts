import Phaser from 'phaser';

const INTRO_VIDEO_KEY = 'intro-video';

export class IntroScene extends Phaser.Scene {
  private video?: Phaser.GameObjects.Video;
  private startUi?: Phaser.GameObjects.Container;
  private startButton?: Phaser.GameObjects.Rectangle;
  private startButtonText?: Phaser.GameObjects.Text;
  private started = false;
  private finished = false;

  constructor() {
    super('IntroScene');
  }

  preload(): void {
    const asset = (file: string): string => `${import.meta.env.BASE_URL}assets/${file}`;
    this.load.video(INTRO_VIDEO_KEY, asset('video/intro.mp4'));
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');

    const backdrop = this.add.rectangle(640, 360, 1280, 720, 0x090516);
    const glow = this.add.circle(640, 315, 265, 0x7c3aed, 0.22);
    const title = this.add
      .text(640, 245, '节奏星球', {
        fontFamily: 'Arial, Microsoft YaHei, sans-serif',
        fontSize: '86px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#7c3aed',
        strokeThickness: 8,
        shadow: { color: '#d946ef', blur: 24, fill: true }
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(640, 350, 'DJ Drop the Beat', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#67e8f9',
        letterSpacing: 5
      })
      .setOrigin(0.5);

    this.startButton = this.add
      .rectangle(640, 500, 260, 76, 0xec4899, 1)
      .setStrokeStyle(3, 0xffffff, 0.9)
      .setInteractive({ useHandCursor: true });
    this.startButtonText = this.add
      .text(640, 500, '开 始', {
        fontFamily: 'Arial',
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#ffffff'
      })
      .setOrigin(0.5);
    this.startUi = this.add.container(0, 0, [backdrop, glow, title, subtitle, this.startButton, this.startButtonText]).setDepth(2);

    this.video = this.add.video(640, 360, INTRO_VIDEO_KEY).setDepth(1).setVisible(false);
    this.video.once(Phaser.GameObjects.Events.VIDEO_CREATED, (_video: Phaser.GameObjects.Video, width: number, height: number) => {
      const scale = Math.min(1280 / width, 720 / height);
      this.video?.setDisplaySize(width * scale, height * scale);
    });
    this.video.on(Phaser.GameObjects.Events.VIDEO_COMPLETE, this.finishIntro, this);
    this.video.on(Phaser.GameObjects.Events.VIDEO_ERROR, this.finishIntro, this);
    this.video.on(Phaser.GameObjects.Events.VIDEO_LOCKED, this.restoreStartButton, this);

    this.startButton.on('pointerover', () => this.startButton?.setFillStyle(0xf472b6));
    this.startButton.on('pointerout', () => this.startButton?.setFillStyle(0xec4899));
    this.startButton.on('pointerdown', this.playIntro, this);

    this.add
      .text(1248, 688, '空格跳过', {
        fontFamily: 'Arial, Microsoft YaHei, sans-serif',
        fontSize: '18px',
        color: '#ffffff'
      })
      .setOrigin(1)
      .setAlpha(0.75)
      .setDepth(3);
    this.input.keyboard?.on('keydown-SPACE', this.finishIntro, this);
  }

  private playIntro(): void {
    if (!this.video || this.started || this.finished) return;
    this.started = true;
    this.startButton?.disableInteractive();
    this.startUi?.setVisible(false);
    this.video.setVisible(true).setMute(false).setVolume(1);
    this.video.play(false);
  }

  private restoreStartButton(): void {
    if (this.finished) return;
    this.started = false;
    this.video?.setVisible(false);
    this.startUi?.setVisible(true);
    this.startButton?.setInteractive({ useHandCursor: true });
    this.startButtonText?.setText('点击继续');
  }

  private finishIntro(): void {
    if (this.finished) return;
    this.finished = true;
    this.input.keyboard?.off('keydown-SPACE', this.finishIntro, this);
    this.video?.stop(false);
    this.scene.start('MainScene');
  }
}
