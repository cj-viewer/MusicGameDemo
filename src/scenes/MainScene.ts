import Phaser from 'phaser';
import { Conductor, type BeatInfo } from '../core/Conductor';
import { Sfx } from '../core/Sfx';
import { ComboSystem } from '../game/ComboSystem';
import { HUD } from '../game/HUD';
import { Player, PLAYER_RADIUS } from '../game/Player';
import { registerPlayerAnimations } from '../game/playerAnimation';
import { BATON, GLOWSTICKS, getAttackSpec, type WeaponDef } from '../game/weapons';
import { Enemy, FanEnemy, SmallGuard } from '../game/enemies';
import { GAMEPAD_BUTTON, rumbleParameters, type RumbleKind } from '../game/GamepadControls';
import { WORLD_OBJECT_SCALE, worldDepth, worldSize } from '../game/visualScale';
import type { FpvMiniScene } from './FpvMiniScene';
import { TuningEditor } from '../game/TuningEditor';
import {
  MAIN_CAMERA_BASE_ZOOM,
  MAIN_CAMERA_LOOK_DAMPING_MS,
  MAIN_CAMERA_LOOK_DEAD_ZONE,
  MAIN_CAMERA_LOOK_MAX_X,
  MAIN_CAMERA_LOOK_MAX_Y,
  screenLayerOffset
} from '../game/cameraConfig';

// bgm3.mp3 的实测节拍：对全曲 onset 包络做自相关 + 网格相位搜索得出 BPM，首拍在文件内 0.026s 处。
interface BgmTrack {
  key: string;
  label: string;
  bpm: number;
  firstBeatOffset: number;
  loopBeats: number;
}
const BGM_TRACKS: readonly BgmTrack[] = [
  { key: 'bgm-1', label: 'bgm1.mp3', bpm: 145, firstBeatOffset: 0.012, loopBeats: 498 },
  { key: 'bgm-2', label: 'bgm2.mp3', bpm: 176.47, firstBeatOffset: 0.02, loopBeats: 624 },
  { key: 'bgm-3', label: 'bgm3.mp3', bpm: 146.32, firstBeatOffset: 0.026, loopBeats: 616 },
  { key: 'bgm-0', label: 'bgm0.mp3', bpm: 153.846, firstBeatOffset: 0.09, loopBeats: 438 }
];
const DEFAULT_TUTORIAL_BGM_SLOT = 3;
const DEFAULT_LEVEL_BGM_SLOT = 0;
const BPM = BGM_TRACKS[DEFAULT_TUTORIAL_BGM_SLOT].bpm;

/** BGM 通道对外仍以 100% 为默认值；内部基础混音衰减到旧版 0.3 的三分之一。 */
const BGM_VOLUME = 0.05;

const DEFAULT_MASTER_VOLUME = 1.5;
const MAX_MASTER_VOLUME = 3;
const DEFAULT_BGM_CHANNEL_VOLUME = 1;
const DEFAULT_SFX_CHANNEL_VOLUME = 1;
const MAX_CHANNEL_VOLUME = 2;
const VOLUME_TRACK_X = 440;
const VOLUME_TRACK_WIDTH = 400;
const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 720;
/** 主场景轻微拉远，并按角色靠近场地边缘的程度做 Cinemachine 风格前探。 */
const CAMERA_BASE_SCROLL_X = screenLayerOffset(VIEW_WIDTH);
const CAMERA_BASE_SCROLL_Y = screenLayerOffset(VIEW_HEIGHT);
const ARENA_MARGIN = 12;
const RHYTHM_EDGE_BAND = 82;
const ARENA = {
  x: ARENA_MARGIN + RHYTHM_EDGE_BAND,
  y: ARENA_MARGIN,
  width: VIEW_WIDTH - (ARENA_MARGIN + RHYTHM_EDGE_BAND) * 2,
  height: VIEW_HEIGHT - ARENA_MARGIN * 2 - RHYTHM_EDGE_BAND
};
const ARENA_BORDER_BASE_COLOR = 0x6b3b70;
const ARENA_BEAT_LIGHT_COLOR = 0xe879f9;
const ARENA_BEAT_HEAVY_COLOR = 0xf97316;
/** 正式游戏同时预览未来三拍：每个框在各自的拍点抵达大框。 */
const ARENA_BEAT_CUE_START_SCALE = 0.7;
const ARENA_BEAT_CUE_LOOKAHEAD = 3;
const ARENA_BEAT_CUE_MIN_ALPHA = 0;
const TUTORIAL_CALIBRATION_SAMPLES = 12;
const TUTORIAL_CALIBRATION_MAX_ABS_OFFSET = 0.12;
const TUTORIAL_CALIBRATION_CANDIDATE_WINDOW = 0.18;
const TUTORIAL_CALIBRATION_MAX_SPREAD = 0.04;
const PLAYER_BULLET_LENGTH = worldSize(38);
const ENEMY_BULLET_LENGTH = worldSize(36 * 0.75);
const BULLET_THICKNESS = worldSize(10);
const ENEMY_BULLET_THICKNESS = BULLET_THICKNESS * 0.75;
const DEFAULT_PLAYER_BULLET_SPEED = 360;
/** 敌方弹幕基础速度由旧版 180 px/s 下调为 0.8 倍。 */
const DEFAULT_ENEMY_BULLET_SPEED = 180 * 0.8;
/** 每拍前 0.2 秒以归一化 easeInExpo 重分配位移，总行程仍为基础速度 × 0.2 秒。 */
const ENEMY_BULLET_BEAT_SURGE_WINDOW = 0.2;
const PLAYER_BULLET_COLOR = 0xef4444;
const BATON_BULLET_COLOR = 0xa855f7;
const GLOWSTICK_KNOCKBACK_SPEED = 150;
const BATON_KNOCKBACK_SPEED = GLOWSTICK_KNOCKBACK_SPEED * 1.25;

type GameState = 'title' | 'tutorial' | 'tutorialConfirm' | 'playing' | 'intermission' | 'over';

/** 教学要求连续全对的小节数 */
const TUTORIAL_TARGET_STREAK = 3;
type BeatSfxCue = 'playerHurt' | 'feverStart' | 'enemyHurt' | 'pickup';

const WAVE_ENEMY_COUNTS = [6, 10, 16, 24, 36];

interface Pickup {
  go: Phaser.GameObjects.Container;
  parts: Phaser.GameObjects.Rectangle[];
  colors: number[];
  baseY: number;
  weapon: WeaponDef;
}

export class MainScene extends Phaser.Scene {
  conductor!: Conductor;
  sfx!: Sfx;
  combo!: ComboSystem;
  hud!: HUD;
  player!: Player;

  private bgm!: Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
  private bgmFirstBeat = 0;
  private currentBgmTrack: BgmTrack = BGM_TRACKS[DEFAULT_TUTORIAL_BGM_SLOT];
  private tuningEditor!: TuningEditor;
  private masterVolume = DEFAULT_MASTER_VOLUME;
  private bgmChannelVolume = DEFAULT_BGM_CHANNEL_VOLUME;
  private sfxChannelVolume = DEFAULT_SFX_CHANNEL_VOLUME;
  private volumePanel!: Phaser.GameObjects.Container;
  private volumeFill!: Phaser.GameObjects.Rectangle;
  private volumeThumb!: Phaser.GameObjects.Arc;
  private volumeValueText!: Phaser.GameObjects.Text;
  private bgmVolumeFill!: Phaser.GameObjects.Rectangle;
  private bgmVolumeThumb!: Phaser.GameObjects.Arc;
  private bgmVolumeValueText!: Phaser.GameObjects.Text;
  private sfxVolumeFill!: Phaser.GameObjects.Rectangle;
  private sfxVolumeThumb!: Phaser.GameObjects.Arc;
  private sfxVolumeValueText!: Phaser.GameObjects.Text;
  private volumePanelVisible = false;
  private volumeDragging: 'master' | 'bgm' | 'sfx' | null = null;
  private fpvWindowEnabled = true;
  private fpvToggleButton!: Phaser.GameObjects.Rectangle;
  private fpvToggleText!: Phaser.GameObjects.Text;
  /** ESC 设置打开时，主场景和观察窗都保持在同一帧。 */
  private gamePaused = false;
  private cameraLookX = 0;
  private cameraLookY = 0;

  private enemies: Enemy[] = [];
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBulletHitboxes!: Phaser.Physics.Arcade.Group;
  private playerBulletHitboxes!: Phaser.Physics.Arcade.Group;
  private pickups: Pickup[] = [];
  private state: GameState = 'title';
  private waveIdx = -1;
  private displayedWaveNumber = 0;
  private victoryAchieved = false;
  private lastComboLevel = 0;
  private arenaBorder!: Phaser.GameObjects.Rectangle;
  private arenaBeatCues: Phaser.GameObjects.Rectangle[] = [];
  private arenaCorrectFeedback!: Phaser.GameObjects.Rectangle;
  private feverBorder!: Phaser.GameObjects.Graphics;
  private rhythmBlocks: Phaser.GameObjects.Rectangle[] = [];
  private rhythmPulseUntil = 0;
  private pendingBeatSfx = new Set<BeatSfxCue>();
  private gamepadButtonState = { dodge: false, attack: false };
  /** 调试：B 键切换判定框显示（红=受击判定，绿=武器/子弹判定），重开局保留开关状态 */
  private debugHitboxes = false;
  private debugGfx!: Phaser.GameObjects.Graphics;

  // 顶部连段面板只在教学模式显示；正式游戏改用场地扩散框提示拍点
  private patternPanel?: Phaser.GameObjects.Container;
  private patternIcons: Phaser.GameObjects.Shape[] = [];

  // 教学状态
  private tutorialStreakText?: Phaser.GameObjects.Text;
  private tutorialStreak = 0;
  private tutorialHitBeats = new Set<number>();
  private tutorialFailedMeasures = new Set<number>();
  private tutorialTimingOffsets: number[] = [];
  private tutorialCalibrationBeats = new Set<number>();
  private tutorialCalibratedOffset = 0;
  private confirmUi?: Phaser.GameObjects.Container;
  /** 教学场地上的操作图，位于底图之上、角色之下。 */
  private tutorialControlGuide?: Phaser.GameObjects.Container;
  /** 确认按钮点击后短暂屏蔽攻击输入，避免同一次点击又触发挥击 */
  private suppressAttackUntil = 0;
  /** 进入游戏的节拍倒计时（每小节减一），-1 表示未激活 */
  private countdownRemaining = -1;

  constructor() {
    super('MainScene');
  }

  preload(): void {
    const asset = (file: string): string => `${import.meta.env.BASE_URL}assets/${file}`;
    this.load.image('guard', asset('images/characters/guard.png'));
    for (const animation of ['run', 'roll', 'attack']) {
      const firstFrame = animation === 'run' ? 2 : 1;
      const lastFrame = animation === 'run' ? 5 : 6;
      for (let index = firstFrame; index <= lastFrame; index++) {
        const frame = String(index).padStart(2, '0');
        this.load.image(`fan-${animation}-${index}`, asset(`images/characters/fan/${animation}/${animation}-${frame}.png`));
      }
    }
    for (let index = 1; index <= 2; index++) {
      this.load.image(`player-idle-${index}`, asset(`images/characters/player/idle/idle-0${index}.png`));
    }
    for (let index = 1; index <= 4; index++) {
      this.load.image(`player-run-${index}`, asset(`images/characters/player/run/run-0${index}.png`));
    }
    this.load.image('player-down-1', asset('images/characters/player/down/down-01.png'));
    this.load.audio('beat-light', asset('audio/sfx/sfx-beat-light.mp3'));
    this.load.audio('beat-heavy', asset('audio/sfx/sfx-beat-heavy.mp3'));
    this.load.audio('bgm-1', asset('audio/music/bgm1.mp3'));
    this.load.audio('bgm-2', asset('audio/music/bgm2.mp3'));
    this.load.audio('bgm-3', asset('audio/music/bgm3.mp3'));
    this.load.audio('bgm-0', asset('audio/music/bgm0.mp3'));
  }

