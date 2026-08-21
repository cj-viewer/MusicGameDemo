import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH, ui } from '../game/displayConfig';
import { queueCoreAssets, startBackgroundLoad } from '../game/assetManifest';

const INTRO_VIDEO_KEY = 'intro-video';
const INTRO_TITLE_BACKGROUND_KEY = 'intro-title-background';
const INTRO_UI_FONT = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const INTRO_PANEL = 0xf0c9df;
const INTRO_PANEL_LIGHT = 0xffe9f5;
const INTRO_FRAME = 0x6b4b78;
const INTRO_TEXT = '#4f3b63';
const INTRO_CYAN = 0x4ec8c9;

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
    this.load.image(
      INTRO_TITLE_BACKGROUND_KEY,
      asset('images/backgrounds/intro/intro-title-background-1280.webp')
    );
    this.load.video(INTRO_VIDEO_KEY, asset('video/intro.mp4'));
  }

  create(): void {
    this.started = false;
    this.finished = false;
    // 主界面与视频均覆盖完整 2K 内部画布；开始按钮沿用视觉稿右上留白位置。
    this.cameras.main.setZoom(1).setScroll(0, 0);
    this.cameras.main.setBackgroundColor('#000000');

    this.textures.get(INTRO_TITLE_BACKGROUND_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
    const backdrop = this.add.image(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, INTRO_TITLE_BACKGROUND_KEY);
    // 保持项目方原图比例，以 Cover 铺满 2K 画布；额外出血用于四向轻视差，避免露边。
    const coverScale = Math.max(
      (VIEW_WIDTH + ui(48)) / backdrop.width,
      (VIEW_HEIGHT + ui(32)) / backdrop.height
    );
    backdrop.setDisplaySize(backdrop.width * coverScale, backdrop.height * coverScale);
    this.menuBackground = backdrop;

    const buttonX = ui(1060);
    const buttonY = ui(205);
    this.startButton = this.add
      .rectangle(buttonX, buttonY, ui(220), ui(60), INTRO_PANEL, 0.94)
      .setStrokeStyle(ui(3), INTRO_FRAME, 0.95)
      .setInteractive({ useHandCursor: true });
    const startButtonInner = this.add
      .rectangle(buttonX, buttonY - ui(16), ui(204), ui(8), INTRO_PANEL_LIGHT, 0.55);
    const startPixelTabs = [
      this.add.rectangle(buttonX - ui(82), buttonY - ui(34), ui(14), ui(6), INTRO_FRAME, 0.9),
      this.add.rectangle(buttonX + ui(82), buttonY - ui(34), ui(14), ui(6), INTRO_FRAME, 0.9),
      this.add.rectangle(buttonX - ui(82), buttonY + ui(34), ui(14), ui(6), INTRO_FRAME, 0.9),
      this.add.rectangle(buttonX + ui(82), buttonY + ui(34), ui(14), ui(6), INTRO_FRAME, 0.9)
    ];
    this.startButtonText = this.add
      .text(buttonX, buttonY, '单 人 模 式', {
        fontFamily: INTRO_UI_FONT,
        fontSize: `${ui(26)}px`,
        fontStyle: 'bold',
        color: INTRO_TEXT,
        letterSpacing: ui(6),
        resolution: 2,
        shadow: { color: '#fff0fa', blur: 0, fill: true, offsetX: ui(1), offsetY: ui(1) }
      })
      .setOrigin(0.5);
    this.menuContent = this.add
      .container(0, 0, [this.startButton, startButtonInner, ...startPixelTabs, this.startButtonText])
      .setDepth(2);
    this.startUi = this.menuContent;

    this.video = this.add.video(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, INTRO_VIDEO_KEY).setDepth(1).setVisible(false);
    this.video.once(Phaser.GameObjects.Events.VIDEO_CREATED, (_video: Phaser.GameObjects.Video, width: number, height: number) => {
      const scale = Math.min(VIEW_WIDTH / width, VIEW_HEIGHT / height);
      this.video?.setDisplaySize(width * scale, height * scale);
    });
    this.video.on(Phaser.GameObjects.Events.VIDEO_COMPLETE, this.finishIntro, this);
    this.video.on(Phaser.GameObjects.Events.VIDEO_ERROR, this.onVideoError, this);
    this.video.on(Phaser.GameObjects.Events.VIDEO_LOCKED, this.restoreStartButton, this);
    // 片头真正开始播放后，用这段放映时间把 MainScene 的贴图和教学 BGM 预热到缓存里，
    // 玩家看完片头就能直接进教学关，而不是再等一轮几 MB 的下载。
    this.video.on(Phaser.GameObjects.Events.VIDEO_PLAYING, this.onVideoPlaying, this);

    this.startButton.on('pointerover', () =>
      this.startButton?.setFillStyle(INTRO_PANEL_LIGHT, 0.96).setStrokeStyle(ui(3), INTRO_FRAME, 1)
    );
    this.startButton.on('pointerout', () =>
      this.startButton?.setFillStyle(INTRO_PANEL, 0.94).setStrokeStyle(ui(3), INTRO_FRAME, 0.95)
    );
    this.startButton.on('pointerdown', this.playIntro, this);

    const multiplayerY = ui(285);
    const multiplayerButton = this.add
      .rectangle(buttonX, multiplayerY, ui(220), ui(60), INTRO_CYAN, 0.9)
      .setStrokeStyle(ui(3), 0x1e7577, 0.95)
      .setInteractive({ useHandCursor: true });
    const multiplayerInner = this.add
      .rectangle(buttonX, multiplayerY - ui(16), ui(204), ui(8), 0xd7ffff, 0.45);
    const multiplayerPixelTabs = [
      this.add.rectangle(buttonX - ui(82), multiplayerY - ui(34), ui(14), ui(6), 0x1e7577, 0.9),
      this.add.rectangle(buttonX + ui(82), multiplayerY - ui(34), ui(14), ui(6), 0x1e7577, 0.9),
      this.add.rectangle(buttonX - ui(82), multiplayerY + ui(34), ui(14), ui(6), 0x1e7577, 0.9),
      this.add.rectangle(buttonX + ui(82), multiplayerY + ui(34), ui(14), ui(6), 0x1e7577, 0.9)
    ];
    const multiplayerText = this.add.text(buttonX, multiplayerY, '多 人 联 机', {
      fontFamily: INTRO_UI_FONT,
      fontSize: ui(24) + 'px', fontStyle: 'bold', color: INTRO_TEXT, letterSpacing: ui(4), resolution: 2
    }).setOrigin(0.5);
    this.menuContent.add([multiplayerButton, multiplayerInner, ...multiplayerPixelTabs, multiplayerText]);
    multiplayerButton
      .on('pointerover', () => multiplayerButton.setFillStyle(0x7de1e2, 0.96))
      .on('pointerout', () => multiplayerButton.setFillStyle(INTRO_CYAN, 0.9))
      .on('pointerdown', () => this.scene.start('MultiplayerLobbyScene'));

    this.skipText = this.add
      .text(VIEW_WIDTH - ui(20), VIEW_HEIGHT - ui(20), '空格跳过', {
        fontFamily: INTRO_UI_FONT,
        fontSize: `${ui(12)}px`,
        color: '#fff0fa'
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
    this.input.keyboard?.once('keydown-SPACE', this.finishIntro, this);
    this.startButton?.disableInteractive();
    this.startUi?.setVisible(false);
    this.video.setVisible(true).setMute(false).setVolume(1);
    this.skipText?.setVisible(true);
    this.video.play(false);
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
    this.video?.off(Phaser.GameObjects.Events.VIDEO_COMPLETE, this.finishIntro, this);
    this.video?.off(Phaser.GameObjects.Events.VIDEO_ERROR, this.onVideoError, this);
    this.video?.off(Phaser.GameObjects.Events.VIDEO_LOCKED, this.restoreStartButton, this);
    this.video?.off(Phaser.GameObjects.Events.VIDEO_PLAYING, this.onVideoPlaying, this);
    this.video?.stop(false);
    this.video?.destroy();
    this.menuBackground?.destroy();
    this.menuContent?.destroy(true);
    this.skipText?.destroy();
    this.video = undefined;
    this.menuBackground = undefined;
    this.menuContent = undefined;
    this.startUi = undefined;
    this.skipText = undefined;
    if (this.textures.exists(INTRO_TITLE_BACKGROUND_KEY)) {
      this.textures.remove(INTRO_TITLE_BACKGROUND_KEY);
    }
    if (this.cache.video.exists(INTRO_VIDEO_KEY)) {
      this.cache.video.remove(INTRO_VIDEO_KEY);
    }
  }
}
