import Phaser from 'phaser';
import { UI_SCALE } from '../game/displayConfig';
import { queueCoreAssets, startBackgroundLoad } from '../game/assetManifest';

const INTRO_VIDEO_KEY = 'intro-video';
const ROCKET_VIDEO_KEY = 'intro-rocket-video';

export class IntroScene extends Phaser.Scene {
  private video?: Phaser.GameObjects.Video;
  private startUi?: Phaser.GameObjects.Container;
  private startButton?: Phaser.GameObjects.Rectangle;
  private skipText?: Phaser.GameObjects.Text;
  private startButtonText?: Phaser.GameObjects.Text;
  private warmupTimer?: Phaser.Time.TimerEvent;
  private warmed = false;
  private started = false;
  private finished = false;

  constructor() {
    super('IntroScene');
  }

  preload(): void {
    const asset = (file: string): string => `${import.meta.env.BASE_URL}assets/${file}`;
    this.load.video(INTRO_VIDEO_KEY, asset('video/intro.mp4'));
    this.load.video(ROCKET_VIDEO_KEY, asset('video/intro-rocket.mp4'));
  }

  create(): void {
    this.started = false;
    this.finished = false;
    // 片头沿用旧 1280×720 排版，但在 1920×1080 内部画布上等比铺满。
    this.cameras.main.setZoom(UI_SCALE).centerOn(640, 360);
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
    this.video.on(Phaser.GameObjects.Events.VIDEO_COMPLETE, this.playRocketIntro, this);
    this.video.on(Phaser.GameObjects.Events.VIDEO_ERROR, this.onVideoError, this);
    this.video.on(Phaser.GameObjects.Events.VIDEO_LOCKED, this.restoreStartButton, this);
    // 片头真正开始播放后，用这段放映时间把 MainScene 的贴图和教学 BGM 预热到缓存里，
    // 玩家看完片头就能直接进教学关，而不是再等一轮几 MB 的下载。
    this.video.on(Phaser.GameObjects.Events.VIDEO_PLAYING, this.onVideoPlaying, this);

    this.startButton.on('pointerover', () => this.startButton?.setFillStyle(0xf472b6));
    this.startButton.on('pointerout', () => this.startButton?.setFillStyle(0xec4899));
    this.startButton.on('pointerdown', this.playIntro, this);
    this.input.keyboard?.once('keydown-SPACE', this.finishIntro, this);

    this.skipText = this.add
      .text(1248, 688, '空格跳过', {
        fontFamily: 'Arial, Microsoft YaHei, sans-serif',
        fontSize: '18px',
        color: '#ffffff'
      })
      .setOrigin(1)
      .setAlpha(0.75)
      .setDepth(3)
      .setVisible(false);

    // 玩家一直停在标题页时也别浪费带宽：稍等一会儿仍然开始预热。
    this.warmupTimer = this.time.delayedCall(5000, this.warmGameAssets, undefined, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
  }

  /** 把 MainScene 需要的资源排进本 Scene 的 Loader，在后台下载（只做一次）。 */
  private warmGameAssets(): void {
    if (this.warmed) return;
    this.warmed = true;
    this.warmupTimer?.remove();
    this.warmupTimer = undefined;
    queueCoreAssets(this);
    startBackgroundLoad(this);
  }

  private onVideoPlaying(): void {
    this.warmGameAssets();
  }

  private onVideoError(): void {
    this.warmGameAssets();
    this.finishIntro();
  }

  private playIntro(): void {
    if (!this.video || this.started || this.finished) return;
    this.started = true;
    this.startButton?.disableInteractive();
    this.startUi?.setVisible(false);
    this.video.setVisible(true).setMute(false).setVolume(1);
    this.skipText?.setVisible(true);
    this.video.play(false);
  }

  private playRocketIntro(): void {
    if (this.finished || !this.video) {
      this.finishIntro();
      return;
    }
    // 复用已经由玩家点击解锁的同一个 HTMLVideoElement。若创建第二个 Video
    // GameObject，新的有声媒体元素可能再次被浏览器媒体策略拦截。
    this.video.off(Phaser.GameObjects.Events.VIDEO_COMPLETE, this.playRocketIntro, this);
    this.video.once(Phaser.GameObjects.Events.VIDEO_COMPLETE, this.finishIntro, this);
    this.video.setVisible(true).setMute(false).setVolume(1);
    this.video.changeSource(ROCKET_VIDEO_KEY, true, false);
  }

  private restoreStartButton(): void {
    if (this.finished) return;
    this.started = false;
    this.video?.setVisible(false);
    this.startUi?.setVisible(true);
    this.skipText?.setVisible(false);
    this.startButton?.setInteractive({ useHandCursor: true });
    this.startButtonText?.setText('点击继续');
  }

  private finishIntro(): void {
    if (this.finished) return;
    this.finished = true;
    this.input.keyboard?.off('keydown-SPACE', this.finishIntro, this);
    this.skipText?.setVisible(false);
    this.video?.stop(false);
    this.scene.start('MainScene');
  }

  private cleanup(): void {
    this.warmupTimer?.remove();
    this.warmupTimer = undefined;
    this.input.keyboard?.off('keydown-SPACE', this.finishIntro, this);
    this.video?.off(Phaser.GameObjects.Events.VIDEO_COMPLETE, this.playRocketIntro, this);
    this.video?.off(Phaser.GameObjects.Events.VIDEO_COMPLETE, this.finishIntro, this);
    this.video?.off(Phaser.GameObjects.Events.VIDEO_ERROR, this.onVideoError, this);
    this.video?.off(Phaser.GameObjects.Events.VIDEO_LOCKED, this.restoreStartButton, this);
    this.video?.off(Phaser.GameObjects.Events.VIDEO_PLAYING, this.onVideoPlaying, this);
  }
}