  create(): void {
    // 重开局（R 键）会在同一个 Scene 实例上重新执行 create()，先停掉旧的 bgm 避免叠放
    for (const track of BGM_TRACKS) this.sound.stopByKey(track.key);
    this.enemies = [];
    this.pickups = [];
    this.state = 'title';
    this.waveIdx = -1;
    this.displayedWaveNumber = 0;
    this.victoryAchieved = false;
    this.lastComboLevel = 0;
    this.rhythmBlocks = [];
    this.rhythmPulseUntil = 0;
    this.pendingBeatSfx.clear();
    this.gamepadButtonState = { dodge: false, attack: false };
    this.patternPanel = undefined;
    this.patternIcons = [];
    this.confirmUi = undefined;
    this.tutorialControlGuide = undefined;
    this.tutorialStreakText = undefined;
    this.tutorialStreak = 0;
    this.tutorialHitBeats.clear();
    this.tutorialFailedMeasures.clear();
    this.suppressAttackUntil = 0;
    this.countdownRemaining = -1;
    this.cameraLookX = 0;
    this.cameraLookY = 0;
    this.cameras.main.setZoom(MAIN_CAMERA_BASE_ZOOM).setScroll(CAMERA_BASE_SCROLL_X, CAMERA_BASE_SCROLL_Y);
    this.createFanAnimations();
    registerPlayerAnimations(this);

    this.physics.world.setBounds(ARENA.x, ARENA.y, ARENA.width, ARENA.height);
    this.arenaBorder = this.add
      .rectangle(ARENA.x + ARENA.width / 2, ARENA.y + ARENA.height / 2, ARENA.width, ARENA.height)
      .setStrokeStyle(3, ARENA_BORDER_BASE_COLOR, 1)
      .setDepth(1);
    this.arenaBeatCues = Array.from({ length: ARENA_BEAT_CUE_LOOKAHEAD }, () =>
      this.add
        .rectangle(ARENA.x + ARENA.width / 2, ARENA.y + ARENA.height / 2, ARENA.width, ARENA.height)
        .setStrokeStyle(3, ARENA_BEAT_LIGHT_COLOR, 1)
        .setScale(ARENA_BEAT_CUE_START_SCALE)
        .setAlpha(0)
        .setVisible(false)
        .setDepth(6)
    );
    this.arenaCorrectFeedback = this.add
      .rectangle(ARENA.x + ARENA.width / 2, ARENA.y + ARENA.height / 2, ARENA.width, ARENA.height)
      .setStrokeStyle(6, ARENA_BEAT_LIGHT_COLOR, 0)
      .setFillStyle(0, 0)
      .setVisible(false)
      .setDepth(8);
    this.createRhythmEdgeBlocks();

    this.debugGfx = this.add.graphics().setDepth(20);

    // Fever Time 期间的橙色边框光效（随节拍脉冲）
    this.feverBorder = this.add.graphics().setDepth(7).setAlpha(0);
    this.feverBorder.lineStyle(6, 0xf97316, 1);
    this.feverBorder.strokeRect(ARENA.x + 3, ARENA.y + 3, ARENA.width - 6, ARENA.height - 6);

    const soundManager = this.sound as Phaser.Sound.WebAudioSoundManager;
    soundManager.masterVolumeNode.gain.setValueAtTime(this.masterVolume, soundManager.context.currentTime);
    this.conductor = new Conductor(this, BPM);
    this.sfx = new Sfx(this.conductor.ctx, soundManager.destination);
    this.conductor.setSfxVolume(this.sfxChannelVolume);
    this.sfx.setVolume(this.sfxChannelVolume);
    this.currentBgmTrack = BGM_TRACKS[DEFAULT_TUTORIAL_BGM_SLOT];
    this.bgm = this.sound.add(this.currentBgmTrack.key, {
      loop: false,
      volume: BGM_VOLUME * this.bgmChannelVolume
    }) as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
    this.bgm.on(Phaser.Sound.Events.COMPLETE, this.onBgmComplete, this);
    this.combo = new ComboSystem(this.conductor, GLOWSTICKS.pattern);
    this.hud = new HUD(this, this.conductor);
    this.player = new Player(this, 640, 400);

    this.hud.setPattern(GLOWSTICKS.pattern, GLOWSTICKS.name);
    this.conductor.setCuePattern(GLOWSTICKS.pattern);
    this.hud.setHp(this.player.hp, this.player.maxHp);
    this.hud.setVictoryVisible(false);
    this.createSettingsPanel();
    this.tuningEditor = new TuningEditor(this, BGM_TRACKS.map((track) => track.label));
    this.tuningEditor.playerBulletSpeed = DEFAULT_PLAYER_BULLET_SPEED;
    this.tuningEditor.enemyBulletSpeed = DEFAULT_ENEMY_BULLET_SPEED;
    this.tuningEditor.tutorialBgmSlot = DEFAULT_TUTORIAL_BGM_SLOT;
    this.tuningEditor.levelBgmSlot = DEFAULT_LEVEL_BGM_SLOT;

    this.enemyGroup = this.physics.add.group();
    this.bullets = this.physics.add.group();
    this.playerBullets = this.physics.add.group();
    this.enemyBulletHitboxes = this.physics.add.group();
    this.playerBulletHitboxes = this.physics.add.group();

    this.physics.add.collider(this.player.go, this.enemyGroup);
    this.physics.add.collider(this.enemyGroup, this.enemyGroup);
    this.physics.add.overlap(this.player.go, this.enemyBulletHitboxes, (_playerGO, hitboxGO) => {
      if (this.state !== 'playing') return;
      const hitbox = hitboxGO as Phaser.GameObjects.Rectangle;
      const bullet = hitbox.getData('ownerBullet') as Phaser.GameObjects.Rectangle | undefined;
      if (!bullet?.active) return;
      this.player.takeDamage(bullet.getData('damage') as number);
      this.destroyEnemyBullet(bullet);
    });
    this.physics.add.overlap(this.playerBulletHitboxes, this.enemyGroup, (hitboxGO, enemyGO) => {
      const hitbox = hitboxGO as Phaser.GameObjects.Rectangle;
      const bullet = hitbox.getData('ownerBullet') as Phaser.GameObjects.Rectangle | undefined;
      if (!bullet?.active) return;
      const enemy = this.enemies.find((candidate) => candidate.go === enemyGO);
      if (enemy && !enemy.dead) {
        enemy.takeDamage(
          bullet.getData('damage') as number,
          bullet.getData('knockbackAngle') as number | undefined,
          (bullet.getData('knockbackSpeed') as number | undefined) ?? 0
        );
      }
      this.destroyPlayerBullet(bullet);
    });

    this.conductor.on('beat', this.onBeat, this);

    this.setupInput();
    // 独立 Scene 只投影主场景数据，不参与主场景的控制、物理或判定。
    if (this.scene.isActive('FpvMiniScene')) this.scene.stop('FpvMiniScene');
    this.scene.launch('FpvMiniScene');
    // 直接进入教学，不再用全屏标题遮罩等待点击。
    this.startGame();
  }

  update(_time: number, delta: number): void {
    if (this.gamePaused) return;
    this.conductor.update();
    this.hud.update();
    this.updateArenaBeatCue();
    this.updateRhythmEdgeAnticipation();
    if (this.combo.updateFever()) this.endFever();
    this.handleGamepadInput();
    this.updateCameraLookAhead(delta);

    if (this.state === 'over' || this.state === 'title') {
      this.drawDebugHitboxes();
      return;
    }

    this.player.update(this.time.now, delta);
    for (const enemy of this.enemies) enemy.update(delta);
    this.updateEnemyBulletBeatSurge(delta);
    this.updateStraightBulletHitboxes();
    this.updateBulletTrails(delta);
    this.cleanupBullets();
    this.checkPickups();
    this.drawDebugHitboxes();

    if (this.combo.feverActive()) {
      this.hud.setFeverCountdown(this.combo.feverRemainRatio());
    }
  }

  /** 供右上角观察窗读取的只读状态；它不拥有任何主玩法状态。 */
  get isGamePaused(): boolean {
    return this.gamePaused;
  }

  get isTitleScreen(): boolean {
    return this.state === 'title';
  }

  get fpvEnemies(): readonly Enemy[] {
    return this.enemies;
  }

  get fpvEnemyBullets(): readonly Phaser.GameObjects.GameObject[] {
    return this.bullets?.getChildren() ?? [];
  }

  get fpvPlayerBullets(): readonly Phaser.GameObjects.GameObject[] {
    return this.playerBullets?.getChildren() ?? [];
  }

