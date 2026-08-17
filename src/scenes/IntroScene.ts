import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH, ui } from '../game/displayConfig';
import { queueCoreAssets, startBackgroundLoad } from '../game/assetManifest';

const INTRO_VIDEO_KEY = 'intro-video';
const ROCKET_VIDEO_KEY = 'intro-rocket-video';
const MAIN_MENU_BACKGROUND_KEY = 'main-menu-background';

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
  private menuBackground?: Phaser.GameObjects.Image;
  private menuContent?: Phaser.GameObjects.Container;

  constructor() {
    super('IntroScene');
  }

  preload(): void {
    const asset = (file: string): string => `${import.meta.env.BASE_URL}assets/${file}`;
    this.load.image(MAIN_MENU_BACKGROUND_KEY, asset('images/backgrounds/title/main-menu.png'));
    this.load.video(INTRO_VIDEO_KEY, asset('video/intro.mp4'));
    this.load.video(ROCKET_VIDEO_KEY, asset('video/intro-rocket.mp4'));
  }

  create(): void {
    this.started = false;
    this.finished = false;
    // 主界面与视频均覆盖完整 2K 内部画布；标题操作区固定在左上角。
    this.cameras.main.setZoom(1).setScroll(0, 0);
    this.cameras.main.setBackgroundColor('#000000');

    const backdrop = this.add.image(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, MAIN_MENU_BACKGROUND_KEY)
      // 给四向视差预留出血，指针到画面四角也不会露出底图边界。
      .setDisplaySize(VIEW_WIDTH + ui(48), VIEW_HEIGHT + ui(32));
    this.menuBackground = backdrop;
    // 将标题、说明和开始按钮收拢到同一个圆形菜单锚点，形成完整的左上信息组。
    const menuX = ui(185);
    const menuY = ui(184);
    const glow = this.add.circle(menuX, menuY, ui(164), 0x7c3aed, 0.2);
    const title = this.add
      .text(menuX, menuY - ui(78), '节奏星球', {
        fontFamily: 'Arial, Microsoft YaHei, sans-serif',
        fontSize: `${ui(48)}px`,
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#7c3aed',
        strokeThickness: 8,
        shadow: { color: '#d946ef', blur: 24, fill: true }
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(menuX, menuY - ui(18), 'DJ Drop the Beat', {
        fontFamily: 'Arial, sans-serif',
        fontSize: `${ui(20)}px`,
        fontStyle: 'bold',
        color: '#67e8f9',
        letterSpacing: 5
      })
      .setOrigin(0.5);

    this.startButton = this.add
      .rectangle(menuX, menuY + ui(66), ui(168), ui(50), 0xec4899, 0.94)
      .setStrokeStyle(ui(2), 0xffffff, 0.9)
      .setInteractive({ useHandCursor: true });
    this.startButtonText = this.add
      .text(menuX, menuY + ui(66), '开 始', {
        fontFamily: 'Arial',
        fontSize: `${ui(22)}px`,
        fontStyle: 'bold',
        color: '#ffffff'
      })
      .setOrigin(0.5);
    this.menuContent = this.add.container(0, 0, [glow, title, subtitle, this.startButton, this.startButtonText]).setDepth(2);
    this.startUi = this.menuContent;

    this.video = this.add.video(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, INTRO_VIDEO_KEY).setDepth(1).setVisible(false);
    this.video.once(Phaser.GameObjects.Events.VIDEO_CREATED, (_video: Phaser.GameObjects.Video, width: number, height: number) => {
      const scale = Math.min(VIEW_WIDTH / width, VIEW_HEIGHT / height);
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
      .text(VIEW_WIDTH - ui(20), VIEW_HEIGHT - ui(20), '空格跳过', {
        fontFamily: 'Arial, Microsoft YaHei, sans-serif',
        fontSize: `${ui(12)}px`,
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

  update(): void {
    if (!this.startUi?.visible || !this.menuBackground || !this.menuContent) return;
    const pointer = this.input.activePointer;
    const nx = Phaser.Math.Clamp(pointer.x / Math.max(1, this.scale.width) - 0.5, -0.5, 0.5);
    const ny = Phaser.Math.Clamp(pointer.y / Math.max(1, this.scale.height) - 0.5, -0.5, 0.5);
    // 背景位移更小、操作区略大，模拟菜单相机的浅层透视。
    this.menuBackground.setPosition(VIEW_WIDTH / 2 - nx * ui(18), VIEW_HEIGHT / 2 - ny * ui(12));
    this.menuContent.setPosition(-nx * ui(32), -ny * ui(22));
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