  // ---------- 输入 ----------

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.gamePaused || this.volumePanelVisible || this.tuningEditor.visible) return;
      const btn = pointer.rightButtonDown() ? 'H' : pointer.leftButtonDown() ? 'L' : null;
      if (this.state === 'title') {
        this.startGame();
        return;
      }
      if (this.state === 'tutorialConfirm') {
        // 点击确认页按钮时由按钮自身决定进入或重练，避免全屏左键轻攻击先行吞掉按钮语义。
        if (this.input.hitTestPointer(pointer).length > 0) return;
        if (btn) this.handleTutorialConfirmInput(btn);
        return;
      }
      if (this.state === 'over') return;
      if (this.time.now < this.suppressAttackUntil) return;

      if (btn) this.handleAttackInput(btn);
    });

    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (event.repeat || this.gamePaused || this.volumePanelVisible || this.tuningEditor.visible) return;

      if (event.code === 'Quote' || event.code === 'Enter') {
        event.preventDefault();
        if (this.state === 'title') {
          this.startGame();
          return;
        }
        const btn = event.code === 'Quote' ? 'L' : 'H';
        if (this.state === 'tutorialConfirm') {
          this.handleTutorialConfirmInput(btn);
          return;
        }
        if (this.state === 'over' || this.time.now < this.suppressAttackUntil) return;
        this.handleAttackInput(btn);
        return;
      }

      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        event.preventDefault();
        this.tryKeyboardDodge();
      }
    });

    this.input.keyboard!.on('keydown-R', () => {
      if (this.gamePaused) return;
      this.scene.restart();
    });

    this.input.keyboard!.on('keydown-ESC', (event: KeyboardEvent) => {
      event.preventDefault();
      if (!event.repeat && !this.tuningEditor.visible) this.setVolumePanelVisible(!this.volumePanelVisible);
    });
    this.input.keyboard!.on('keydown-P', (event: KeyboardEvent) => {
      event.preventDefault();
      if (!event.repeat && !this.volumePanelVisible) this.setTuningEditorVisible(!this.tuningEditor.visible);
    });

    // 调试：B 键切换判定框显示
    this.input.keyboard!.on('keydown-B', () => {
      if (this.gamePaused) return;
      this.debugHitboxes = !this.debugHitboxes;
    });

    // 原型调试键：F 直接充满 ComboMeter，便于快速验证 Fever Time
    this.input.keyboard!.on('keydown-F', () => {
      if (this.gamePaused) return;
      if (this.state === 'playing' || this.state === 'intermission') {
        this.combo.addProgress(100);
        this.refreshComboHUD();
      }
    });
  }

  /**
   * 角色位于场地中央死区时镜头保持居中；越靠近上下左右或四角，越向同方向前探。
   * 指数阻尼使帧率变化时仍保持相近的缓入缓出手感，不修改任何世界坐标或玩法判定。
   */
  private updateCameraLookAhead(deltaMs: number): void {
    if (!this.player) return;
    const centerX = ARENA.x + ARENA.width / 2;
    const centerY = ARENA.y + ARENA.height / 2;
    const normalizedX = Phaser.Math.Clamp((this.player.x - centerX) / (ARENA.width / 2), -1, 1);
    const normalizedY = Phaser.Math.Clamp((this.player.y - centerY) / (ARENA.height / 2), -1, 1);
    const edgeAmount = (normalized: number): number => {
      const magnitude = Math.abs(normalized);
      if (magnitude <= MAIN_CAMERA_LOOK_DEAD_ZONE) return 0;
      const t = Phaser.Math.Clamp(
        (magnitude - MAIN_CAMERA_LOOK_DEAD_ZONE) / (1 - MAIN_CAMERA_LOOK_DEAD_ZONE),
        0,
        1
      );
      const smooth = t * t * (3 - 2 * t);
      return Math.sign(normalized) * smooth;
    };
    const targetX = edgeAmount(normalizedX) * MAIN_CAMERA_LOOK_MAX_X;
    const targetY = edgeAmount(normalizedY) * MAIN_CAMERA_LOOK_MAX_Y;
    const damping = 1 - Math.exp(-Math.max(0, deltaMs) / MAIN_CAMERA_LOOK_DAMPING_MS);
    this.cameraLookX = Phaser.Math.Linear(this.cameraLookX, targetX, damping);
    this.cameraLookY = Phaser.Math.Linear(this.cameraLookY, targetY, damping);
    this.cameras.main.setScroll(
      CAMERA_BASE_SCROLL_X + this.cameraLookX,
      CAMERA_BASE_SCROLL_Y + this.cameraLookY
    );
  }

  private tryKeyboardDodge(): void {
    if (this.gamePaused) return;
    if (this.state === 'playing' || this.state === 'intermission' || this.state === 'tutorial') {
      this.player.tryDodge();
    }
  }

  private handleAttackInput(btn: 'L' | 'H', pad?: Phaser.Input.Gamepad.Gamepad): void {
    if (this.gamePaused) return;
    if (this.state === 'tutorial') this.recordTutorialCalibrationCandidate(btn);
    const result = this.combo.handleInput(btn, this.conductor.now());
    if (result.type === 'correct' || result.type === 'protectedCorrect') {
      this.performWeaponAttack(result.beatIdx, false, 5, true);
      if (this.combo.feverActive()) this.player.heal(10);
      this.flashArenaCorrectJudgement(this.combo.pattern[result.beatIdx] === 'H');
      this.hud.flashSuccess(result.globalBeat);
      this.flashPatternIcon(result.globalBeat % 4);
      this.refreshComboHUD();
      if (pad) this.rumbleGamepad(pad, btn === 'H' ? 'heavy' : 'light');
    } else if (result.type === 'wrong') {
      this.performWeaponAttack(result.beatIdx, false, 1, false);
      this.sfx.error();
      this.player.errorFlash();
      this.hud.flashError();
    }

    if (this.state === 'tutorial') {
      if (result.type === 'correct' || result.type === 'protectedCorrect') {
        this.tutorialHitBeats.add(result.globalBeat);
      } else if (result.type === 'wrong') {
        this.failTutorialMeasure();
      }
    }
  }

  private handleTutorialConfirmInput(btn: 'L' | 'H'): void {
    this.suppressAttackUntil = this.time.now + 200;
    if (btn === 'L') this.finishTutorial();
    else this.retryTutorial();
  }

  private handleGamepadInput(): void {
    const pad = this.input.gamepad?.pad1;
    if (!pad) {
      this.gamepadButtonState = { dodge: false, attack: false };
      return;
    }

    const current = {
      dodge: this.isGamepadButtonDown(pad, GAMEPAD_BUTTON.dodge),
      attack: this.isGamepadButtonDown(pad, GAMEPAD_BUTTON.attack)
    };
    if (this.gamePaused) {
      this.gamepadButtonState = current;
      return;
    }
    const pressed = {
      dodge: current.dodge && !this.gamepadButtonState.dodge,
      attack: current.attack && !this.gamepadButtonState.attack
    };
    this.gamepadButtonState = current;

    if (this.state === 'title' && (pressed.dodge || pressed.attack)) {
      this.startGame();
      return;
    }
    if (this.state === 'tutorialConfirm') {
      if (pressed.attack) this.handleTutorialConfirmInput('L');
      else if (pressed.dodge) this.handleTutorialConfirmInput('H');
      return;
    }
    if (this.state !== 'playing' && this.state !== 'intermission' && this.state !== 'tutorial') return;

    if (pressed.dodge && this.player.tryDodge()) this.rumbleGamepad(pad, 'dodge');
    if (pressed.attack) this.handleAttackInput(this.gamepadBeatKey(), pad);
  }

  private gamepadBeatKey(): 'L' | 'H' {
    const nearestBeat = this.conductor.nearestBeat(this.conductor.now()).n;
    const beatInMeasure = ((nearestBeat % 4) + 4) % 4;
    return this.combo.pattern[beatInMeasure];
  }

  private isGamepadButtonDown(pad: Phaser.Input.Gamepad.Gamepad, index: number): boolean {
    return index < pad.buttons.length && pad.getButtonValue(index) > 0.5;
  }

  private createFanAnimations(): void {
    const create = (key: string, framePrefix: string, frameNumbers: number[], frameRate: number, repeat: number): void => {
      if (this.anims.exists(key)) return;
      this.anims.create({
        key,
        frames: frameNumbers.map((frameNumber) => ({ key: `${framePrefix}-${frameNumber}` })),
        frameRate,
        repeat
      });
    };

    create('fan-run', 'fan-run', [2, 3, 4, 5], 10, -1);
    create('fan-roll', 'fan-roll', [1, 2, 3, 4, 5, 6], 14, -1);
    create('fan-attack', 'fan-attack', [1, 2, 3, 4, 5, 6], 12, 0);
  }

  private rumbleGamepad(pad: Phaser.Input.Gamepad.Gamepad, kind: RumbleKind): void {
    const actuator = pad.vibration;
    if (!actuator?.playEffect) return;
    try {
      void actuator.playEffect('dual-rumble', rumbleParameters(kind)).catch(() => undefined);
    } catch {
      // 部分浏览器会暴露执行器但拒绝调用；输入本身不应受影响。
    }
  }

  // ---------- 流程 ----------

  private startGame(): void {
    this.hud.message('');
    this.switchBgmTrack(BGM_TRACKS[this.tuningEditor.tutorialBgmSlot], false);
    this.conductor.start();
    this.bgmFirstBeat = 0;
    this.playBgmAlignedToBeat(this.bgmFirstBeat);
    this.startTutorial();
  }

  /**
   * 让 bgm3.mp3 的首拍（文件内 this.currentBgmTrack.firstBeatOffset 秒处）与指定 Conductor 拍点对齐：
   * 若倒数时间足够则用 delay 等到那一刻播放，否则直接以 seek 跳过已经过去的部分。
   */
  private playBgmAlignedToBeat(firstBeat: number): void {
    const delayToFirstBeat = this.conductor.timeOfBeat(firstBeat) - this.conductor.now();
    if (delayToFirstBeat >= this.currentBgmTrack.firstBeatOffset) {
      this.bgm.play({ delay: delayToFirstBeat - this.currentBgmTrack.firstBeatOffset });
    } else {
      this.bgm.play({ seek: this.currentBgmTrack.firstBeatOffset - delayToFirstBeat });
    }
  }

  private switchBgmTrack(track: BgmTrack, playNow = true): void {
    if (this.currentBgmTrack.key === track.key && this.bgm) {
      this.conductor.retune(track.bpm);
      return;
    }
    this.bgm?.stop();
    this.bgm?.destroy();
    this.currentBgmTrack = track;
    this.conductor.retune(track.bpm);
    this.bgm = this.sound.add(track.key, {
      loop: false,
      volume: BGM_VOLUME * this.bgmChannelVolume
    }) as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
    this.bgm.on(Phaser.Sound.Events.COMPLETE, this.onBgmComplete, this);
    if (playNow && this.conductor.started) {
      this.bgmFirstBeat = Math.max(0, Math.ceil(this.conductor.beatFloatAt(this.conductor.now())));
      this.playBgmAlignedToBeat(this.bgmFirstBeat);
    }
  }
  private createSettingsPanel(): void {
    const shade = this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.55);
    const panel = this.add.rectangle(640, 360, 600, 440, 0x0f172a, 0.96).setStrokeStyle(2, 0x67e8f9, 0.9);
    const title = this.add
      .text(640, 170, '设置（游戏已暂停）', { fontFamily: 'Arial', fontSize: '26px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    const volumeLabel = this.add
      .text(390, 220, '主音量', { fontFamily: 'Arial', fontSize: '17px', color: '#cbd5e1' })
      .setOrigin(0, 0.5);
    const bgmVolumeLabel = this.add
      .text(390, 305, 'BGM 音量', { fontFamily: 'Arial', fontSize: '17px', color: '#cbd5e1' })
      .setOrigin(0, 0.5);
    const sfxVolumeLabel = this.add
      .text(390, 390, '音效音量', { fontFamily: 'Arial', fontSize: '17px', color: '#cbd5e1' })
      .setOrigin(0, 0.5);
    const hint = this.add
      .text(640, 555, '按 Esc 关闭并继续游戏', { fontFamily: 'Arial', fontSize: '14px', color: '#94a3b8' })
      .setOrigin(0.5);
    const track = this.add
      .rectangle(640, 260, VOLUME_TRACK_WIDTH, 12, 0x334155)
      .setStrokeStyle(1, 0x64748b)
      .setInteractive({ useHandCursor: true });
    this.volumeFill = this.add.rectangle(VOLUME_TRACK_X, 260, VOLUME_TRACK_WIDTH, 12, 0x67e8f9).setOrigin(0, 0.5);
    this.volumeThumb = this.add.circle(VOLUME_TRACK_X + VOLUME_TRACK_WIDTH, 260, 13, 0xffffff)
      .setStrokeStyle(3, 0x67e8f9)
      .setInteractive({ useHandCursor: true });
    this.volumeValueText = this.add
      .text(845, 220, '', { fontFamily: 'Arial', fontSize: '17px', color: '#67e8f9' })
      .setOrigin(0.5);
    const bgmTrack = this.add.rectangle(640, 345, VOLUME_TRACK_WIDTH, 12, 0x334155)
      .setStrokeStyle(1, 0x64748b).setInteractive({ useHandCursor: true });
    this.bgmVolumeFill = this.add.rectangle(VOLUME_TRACK_X, 345, VOLUME_TRACK_WIDTH, 12, 0xa78bfa).setOrigin(0, 0.5);
    this.bgmVolumeThumb = this.add.circle(VOLUME_TRACK_X + VOLUME_TRACK_WIDTH, 345, 13, 0xffffff)
      .setStrokeStyle(3, 0xa78bfa).setInteractive({ useHandCursor: true });
    this.bgmVolumeValueText = this.add.text(845, 305, '', { fontFamily: 'Arial', fontSize: '17px', color: '#a78bfa' }).setOrigin(0.5);
    const sfxTrack = this.add.rectangle(640, 430, VOLUME_TRACK_WIDTH, 12, 0x334155)
      .setStrokeStyle(1, 0x64748b).setInteractive({ useHandCursor: true });
    this.sfxVolumeFill = this.add.rectangle(VOLUME_TRACK_X, 430, VOLUME_TRACK_WIDTH, 12, 0xf9a8d4).setOrigin(0, 0.5);
    this.sfxVolumeThumb = this.add.circle(VOLUME_TRACK_X + VOLUME_TRACK_WIDTH, 430, 13, 0xffffff)
      .setStrokeStyle(3, 0xf9a8d4).setInteractive({ useHandCursor: true });
    this.sfxVolumeValueText = this.add.text(845, 390, '', { fontFamily: 'Arial', fontSize: '17px', color: '#f9a8d4' }).setOrigin(0.5);
    const fpvLabel = this.add
      .text(390, 500, '右下 FPV 观察窗', { fontFamily: 'Arial', fontSize: '17px', color: '#cbd5e1' })
      .setOrigin(0, 0.5);
    this.fpvToggleButton = this.add
      .rectangle(765, 500, 152, 42, 0x0f766e)
      .setStrokeStyle(2, 0x67e8f9, 0.95)
      .setInteractive({ useHandCursor: true });
    this.fpvToggleText = this.add
      .text(765, 500, '', { fontFamily: 'Arial', fontSize: '16px', fontStyle: 'bold', color: '#ecfeff' })
      .setOrigin(0.5);

    this.volumePanel = this.add.container(0, 0, [
      shade,
      panel,
      title,
      volumeLabel,
      bgmVolumeLabel,
      sfxVolumeLabel,
      hint,
      track,
      this.volumeFill,
      this.volumeThumb,
      this.volumeValueText,
      bgmTrack,
      this.bgmVolumeFill,
      this.bgmVolumeThumb,
      this.bgmVolumeValueText,
      sfxTrack,
      this.sfxVolumeFill,
      this.sfxVolumeThumb,
      this.sfxVolumeValueText,
      fpvLabel,
      this.fpvToggleButton,
      this.fpvToggleText
    ])
      .setDepth(30)
      .setPosition(CAMERA_BASE_SCROLL_X, CAMERA_BASE_SCROLL_Y)
      .setScale(1 / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0)
      .setVisible(false);

    const beginDrag = (channel: 'master' | 'bgm' | 'sfx', pointer: Phaser.Input.Pointer): void => {
      this.volumeDragging = channel;
      this.updateVolumeFromPointer(channel, pointer.x);
    };
    track.on('pointerdown', (pointer: Phaser.Input.Pointer) => beginDrag('master', pointer));
    this.volumeThumb.on('pointerdown', (pointer: Phaser.Input.Pointer) => beginDrag('master', pointer));
    bgmTrack.on('pointerdown', (pointer: Phaser.Input.Pointer) => beginDrag('bgm', pointer));
    this.bgmVolumeThumb.on('pointerdown', (pointer: Phaser.Input.Pointer) => beginDrag('bgm', pointer));
    sfxTrack.on('pointerdown', (pointer: Phaser.Input.Pointer) => beginDrag('sfx', pointer));
    this.sfxVolumeThumb.on('pointerdown', (pointer: Phaser.Input.Pointer) => beginDrag('sfx', pointer));
    this.fpvToggleButton.on('pointerdown', () => this.setFpvWindowEnabled(!this.fpvWindowEnabled));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.volumeDragging && this.volumePanelVisible) this.updateVolumeFromPointer(this.volumeDragging, pointer.x);
    });
    this.input.on('pointerup', () => {
      this.volumeDragging = null;
    });
    this.refreshVolumeControl();
    this.refreshFpvToggle();
  }

  private setVolumePanelVisible(visible: boolean): void {
    this.volumePanelVisible = visible;
    this.volumeDragging = null;
    this.volumePanel.setVisible(visible);
    if (visible) {
      this.gamePaused = true;
      this.conductor.pause();
      this.sound.pauseAll();
      this.physics.world.pause();
      this.tweens.pauseAll();
      this.anims.pauseAll();
      this.time.paused = true;
      this.getFpvMiniScene()?.setPanelPaused(true);
      this.input.mouse?.releasePointerLock();
      this.input.setDefaultCursor('default');
      this.game.canvas.style.cursor = 'default';
    } else {
      this.time.paused = false;
      this.physics.world.resume();
      this.tweens.resumeAll();
      this.anims.resumeAll();
      this.conductor.resume();
      this.sound.resumeAll();
      this.gamePaused = false;
      this.getFpvMiniScene()?.setPanelPaused(false);
    }
  }

  private setFpvWindowEnabled(enabled: boolean): void {
    this.fpvWindowEnabled = enabled;
    this.getFpvMiniScene()?.setPanelEnabled(enabled);
    this.refreshFpvToggle();
  }

  private refreshFpvToggle(): void {
    if (!this.fpvToggleText) return;
    this.fpvToggleButton.setFillStyle(this.fpvWindowEnabled ? 0x0f766e : 0x334155);
    this.fpvToggleText.setText(this.fpvWindowEnabled ? '已开启' : '已关闭');
  }

  private setTuningEditorVisible(visible: boolean): void {
    this.tuningEditor.setVisible(visible);
    if (visible) {
      this.gamePaused = true;
      this.conductor.pause();
      this.sound.pauseAll();
      this.physics.world.pause();
      this.tweens.pauseAll();
      this.anims.pauseAll();
      this.time.paused = true;
      this.getFpvMiniScene()?.setPanelPaused(true);
      this.input.mouse?.releasePointerLock();
      this.input.setDefaultCursor('default');
      this.game.canvas.style.cursor = 'default';
    } else {
      this.time.paused = false;
      this.physics.world.resume();
      this.tweens.resumeAll();
      this.anims.resumeAll();
      this.conductor.resume();
      this.sound.resumeAll();
      this.gamePaused = false;
      this.getFpvMiniScene()?.setPanelPaused(false);
      const selected = this.state === 'title' || this.state === 'tutorial' || this.state === 'tutorialConfirm'
        ? BGM_TRACKS[this.tuningEditor.tutorialBgmSlot]
        : BGM_TRACKS[this.tuningEditor.levelBgmSlot];
      this.switchBgmTrack(selected);
    }
  }
  private getFpvMiniScene(): FpvMiniScene | undefined {
    return this.scene.isActive('FpvMiniScene') ? (this.scene.get('FpvMiniScene') as FpvMiniScene) : undefined;
  }

  private updateVolumeFromPointer(channel: 'master' | 'bgm' | 'sfx', pointerX: number): void {
    const ratio = Phaser.Math.Clamp((pointerX - VOLUME_TRACK_X) / VOLUME_TRACK_WIDTH, 0, 1);
    const soundManager = this.sound as Phaser.Sound.WebAudioSoundManager;
    if (channel === 'master') {
      this.masterVolume = ratio * MAX_MASTER_VOLUME;
      soundManager.masterVolumeNode.gain.setTargetAtTime(this.masterVolume, soundManager.context.currentTime, 0.01);
    } else if (channel === 'bgm') {
      this.bgmChannelVolume = ratio * MAX_CHANNEL_VOLUME;
      this.bgm.setVolume(BGM_VOLUME * this.bgmChannelVolume);
    } else {
      this.sfxChannelVolume = ratio * MAX_CHANNEL_VOLUME;
      this.conductor.setSfxVolume(this.sfxChannelVolume);
      this.sfx.setVolume(this.sfxChannelVolume);
    }
    this.refreshVolumeControl();
  }

  private refreshVolumeControl(): void {
    const ratio = this.masterVolume / MAX_MASTER_VOLUME;
    this.volumeFill.displayWidth = VOLUME_TRACK_WIDTH * ratio;
    this.volumeThumb.x = VOLUME_TRACK_X + VOLUME_TRACK_WIDTH * ratio;
    this.volumeValueText.setText(`${Math.round(this.masterVolume * 100)}%`);
    const bgmRatio = this.bgmChannelVolume / MAX_CHANNEL_VOLUME;
    this.bgmVolumeFill.displayWidth = VOLUME_TRACK_WIDTH * bgmRatio;
    this.bgmVolumeThumb.x = VOLUME_TRACK_X + VOLUME_TRACK_WIDTH * bgmRatio;
    this.bgmVolumeValueText.setText(`${Math.round(this.bgmChannelVolume * 100)}%`);
    const sfxRatio = this.sfxChannelVolume / MAX_CHANNEL_VOLUME;
    this.sfxVolumeFill.displayWidth = VOLUME_TRACK_WIDTH * sfxRatio;
    this.sfxVolumeThumb.x = VOLUME_TRACK_X + VOLUME_TRACK_WIDTH * sfxRatio;
    this.sfxVolumeValueText.setText(`${Math.round(this.sfxChannelVolume * 100)}%`);
  }

  /** bgm3 长度不是整拍；每 616 拍按 Conductor 重新开始，避免 Phaser 原生循环累计漂移。 */
  private onBgmComplete(): void {
    if (!this.conductor.started) return;
    this.bgmFirstBeat += this.currentBgmTrack.loopBeats;
    this.playBgmAlignedToBeat(this.bgmFirstBeat);
  }

  // ---------- 教学 ----------

  /** 开场教学：不生成敌人，玩家跟随上方节拍点连打，连续 3 个小节全对后确认进入游戏 */
  private startTutorial(): void {
    this.state = 'tutorial';
    this.tutorialStreak = 0;
    this.tutorialHitBeats.clear();
    this.tutorialFailedMeasures.clear();
    this.tutorialTimingOffsets = [];
    this.tutorialCalibrationBeats.clear();
    this.tutorialCalibratedOffset = 0;
    this.combo.setInputLatencyOffset(0);
    this.hud.setBeatGuideVisible(false);
    this.arenaBeatCues.forEach((cue) => cue.setVisible(false));
    this.buildPatternPanel(true);
    this.createTutorialControlGuide();
    this.updateTutorialStreakText();
    this.hud.setWave('教学中');
    this.flashMessage('跟随节拍！');
  }

  /** 在教学场地的地面层绘制键位卡，不参与碰撞、输入或 TopDown 排序。 */
  private createTutorialControlGuide(): void {
    this.tutorialControlGuide?.destroy(true);
    const guide = this.add.container(320, 430).setDepth(1.5).setAlpha(0.82);
    const panel = this.add.rectangle(0, 0, 390, 238, 0x0b1026, 0.62).setStrokeStyle(2, 0x6b3b70, 0.72);
    const title = this.add
      .text(-168, -92, '基础操作', { fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#f5d0fe' })
      .setOrigin(0, 0.5);
    const divider = this.add.rectangle(0, -68, 336, 1, 0x6b3b70, 0.65);

    const keycap = (x: number, y: number, label: string, width = 42): Phaser.GameObjects.Container => {
      const cap = this.add.rectangle(0, 0, width, 32, 0x1e293b, 0.92).setStrokeStyle(1.5, 0xe879f9, 0.82);
      const text = this.add
        .text(0, 0, label, { fontFamily: 'Arial', fontSize: '14px', fontStyle: 'bold', color: '#ffffff' })
        .setOrigin(0.5);
      return this.add.container(x, y, [cap, text]);
    };
    const description = (x: number, y: number, text: string): Phaser.GameObjects.Text =>
      this.add.text(x, y, text, { fontFamily: 'Arial', fontSize: '14px', color: '#e2e8f0' }).setOrigin(0, 0.5);

    const movementKeys = [
      keycap(-120, -40, 'W'),
      keycap(-162, -4, 'A'),
      keycap(-120, -4, 'S'),
      keycap(-78, -4, 'D')
    ];
    const quoteKey = keycap(58, -40, '" / 左键', 94);
    const enterKey = keycap(58, 2, 'Enter / 右键', 116);
    const shiftKey = keycap(-120, 70, 'L / R Shift', 116);
    const escKey = keycap(58, 70, 'Esc', 54);

    guide.add([
      panel,
      title,
      divider,
      ...movementKeys,
      description(-54, -22, '移动'),
      quoteKey,
      description(122, -40, '轻攻击'),
      enterKey,
      description(122, 2, '重攻击'),
      shiftKey,
      description(-54, 70, '冲刺'),
      escKey,
      description(94, 70, '设置')
    ]);
    this.tutorialControlGuide = guide;
  }

  /** 教学关专用的顶部连段面板；正式关调用时只负责彻底清除。 */
  private buildPatternPanel(tutorial: boolean): void {
    this.patternPanel?.destroy(true);
    this.patternPanel = undefined;
    this.patternIcons = [];
    this.tutorialStreakText = undefined;

    const ui = this.add
      .container(CAMERA_BASE_SCROLL_X + 640 / MAIN_CAMERA_BASE_ZOOM, CAMERA_BASE_SCROLL_Y)
      .setDepth(15)
      .setScale(1 / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0);

    if (tutorial) {
      ui.add(this.add.rectangle(0, 126, 560, 154, 0x0f172a, 0.72).setStrokeStyle(1, 0x334155));
      ui.add(
        this.add
          .text(0, 62, '教学 · 按节拍打出连段', { fontFamily: 'Arial', fontSize: '22px', color: '#e2e8f0' })
          .setOrigin(0.5)
      );
    } else {
      ui.add(this.add.rectangle(0, 128, 350, 70, 0x0f172a, 0.68).setStrokeStyle(1, 0x334155));
    }

    const xs = [-108, -36, 36, 108];
    this.combo.pattern.forEach((key, i) => {
      const icon: Phaser.GameObjects.Shape = key === 'L'
        ? this.add.circle(xs[i], 128, 14).setStrokeStyle(3, 0x67e8f9)
        : this.add.rectangle(xs[i], 128, 22, 22, 0xfbbf24).setAngle(45);
      ui.add(icon);
      this.patternIcons.push(icon);

      if (tutorial) {
        const label = this.add
          .text(xs[i], 160, key === 'L' ? '轻' : '重', {
            fontFamily: 'Arial',
            fontSize: '16px',
            color: key === 'L' ? '#67e8f9' : '#fbbf24'
          })
          .setOrigin(0.5);
        ui.add(label);
      }
    });

    if (tutorial) {
      this.tutorialStreakText = this.add
        .text(0, 192, '', { fontFamily: 'Arial', fontSize: '17px', color: '#facc15' })
        .setOrigin(0.5);
      ui.add(this.tutorialStreakText);
    }
    this.patternPanel = ui;
  }
  /** 每拍高亮当前拍的节拍块（教学与游戏通用） */
  private pulsePatternIcon(beatIdx: number): void {
    const icon = this.patternIcons[beatIdx];
    if (!icon) return;
    icon.setScale(1.35);
    this.tweens.add({ targets: icon, scaleX: 1, scaleY: 1, duration: 150 });
  }

  private updateTutorialStreakText(): void {
    const calibration = this.tutorialTimingOffsets.length > 0
      ? `　延迟校准 ${Math.round(this.tutorialCalibratedOffset * 1000)}ms`
      : '　延迟校准中';
    this.tutorialStreakText?.setText(`连续完整小节 ${this.tutorialStreak} / ${TUTORIAL_TARGET_STREAK}${calibration}`);
  }

  /**
   * 在教学的连续正确输入中估计设备延迟：使用中位数抑制偶发误差，
   * 再用 MAD 裁掉离群样本。校准只用于后续判定时钟平移，不改变音乐时钟或节拍提示。
   */
  private recordTutorialTiming(rawOffset: number): void {
    if (Math.abs(rawOffset) > TUTORIAL_CALIBRATION_MAX_ABS_OFFSET) return;
    this.tutorialTimingOffsets.push(rawOffset);
    if (this.tutorialTimingOffsets.length > TUTORIAL_CALIBRATION_SAMPLES) this.tutorialTimingOffsets.shift();
    if (this.tutorialTimingOffsets.length < 4) {
      this.updateTutorialStreakText();
      return;
    }

    const median = this.median(this.tutorialTimingOffsets);
    const deviations = this.tutorialTimingOffsets.map((sample) => Math.abs(sample - median));
    const mad = this.median(deviations);
    const tolerance = Math.max(0.008, Math.min(TUTORIAL_CALIBRATION_MAX_SPREAD, mad * 2.5));
    const inliers = this.tutorialTimingOffsets.filter((sample) => Math.abs(sample - median) <= tolerance);
    if (inliers.length < 4) return;

    const estimate = this.median(inliers);
    // 逐次收敛，避免最后一拍把玩家正在适应的节奏突然推偏。
    this.tutorialCalibratedOffset = Phaser.Math.Clamp(
      Phaser.Math.Linear(this.tutorialCalibratedOffset, estimate, 0.35),
      -TUTORIAL_CALIBRATION_MAX_ABS_OFFSET,
      TUTORIAL_CALIBRATION_MAX_ABS_OFFSET
    );
    this.combo.setInputLatencyOffset(this.tutorialCalibratedOffset);
    this.updateTutorialStreakText();
  }

  /**
   * 教学校准允许“按键种类正确但尚未落入旧窗口”的首批输入成为候选，
   * 这样输入链路本身慢于旧 100ms 窗口时，仍能把判定拉回正确位置。
   */
  private recordTutorialCalibrationCandidate(btn: 'L' | 'H'): void {
    const { n, offset } = this.conductor.nearestBeat(this.conductor.now());
    if (n < 0 || this.tutorialCalibrationBeats.has(n)) return;
    const beatIdx = ((n % 4) + 4) % 4;
    if (btn !== this.combo.pattern[beatIdx] || Math.abs(offset) > TUTORIAL_CALIBRATION_CANDIDATE_WINDOW) return;
    this.tutorialCalibrationBeats.add(n);
    this.recordTutorialTiming(offset);
  }

  private median(values: number[]): number {
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
  }

  /** 教学中每拍：小节交界时结算上一小节（第 0 小节为热身，不计） */
  private onTutorialBeat(info: BeatInfo): void {
    if (info.beatInMeasure === 0 && info.measure >= 2) {
      this.evaluateTutorialMeasure(info.measure - 1);
    }
  }

  private evaluateTutorialMeasure(measure: number): void {
    const allHit = [0, 1, 2, 3].every((i) => this.tutorialHitBeats.has(measure * 4 + i));
    const success = allHit && !this.tutorialFailedMeasures.has(measure);
    if (success) {
      this.tutorialStreak++;
      this.spawnTutorialVerdict('✓', '#4ade80');
      if (this.tutorialStreak >= TUTORIAL_TARGET_STREAK) {
        this.updateTutorialStreakText();
        this.showTutorialConfirm();
        return;
      }
    } else {
      this.tutorialStreak = 0;
    }
    this.updateTutorialStreakText();
  }

  /** 错拍立即判当前小节失败并清零连击 */
  private failTutorialMeasure(): void {
    const measure = Math.floor(Math.max(0, this.conductor.beatFloatAt(this.conductor.now())) / 4);
    this.tutorialFailedMeasures.add(measure);
    if (this.tutorialStreak > 0) {
      this.tutorialStreak = 0;
      this.updateTutorialStreakText();
    }
    this.spawnTutorialVerdict('✕', '#f87171');
  }

  /** 命中反馈：对应节拍块处扩散绿环（教学与游戏通用） */
  private flashPatternIcon(beatIdx: number): void {
    const icon = this.patternIcons[beatIdx];
    if (!icon || !this.patternPanel) return;
    const ring = this.add.circle(icon.x, icon.y, 16).setStrokeStyle(3, 0x4ade80, 0.95);
    this.patternPanel.add(ring);
    this.tweens.add({ targets: ring, scale: 1.9, alpha: 0, duration: 220, onComplete: () => ring.destroy() });
  }

  /** 图标行右侧弹出 ✓/✕ 小节结果 */
  private spawnTutorialVerdict(mark: string, color: string): void {
    if (!this.patternPanel || !this.tutorialStreakText) return;
    const text = this.add
      .text(190, 128, mark, { fontFamily: 'Arial', fontSize: '30px', fontStyle: 'bold', color })
      .setOrigin(0.5);
    this.patternPanel.add(text);
    this.tweens.add({ targets: text, y: 100, alpha: 0, duration: 500, ease: 'Sine.easeOut', onComplete: () => text.destroy() });
  }

  private showTutorialConfirm(): void {
    this.state = 'tutorialConfirm';
    const ui = this.add
      .container(CAMERA_BASE_SCROLL_X + 640 / MAIN_CAMERA_BASE_ZOOM, CAMERA_BASE_SCROLL_Y + 360 / MAIN_CAMERA_BASE_ZOOM)
      .setDepth(21)
      .setScale(1 / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0);
    const overlay = this.add.rectangle(0, 0, 1280, 720, 0x000000, 0.55);
    const title = this.add
      .text(0, -90, '教学完成！', {
        fontFamily: 'Arial',
        fontSize: '48px',
        fontStyle: 'bold',
        color: '#4ade80',
        stroke: '#000000',
        strokeThickness: 5
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(0, -34, `连续 ${TUTORIAL_TARGET_STREAK} 个小节全部命中 · 轻攻击进入 · 重攻击重练`, {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#e2e8f0'
      })
      .setOrigin(0.5);
    ui.add([overlay, title, sub]);
    ui.add(this.createConfirmButton(-150, 60, '轻攻击：进入游戏', 0x16a34a, () => this.finishTutorial()));
    ui.add(this.createConfirmButton(150, 60, '重攻击：重新教学', 0x475569, () => this.retryTutorial()));
    this.confirmUi = ui;
  }

  private createConfirmButton(
    x: number,
    y: number,
    label: string,
    color: number,
    onClick: () => void
  ): Phaser.GameObjects.GameObject[] {
    const rect = this.add.rectangle(x, y, 260, 58, color, 0.95).setStrokeStyle(2, 0xffffff, 0.85);
    const text = this.add
      .text(x, y, label, { fontFamily: 'Arial', fontSize: '24px', color: '#ffffff' })
      .setOrigin(0.5);
    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerover', () => rect.setScale(1.05));
    rect.on('pointerout', () => rect.setScale(1));
    rect.on(
      'pointerdown',
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData
      ) => {
        event.stopPropagation();
        this.suppressAttackUntil = this.time.now + 200;
        onClick();
      }
    );
    return [rect, text];
  }

  private retryTutorial(): void {
    this.confirmUi?.destroy();
    this.confirmUi = undefined;
    this.startTutorial();
  }

  private finishTutorial(): void {
    this.confirmUi?.destroy();
    this.confirmUi = undefined;
    this.tutorialControlGuide?.destroy(true);
    this.tutorialControlGuide = undefined;
    // 正式游戏彻底移除顶部连段面板与上下节拍提示，改由场地扩散框承担拍点预告。
    this.buildPatternPanel(false);
    this.hud.setBeatGuideVisible(false);
    // 教学期间积累的 Fever 能量清零，正式开局从零开始
    this.combo.progress = 0;
    this.lastComboLevel = 0;
    this.hud.setCombo(0, 0);
    this.state = 'intermission';
    this.switchBgmTrack(BGM_TRACKS[this.tuningEditor.levelBgmSlot]);
    this.hud.setWave('准备…');
    // 节拍同步倒计时：每小节减一，5→1 后下一小节开波
    this.countdownRemaining = 5;
  }

  /** 倒计时数字随小节弹出，显示至本小节临近结束（数字越小越接近警示色） */
  private showCountdownTick(label: string, color: string): void {
    const text = this.add
      .text(640, 300, label, {
        fontFamily: 'Arial',
        fontSize: '96px',
        fontStyle: 'bold',
        color,
        stroke: '#000000',
        strokeThickness: 8
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setPosition(CAMERA_BASE_SCROLL_X + 640 / MAIN_CAMERA_BASE_ZOOM, CAMERA_BASE_SCROLL_Y + 300 / MAIN_CAMERA_BASE_ZOOM)
      .setScale(1 / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0)
      .setScale(1.5 / MAIN_CAMERA_BASE_ZOOM);
    this.tweens.add({
      targets: text,
      scaleX: 1 / MAIN_CAMERA_BASE_ZOOM,
      scaleY: 1 / MAIN_CAMERA_BASE_ZOOM,
      duration: 120,
      ease: 'Back.easeOut'
    });
    this.tweens.add({
      targets: text,
      alpha: 0,
      delay: Math.max(120, this.conductor.beatDur * 4 * 1000 - 300),
      duration: 220,
      onComplete: () => text.destroy()
    });
  }

  private startWave(idx: number): void {
    if (this.state === 'over') return;
    this.waveIdx = idx;
    this.displayedWaveNumber++;
    this.state = 'playing';
    this.hud.setWave(`Wave ${this.displayedWaveNumber}`);
    this.flashMessage(`WAVE ${this.displayedWaveNumber}`);

    const enemyCount = WAVE_ENEMY_COUNTS[idx];
    for (let i = 0; i < enemyCount; i++) {
      const [x, y] = this.spawnPointOnArenaEdge(i, enemyCount);
      const enemy: Enemy = i % 2 === 0
        ? new SmallGuard(this, x, y)
        : new FanEnemy(this, x, y);
      this.enemies.push(enemy);
      this.enemyGroup.add(enemy.go);
    }
  }

  onEnemyKilled(enemy: Enemy): void {
    this.enemies = this.enemies.filter((e) => e !== enemy);

    // 保安掉警棍，粉丝掉荧光棒；玩家已持有或场上已有时不重复生成。
    const drop = enemy.kind === 'smallGuard' ? BATON : enemy.kind === 'fan' ? GLOWSTICKS : undefined;
    if (drop && this.player.weapon.id !== drop.id && !this.pickups.some((pickup) => pickup.weapon.id === drop.id)) {
      this.spawnPickup(enemy.x, enemy.y, drop);
    }

    if (this.enemies.length === 0 && this.state === 'playing') {
      if (this.waveIdx >= WAVE_ENEMY_COUNTS.length - 1) {
        if (!this.victoryAchieved) {
          this.victoryAchieved = true;
          this.hud.setVictoryVisible(true);
        }
        this.state = 'intermission';
        this.time.delayedCall(2000, () => {
          if (this.state !== 'over') this.startWave(WAVE_ENEMY_COUNTS.length - 1);
        });
      } else {
        this.state = 'intermission';
        this.time.delayedCall(2000, () => startNext(this));
        const next = this.waveIdx + 1;
        function startNext(scene: MainScene): void {
          if (scene.state !== 'over') scene.startWave(next);
        }
      }
    }
  }

  private spawnPointOnArenaEdge(index: number, total: number): [number, number] {
    const margin = 70;
    const left = ARENA.x + margin;
    const right = ARENA.x + ARENA.width - margin;
    const top = ARENA.y + margin;
    const bottom = ARENA.y + ARENA.height - margin;
    const width = right - left;
    const height = bottom - top;
    const perimeter = 2 * (width + height);
    let distance = (index / total) * perimeter;

    if (distance <= width) return [left + distance, top];
    distance -= width;
    if (distance <= height) return [right, top + distance];
    distance -= height;
    if (distance <= width) return [right - distance, bottom];
    distance -= width;
    return [left, bottom - distance];
  }

  onPlayerDied(): void {
    this.state = 'over';
    this.player.die();
    this.hud.message('FAILED...\n\n按 R 重新开始');
  }

  getAutoAimAngle(moveAngle: number): number {
    let nearest: Enemy | undefined;
    let bestScore = Infinity;
    let bestIsInMovementCone = false;
    const halfPriorityCone = Phaser.Math.DegToRad(22.5);

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const enemyAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      const inMovementCone = Math.abs(Phaser.Math.Angle.Wrap(enemyAngle - moveAngle)) <= halfPriorityCone;
      const score = distance / (inMovementCone ? 2 : 1);
      if (score < bestScore || (score === bestScore && inMovementCone && !bestIsInMovementCone)) {
        nearest = enemy;
        bestScore = score;
        bestIsInMovementCone = inMovementCone;
      }
    }

    return nearest
      ? Phaser.Math.Angle.Between(this.player.x, this.player.y, nearest.x, nearest.y)
      : moveAngle;
  }

  /** 当前帧在整拍归一化 easeInExpo 位移曲线上的平均速度倍率。 */
  getNormalizedBeatMovementMultiplier(deltaMs: number): number {
    const dt = Math.max(0, deltaMs) / 1000;
    if (dt <= 0) return 1;
    const beatDuration = this.conductor.beatDur;
    const easeInExpo = (t: number): number => (t <= 0 ? 0 : 2 ** (10 * t - 10));
    let remaining = dt;
    let cursorToBeat = this.conductor.timeToNextBeat(this.conductor.now());
    let normalizedTravelSeconds = 0;
    while (remaining > 0.000001) {
      const segment = Math.min(remaining, cursorToBeat);
      const from = Phaser.Math.Clamp(1 - cursorToBeat / beatDuration, 0, 1);
      const to = Phaser.Math.Clamp(from + segment / beatDuration, 0, 1);
      normalizedTravelSeconds += beatDuration * (easeInExpo(to) - easeInExpo(from));
      remaining -= segment;
      cursorToBeat -= segment;
      if (cursorToBeat <= 0.000001) cursorToBeat = beatDuration;
    }
    return normalizedTravelSeconds / dt;
  }

  // ---------- 调试 ----------

  /** 红框=玩家与敌人的受击判定（物理 body），绿框=玩家武器与敌方子弹的判定 */
  private drawDebugHitboxes(): void {
    this.debugGfx.clear();
    if (!this.debugHitboxes) return;

    this.debugGfx.lineStyle(2, 0xff0000, 0.9);
    this.strokeDebugBody(this.player.body);
    for (const enemy of this.enemies) {
      if (!enemy.dead) this.strokeDebugBody(enemy.go.body);
    }

    this.debugGfx.lineStyle(2, 0x00ff00, 0.9);
    for (const group of [this.playerBulletHitboxes, this.enemyBulletHitboxes]) {
      for (const obj of group.getChildren()) {
        this.strokeDebugBody((obj as Phaser.GameObjects.Rectangle).body as Phaser.Physics.Arcade.Body);
      }
    }
  }

  private strokeDebugBody(body: Phaser.Physics.Arcade.Body): void {
    // body 关闭时（闪避无敌、死亡）不参与判定，跳过绘制
    if (!body.enable) return;
    if (body.isCircle) {
      this.debugGfx.strokeCircle(body.center.x, body.center.y, body.halfWidth);
    } else {
      this.debugGfx.strokeRect(body.x, body.y, body.width, body.height);
    }
  }

  private createBulletHitboxes(
    bullet: Phaser.GameObjects.Rectangle,
    group: Phaser.Physics.Arcade.Group,
    size: number
  ): Phaser.GameObjects.Rectangle[] {
    const hitboxes = Array.from({ length: 3 }, () => {
      const hitbox = this.add.rectangle(bullet.x, bullet.y, size, size, 0xffffff, 0);
      group.add(hitbox);
      const body = hitbox.body as Phaser.Physics.Arcade.Body;
      body.setSize(size, size, true);
      hitbox.setData('ownerBullet', bullet);
      return hitbox;
    });
    bullet.setData('hitboxes', hitboxes);
    return hitboxes;
  }

  private positionStraightBulletHitboxes(
    bullet: Phaser.GameObjects.Rectangle,
    length: number,
    size: number,
    angle: number
  ): void {
    const hitboxes = bullet.getData('hitboxes') as Phaser.GameObjects.Rectangle[] | undefined;
    if (!hitboxes) return;
    const offset = Math.max(0, (length - size) * 0.5);
    const offsets = [-offset, 0, offset];
    const bulletBody = bullet.body as Phaser.Physics.Arcade.Body;
    hitboxes.forEach((hitbox, index) => {
      if (!hitbox.active) return;
      const x = bullet.x + Math.cos(angle) * offsets[index];
      const y = bullet.y + Math.sin(angle) * offsets[index];
      hitbox.setPosition(x, y);
      const body = hitbox.body as Phaser.Physics.Arcade.Body;
      body.reset(x, y);
      body.setVelocity(bulletBody.velocity.x, bulletBody.velocity.y);
    });
  }

  private positionArcBulletHitboxes(
    bullet: Phaser.GameObjects.Rectangle,
    originX: number,
    originY: number,
    radius: number,
    angle: number,
    halfArcAngle: number
  ): void {
    const hitboxes = bullet.getData('hitboxes') as Phaser.GameObjects.Rectangle[] | undefined;
    if (!hitboxes) return;
    const sampleAngles = [angle - halfArcAngle, angle, angle + halfArcAngle];
    hitboxes.forEach((hitbox, index) => {
      if (!hitbox.active) return;
      const x = originX + Math.cos(sampleAngles[index]) * radius;
      const y = originY + Math.sin(sampleAngles[index]) * radius;
      hitbox.setPosition(x, y);
      (hitbox.body as Phaser.Physics.Arcade.Body).reset(x, y);
    });
  }


  private updateStraightBulletHitboxes(): void {
    for (const group of [this.bullets, this.playerBullets]) {
      for (const obj of group.getChildren()) {
        const bullet = obj as Phaser.GameObjects.Rectangle;
        if (bullet.getData('hitboxMode') !== 'straight') continue;
        this.positionStraightBulletHitboxes(
          bullet,
          bullet.getData('hitboxLength') as number,
          bullet.getData('hitboxSize') as number,
          bullet.getData('hitboxAngle') as number
        );
      }
    }
  }

  private destroyBulletHitboxes(bullet: Phaser.GameObjects.Rectangle): void {
    const hitboxes = bullet.getData('hitboxes') as Phaser.GameObjects.Rectangle[] | undefined;
    for (const hitbox of hitboxes ?? []) {
      if (hitbox.active) hitbox.destroy();
    }
    bullet.setData('hitboxes', undefined);
  }

  private flashMessage(text: string): void {
    this.hud.message(text);
    this.time.delayedCall(1200, () => {
      if (this.state !== 'over') this.hud.message('');
    });
  }

  // ---------- 节拍 ----------

  private onBeat(info: BeatInfo): void {
    if (this.state === 'title') return;
    this.playQueuedBeatSfx();
    if (this.state === 'over') return;

    this.player.onBeat();
    this.hud.onBeat(info.beatInMeasure);
    this.getFpvMiniScene()?.onBeat(this.combo.pattern[info.beatInMeasure] === 'H');
    const heavyBeat = this.combo.pattern[info.beatInMeasure] === 'H';
    this.pulseRhythmEdgeBlocks(heavyBeat);
    this.pulseArenaBeatJudgement(heavyBeat);
    this.pulsePickups();
    this.pulsePatternIcon(info.beatInMeasure);
    if (this.state === 'tutorial') this.onTutorialBeat(info);

    // 进入游戏的倒计时：每小节第 1 拍减一
    if (this.state === 'intermission' && this.countdownRemaining >= 0 && info.beatInMeasure === 0) {
      if (this.countdownRemaining > 0) {
        this.showCountdownTick(String(this.countdownRemaining), this.countdownRemaining <= 2 ? '#f97316' : '#facc15');
        this.countdownRemaining--;
      } else {
        this.countdownRemaining = -1;
        this.startWave(0);
      }
    }

    const tick = this.combo.onBeat(info);
    if (tick.demoAttack !== undefined) {
      this.hud.setState('自动演示中…');
      this.performWeaponAttack(tick.demoAttack, true, 5, true);
      this.flashArenaCorrectJudgement(this.combo.pattern[tick.demoAttack] === 'H');
      this.hud.flashSuccess(info.globalBeat);
      this.flashPatternIcon(info.beatInMeasure);
      this.refreshComboHUD();
    }
    if (tick.demoEnded) {
      this.hud.setState('');
    }

    // 节拍脉冲：平时按 Combo 等级增强（积累感），Fever 期间最强并闪烁边框
    const fever = this.combo.feverActive();
    this.hud.beatPulse(this.combo.level, fever);
    if (fever) {
      this.feverBorder.setAlpha(0.9);
      this.tweens.add({ targets: this.feverBorder, alpha: 0.25, duration: 350 });
    }

    if (this.state === 'playing') {
      for (const enemy of [...this.enemies]) enemy.onBeat(info);
    }
  }

  // ---------- 攻击 ----------

  private performWeaponAttack(beatIdx: number, _demo: boolean, pelletCount: number, enableFever: boolean): void {
    const weapon = this.player.weapon;
    const spec = getAttackSpec(weapon.id, beatIdx);
    const mult = this.combo.damageMultiplier;
    const heavy = weapon.pattern[beatIdx] === 'H';
    const angle = this.player.aimAngle;

    // enableFever 为 true 即踩拍成功（含自动演示），攻击带强调特效与发光弹丸
    const onBeat = enableFever;
    const damage = spec.kind === 'charge' ? 8 : spec.damage;
    this.sfx.attack(heavy);
    this.player.playAttackAnimation(angle);
    if (onBeat) this.spawnOnBeatAttackFx(this.player.x, this.player.y, angle, heavy, spec.color);
    if (weapon.id === 'baton') {
      this.spawnBatonSweep(
        this.player.x,
        this.player.y,
        angle,
        damage * mult,
        enableFever ? 3 : 1,
        heavy,
        onBeat
      );
    } else {
      this.spawnPlayerShotgun(
        this.player.x,
        this.player.y,
        angle,
        heavy ? 560 : 480,
        damage * mult,
        PLAYER_BULLET_COLOR,
        pelletCount,
        onBeat
      );
    }

    if (weapon.id !== 'baton' && spec.kind === 'charge') {
      const ring = this.add
        .circle(this.player.x, this.player.y, worldSize(20))
        .setStrokeStyle(worldSize(3), spec.color, 0.9)
        .setDepth(6);
      this.tweens.add({ targets: ring, scale: 1.8, alpha: 0, duration: 250, onComplete: () => ring.destroy() });
    }

    // Fever Time：每次成功攻击额外释放清屏音波（轻=扇形，重=全圆）
    if (enableFever && this.combo.feverActive()) {
      this.sfx.feverWave();
      if (heavy) {
        this.spawnSoundWave(this.player.x, this.player.y, angle, 180, 190, 14 * mult);
      } else {
        this.spawnSoundWave(this.player.x, this.player.y, angle, 55, 230, 10 * mult);
      }
    }
  }

  /**
   * 踩拍攻击的强调特效：双层冲击环 + 瞄准方向楔形闪光 + 音符飘散 + 相机微推拉。
   * 与普通（错拍）攻击形成明显区分；重拍整体比轻拍更夸张。
   */
  private spawnOnBeatAttackFx(x: number, y: number, angle: number, heavy: boolean, color: number): void {
    // 双层冲击环：外环用本拍攻击色，内环白色、更快消散
    const outer = this.add.circle(x, y, 16).setStrokeStyle(heavy ? 5 : 4, color, 0.95).setDepth(6);
    const inner = this.add.circle(x, y, 10).setStrokeStyle(3, 0xffffff, 0.9).setDepth(6);
    this.tweens.add({
      targets: outer,
      scale: heavy ? 3.4 : 2.6,
      alpha: 0,
      duration: heavy ? 260 : 200,
      ease: 'Cubic.easeOut',
      onComplete: () => outer.destroy()
    });
    this.tweens.add({
      targets: inner,
      scale: 2,
      alpha: 0,
      duration: 140,
      ease: 'Cubic.easeOut',
      onComplete: () => inner.destroy()
    });

    // 瞄准方向的楔形闪光：即时反馈攻击朝向
    const wedge = this.add.graphics().setDepth(6);
    const halfRad = Phaser.Math.DegToRad(heavy ? 34 : 22);
    wedge.fillStyle(0xffffff, 0.5);
    wedge.slice(x, y, heavy ? 64 : 48, angle - halfRad, angle + halfRad, false);
    wedge.fillPath();
    this.tweens.add({ targets: wedge, alpha: 0, duration: 130, onComplete: () => wedge.destroy() });

    // 音符飘散：音游主题的踩拍标记
    const colorHex = `#${color.toString(16).padStart(6, '0')}`;
    const noteCount = heavy ? 2 : 1;
    for (let i = 0; i < noteCount; i++) {
      const nx = x + Phaser.Math.Between(-18, 18);
      const note = this.add
        .text(nx, y - 26, i % 2 === 0 ? '♪' : '♫', { fontSize: heavy ? '22px' : '17px', color: colorHex })
        .setOrigin(0.5)
        .setDepth(8);
      this.tweens.add({
        targets: note,
        y: note.y - Phaser.Math.Between(26, 40),
        x: nx + Phaser.Math.Between(-12, 12),
        alpha: 0,
        angle: Phaser.Math.Between(-25, 25),
        duration: 420,
        ease: 'Sine.easeOut',
        onComplete: () => note.destroy()
      });
    }

    // 相机微推拉：轻拍几乎不可察觉的顿挫，重拍稍强
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    cam.setZoom(MAIN_CAMERA_BASE_ZOOM);
    this.tweens.add({
      targets: cam,
      zoom: MAIN_CAMERA_BASE_ZOOM * (heavy ? 1.015 : 1.0075),
      duration: 60,
      yoyo: true,
      ease: 'Quad.easeOut'
    });
  }

  /**
   * Fever 音波：波前从中心扩散，途经的弹幕被抵消、敌人受到一次伤害。
   * halfArcDeg >= 180 为圆形音波，否则为朝 angle 方向的扇形音波。
   */
  private spawnSoundWave(
    x: number,
    y: number,
    angle: number,
    halfArcDeg: number,
    maxRadius: number,
    damage: number
  ): void {
    const halfRad = Phaser.Math.DegToRad(halfArcDeg);
    const full = halfArcDeg >= 180;
    const gfx = this.add.graphics().setDepth(6);
    const damaged = new Set<Enemy>();

    const inSector = (tx: number, ty: number, radius: number): boolean => {
      if (Phaser.Math.Distance.Between(x, y, tx, ty) > radius) return false;
      if (full) return true;
      const toTarget = Phaser.Math.Angle.Between(x, y, tx, ty);
      return Math.abs(Phaser.Math.Angle.Wrap(toTarget - angle)) <= halfRad;
    };

    const counter = { value: 0 };
    this.tweens.add({
      targets: counter,
      value: 1,
      duration: 350,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        const radius = 24 + counter.value * (maxRadius - 24);
        gfx.clear();
        gfx.lineStyle(worldSize(5), 0xf97316, 1 - counter.value * 0.8);
        if (full) {
          gfx.strokeCircle(x, y, radius);
        } else {
          gfx.beginPath();
          gfx.arc(x, y, radius, angle - halfRad, angle + halfRad, false);
          gfx.strokePath();
        }
        // 波前清弹
        for (const obj of this.bullets.getChildren().slice()) {
          const bullet = obj as Phaser.GameObjects.Rectangle;
          if (inSector(bullet.x, bullet.y, radius)) this.destroyEnemyBullet(bullet);
        }
        // 波前伤害（每个敌人只结算一次）
        for (const enemy of [...this.enemies]) {
          if (enemy.dead || damaged.has(enemy)) continue;
          if (inSector(enemy.x, enemy.y, radius + enemy.radius)) {
            damaged.add(enemy);
            enemy.takeDamage(Math.round(damage));
          }
        }
      },
      onComplete: () => gfx.destroy()
    });
  }

  damageEnemiesInArc(x: number, y: number, angle: number, radius: number, halfArcDeg: number, damage: number): void {
    const halfRad = Phaser.Math.DegToRad(halfArcDeg);
    for (const enemy of [...this.enemies]) {
      if (enemy.dead) continue;
      const dist = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      if (dist > radius + enemy.radius) continue;
      if (halfArcDeg < 180) {
        const toEnemy = Phaser.Math.Angle.Between(x, y, enemy.x, enemy.y);
        if (Math.abs(Phaser.Math.Angle.Wrap(toEnemy - angle)) > halfRad) continue;
      }
      enemy.takeDamage(Math.round(damage));
    }
  }

  // ---------- 特效与弹幕 ----------

  spawnArcFx(x: number, y: number, angle: number, radius: number, halfArcDeg: number, color: number): void {
    const gfx = this.add.graphics().setDepth(6);
    gfx.fillStyle(color, 0.35);
    if (halfArcDeg >= 180) {
      gfx.fillCircle(x, y, radius);
    } else {
      const halfRad = Phaser.Math.DegToRad(halfArcDeg);
      gfx.slice(x, y, radius, angle - halfRad, angle + halfRad, false);
      gfx.fillPath();
    }
    this.tweens.add({ targets: gfx, alpha: 0, duration: 200, onComplete: () => gfx.destroy() });
  }

  spawnBullet(x: number, y: number, angle: number, _speed: number, damage: number, color: number): void {
    const bullet = this.add
      .rectangle(x, y, ENEMY_BULLET_LENGTH, ENEMY_BULLET_THICKNESS, color)
      .setRotation(angle)
      .setDepth(4);
    this.bullets.add(bullet);
    const body = bullet.body as Phaser.Physics.Arcade.Body;
    body.setSize(ENEMY_BULLET_THICKNESS, ENEMY_BULLET_THICKNESS, true);
    body.setVelocity(Math.cos(angle) * this.tuningEditor.enemyBulletSpeed, Math.sin(angle) * this.tuningEditor.enemyBulletSpeed);
    bullet.setData('damage', damage);
    bullet.setData('angle', angle);
    bullet.setData('baseSpeed', this.tuningEditor.enemyBulletSpeed);
    bullet.setData('despawnBeat', Math.floor(this.conductor.beatFloatAt(this.conductor.now())) + 8);
    bullet.setData('trailColor', color);
    bullet.setData('trailThickness', ENEMY_BULLET_THICKNESS);
    bullet.setData('bursting', true);
    bullet.setData('hitboxMode', 'straight');
    bullet.setData('hitboxLength', ENEMY_BULLET_LENGTH);
    bullet.setData('hitboxSize', ENEMY_BULLET_THICKNESS);
    bullet.setData('hitboxAngle', angle);
    this.createBulletHitboxes(bullet, this.enemyBulletHitboxes, ENEMY_BULLET_THICKNESS);
    this.positionStraightBulletHitboxes(bullet, ENEMY_BULLET_LENGTH, ENEMY_BULLET_THICKNESS, angle);
  }

  /**
   * 将每拍前 0.2 秒的匀速路程按 easeInExpo 的累计曲线重新分配。
   * 速度倍率是归一化曲线的区间平均斜率，因此无论帧率如何，窗口总位移都严格等于 baseSpeed × 0.2s。
   */
  private updateEnemyBulletBeatSurge(deltaMs: number): void {
    const now = this.conductor.now();
    const dt = Math.max(0, deltaMs) / 1000;
    const beatDuration = this.conductor.beatDur;
    const timeToBeat = this.conductor.timeToNextBeat(now);
    const easeInExpo = (t: number): number => (t <= 0 ? 0 : 2 ** (10 * t - 10));
    let remaining = dt;
    let cursorToBeat = timeToBeat;
    let normalizedTravelSeconds = 0;

    // 对本帧覆盖的时间区间分段积分；跨入窗口或跨过拍点时也不丢失路程。
    while (remaining > 0.000001) {
      if (cursorToBeat > ENEMY_BULLET_BEAT_SURGE_WINDOW) {
        const baseSegment = Math.min(remaining, cursorToBeat - ENEMY_BULLET_BEAT_SURGE_WINDOW);
        normalizedTravelSeconds += baseSegment;
        remaining -= baseSegment;
        cursorToBeat -= baseSegment;
      } else {
        const surgeSegment = Math.min(remaining, cursorToBeat);
        const from = Phaser.Math.Clamp(
          (ENEMY_BULLET_BEAT_SURGE_WINDOW - cursorToBeat) / ENEMY_BULLET_BEAT_SURGE_WINDOW,
          0,
          1
        );
        const to = Phaser.Math.Clamp(from + surgeSegment / ENEMY_BULLET_BEAT_SURGE_WINDOW, 0, 1);
        normalizedTravelSeconds += ENEMY_BULLET_BEAT_SURGE_WINDOW * (easeInExpo(to) - easeInExpo(from));
        remaining -= surgeSegment;
        cursorToBeat -= surgeSegment;
        if (cursorToBeat <= 0.000001) cursorToBeat = beatDuration;
      }
    }

    const normalizedSpeedMultiplier = dt > 0 ? normalizedTravelSeconds / dt : 1;
    const touchesSurgeWindow = timeToBeat <= ENEMY_BULLET_BEAT_SURGE_WINDOW
      || timeToBeat - dt <= ENEMY_BULLET_BEAT_SURGE_WINDOW;

    for (const obj of this.bullets.getChildren()) {
      const bullet = obj as Phaser.GameObjects.Rectangle;
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      const angle = bullet.getData('angle') as number;
      const baseSpeed = this.tuningEditor.enemyBulletSpeed;
      bullet.setData('baseSpeed', baseSpeed);
      const speed = this.tuningEditor.enemyBulletBeatSurgeEnabled
        ? baseSpeed * normalizedSpeedMultiplier
        : baseSpeed;
      body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      bullet.setData('bursting', this.tuningEditor.enemyBulletBeatSurgeEnabled && touchesSurgeWindow);
    }
  }

  spawnEnemyProjectile(x: number, y: number, angle: number, damage: number, color: number): void {
    // 三向散射让敌人数量上升后形成持续弹幕，同时保持子弹匀速移动。
    for (const spread of [-0.13, 0, 0.13]) {
      const shotAngle = angle + spread;
      this.spawnBullet(
        x + Math.cos(shotAngle) * worldSize(26),
        y + Math.sin(shotAngle) * worldSize(26),
        shotAngle,
        0,
        damage,
        color
      );
    }
  }

  private spawnPlayerShotgun(
    x: number,
    y: number,
    angle: number,
    _speed: number,
    damage: number,
    color: number,
    pelletCount: number,
    onBeat = false
  ): void {
    const judgedBeat = this.conductor.nearestBeat(this.conductor.now()).n;
    const despawnBeat = Math.max(0, judgedBeat + 1);
    for (let i = 0; i < pelletCount; i++) {
      const offset = pelletCount === 1 ? 0 : -15 + (30 * i) / (pelletCount - 1);
      const shotAngle = angle + Phaser.Math.DegToRad(offset);
      const bullet = this.add.rectangle(
        x + Math.cos(shotAngle) * (PLAYER_RADIUS + worldSize(8)),
        y + Math.sin(shotAngle) * (PLAYER_RADIUS + worldSize(8)),
        PLAYER_BULLET_LENGTH,
        BULLET_THICKNESS,
        color
      ).setRotation(shotAngle).setDepth(4);
      // 踩拍弹丸带白色描边发光，与错拍的普通弹丸区分
      if (onBeat) bullet.setStrokeStyle(2, 0xffffff, 0.95);
      this.playerBullets.add(bullet);
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      body.setSize(BULLET_THICKNESS, BULLET_THICKNESS, true);
      const velocity = this.physics.velocityFromRotation(shotAngle, this.tuningEditor.playerBulletSpeed);
      body.setVelocity(velocity.x, velocity.y);
      bullet.setData('damage', damage);
      bullet.setData('despawnBeat', despawnBeat);
      bullet.setData('trailColor', color);
      bullet.setData('trailThickness', BULLET_THICKNESS);
      bullet.setData('knockbackAngle', shotAngle);
      bullet.setData('knockbackSpeed', GLOWSTICK_KNOCKBACK_SPEED);
      bullet.setData('hitboxMode', 'straight');
      bullet.setData('hitboxLength', PLAYER_BULLET_LENGTH);
      bullet.setData('hitboxSize', BULLET_THICKNESS);
      bullet.setData('hitboxAngle', shotAngle);
      this.createBulletHitboxes(bullet, this.playerBulletHitboxes, BULLET_THICKNESS);
      this.positionStraightBulletHitboxes(bullet, PLAYER_BULLET_LENGTH, BULLET_THICKNESS, shotAngle);
    }
  }

  private spawnBatonSweep(
    originX: number,
    originY: number,
    aimAngle: number,
    damage: number,
    bulletCount: number,
    heavy: boolean,
    onBeat = false
  ): void {
    const clockwise = !heavy;
    const halfSweep = heavy ? Math.PI / 3 : Math.PI / 4;
    const startAngle = aimAngle + (clockwise ? -halfSweep : halfSweep);
    const endAngle = aimAngle + (clockwise ? halfSweep : -halfSweep);
    const middleRadius = worldSize(74 * 1.25);
    const layerSpacing = worldSize(20 * 1.15);
    const radii = bulletCount === 1
      ? [middleRadius]
      : [middleRadius - layerSpacing, middleRadius, middleRadius + layerSpacing];
    const lengthScales = bulletCount === 1 ? [1] : [0.5, 1, 1.5];
    const baseLength = worldSize((heavy ? 62 : 46) * 1.5);
    const bullets = radii.map((radius, index) => {
      const arcLength = baseLength * lengthScales[index];
      const halfArcAngle = arcLength / (2 * radius);
      const visual = this.add.graphics().setDepth(4);
      const bullet = this.add
        .rectangle(originX, originY, arcLength, BULLET_THICKNESS + 4, BATON_BULLET_COLOR, 0)
        .setDepth(4);
      this.playerBullets.add(bullet);
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      body.setSize(arcLength, BULLET_THICKNESS + 4);
      body.setVelocity(0, 0);
      bullet.setData('damage', damage);
      bullet.setData('despawnBeat', Infinity);
      bullet.setData('trailColor', BATON_BULLET_COLOR);
      bullet.setData('batonVisual', visual);
      bullet.setData('trailThickness', BULLET_THICKNESS + 4);
      bullet.setData('knockbackSpeed', BATON_KNOCKBACK_SPEED);
      bullet.setData('hitboxMode', 'arc');
      this.createBulletHitboxes(bullet, this.playerBulletHitboxes, BULLET_THICKNESS);
      return { bullet, visual, radius, halfArcAngle };
    });

    const sweep = { progress: 0 };
    const updatePositions = (): void => {
      const angle = Phaser.Math.Linear(startAngle, endAngle, sweep.progress);
      for (const { bullet, visual, radius, halfArcAngle } of bullets) {
        if (!bullet.active) continue;
        const x = originX + Math.cos(angle) * radius;
        const y = originY + Math.sin(angle) * radius;
        const bodyAngle = angle + Math.PI / 2;
        bullet.setPosition(x, y).setRotation(bodyAngle);
        (bullet.body as Phaser.Physics.Arcade.Body).reset(x, y);
        this.positionArcBulletHitboxes(bullet, originX, originY, radius, angle, halfArcAngle);
        bullet.setData('knockbackAngle', angle + (clockwise ? Math.PI / 2 : -Math.PI / 2));
        visual.clear();
        // 踩拍扫击带白色光晕底层
        if (onBeat) {
          visual.lineStyle(BULLET_THICKNESS + 8, 0xffffff, 0.22);
          visual.beginPath();
          visual.arc(originX, originY, radius, angle - halfArcAngle * 1.15, angle + halfArcAngle * 1.15, false);
          visual.strokePath();
        }
        visual.lineStyle(BULLET_THICKNESS, BATON_BULLET_COLOR, 1);
        visual.beginPath();
        visual.arc(originX, originY, radius, angle - halfArcAngle, angle + halfArcAngle, false);
        visual.strokePath();
      }
    };
    updatePositions();
    this.tweens.add({
      targets: sweep,
      progress: 1,
      duration: 150,
      ease: 'Linear',
      onUpdate: updatePositions,
      onComplete: () => {
        for (const { bullet } of bullets) {
          if (bullet.active) this.destroyPlayerBullet(bullet);
        }
      }
    });
  }

  private updateBulletTrails(deltaMs: number): void {
    const now = this.time.now;
    const dt = Math.max(deltaMs, 1) / 1000;
    for (const group of [this.bullets, this.playerBullets]) {
      for (const obj of group.getChildren()) {
        const bullet = obj as Phaser.GameObjects.Rectangle;
        const previousX = bullet.getData('trailX') as number | undefined;
        const previousY = bullet.getData('trailY') as number | undefined;
        bullet.setData('trailX', bullet.x);
        bullet.setData('trailY', bullet.y);
        if (previousX === undefined || previousY === undefined) continue;

        const distance = Phaser.Math.Distance.Between(previousX, previousY, bullet.x, bullet.y);
        const speed = distance / dt;
        if (group === this.bullets && !bullet.getData('bursting')) continue;
        if (speed < 1) continue;
        const interval = Phaser.Math.Clamp(95 - speed * 0.1, 16, 80);
        const lastAt = (bullet.getData('lastTrailAt') as number | undefined) ?? 0;
        if (now - lastAt < interval) continue;
        bullet.setData('lastTrailAt', now);

        const angle = bullet.rotation;
        const length = Phaser.Math.Clamp(speed * 0.045 * WORLD_OBJECT_SCALE, worldSize(8), worldSize(42));
        const alpha = Phaser.Math.Clamp(0.06 + speed / 4000, 0.08, 0.24);
        const color = (bullet.getData('trailColor') as number | undefined) ?? bullet.fillColor;
        const thickness = (bullet.getData('trailThickness') as number | undefined) ?? BULLET_THICKNESS;
        const trail = this.add
          .rectangle(
            bullet.x - Math.cos(angle) * length * 0.55,
            bullet.y - Math.sin(angle) * length * 0.55,
            length,
            Math.max(worldSize(3), thickness * 0.65),
            color,
            alpha
          )
          .setRotation(angle)
          .setDepth(3);
        this.tweens.add({
          targets: trail,
          alpha: 0,
          scaleX: 0.35,
          duration: Phaser.Math.Clamp(220 - speed * 0.12, 70, 180),
          onComplete: () => trail.destroy()
        });
      }
    }
  }

  private destroyPlayerBullet(bullet: Phaser.GameObjects.Rectangle): void {
    const visual = bullet.getData('batonVisual') as Phaser.GameObjects.Graphics | undefined;
    if (visual?.active) visual.destroy();
    this.destroyBulletHitboxes(bullet);
    if (bullet.active) bullet.destroy();
  }


  private destroyEnemyBullet(bullet: Phaser.GameObjects.Rectangle): void {
    const heldTrail = bullet.getData('heldTrail') as Phaser.GameObjects.Rectangle | undefined;
    if (heldTrail?.active) heldTrail.destroy();
    this.destroyBulletHitboxes(bullet);
    if (bullet.active) bullet.destroy();
  }

  spawnImpactFx(x: number, y: number, color: number, strong: boolean): void {
    const ring = this.add
      .circle(x, y, worldSize(strong ? 20 : 10))
      .setStrokeStyle(worldSize(strong ? 5 : 3), color, 0.95)
      .setDepth(8);
    this.tweens.add({
      targets: ring,
      scale: strong ? 3 : 2,
      alpha: 0,
      duration: strong ? 260 : 140,
      onComplete: () => ring.destroy()
    });
    for (let i = 0; i < (strong ? 8 : 4); i++) {
      const sparkAngle = (Math.PI * 2 * i) / (strong ? 8 : 4);
      const spark = this.add
        .rectangle(x, y, worldSize(strong ? 12 : 8), worldSize(3), i % 2 === 0 ? color : 0xffffff)
        .setDepth(8);
      spark.setRotation(sparkAngle);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(sparkAngle) * worldSize(strong ? 42 : 24),
        y: y + Math.sin(sparkAngle) * worldSize(strong ? 42 : 24),
        alpha: 0,
        duration: strong ? 220 : 120,
        onComplete: () => spark.destroy()
      });
    }
    this.cameras.main.shake(strong ? 130 : 45, strong ? 0.005 : 0.0015);
    if (strong) this.cameras.main.flash(90, 255, 40, 40, false);
  }

  /**
   * 正式游戏预览未来三拍：三个同宽高比内框分别在未来 1 / 2 / 3 拍抵达场地边界。
   * 每个框从 0.4 倍尺寸出发，以 easeInExpo 缓慢加速扩散三拍；透明度按 easeOutQuint 变亮。
   */
  private updateArenaBeatCue(): void {
    const active = this.conductor.started && (this.state === 'tutorial' || this.state === 'playing' || this.state === 'intermission');
    if (!active) {
      this.arenaBeatCues.forEach((cue) => cue.setVisible(false));
      return;
    }

    const beatFloat = this.conductor.beatFloatAt(this.conductor.now());
    if (beatFloat < 0) {
      this.arenaBeatCues.forEach((cue) => cue.setVisible(false));
      return;
    }

    // 大场地框是固定判定边界；扩散框只在其内侧运行。
    // 不在这里重置边框颜色，让命中时的短暂亮起完整播放完毕。
    const nextBeat = Math.floor(beatFloat) + 1;
    for (let index = 0; index < ARENA_BEAT_CUE_LOOKAHEAD; index++) {
      const cue = this.arenaBeatCues[index];
      const targetBeat = nextBeat + index;
      const elapsedBeats = beatFloat - (targetBeat - ARENA_BEAT_CUE_LOOKAHEAD);
      const progress = Phaser.Math.Clamp(elapsedBeats / ARENA_BEAT_CUE_LOOKAHEAD, 0, 1);
      const scaleProgress = Phaser.Math.Easing.Expo.In(progress);
      const alphaProgress = Phaser.Math.Easing.Expo.In(progress);
      const scale = Phaser.Math.Linear(ARENA_BEAT_CUE_START_SCALE, 1, scaleProgress);
      const alpha = Phaser.Math.Linear(ARENA_BEAT_CUE_MIN_ALPHA, 1, alphaProgress);
      const beatInMeasure = ((targetBeat % 4) + 4) % 4;
      const heavy = this.combo.pattern[beatInMeasure] === 'H';
      cue
        .setVisible(progress < 1)
        .setScale(scale)
        .setAlpha(alpha)
        .setStrokeStyle(heavy ? 5 : 3, heavy ? ARENA_BEAT_HEAVY_COLOR : ARENA_BEAT_LIGHT_COLOR, 1);
    }
  }

  /** 到拍时只点亮场地大框；扩散内框在越界前已经隐藏。 */
  private pulseArenaBeatJudgement(heavy: boolean): void {
    if (this.state !== 'tutorial' && this.state !== 'playing' && this.state !== 'intermission') return;
    const color = heavy ? ARENA_BEAT_HEAVY_COLOR : ARENA_BEAT_LIGHT_COLOR;
    this.arenaBeatCues.forEach((cue) => cue.setVisible(false));
    this.arenaBorder.setStrokeStyle(heavy ? 6 : 4, color, 1);
    this.time.delayedCall(heavy ? 120 : 90, () => {
      if (this.arenaBorder.active) this.arenaBorder.setStrokeStyle(3, ARENA_BORDER_BASE_COLOR, 1);
    });
  }

  /** 正确踩拍时叠加一次比普通拍点更粗、更亮并向外淡出的场地框反馈。 */
  private flashArenaCorrectJudgement(heavy: boolean): void {
    if (this.state !== 'tutorial' && this.state !== 'playing' && this.state !== 'intermission') return;
    const color = heavy ? ARENA_BEAT_HEAVY_COLOR : ARENA_BEAT_LIGHT_COLOR;
    this.tweens.killTweensOf(this.arenaCorrectFeedback);
    this.arenaCorrectFeedback
      .setVisible(true)
      .setScale(1)
      .setAlpha(0.95)
      .setStrokeStyle(heavy ? 11 : 8, color, 1);
    this.tweens.add({
      targets: this.arenaCorrectFeedback,
      scale: heavy ? 1.035 : 1.025,
      alpha: 0,
      duration: heavy ? 310 : 240,
      ease: 'Quad.easeOut',
      onComplete: () => this.arenaCorrectFeedback.setVisible(false).setScale(1)
    });
  }

  private createRhythmEdgeBlocks(): void {
    const colors = [0x4c1d6f, 0x63356f, 0x70234e, 0x75405c];
    const brightenAndDesaturate = (colorValue: number, lighten: number, desaturate: number): number => {
      const color = Phaser.Display.Color.ValueToColor(colorValue);
      color.lighten(lighten);
      color.desaturate(desaturate);
      return color.color;
    };
    const addCrowdBar = (
      x: number,
      y: number,
      edge: 'side' | 'bottom',
      maxHeight = 58,
      minHeight = 46
    ): void => {
      const width = Phaser.Math.Between(22, 26);
      const height = Phaser.Math.Between(minHeight, maxHeight);
      const baseColor = Phaser.Utils.Array.GetRandom(colors);
      const block = this.add
        .rectangle(x, y, width, height, baseColor, 1)
        .setOrigin(0.5, 1)
        .setDepth(worldDepth(y));
      block.setData('baseColor', baseColor);
      block.setData('lightColor', brightenAndDesaturate(baseColor, 3, 3));
      block.setData('heavyColor', brightenAndDesaturate(baseColor, 5, 5));
      block.setData('edge', edge);
      block.setData('anticipationDelay', Phaser.Math.FloatBetween(0, 0.12));
      block.setData('jumpVariance', Phaser.Math.FloatBetween(0.88, 1.12));
      this.rhythmBlocks.push(block);
    };

    // 下边缘采用两条交错轨道：保持安全间距，再加入受控随机错落，避免整齐得像栅栏。
    const bottomPitch = 39;
    for (let lane = 0; lane < 2; lane++) {
      for (let index = 0; index < 32; index++) {
        addCrowdBar(
          20 + lane * (bottomPitch / 2) + index * bottomPitch + Phaser.Math.FloatBetween(-5, 5),
          VIEW_HEIGHT - 3 - lane * 30 + Phaser.Math.FloatBetween(-4, 4),
          'bottom',
          50,
          42
        );
      }
    }

    // 左右边缘使用三列近似等距轨道，共 38 根；错落控制在安全间距内，避免整条完全重叠。
    const sideTracks = [13, 13, 12];
    const leftXs = [14, 44, 74];
    const rightXs = leftXs.map((offset) => ARENA.x + ARENA.width + offset);
    sideTracks.forEach((count, track) => {
      const yStart = 76 + track * 5;
      const yEnd = track === 2 ? 595 : yStart + 516;
      const pitch = (yEnd - yStart) / (count - 1);
      for (let index = 0; index < count; index++) {
        const y = yStart + index * pitch + Phaser.Math.FloatBetween(-2.5, 2.5);
        addCrowdBar(leftXs[track] + Phaser.Math.FloatBetween(-4, 4), y, 'side', 40, 36);
        addCrowdBar(rightXs[track] + Phaser.Math.FloatBetween(-4, 4), y, 'side', 40, 36);
      }
    });
  }

  private pulseRhythmEdgeBlocks(heavy: boolean): void {
    this.tweens.killTweensOf(this.rhythmBlocks);
    this.rhythmPulseUntil = this.time.now + (heavy ? 230 : 180);
    for (const block of this.rhythmBlocks) {
      const variance = block.getData('jumpVariance') as number;
      const jumpScale = heavy ? 1.85 : 1.3;
      block.setScale(heavy ? 0.93 : 0.97, jumpScale * variance);
      block.setAlpha(1);
      block.setFillStyle(block.getData(heavy ? 'heavyColor' : 'lightColor') as number, 1);
    }
    this.tweens.add({
      targets: this.rhythmBlocks,
      scaleX: 1,
      scaleY: 1,
      duration: heavy ? 220 : 170,
      ease: 'Back.easeOut',
      onComplete: () => {
        for (const block of this.rhythmBlocks) {
          block.setAlpha(1);
          block.setFillStyle(block.getData('baseColor') as number, 1);
        }
      }
    });
  }

  private updateRhythmEdgeAnticipation(): void {
    if (!this.conductor.started || this.time.now < this.rhythmPulseUntil) return;

    const now = this.conductor.now();
    const timeToBeat = this.conductor.timeToNextBeat(now);
    const anticipationWindow = this.conductor.beatDur * 0.42;
    const progress = Phaser.Math.Clamp(1 - timeToBeat / anticipationWindow, 0, 1);
    const nextBeat = Math.floor(this.conductor.beatFloatAt(now)) + 1;
    const beatInMeasure = ((nextBeat % 4) + 4) % 4;
    const heavy = this.combo.pattern[beatInMeasure] === 'H';

    for (const block of this.rhythmBlocks) {
      const delay = block.getData('anticipationDelay') as number;
      const localProgress = Phaser.Math.Clamp((progress - delay) / (1 - delay), 0, 1);
      const eased = localProgress * localProgress;
      const compressedScale = heavy ? 0.52 : 0.82;
      block.setScale(
        1 + eased * (heavy ? 0.12 : 0.04),
        Phaser.Math.Linear(1, compressedScale, eased)
      );
      const baseColor = block.getData('baseColor') as number;
      const targetColor = block.getData(heavy ? 'heavyColor' : 'lightColor') as number;
      block.setFillStyle(this.interpolateRgb(baseColor, targetColor, eased), 1);
      block.setAlpha(1);
    }
  }

  private interpolateRgb(from: number, to: number, amount: number): number {
    const fromR = (from >> 16) & 0xff;
    const fromG = (from >> 8) & 0xff;
    const fromB = from & 0xff;
    const toR = (to >> 16) & 0xff;
    const toG = (to >> 8) & 0xff;
    const toB = to & 0xff;
    const r = Math.round(Phaser.Math.Linear(fromR, toR, amount));
    const g = Math.round(Phaser.Math.Linear(fromG, toG, amount));
    const b = Math.round(Phaser.Math.Linear(fromB, toB, amount));
    return (r << 16) | (g << 8) | b;
  }

  private cleanupBullets(): void {
    const pad = 30;
    const beatFloat = this.conductor.beatFloatAt(this.conductor.now());
    for (const group of [this.bullets, this.playerBullets]) {
      for (const obj of group.getChildren().slice()) {
        const bullet = obj as Phaser.GameObjects.Rectangle;
        const outsideArena =
          bullet.x < ARENA.x - pad ||
          bullet.x > ARENA.x + ARENA.width + pad ||
          bullet.y < ARENA.y - pad ||
          bullet.y > ARENA.y + ARENA.height + pad;
        if (
          beatFloat >= (bullet.getData('despawnBeat') as number) ||
          (group === this.playerBullets && outsideArena)
        ) {
          if (group === this.playerBullets) this.destroyPlayerBullet(bullet);
          else this.destroyEnemyBullet(bullet);
        }
      }
    }
  }

  /** 踩拍冲刺使用 Fever 全圆音波同款逻辑，仅把 190px 作用半径缩至一半。 */
  triggerDodgeFeverWave(x: number, y: number): void {
    this.sfx.feverWave();
    this.spawnSoundWave(x, y, this.player.aimAngle, 180, 95, 14 * this.combo.damageMultiplier);
    this.combo.addProgress(1);
    this.refreshComboHUD();
  }

  // ---------- 拾取 ----------

  private spawnPickup(x: number, y: number, weapon: WeaponDef): void {
    const go = this.add.container(x, y).setDepth(2);
    const parts: Phaser.GameObjects.Rectangle[] = [];
    const colors: number[] = [];

    if (weapon.id === GLOWSTICKS.id) {
      for (const offset of [-9, 9]) {
        parts.push(
          this.add
            .rectangle(worldSize(offset), 0, worldSize(30), worldSize(7.5), 0xef4444)
            .setRotation(-Math.PI / 2)
        );
        colors.push(0xef4444);
      }
    } else {
      parts.push(this.add.rectangle(0, 0, worldSize(51), worldSize(9), 0xa855f7).setRotation(-Math.PI / 2));
      colors.push(0xa855f7);
    }

    go.add(parts);
    this.pickups.push({ go, parts, colors, baseY: y, weapon });
  }

  private pulsePickups(): void {
    const riseDuration = Math.max(80, this.conductor.beatDur * 420);
    for (const pickup of this.pickups) {
      this.tweens.killTweensOf(pickup.go);
      pickup.go.setY(pickup.baseY);
      pickup.parts.forEach((part) => part.setFillStyle(0xffffff));
      this.time.delayedCall(90, () => {
        pickup.parts.forEach((part, index) => {
          if (part.active) part.setFillStyle(pickup.colors[index]);
        });
      });
      this.tweens.add({
        targets: pickup.go,
        y: pickup.baseY - 10,
        duration: riseDuration,
        ease: 'Sine.Out',
        yoyo: true
      });
    }
  }

  private checkPickups(): void {
    for (const pickup of this.pickups.slice()) {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, pickup.go.x, pickup.go.y) < 34) {
        this.pickups = this.pickups.filter((p) => p !== pickup);
        pickup.go.destroy();
        this.equipWeapon(pickup.weapon);
      }
    }
  }

  private equipWeapon(weapon: WeaponDef): void {
    this.queueBeatSfx('pickup');
    this.player.weapon = weapon;
    this.combo.startSwitch(weapon.pattern);
    this.hud.setPattern(weapon.pattern, weapon.name);
    this.conductor.setCuePattern(weapon.pattern);
    this.buildPatternPanel(this.state === 'tutorial');
    this.hud.setState('武器切换中…');
  }

  // ---------- HUD ----------

  private refreshComboHUD(): void {
    const level = this.combo.level;
    if (level > this.lastComboLevel) {
      this.sfx.levelUp();
      this.hud.pulseCombo();
    } else if (level < this.lastComboLevel) {
      this.sfx.comboBreak();
    }
    this.lastComboLevel = level;
    this.hud.setCombo(this.combo.progress, level);

    // Meter 满 → 进入 Fever Time（教学阶段不触发）
    if (level === 5 && !this.combo.feverActive() && (this.state === 'playing' || this.state === 'intermission')) {
      this.enterFever();
    }
  }

  private enterFever(): void {
    this.combo.startFever();
    this.queueBeatSfx('feverStart');
    this.hud.setFever(true);
    this.hud.feverBurst();
    this.cameras.main.shake(200, 0.005);
    this.feverBorder.setAlpha(0.9);
  }

  private endFever(): void {
    this.sfx.feverEnd();
    this.hud.setFever(false);
    this.tweens.add({ targets: this.feverBorder, alpha: 0, duration: 300 });
    this.lastComboLevel = 0;
    this.refreshComboHUD();
  }

  queueBeatSfx(cue: BeatSfxCue): void {
    this.pendingBeatSfx.add(cue);
  }

  private playQueuedBeatSfx(): void {
    const priority: BeatSfxCue[] = ['playerHurt', 'feverStart', 'enemyHurt', 'pickup'];
    const cue = priority.find((candidate) => this.pendingBeatSfx.has(candidate));
    this.pendingBeatSfx.clear();

    if (cue === 'playerHurt') this.sfx.hurt();
    else if (cue === 'feverStart') this.sfx.feverStart();
    else if (cue === 'enemyHurt') this.sfx.enemyHurt();
    else if (cue === 'pickup') this.sfx.pickup();
  }
}
