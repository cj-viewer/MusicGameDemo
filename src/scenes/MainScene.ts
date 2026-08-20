import Phaser from 'phaser';
import { Conductor, type BeatInfo } from '../core/Conductor';
import {
  ComboSystem,
  INPUT_EARLY_WINDOW,
  type AttackInputPhase,
  type AttackJudgement
} from '../game/ComboSystem';
import { HUD } from '../game/HUD';
import { Player } from '../game/Player';
import { registerPlayerAnimations } from '../game/playerAnimation';
import { BATON, GLOWSTICKS, getAttackSpec, type WeaponDef, type WeaponId } from '../game/weapons';
import { BossGuard, Enemy, FanEnemy, SmallGuard, TutorialCharacter, type EnemyKind } from '../game/enemies';
import { registerFanAnimations } from '../game/fanAnimation';
import { registerGuardAnimations } from '../game/guardAnimation';
import { registerTutorialCharacterAnimations } from '../game/tutorialCharacterAnimation';
import { GAMEPAD_BUTTON, rumbleParameters, type RumbleKind } from '../game/GamepadControls';
import { WORLD_OBJECT_SCALE, worldSize } from '../game/visualScale';
import type { FpvMiniScene } from './FpvMiniScene';
import { passesDropChance, TuningEditor } from '../game/TuningEditor';
import {
  MAIN_CAMERA_BASE_ZOOM,
  MAIN_CAMERA_LOOK_DAMPING_MS,
  MAIN_CAMERA_LOOK_DEAD_ZONE,
  MAIN_CAMERA_LOOK_MAX_X,
  MAIN_CAMERA_LOOK_MAX_Y,
  screenLayerOffset,
  applyScreenLayerScrollFactor
} from '../game/cameraConfig';
import { UI_SCALE, VIEW_HEIGHT, VIEW_WIDTH, ui as hd } from '../game/displayConfig';
import {
  BGM_TRACKS,
  DEFAULT_LEVEL_BGM_SLOT,
  DEFAULT_TUTORIAL_BGM_SLOT,
  type BgmTrack
} from '../game/bgmTracks';
import {
  queueBgmTrack,
  queueCoreAssets,
  queueDeferredBgm,
  queuePostTutorialVideo,
  startBackgroundLoad,
  POST_TUTORIAL_VIDEO_KEY,
  TUTORIAL_BOTTOM_ROCKS_KEY,
  TUTORIAL_CONTROL_DASH_KEY,
  TUTORIAL_CONTROL_HEAVY_KEY,
  TUTORIAL_CONTROL_LIGHT_KEY,
  TUTORIAL_CONTROL_SETTINGS_KEY,
  TUTORIAL_PATTERN_PANEL_KEY
} from '../game/assetManifest';
import {
  createStageEnvironments,
  STAGE_JUDGEMENT_DEPTH,
  type StageEnvironmentController
} from '../game/PinkStageEnvironment';

/** 试玩中的统一节拍速度；BGM 按各自原始 BPM 等比变速到该值。 */
const BPM = 132;

/** BGM 通道归一显示为 100%；基础混音为上一版四分之一后的两倍。 */
const BGM_VOLUME = 0.2;

const DEFAULT_MASTER_VOLUME = 1;
const MAX_MASTER_VOLUME = 2;
const DEFAULT_BGM_CHANNEL_VOLUME = 1;
const MAX_CHANNEL_VOLUME = 2;
const SETTINGS_VOLUME_TRACK_X = 280;
const SETTINGS_VOLUME_TRACK_WIDTH = 250;
const SETTINGS_PANEL_X = 20;
const SETTINGS_PANEL_Y = 35;
const SETTINGS_PANEL_WIDTH = 600;
const SETTINGS_PANEL_HEIGHT = 650;
const SETTINGS_PANEL_CAPTURE_PADDING = 24;
const SETTINGS_PANEL_FROST_TEXTURE_KEY = 'volume-panel-frost';
/** 2K 主场景使用 1.065x 基础镜头，并按角色靠近场地边缘的程度做 Cinemachine 风格前探。 */
const CAMERA_BASE_SCROLL_X = screenLayerOffset(VIEW_WIDTH);
const CAMERA_BASE_SCROLL_Y = screenLayerOffset(VIEW_HEIGHT);
/** 留出一圈可见场景，同时在 1.065x 镜头下不让判定框被裁出屏幕。 */
const ARENA_FRAME_INSET = hd(48);
const ARENA = {
  // 角色、敌人与判定框共用同一内缩活动区域。
  x: ARENA_FRAME_INSET,
  y: ARENA_FRAME_INSET,
  width: VIEW_WIDTH - ARENA_FRAME_INSET * 2,
  height: VIEW_HEIGHT - ARENA_FRAME_INSET * 2
};
/**
 * `scrollFactor=0` 的屏幕提示仍会经过主镜头 zoom；使用与 HUD 相同的
 * scroll 偏移与反向倍率，才能在实际屏幕上精确保留 72px 的四边留白。
 */
const SCREEN_ARENA_CENTER_X = CAMERA_BASE_SCROLL_X + VIEW_WIDTH / (2 * MAIN_CAMERA_BASE_ZOOM);
const SCREEN_ARENA_CENTER_Y = CAMERA_BASE_SCROLL_Y + VIEW_HEIGHT / (2 * MAIN_CAMERA_BASE_ZOOM);
const SCREEN_ARENA_WIDTH = ARENA.width / MAIN_CAMERA_BASE_ZOOM;
const SCREEN_ARENA_HEIGHT = ARENA.height / MAIN_CAMERA_BASE_ZOOM;
const SCREEN_ARENA_X = CAMERA_BASE_SCROLL_X + ARENA.x / MAIN_CAMERA_BASE_ZOOM;
const SCREEN_ARENA_Y = CAMERA_BASE_SCROLL_Y + ARENA.y / MAIN_CAMERA_BASE_ZOOM;
const ARENA_BEAT_LIGHT_COLOR = 0xe879f9;
const ARENA_BEAT_HEAVY_COLOR = 0xf97316;
/** 连招起手后，仅为剩余第 2 / 3 / 4 拍复用旧版三框小节预告。 */
const ARENA_BEAT_CUE_START_SCALE = 0.7;
const ARENA_BEAT_CUE_COUNT = 3;
const ARENA_BEAT_CUE_DURATION_BEATS = 2.4;
const ARENA_BEAT_CUE_JUDGEMENT_SCALE_PROGRESS = 0.5;
const ARENA_BEAT_CUE_MIN_ALPHA = 0;
const ARENA_BEAT_HEAVY_ALPHA_PEAK_PROGRESS = 0.9;
const TUTORIAL_CALIBRATION_SAMPLES = 12;
const TUTORIAL_CALIBRATION_MAX_ABS_OFFSET = 0.12;
const TUTORIAL_CALIBRATION_CANDIDATE_WINDOW = 0.18;
const TUTORIAL_CALIBRATION_MAX_SPREAD = 0.04;
const PLAYER_BULLET_LENGTH = worldSize(38);
const ENEMY_BULLET_LENGTH = worldSize(36 * 0.75);
const BULLET_THICKNESS = worldSize(10);
const ENEMY_BULLET_THICKNESS = BULLET_THICKNESS * 0.75;
/** 每拍前 0.2 秒以归一化 easeInExpo 重分配位移，总行程仍为基础速度 × 0.2 秒。 */
const ENEMY_BULLET_BEAT_SURGE_WINDOW = 0.2;
const PLAYER_BULLET_COLOR = 0xef4444;
const BATON_BULLET_COLOR = 0xa855f7;
const GUARD_BULLET_COLOR = 0x52efff;
const FAN_BULLET_COLOR = 0xff543d;
const PLAYER_PROJECTILE_TEXTURE = 'fx-projectile-player-composite';
const PLAYER_PROJECTILE_ON_BEAT_TEXTURE = 'fx-projectile-player-composite-on-beat';
const GUARD_PROJECTILE_TEXTURE = 'fx-projectile-guard-composite';
const FAN_PROJECTILE_TEXTURE = 'fx-projectile-fan-composite';
const TUTORIAL_PINK_PROJECTILE_TEXTURE = 'fx-projectile-tutorial-pink-composite';
const BOSS_TRIPLE_PROJECTILE_TEXTURE = 'fx-projectile-boss-triple-composite';
const BOSS_NOTE_PROJECTILE_TEXTURE = 'fx-projectile-boss-note-composite';
const BOSS_TRIPLE_BULLET_COLOR = 0x3b82f6;
const BOSS_NOTE_BULLET_COLOR = 0x22c55e;
const BOSS_CRESCENT_COLOR = 0xa855f7;
type BossProjectileStyle = 'triple' | 'note';
/** 透明宿主沿用既有尺寸；主画面可见胶囊缩短 20%，判定段与外部纹理包围不变。 */
const PLAYER_LINE_CORE_LENGTH_SCALE = 1.35;
const PLAYER_LINE_VISIBLE_LENGTH_SCALE = PLAYER_LINE_CORE_LENGTH_SCALE * 0.8;
const PLAYER_LINE_CORE_THICKNESS_SCALE = 0.52;
const PLAYER_LINE_GLOW_LENGTH_SCALE = 1.95;
const PLAYER_LINE_GLOW_THICKNESS_SCALE = 3.2;
/** 参考旧版画面，在武器发光端与直射亮芯之间保留约 19px 的 720p 屏幕间距。 */
const PLAYER_STRAIGHT_MUZZLE_GAP = worldSize(24);
/** 点弹只在实体轮廓外保留一圈紧贴泛光，避免浅色地面上的大面积夹白。 */
const ENEMY_PROJECTILE_GLOW_DISTANCE = worldSize(13);
/** bg1.psd 内嵌 UI 使用 1920×1080 绝对坐标，进入 2K 画布时统一等比放大。 */
const PSD_LAYOUT_SCALE = VIEW_WIDTH / 1920;
const TUTORIAL_PATTERN_PANEL_X = 114.07098267244896;
const TUTORIAL_PATTERN_PANEL_Y = 86.03587055872106;
const TUTORIAL_PATTERN_PANEL_WIDTH = 354.68973765582154;
const TUTORIAL_PATTERN_PANEL_HEIGHT = 170.59471811127755;
const TUTORIAL_PATTERN_PANEL_CROPS = [
  { x: 63, y: 124, width: 94, height: 95 },
  { x: 174, y: 124, width: 94, height: 95 },
  { x: 286, y: 124, width: 94, height: 95 },
  { x: 397, y: 124, width: 95, height: 95 }
] as const;
const TUTORIAL_BOTTOM_ROCKS_LAYOUT = {
  x: 89,
  y: 877,
  width: 1704,
  height: 112
} as const;
const TUTORIAL_CONTROL_LAYOUTS = [
  { key: TUTORIAL_CONTROL_LIGHT_KEY, x: 130, y: 450 },
  { key: TUTORIAL_CONTROL_HEAVY_KEY, x: 128, y: 549 },
  { key: TUTORIAL_CONTROL_SETTINGS_KEY, x: 128, y: 648 },
  { key: TUTORIAL_CONTROL_DASH_KEY, x: 128, y: 747 }
] as const;
const TUTORIAL_CONTROL_WIDTH = 320;
const TUTORIAL_CONTROL_HEIGHT = 64;
const TUTORIAL_CONTROL_ENTRANCE_DELAY = 160;
const TUTORIAL_CONTROL_ENTRANCE_DURATION = 280;
/** 正式关四拍图案放大为上一版的两倍。 */
const FORMAL_PATTERN_SCALE = 1.16;
/** 放在 ARENA 顶部反馈框线（2K y=96）下方，避免框线穿过图案。 */
const FORMAL_PATTERN_ICON_Y = 112;
const FORMAL_PATTERN_BASE_COLOR = 0xffffff;
const FORMAL_PATTERN_LIGHT_COLOR = 0x67e8f9;
const FORMAL_PATTERN_HEAVY_COLOR = 0xfbbf24;
const FORMAL_PATTERN_HIT_FLASH_MS = 220;
const BATON_KNOCKBACK_SPEED = 187.5;
const BATON_HEAVY_KNOCKBACK_SPEED = 360;
const BATON_CRESCENT_KNOCKBACK_SPEED = 480;

type GameState =
  | 'title'
  | 'tutorialIntroWalk'
  | 'tutorialDialogue'
  | 'tutorial'
  | 'tutorialEnergyDialogue'
  | 'tutorialConfirm'
  | 'tutorialOutro'
  | 'levelIntroWalk'
  | 'levelDialogue'
  | 'playing'
  | 'intermission'
  | 'victory'
  | 'over';

const TUTORIAL_DIALOGUE_LINES = [
  '终于到了节奏星球。',
  '听说这里的人除了走路任何行为都是按照节奏的。',
  '让我来先学习一下。',
  '我需要按照节奏击打。',
  '闪避可以让我短暂无敌。',
  '试着完成三个小节和一次闪避吧！'
] as const;
const FIRST_LEVEL_DIALOGUE_LINES = [
  '打败这些保安和围堵的粉丝。',
  '我就可以去内场见DJ Princess了！'
] as const;
const TUTORIAL_ENERGY_DIALOGUE_LINES = [
  '下面的能量会随着时间而流逝。',
  '按对节拍会增加能量。',
  '闪避会消耗少量能量，但是错拍闪避会消耗大量能量。',
  '能量会给我的攻击带来加成。',
  '能量满了会触发大招。',
  '准备好了，去现场吧！',
  '对了，可以试试看捡起别人掉落的武器哦。'
] as const;
const TUTORIAL_INTRO_START_X = ARENA.x + worldSize(28);
const TUTORIAL_INTRO_TARGET_X = VIEW_WIDTH * 0.38;
const TUTORIAL_INTRO_Y = VIEW_HEIGHT * 0.56;
const TUTORIAL_INTRO_WALK_DURATION_MS = 2800;
const FIRST_LEVEL_INTRO_TARGET_X = VIEW_WIDTH * 0.5;

/** 教学要求累计完成的完整四拍 Pattern 数 */
const TUTORIAL_TARGET_STREAK = 3;
type AudioChannel = 'master' | 'bgm' | 'rhythm';
type VolumeControlChannel = AudioChannel;
type CombatSettingsPage = 'speed' | 'playerDamage' | 'comboMeter' | 'enemy' | 'boss' | 'mode';
type CombatSettingKey =
  | 'playerMoveSpeed'
  | 'glowstickBulletSpeed'
  | 'glowstickLightAttackSpeed'
  | 'glowstickHeavyAttackSpeed'
  | 'batonSweepSpeed'
  | 'batonLightAttackSpeed'
  | 'batonHeavyAttackSpeed'
  | 'batonHoldFireFrequency'
  | 'smallGuardBulletSpeed'
  | 'smallGuardAttackFrequency'
  | 'fanBulletSpeed'
  | 'fanAttackFrequency'
  | 'enemyStraightBulletSpeedMultiplier'
  | 'enemyBulletSizeMultiplier'
  | 'glowstickHeavyChargeDelayMs'
  | 'glowstickHeavyLaserThickness'
  | 'batonHeavyCrescentRange'
  | 'batonLightSweepAngle'
  | 'batonLightSweepRange'
  | 'glowstickLightDamage'
  | 'glowstickHeavyDamage'
  | 'batonLightDamage'
  | 'batonHeavyDamage'
  | 'glowstickPerfectDamageMultiplier'
  | 'glowstickGoodDamageMultiplier'
  | 'glowstickPoorDamageMultiplier'
  | 'batonPerfectDamageMultiplier'
  | 'batonGoodDamageMultiplier'
  | 'batonPoorDamageMultiplier'
  | 'comboPerfectReward'
  | 'comboGoodReward'
  | 'comboPatternCompleteReward'
  | 'comboDecayPerSecond'
  | 'tutorialRhythmBpm'
  | 'levelRhythmBpm'
  | 'tutorialSongBpm'
  | 'levelSongBpm'
  | 'levelBeatAlignmentOffsetMs'
  | 'dodgeOnBeatCost'
  | 'dodgeOffBeatCost'
  | 'smallGuardDamage'
  | 'fanDamage'
  | 'glowstickDropChance'
  | 'batonDropChance'
  | 'waveSpawnMinBatchSize'
  | 'waveSpawnMaxBatchSize'
  | 'waveSpawnMinIntervalSeconds'
  | 'waveSpawnMaxIntervalSeconds'
  | 'bossMaxHp'
  | 'bossSizeMultiplier'
  | 'bossMoveSpeed'
  | 'bossAttackIntervalBeats'
  | 'bossProjectileDamage'
  | 'bossProjectileSpeed'
  | 'bossCrescentSpeed'
  | 'bossStompRadius'
  | 'bossStompKnockback'
  | 'bossNoteFormationSpeed'
  | 'bossNoteFormationBulletSize'
  | 'bossMinionCount';

type BpmSettingKey = 'tutorialRhythmBpm' | 'levelRhythmBpm' | 'tutorialSongBpm' | 'levelSongBpm';
const BPM_SETTING_KEYS: readonly BpmSettingKey[] = [
  'tutorialRhythmBpm',
  'levelRhythmBpm',
  'tutorialSongBpm',
  'levelSongBpm'
];

interface VolumeSliderVisual {
  fill: Phaser.GameObjects.Rectangle;
  thumb: Phaser.GameObjects.Arc;
  valueText: Phaser.GameObjects.Text;
  max: number;
}

const WAVE_ENEMY_COUNTS = [2, 6, 12, 18, 24];
const BOSS_WAVE_INDEX = WAVE_ENEMY_COUNTS.length;

interface Pickup {
  go: Phaser.GameObjects.Container;
  weaponVisual: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Arc;
  ringGlow: Phaser.Filters.Glow | null;
  weaponGlow: Phaser.Filters.Glow | null;
  baseY: number;
  weapon: WeaponDef;
}

type WaveEnemyFactory = () => Enemy;

export class MainScene extends Phaser.Scene {
  conductor!: Conductor;
  combo!: ComboSystem;
  hud!: HUD;
  player!: Player;

  private bgm!: Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
  private bgmFirstBeat = 0;
  private currentBgmTrack: BgmTrack = BGM_TRACKS[DEFAULT_TUTORIAL_BGM_SLOT];
  /** 目标曲目仍在后台下载时，先记下这次切歌请求，文件到位后再执行。 */
  private pendingBgmSwitch?: { track: BgmTrack; playNow: boolean };
  private levelBgmAlignmentDirty = false;
  private rhythmBpmDirty = false;
  /** 歌曲本身 BPM（只影响播放速度）修改后，关闭 P Menu 时需要重新对齐播放。 */
  private songBpmDirty = false;
  private tuningEditor!: TuningEditor;
  private masterVolume = DEFAULT_MASTER_VOLUME;
  private bgmChannelVolume = DEFAULT_BGM_CHANNEL_VOLUME;
  private audioChannelVolumes: Record<Exclude<AudioChannel, 'master' | 'bgm'>, number> = {
    rhythm: 1
  };
  private volumePanel!: Phaser.GameObjects.Container;
  private volumePanelFrostTexture?: Phaser.Textures.CanvasTexture;
  private volumePanelFrostImage?: Phaser.GameObjects.Image;
  private volumePanelCaptureToken = 0;
  private volumeSliders: Partial<Record<VolumeControlChannel, VolumeSliderVisual>> = {};
  private combatValueTexts: Partial<Record<CombatSettingKey, Phaser.GameObjects.Text>> = {};
  private combatSettingsPage: CombatSettingsPage = 'speed';
  private combatPageContainers: Partial<Record<CombatSettingsPage, Phaser.GameObjects.Container>> = {};
  private combatTabButtons: Partial<Record<CombatSettingsPage, Phaser.GameObjects.Rectangle>> = {};
  private heavyModeToggleButtons: Partial<Record<WeaponId, Phaser.GameObjects.Rectangle>> = {};
  private heavyModeToggleTexts: Partial<Record<WeaponId, Phaser.GameObjects.Text>> = {};
  private manualAimToggleButton!: Phaser.GameObjects.Rectangle;
  private manualAimToggleText!: Phaser.GameObjects.Text;
  private volumePanelVisible = false;
  private volumeDragging: VolumeControlChannel | null = null;
  private fpvWindowEnabled = false;
  private fpvToggleButton!: Phaser.GameObjects.Rectangle;
  private fpvToggleText!: Phaser.GameObjects.Text;
  /** ESC 设置打开时，主场景和观察窗都保持在同一帧。 */
  private gamePaused = false;
  /** 玩家死亡动画播放完毕后，全局冻结到下一次重开。 */
  private gameOverFrozen = false;
  private cameraLookX = 0;
  private cameraLookY = 0;
  private stageEnvironment!: StageEnvironmentController;
  /** 在 Window 捕获阶段接管 Escape，避免浏览器焦点或 Phaser 暂停状态吞掉设置入口。 */
  private readonly handleGlobalEscape = (event: KeyboardEvent): void => {
    if ((event.code !== 'Escape' && event.key !== 'Escape') || event.repeat || !this.sys.isActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (
      this.state === 'tutorialIntroWalk'
      || this.state === 'tutorialDialogue'
      || this.state === 'tutorialEnergyDialogue'
      || this.state === 'levelIntroWalk'
      || this.state === 'levelDialogue'
      || this.state === 'tutorialOutro'
    ) return;
    const openingSettings = this.tuningEditor.visible || !this.volumePanelVisible;
    if (openingSettings) this.completeTutorialControlTask(2, true);
    if (this.tuningEditor.visible) {
      this.setTuningEditorVisible(false);
      this.setVolumePanelVisible(true);
    } else {
      this.setVolumePanelVisible(openingSettings);
    }
    if (!openingSettings) this.resumeTutorialControlAfterSettings();
  };

  private enemies: Enemy[] = [];
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBulletHitboxes!: Phaser.Physics.Arcade.Group;
  private playerBulletHitboxes!: Phaser.Physics.Arcade.Group;
  private activeSpecialAttackFx = new Set<Phaser.GameObjects.Graphics>();
  private activeSpecialAttackTimers = new Map<Phaser.GameObjects.Graphics, Phaser.Time.TimerEvent>();
  private pickups: Pickup[] = [];
  private state: GameState = 'title';
  private waveIdx = -1;
  private displayedWaveNumber = 0;
  private pendingWaveSpawns: WaveEnemyFactory[] = [];
  private waveSpawnTimer?: Phaser.Time.TimerEvent;
  private waveAdvanceTimer?: Phaser.Time.TimerEvent;
  private victoryAchieved = false;
  private lastComboLevel = 0;
  /** 首拍命中后，为后续 2 / 3 / 4 拍显示旧版小节缩放判定框。 */
  private arenaBeatCues: Phaser.GameObjects.Rectangle[] = [];
  private arenaCorrectFeedback!: Phaser.GameObjects.Rectangle;
  private feverBorder!: Phaser.GameObjects.Graphics;
  /** 连续踩拍积累的命中与连段短效亮度；拍间持续衰减，断拍后自然回暗。 */
  private arenaRhythmIntensity = 0;
  private rhythmComboStreak = 0;
  private lastRhythmHitBeat = -Infinity;
  private gamepadButtonState = { dodge: false, attack: false };
  /** 调试：B 键切换判定框显示（红=受击判定，绿=武器/子弹判定），重开局保留开关状态 */
  private debugHitboxes = false;
  private debugGfx!: Phaser.GameObjects.Graphics;

  // 教学使用透明连段面板；正式关保留紧凑四拍图标条。
  private patternPanel?: Phaser.GameObjects.Container;
  private patternIcons: Phaser.GameObjects.Shape[] = [];
  private patternPanelMode: 'tutorial' | 'compact' = 'compact';
  private formalPatternBaseX = 0;
  private formalPatternBaseY = 0;
  /** 用于忽略已过期的延迟隐藏回调。 */
  private formalPatternVisibilityRun = 0;
  private tutorialBeatHighlights: Phaser.GameObjects.Image[] = [];
  private tutorialHitHighlights: Phaser.GameObjects.Image[] = [];
  private batonHoldTrack?: Phaser.GameObjects.Rectangle;
  private batonHoldFill?: Phaser.GameObjects.Rectangle;
  private batonHoldLabel?: Phaser.GameObjects.Text;
  private batonHoldFeedbackUntil = 0;
  private batonHeavyHeld = false;
  private batonHoldFireTimer?: Phaser.Time.TimerEvent;
  private batonHoldAttackOnBeat = false;
  private batonHoldAttackJudgement: AttackJudgement = 'poor';

  // 教学状态
  private tutorialStreakText?: Phaser.GameObjects.Text;
  private tutorialStreak = 0;
  private tutorialCompletedPatterns = 0;
  private tutorialDodgeCompleted = false;
  private tutorialEnergyDialogueStarted = false;
  private tutorialDialogue?: Phaser.GameObjects.Container;
  private tutorialDialogueText?: Phaser.GameObjects.Text;
  private tutorialDialogueIndex = 0;
  private tutorialDialogueTransitioning = false;
  private activeDialogueLines: readonly string[] = TUTORIAL_DIALOGUE_LINES;
  private tutorialOutroVideo?: Phaser.GameObjects.Video;
  private tutorialOutroBackdrop?: Phaser.GameObjects.Rectangle;
  private tutorialOutroText?: Phaser.GameObjects.Text;
  private tutorialOutroFinished = false;
  private tutorialTimingOffsets: number[] = [];
  private tutorialCalibrationBeats = new Set<number>();
  private tutorialCalibratedOffset = 0;
  private confirmUi?: Phaser.GameObjects.Container;
  /** PSD 教学石子前景与操作卡组成的屏幕固定 UI。 */
  private tutorialControlGuide?: Phaser.GameObjects.Container;
  private tutorialControlRows: Phaser.GameObjects.Image[] = [];
  private tutorialControlTaskArmed = false;
  private tutorialControlRunId = 0;
  /** 轻、重攻击卡同时常驻；分别完成后才继续设置与闪现教学。 */
  private readonly tutorialAttackTasksCompleted = new Set<number>();
  /** 教学池塘角色：每两小节换一只，无武器并从嘴部发射点弹。 */
  private tutorialCharacters: TutorialCharacter[] = [];
  /** 确认按钮点击后短暂屏蔽攻击输入，避免同一次点击又触发挥击 */
  private suppressAttackUntil = 0;
  /** 进入游戏的真实秒倒计时，-1 表示未激活。 */
  private countdownRemaining = -1;
  private countdownTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super('MainScene');
  }

  preload(): void {
    // 正式关卡的 BGM 不在这里排队：它们由 create() 后台补下，教学关不必等。
    // IntroScene 已在片头播放期间预热过同一批 key，这里通常只剩少量缓存未命中的文件。
    queueCoreAssets(this);
    this.createLoadingIndicator();
  }

  /** preload 期间的进度条，避免远端首次加载时只看到一片黑屏。 */
  private createLoadingIndicator(): void {
    if (this.load.list.size === 0 && !this.load.isLoading()) return;
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    const barWidth = hd(420);
    const barHeight = hd(14);
    const label = this.add
      .text(cx, cy - hd(34), '加载中…', {
        fontFamily: 'Arial, Microsoft YaHei, sans-serif',
        fontSize: `${hd(22)}px`,
        color: '#e9d5ff'
      })
      .setOrigin(0.5)
      .setDepth(1000);
    const frame = this.add
      .rectangle(cx, cy, barWidth, barHeight)
      .setStrokeStyle(2, 0x67e8f9, 0.9)
      .setDepth(1000);
    const fill = this.add
      .rectangle(cx - barWidth / 2 + 2, cy, 0, barHeight - 4, 0xec4899)
      .setOrigin(0, 0.5)
      .setDepth(1000);
    const onProgress = (value: number): void => {
      fill.width = Math.max(0, (barWidth - 4) * value);
      label.setText(`加载中… ${Math.round(value * 100)}%`);
    };
    this.load.on(Phaser.Loader.Events.PROGRESS, onProgress);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.load.off(Phaser.Loader.Events.PROGRESS, onProgress);
      label.destroy();
      frame.destroy();
      fill.destroy();
    });
  }

  create(): void {
    // 重开局（R 键）会在同一个 Scene 实例上重新执行 create()，先停掉旧的 bgm 避免叠放
    for (const track of BGM_TRACKS) this.sound.stopByKey(track.key);
    // 教学关只需要教学 BGM；其余曲目在这里挂后台下载，等玩家打完教学早就就绪了。
    this.pendingBgmSwitch = undefined;
    this.activeSpecialAttackFx.clear();
    this.activeSpecialAttackTimers.clear();
    this.load.off(Phaser.Loader.Events.FILE_COMPLETE, this.onDeferredFileComplete, this);
    this.load.on(Phaser.Loader.Events.FILE_COMPLETE, this.onDeferredFileComplete, this);
    queueDeferredBgm(this);
    startBackgroundLoad(this);
    this.enemies = [];
    this.pickups = [];
    this.state = 'title';
    this.gamePaused = false;
    this.gameOverFrozen = false;
    this.time.paused = false;
    this.volumePanelVisible = false;
    this.volumeDragging = null;
    this.waveIdx = -1;
    this.displayedWaveNumber = 0;
    this.pendingWaveSpawns = [];
    this.waveSpawnTimer = undefined;
    this.waveAdvanceTimer = undefined;
    this.victoryAchieved = false;
    this.lastComboLevel = 0;
    this.arenaRhythmIntensity = 0;
    this.rhythmComboStreak = 0;
    this.lastRhythmHitBeat = -Infinity;
    this.gamepadButtonState = { dodge: false, attack: false };
    this.patternPanel = undefined;
    this.patternIcons = [];
    this.patternPanelMode = 'compact';
    this.formalPatternBaseX = 0;
    this.formalPatternVisibilityRun = 0;
    this.tutorialBeatHighlights = [];
    this.tutorialHitHighlights = [];
    this.batonHoldTrack = undefined;
    this.batonHoldFill = undefined;
    this.batonHoldLabel = undefined;
    this.batonHoldFeedbackUntil = 0;
    this.batonHeavyHeld = false;
    this.batonHoldFireTimer = undefined;
    this.batonHoldAttackOnBeat = false;
    this.batonHoldAttackJudgement = 'poor';
    this.confirmUi = undefined;
    this.tutorialControlGuide = undefined;
    this.tutorialControlRows = [];
    this.tutorialControlTaskArmed = false;
    this.tutorialControlRunId = 0;
    this.tutorialAttackTasksCompleted.clear();
    this.tutorialStreakText = undefined;
    this.tutorialStreak = 0;
    this.tutorialCompletedPatterns = 0;
    this.tutorialDodgeCompleted = false;
    this.tutorialEnergyDialogueStarted = false;
    this.tutorialDialogue = undefined;
    this.tutorialDialogueText = undefined;
    this.tutorialDialogueIndex = 0;
    this.tutorialDialogueTransitioning = false;
    this.activeDialogueLines = TUTORIAL_DIALOGUE_LINES;
    this.tutorialOutroVideo = undefined;
    this.tutorialOutroBackdrop = undefined;
    this.tutorialOutroText = undefined;
    this.tutorialOutroFinished = false;
    this.suppressAttackUntil = 0;
    this.countdownRemaining = -1;
    this.countdownTimer = undefined;
    this.cameraLookX = 0;
    this.cameraLookY = 0;
    this.cameras.main
      .setBounds(0, 0, VIEW_WIDTH, VIEW_HEIGHT)
      .setZoom(MAIN_CAMERA_BASE_ZOOM)
      .setScroll(CAMERA_BASE_SCROLL_X, CAMERA_BASE_SCROLL_Y);
    this.createEnemyAnimations();
    registerPlayerAnimations(this);
    this.stageEnvironment = createStageEnvironments(this);

    this.physics.world.setBounds(ARENA.x, ARENA.y, ARENA.width, ARENA.height);
    this.arenaBeatCues = Array.from({ length: ARENA_BEAT_CUE_COUNT }, () =>
      this.add
        .rectangle(SCREEN_ARENA_CENTER_X, SCREEN_ARENA_CENTER_Y, SCREEN_ARENA_WIDTH, SCREEN_ARENA_HEIGHT)
        .setStrokeStyle(3, ARENA_BEAT_LIGHT_COLOR, 1)
        .setFillStyle(0, 0)
        .setScale(ARENA_BEAT_CUE_START_SCALE)
        .setAlpha(0)
        .setVisible(false)
        .setDepth(STAGE_JUDGEMENT_DEPTH)
        .setScrollFactor(0)
    );
    this.arenaCorrectFeedback = this.add
      .rectangle(SCREEN_ARENA_CENTER_X, SCREEN_ARENA_CENTER_Y, SCREEN_ARENA_WIDTH, SCREEN_ARENA_HEIGHT)
      .setStrokeStyle(12, ARENA_BEAT_LIGHT_COLOR, 0)
      .setFillStyle(0, 0)
      .setVisible(false)
      // 绘制在底图之上、所有环境物件与角色之下。
      .setDepth(STAGE_JUDGEMENT_DEPTH)
      // 判定框属于屏幕提示，镜头前探时也始终与左右边缘等距。
      .setScrollFactor(0);
    this.debugGfx = this.add.graphics().setDepth(20);

    // Fever Time 期间的橙色边框光效（随节拍脉冲）
    this.feverBorder = this.add.graphics().setDepth(7).setAlpha(0).setScrollFactor(0);
    this.feverBorder.lineStyle(12, 0xf97316, 1);
    this.feverBorder.strokeRect(
      SCREEN_ARENA_X + 3 / MAIN_CAMERA_BASE_ZOOM,
      SCREEN_ARENA_Y + 3 / MAIN_CAMERA_BASE_ZOOM,
      SCREEN_ARENA_WIDTH - 6 / MAIN_CAMERA_BASE_ZOOM,
      SCREEN_ARENA_HEIGHT - 6 / MAIN_CAMERA_BASE_ZOOM
    );

    const soundManager = this.sound as Phaser.Sound.WebAudioSoundManager;
    soundManager.masterVolumeNode.gain.setValueAtTime(this.masterVolume, soundManager.context.currentTime);
    this.conductor = new Conductor(this, BPM);
    this.applyAudioCategoryVolumes();
    this.currentBgmTrack = BGM_TRACKS[DEFAULT_TUTORIAL_BGM_SLOT];
    this.bgm = this.sound.add(this.currentBgmTrack.key, {
      loop: false,
      volume: BGM_VOLUME * this.bgmChannelVolume
    }) as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
    this.bgm.on(Phaser.Sound.Events.COMPLETE, this.onBgmComplete, this);
    this.combo = new ComboSystem(this.conductor, GLOWSTICKS.pattern);
    this.hud = new HUD(this, this.conductor);
    this.player = new Player(this, hd(640), hd(400));
    this.hud.updatePlayerHpPosition(this.player.x, this.player.y);

    this.hud.setPattern(GLOWSTICKS.pattern, GLOWSTICKS.name);
    this.hud.setHp(this.player.hp, this.player.maxHp);
    this.hud.setVictoryVisible(false);
    this.tuningEditor = new TuningEditor(this, BGM_TRACKS.map((track) => track.label));
    this.tuningEditor.tutorialBgmSlot = DEFAULT_TUTORIAL_BGM_SLOT;
    this.tuningEditor.levelBgmSlot = DEFAULT_LEVEL_BGM_SLOT;
    this.tuningEditor.loadPersistedConfig();
    this.syncComboEnergyRewards();
    this.createSettingsPanel();

    this.enemyGroup = this.physics.add.group();
    this.bullets = this.physics.add.group();
    this.playerBullets = this.physics.add.group();
    this.enemyBulletHitboxes = this.physics.add.group();
    this.playerBulletHitboxes = this.physics.add.group();

    this.physics.add.collider(this.player.go, this.enemyGroup);
    this.physics.add.collider(this.enemyGroup, this.enemyGroup);
    this.physics.add.overlap(this.player.go, this.enemyBulletHitboxes, (_playerGO, hitboxGO) => {
      if (this.state !== 'playing' && this.state !== 'tutorial') return;
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
      const enemy = [...this.enemies, ...this.tutorialCharacters].find((candidate) => candidate.go === enemyGO);
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
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanupForRestart, this);
    // 独立 Scene 只投影主场景数据，不参与主场景的控制、物理或判定。
    if (this.scene.isActive('FpvMiniScene')) this.scene.stop('FpvMiniScene');
    this.scene.launch('FpvMiniScene');
    // 直接进入教学，不再用全屏标题遮罩等待点击。
    this.startGame();
  }

  update(_time: number, delta: number): void {
    if (this.gamePaused || this.gameOverFrozen) return;
    this.conductor.update();
    this.resolveMissedComboBeat();
    this.hud.update();
    this.updateBatonHoldUi();
    this.updateArenaRhythmIntensity(delta);
    this.updateComboArenaBeatCues();
    if (this.combo.updateFever()) this.endFever();
    if (
      (this.state === 'tutorial'
        || this.state === 'tutorialEnergyDialogue'
        || this.state === 'playing'
        || this.state === 'intermission')
      && !this.combo.feverActive()
      && this.combo.progress > 0
    ) {
      const displayedBefore = Math.round(this.combo.progress);
      this.combo.decayProgress(this.tuningEditor.comboDecayPerSecond * Math.max(0, delta) / 1000);
      if (Math.round(this.combo.progress) !== displayedBefore) this.refreshComboHUD();
    }
    this.handleGamepadInput();
    this.updateCameraLookAhead(delta);

    if (this.state === 'over' || this.state === 'title' || this.state === 'tutorialOutro') {
      this.drawDebugHitboxes();
      return;
    }

    this.player.update(this.time.now, delta);
    if (
      this.state === 'tutorialDialogue'
      || this.state === 'tutorialEnergyDialogue'
      || this.state === 'levelDialogue'
    ) this.updateTutorialDialoguePosition();
    this.hud.updatePlayerHpPosition(this.player.x, this.player.y);
    for (const enemy of this.enemies) enemy.update(delta);
    for (const character of this.tutorialCharacters) character.update(delta);
    this.updateEnemyBulletBeatSurge(delta);
    this.updateStraightBulletHitboxes();
    this.updateSpecialEnemyProjectiles();
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

  getPlayerMoveSpeed(): number {
    return this.tuningEditor?.playerMoveSpeed ?? 260;
  }

  isManualAimEnabled(): boolean {
    return this.isPlayerControlEnabled() && (this.tuningEditor?.manualAimEnabled ?? false);
  }

  isPlayerControlEnabled(): boolean {
    return this.state === 'tutorial' || this.state === 'playing' || this.state === 'intermission';
  }

  get isTitleScreen(): boolean {
    return this.state === 'title';
  }

  get isTutorialStage(): boolean {
    return this.state === 'tutorialIntroWalk'
      || this.state === 'tutorialDialogue'
      || this.state === 'tutorialEnergyDialogue'
      || this.state === 'levelIntroWalk'
      || this.state === 'levelDialogue'
      || this.state === 'tutorial'
      || this.state === 'tutorialConfirm'
      || this.state === 'tutorialOutro';
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

  getBossCombatConfig(): {
    maxHp: number;
    sizeMultiplier: number;
    moveSpeed: number;
    attackIntervalBeats: number;
    projectileDamage: number;
    projectileSpeed: number;
    crescentSpeed: number;
    stompRadius: number;
    stompKnockback: number;
    noteFormationSpeed: number;
    noteFormationBulletSize: number;
    minionCount: number;
  } {
    return {
      maxHp: this.tuningEditor.bossMaxHp,
      sizeMultiplier: this.tuningEditor.bossSizeMultiplier,
      moveSpeed: this.tuningEditor.bossMoveSpeed,
      attackIntervalBeats: this.tuningEditor.bossAttackIntervalBeats,
      projectileDamage: this.tuningEditor.bossProjectileDamage,
      projectileSpeed: this.tuningEditor.bossProjectileSpeed,
      crescentSpeed: this.tuningEditor.bossCrescentSpeed,
      stompRadius: this.tuningEditor.bossStompRadius,
      stompKnockback: this.tuningEditor.bossStompKnockback,
      noteFormationSpeed: this.tuningEditor.bossNoteFormationSpeed,
      noteFormationBulletSize: this.tuningEditor.bossNoteFormationBulletSize,
      minionCount: this.tuningEditor.bossMinionCount
    };
  }

  onBossSpawned(boss: BossGuard): void {
    this.hud.setBossHealth(boss.hp, boss.maxHp);
    this.hud.setBossHealthVisible(true);
  }

  onBossHealthChanged(hp: number, maxHp: number): void {
    this.hud.setBossHealth(hp, maxHp);
  }

  onBossDefeated(_boss: BossGuard): void {
    this.hud.setBossHealthVisible(false);
  }

  // ---------- 输入 ----------

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    this.input.keyboard!.addCapture(Phaser.Input.Keyboard.KeyCodes.ESC);

    window.removeEventListener('keydown', this.handleGlobalEscape, true);
    window.addEventListener('keydown', this.handleGlobalEscape, true);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.gamePaused || this.gameOverFrozen || this.volumePanelVisible || this.tuningEditor.visible) return;
      const btn = pointer.rightButtonDown() ? 'H' : pointer.leftButtonDown() ? 'L' : null;
      if (this.state === 'tutorialIntroWalk' || this.state === 'levelIntroWalk') return;
      if (
        this.state === 'tutorialDialogue'
        || this.state === 'tutorialEnergyDialogue'
        || this.state === 'levelDialogue'
      ) {
        if (btn === 'L') this.advanceTutorialDialogue();
        return;
      }
      if (this.state === 'tutorialOutro') return;
      if (this.state === 'title') {
        this.startGame();
        return;
      }
      if (this.state === 'tutorialConfirm') {
        // 可交互确认按钮自行处理点击；画面其余区域仍沿用轻攻进入、重攻重练。
        if (this.input.hitTestPointer(pointer).length > 0) return;
        if (btn) this.handleTutorialConfirmInput(btn);
        return;
      }
      if (this.state === 'over' || this.state === 'victory' || this.time.now < this.suppressAttackUntil) return;
      const attackHandled = btn === 'H' && this.player.weapon.id === 'baton'
        ? this.beginBatonHeavyHold()
        : btn ? this.handleAttackInput(btn) : false;
      if (btn && attackHandled) {
        this.completeTutorialControlTask(btn === 'L' ? 0 : 1);
      }
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 2) this.endBatonHeavyHold(true);
    });

    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (
        event.repeat
        || this.gamePaused
        || this.gameOverFrozen
        || this.volumePanelVisible
        || this.tuningEditor.visible
      ) return;

      if (this.state === 'tutorialOutro') {
        if (event.code === 'Space') {
          event.preventDefault();
          this.finishTutorialOutro();
        }
        return;
      }

      if (event.code === 'Space' && this.state === 'tutorial') {
        event.preventDefault();
        this.finishTutorial();
        return;
      }

      if (event.code === 'Quote' || event.code === 'Enter') {
        event.preventDefault();
        if (this.state === 'tutorialIntroWalk' || this.state === 'levelIntroWalk') return;
        if (
          this.state === 'tutorialDialogue'
          || this.state === 'tutorialEnergyDialogue'
          || this.state === 'levelDialogue'
        ) {
          if (event.code === 'Quote') this.advanceTutorialDialogue();
          return;
        }
        if (this.state === 'title') {
          this.startGame();
          return;
        }
        const btn = event.code === 'Quote' ? 'L' : 'H';
        if (this.state === 'tutorialConfirm') {
          this.handleTutorialConfirmInput(btn);
          return;
        }
        if (this.state === 'over' || this.state === 'victory' || this.time.now < this.suppressAttackUntil) return;
        const attackHandled = btn === 'H' && this.player.weapon.id === 'baton'
          ? this.beginBatonHeavyHold()
          : this.handleAttackInput(btn);
        if (attackHandled) this.completeTutorialControlTask(btn === 'L' ? 0 : 1);
        return;
      }

      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        event.preventDefault();
        if (this.tryKeyboardDodge()) this.completeTutorialControlTask(3);
      }
    });

    this.input.keyboard!.on('keydown-R', (event: KeyboardEvent) => {
      if (event.repeat || this.gamePaused || this.state === 'tutorialOutro') return;
      this.restartGame();
    });

    this.input.keyboard!.on('keydown-P', (event: KeyboardEvent) => {
      event.preventDefault();
      if (
        this.state === 'tutorialIntroWalk'
        || this.state === 'tutorialDialogue'
        || this.state === 'tutorialEnergyDialogue'
        || this.state === 'levelIntroWalk'
        || this.state === 'levelDialogue'
        || this.state === 'tutorialOutro'
      ) return;
      if (!event.repeat && !this.volumePanelVisible) this.setTuningEditorVisible(!this.tuningEditor.visible);
    });

    // 调试：H 键切换判定框显示（原来绑在 B 上，B 让给一键跳 Boss）
    this.input.keyboard!.on('keydown-H', () => {
      if (this.gamePaused || this.state === 'tutorialOutro') return;
      this.debugHitboxes = !this.debugHitboxes;
    });

    // 原型调试键：F 直接充满 ComboMeter，便于快速验证 Fever Time
    this.input.keyboard!.on('keydown-F', () => {
      if (this.gamePaused || this.state === 'tutorialOutro') return;
      if (this.state === 'tutorial' || this.state === 'playing' || this.state === 'intermission') {
        this.combo.addProgress(100);
        this.refreshComboHUD();
      }
    });
    this.input.keyboard!.on('keyup-ENTER', () => this.endBatonHeavyHold(true));
    // 调试键 B（跳 Boss）/ C（清弹）/ V（一键通关）已在正式版关闭；
    // debugJumpToBoss / triggerFeverScreenClear / finishVictory 仍由正常玩法路径调用。
  }

  private restartGame(): void {
    this.gameOverFrozen = false;
    this.time.paused = false;
    this.scene.stop('FpvMiniScene');
    this.scene.restart();
  }

  private cleanupForRestart(): void {
    this.countdownTimer?.remove();
    this.countdownTimer = undefined;
    this.waveSpawnTimer?.remove();
    this.waveAdvanceTimer?.remove();
    this.pendingWaveSpawns = [];
    this.waveSpawnTimer = undefined;
    this.waveAdvanceTimer = undefined;
    this.destroyTutorialControlGuide();
    this.destroyTutorialDialogue();
    this.destroyTutorialOutro();
    this.player?.setScriptedWalk(false);
    this.volumePanelCaptureToken++;
    this.volumePanelFrostImage?.setVisible(false);
    this.volumePanelFrostImage = undefined;
    this.volumePanelFrostTexture = undefined;
    if (this.textures.exists(SETTINGS_PANEL_FROST_TEXTURE_KEY)) {
      this.textures.remove(SETTINGS_PANEL_FROST_TEXTURE_KEY);
    }
    window.removeEventListener('keydown', this.handleGlobalEscape, true);
    this.bgm?.off(Phaser.Sound.Events.COMPLETE, this.onBgmComplete, this);
    this.bgm?.stop();
    this.conductor?.off('beat', this.onBeat, this);
    if (this.scene.isActive('FpvMiniScene')) this.scene.stop('FpvMiniScene');
  }

  /**
   * 角色位于场地中央死区时镜头保持居中；越靠近上下左右或四角，越向同方向前探。
   * 指数阻尼使帧率变化时仍保持相近的缓入缓出手感，不修改任何世界坐标或玩法判定。
   */
  private updateCameraLookAhead(deltaMs: number): void {
    if (!this.player) return;
    if (
      this.state === 'tutorialIntroWalk'
      || this.state === 'tutorialDialogue'
      || this.state === 'tutorialEnergyDialogue'
      || this.state === 'levelIntroWalk'
      || this.state === 'levelDialogue'
    ) {
      const damping = 1 - Math.exp(-Math.max(0, deltaMs) / MAIN_CAMERA_LOOK_DAMPING_MS);
      this.cameraLookX = Phaser.Math.Linear(this.cameraLookX, 0, damping);
      this.cameraLookY = Phaser.Math.Linear(this.cameraLookY, 0, damping);
      this.cameras.main.setScroll(CAMERA_BASE_SCROLL_X + this.cameraLookX, CAMERA_BASE_SCROLL_Y + this.cameraLookY);
      return;
    }
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

  private tryKeyboardDodge(): boolean {
    if (this.gamePaused) return false;
    if (this.state === 'playing' || this.state === 'intermission' || this.state === 'tutorial') {
      const dodged = this.player.tryDodge();
      if (dodged && this.state === 'tutorial') this.recordTutorialDodge();
      return dodged;
    }
    return false;
  }

  private handleAttackInput(
    btn: 'L' | 'H',
    pad?: Phaser.Input.Gamepad.Gamepad,
    phase: AttackInputPhase = 'press'
  ): boolean {
    if (this.gamePaused) return false;
    this.player.refreshAimDirection();
    if (this.state === 'tutorial' && phase === 'press') this.recordTutorialCalibrationCandidate(btn);
    const result = this.combo.handleInput(btn, this.conductor.now(), phase);
    const attackPerformed = result.type === 'correct' || result.type === 'wrong';
    if (this.player.weapon.id === 'baton' && btn === 'H' && phase === 'press') {
      this.batonHoldAttackOnBeat = result.type === 'correct';
      this.batonHoldAttackJudgement = result.type === 'correct' ? result.judgement : 'poor';
      if (result.type === 'correct' && result.beatIdx === 1) this.showBatonHoldPressFeedback(result.judgement);
      else if (result.type === 'wrong' && result.beatIdx === 1) this.showBatonHoldPressFeedback('poor');
    }
    if (result.type === 'correct') {
      if (result.comboStarted && this.state !== 'tutorial') this.showFormalComboPattern();
      this.showAttackJudgement(result.judgement, result.timingOffset);
      if (phase === 'press') this.performWeaponAttack(result.beatIdx, true, btn, result.judgement);
      this.conductor.playPlayerCall(btn);
      this.registerRhythmHit(result.globalBeat, btn === 'H');
      if (this.combo.feverActive()) this.player.heal(10);
      this.flashArenaCorrectJudgement(this.combo.pattern[result.beatIdx] === 'H');
      this.hud.flashSuccess(result.globalBeat);
      this.flashPatternIcon(result.beatIdx);
      if (phase === 'release') this.showBatonHoldReleaseFeedback(true, result.judgement);
      if (result.comboCompleted && this.state !== 'tutorial') this.hideFormalComboPattern(FORMAL_PATTERN_HIT_FLASH_MS);
      this.refreshComboHUD();
      if (pad) this.rumbleGamepad(pad, btn === 'H' ? 'heavy' : 'light');
      if (this.state === 'tutorial' && result.comboCompleted) this.recordTutorialCompletedPattern();
    } else if (result.type === 'wrong') {
      this.showAttackJudgement(result.judgement, result.timingOffset, result.reason);
      this.breakRhythmCombo();
      if (phase === 'press') this.performWeaponAttack(result.beatIdx, false, btn, result.judgement);
      this.player.errorFlash();
      this.hud.flashError();
      if (result.comboFailed && this.state !== 'tutorial') this.flashAndHideFormalComboPattern();
      if (phase === 'release') this.showBatonHoldReleaseFeedback(false, 'poor');
    }

    return attackPerformed;
  }

  private beginBatonHeavyHold(): boolean {
    if (this.batonHeavyHeld) return false;
    this.batonHeavyHeld = true;
    const handled = this.handleAttackInput('H', undefined, 'press');
    this.scheduleNextBatonHoldShot();
    return handled;
  }

  private endBatonHeavyHold(submitRelease: boolean): boolean {
    if (!this.batonHeavyHeld) return false;
    this.batonHeavyHeld = false;
    this.batonHoldFireTimer?.remove();
    this.batonHoldFireTimer = undefined;
    if (submitRelease && this.combo.expectsHeavyRelease && !this.gamePaused) {
      return this.handleAttackInput('H', undefined, 'release');
    }
    if (this.batonHoldLabel && this.batonHoldLabel.text.startsWith('持续')) {
      this.showBatonHoldReleaseFeedback(false, 'poor');
    }
    return false;
  }

  private scheduleNextBatonHoldShot(): void {
    if (!this.batonHeavyHeld) return;
    const shotsPerSecond = Phaser.Math.Clamp(this.tuningEditor.batonHoldFireFrequency, 0.5, 20);
    this.batonHoldFireTimer = this.time.delayedCall(1000 / shotsPerSecond, () => {
      this.batonHoldFireTimer = undefined;
      if (
        !this.batonHeavyHeld
        || this.player.weapon.id !== 'baton'
        || this.state === 'over'
        || this.state === 'title'
      ) return;
      this.player.refreshAimDirection();
      this.performWeaponAttack(1, this.batonHoldAttackOnBeat, 'H', this.batonHoldAttackJudgement);
      this.scheduleNextBatonHoldShot();
    });
  }

  /** 漏拍没有输入也必须终止连招，并沿用错拍的 UI/教学失败反馈。 */
  private resolveMissedComboBeat(): void {
    const result = this.combo.updateComboTimeout(this.conductor.now());
    if (!result) return;

    this.showAttackJudgement(result.judgement, result.timingOffset, result.reason);
    if (result.beatIdx === 2 && this.player.weapon.id === 'baton') {
      this.showBatonHoldReleaseFeedback(false, 'poor');
    }
    this.breakRhythmCombo();
    this.player.errorFlash();
    this.hud.flashError();
    if (this.state !== 'tutorial') this.flashAndHideFormalComboPattern();
    if (this.state === 'tutorial') this.failTutorialCombo();
  }

  /** JRPG 式小型浮字：从实际攻击锚点弹出，短暂停留后上浮消隐。 */
  private showAttackJudgement(
    judgement: AttackJudgement,
    _timingOffset: number,
    _reason?: 'offBeat' | 'wrongInput' | 'missedBeat'
  ): void {
    const styles = {
      perfect: {
        label: 'PERFECT',
        top: '#fff4b8',
        bottom: '#f59e0b',
        detail: '#fde68a',
        size: 24,
        hold: 250
      },
      good: {
        label: 'GOOD',
        top: '#dbeafe',
        bottom: '#3b82f6',
        detail: '#93c5fd',
        size: 22,
        hold: 210
      },
      poor: {
        label: 'POOR',
        top: '#e4e4e7',
        bottom: '#71717a',
        detail: '#a1a1aa',
        size: 20,
        hold: 170
      }
    } as const;
    const style = styles[judgement];
    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: '"Arial Narrow", Arial, sans-serif',
      fontSize: `${style.size}px`,
      fontStyle: 'bold italic',
      color: style.top,
      stroke: '#111827',
      strokeThickness: 4,
      letterSpacing: 1,
      shadow: { offsetX: 0, offsetY: 2, color: '#000000', blur: 3, stroke: false, fill: true }
    };
    const label = this.add.text(0, 0, style.label, textStyle).setOrigin(0.5);
    const gradient = label.context.createLinearGradient(0, 0, 0, label.height);
    gradient.addColorStop(0, style.top);
    gradient.addColorStop(0.42, style.top);
    gradient.addColorStop(1, style.bottom);
    label.setFill(gradient);
    const attackOrigin = this.player.getAttackOrigin();
    const startX = attackOrigin.x + Math.cos(this.player.aimAngle) * worldSize(10);
    const startY = attackOrigin.y + Math.sin(this.player.aimAngle) * worldSize(10) - worldSize(18);
    // 准确度浮字属于攻击反馈，但必须在角色本体之后，避免遮住出手和受击表现。
    const feedback = this.add.container(startX, startY + worldSize(5), [label])
      .setDepth(this.player.go.depth - 0.004)
      .setAlpha(0)
      .setAngle(Phaser.Math.FloatBetween(-4, -1))
      .setScale(0.72, 1.18);

    this.tweens.chain({
      targets: feedback,
      tweens: [
        {
          x: judgement === 'poor' ? startX + worldSize(3) : startX,
          y: startY - worldSize(7),
          alpha: 1,
          angle: judgement === 'poor' ? 2 : 0,
          scaleX: judgement === 'perfect' ? 1.1 : 1.04,
          scaleY: 0.96,
          duration: 90,
          ease: 'Back.easeOut'
        },
        {
          x: startX,
          angle: 0,
          scaleX: 1,
          scaleY: 1,
          duration: judgement === 'poor' ? 55 : 75,
          ease: 'Cubic.easeOut'
        },
        {
          duration: style.hold
        },
        {
          y: startY - worldSize(36),
          alpha: 0,
          scale: 0.94,
          duration: 300,
          ease: 'Quad.easeIn',
          onComplete: () => feedback.destroy(true)
        }
      ]
    });
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
    const releasedAttack = !current.attack && this.gamepadButtonState.attack;
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

    if (pressed.dodge && this.player.tryDodge()) {
      if (this.state === 'tutorial') this.recordTutorialDodge();
      this.rumbleGamepad(pad, 'dodge');
    }
    if (pressed.attack) {
      if (this.player.weapon.id === 'baton' && this.combo.expectedInput === 'H' && !this.combo.expectsHeavyRelease) {
        this.beginBatonHeavyHold();
      } else {
        this.handleAttackInput(this.gamepadBeatKey(), pad);
      }
    }
    if (releasedAttack && this.player.weapon.id === 'baton') this.endBatonHeavyHold(true);
  }

  private gamepadBeatKey(): 'L' | 'H' {
    return this.combo.expectedInput;
  }

  private isGamepadButtonDown(pad: Phaser.Input.Gamepad.Gamepad, index: number): boolean {
    return index < pad.buttons.length && pad.getButtonValue(index) > 0.5;
  }

  private createEnemyAnimations(): void {
    registerFanAnimations(this);
    registerGuardAnimations(this);
    registerTutorialCharacterAnimations(this);
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
    this.startTutorialPrelude();
  }

  /**
   * 让 bgm3.mp3 的首拍（文件内 this.currentBgmTrack.firstBeatOffset 秒处）与指定 Conductor 拍点对齐：
   * 若倒数时间足够则用 delay 等到那一刻播放，否则直接以 seek 跳过已经过去的部分。
   */
  private playBgmAlignedToBeat(firstBeat: number): void {
    const playbackRate = this.currentSongBpm() / this.currentBgmTrack.sourceBpm;
    const formalLevel = this.isFormalLevelState();
    const alignmentOffset = formalLevel ? this.tuningEditor.levelBeatAlignmentOffsetMs / 1000 : 0;
    const effectiveFirstBeatOffset = Math.max(0, this.currentBgmTrack.firstBeatOffset + alignmentOffset);
    // firstBeatOffset 是源文件时间轴；变速后，墙钟上的等效偏移需除以播放倍率。
    const scaledFirstBeatOffset = effectiveFirstBeatOffset / playbackRate;
    const delayToFirstBeat = this.conductor.timeOfBeat(firstBeat) - this.conductor.now();
    if (delayToFirstBeat >= scaledFirstBeatOffset) {
      this.bgm.play({ delay: delayToFirstBeat - scaledFirstBeatOffset, rate: playbackRate });
    } else {
      // seek 仍使用源文件秒数，所以把已经过去的墙钟时间乘回播放倍率。
      this.bgm.play({
        seek: Math.max(0, effectiveFirstBeatOffset - delayToFirstBeat * playbackRate),
        rate: playbackRate
      });
    }
  }

  private switchBgmTrack(track: BgmTrack, playNow = true): void {
    const rhythmBpm = this.currentRhythmBpm();
    const songBpm = this.currentSongBpm();
    if (this.currentBgmTrack.key === track.key && this.bgm) {
      this.conductor.retune(rhythmBpm);
      return;
    }
    if (!this.cache.audio.exists(track.key)) {
      // 后台还没下完这首：先让当前曲目继续放，文件到位后再无缝切过去，不卡流程。
      this.pendingBgmSwitch = { track, playNow };
      queueBgmTrack(this, track);
      startBackgroundLoad(this);
      return;
    }
    this.pendingBgmSwitch = undefined;
    this.bgm?.stop();
    this.bgm?.destroy();
    this.currentBgmTrack = track;
    this.conductor.retune(rhythmBpm);
    this.bgm = this.sound.add(track.key, {
      loop: false,
      volume: BGM_VOLUME * this.bgmChannelVolume,
      rate: songBpm / track.sourceBpm
    }) as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
    this.bgm.on(Phaser.Sound.Events.COMPLETE, this.onBgmComplete, this);
    if (playNow && this.conductor.started) {
      this.bgmFirstBeat = Math.max(0, Math.ceil(this.conductor.beatFloatAt(this.conductor.now())));
      this.playBgmAlignedToBeat(this.bgmFirstBeat);
    }
  }

  /** 后台补下的 BGM 到位后，补上之前被推迟的切歌。 */
  private onDeferredFileComplete(key: string, type: string): void {
    const pending = this.pendingBgmSwitch;
    if (!pending || type !== 'audio' || key !== pending.track.key) return;
    this.pendingBgmSwitch = undefined;
    this.switchBgmTrack(pending.track, pending.playNow);
  }
  private createSettingsPanel(): void {
    const uiFont = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
    const frameColor = 0xf7f5e7;
    const textShadow = {
      offsetX: 0,
      offsetY: 1,
      color: 'rgba(52, 71, 65, 0.72)',
      blur: 2,
      stroke: false,
      fill: true
    } as const;
    if (this.textures.exists(SETTINGS_PANEL_FROST_TEXTURE_KEY)) {
      this.textures.remove(SETTINGS_PANEL_FROST_TEXTURE_KEY);
    }
    // 固定屏幕容器会抵消主镜头 zoom；CanvasTexture 按最终 2K 屏幕像素创建，避免二次拉伸。
    const frostWidth = Math.round(SETTINGS_PANEL_WIDTH * UI_SCALE);
    const frostHeight = Math.round(SETTINGS_PANEL_HEIGHT * UI_SCALE);
    const frostTexture = this.textures.createCanvas(
      SETTINGS_PANEL_FROST_TEXTURE_KEY,
      frostWidth,
      frostHeight
    );
    if (!frostTexture) throw new Error('Unable to create the volume-panel frost texture');
    this.volumePanelFrostTexture = frostTexture;
    frostTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.volumePanelFrostImage = this.add
      .image(320, 360, SETTINGS_PANEL_FROST_TEXTURE_KEY)
      .setDisplaySize(SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT);
    // 场景采样先做真实模糊，再叠一层很薄的乳白雾；不使用深色隐私底或全屏暗罩。
    const panelBackground = this.add
      .rectangle(320, 360, SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT, 0xf2f0e8, 0.18)
      .setStrokeStyle(1, frameColor, 0.72);
    const panelFrost = this.add.graphics();
    panelFrost.fillGradientStyle(
      0xffffff,
      0xffffff,
      0xffffff,
      0xffffff,
      0.1,
      0.1,
      0.035,
      0.035
    );
    panelFrost.fillRect(SETTINGS_PANEL_X, SETTINGS_PANEL_Y, SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT);
    const panelTopHighlight = this.add.rectangle(320, 36, 578, 1, frameColor, 0.28);
    const panelInnerFrame = this.add.rectangle(320, 360, 578, 628, 0xffffff, 0)
      .setStrokeStyle(1, frameColor, 0.22);
    const cornerFrame = this.add.graphics();
    cornerFrame.lineStyle(2, frameColor, 0.9);
    const cornerLength = 17;
    const corners: Array<[number, number, number, number]> = [
      [20, 35, 1, 1],
      [620, 35, -1, 1],
      [20, 685, 1, -1],
      [620, 685, -1, -1]
    ];
    corners.forEach(([x, y, horizontalDirection, verticalDirection]) => {
      cornerFrame.beginPath();
      cornerFrame.moveTo(x, y + verticalDirection * cornerLength);
      cornerFrame.lineTo(x, y);
      cornerFrame.lineTo(x + horizontalDirection * cornerLength, y);
      cornerFrame.strokePath();
    });
    cornerFrame.fillStyle(frameColor, 0.92);
    corners.forEach(([x, y]) => cornerFrame.fillRect(x - 2, y - 2, 4, 4));

    const sectionTag = this.add.rectangle(80, 106, 102, 28, frameColor, 0.07)
      .setOrigin(0, 0.5)
      .setStrokeStyle(1, frameColor, 0.48);
    const sectionDivider = this.add.rectangle(385, 106, 410, 1, frameColor, 0.18);
    const objects: Phaser.GameObjects.GameObject[] = [
      this.volumePanelFrostImage,
      panelBackground,
      panelFrost,
      panelTopHighlight,
      panelInnerFrame,
      cornerFrame,
      this.add.text(320, 55, '音量设置', {
        fontFamily: uiFont,
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#fffef6',
        resolution: 2,
        shadow: textShadow
      }).setOrigin(0.5),
      this.add.text(320, 80, '游戏已暂停', {
        fontFamily: uiFont,
        fontSize: '12px',
        color: '#fffef6',
        resolution: 2,
        shadow: textShadow
      }).setAlpha(0.78).setOrigin(0.5),
      sectionTag,
      sectionDivider,
      this.add.text(131, 106, '音频分类', {
        fontFamily: uiFont,
        fontSize: '16px',
        color: '#fffef6',
        resolution: 2,
        shadow: textShadow
      }).setOrigin(0.5),
    ];
    this.volumeSliders = {};
    this.combatValueTexts = {};
    this.combatPageContainers = {};
    this.combatTabButtons = {};
    this.heavyModeToggleButtons = {};
    this.heavyModeToggleTexts = {};
    const debugObjects: Phaser.GameObjects.GameObject[] = [
      this.add.text(690, 84, '战斗参数', {
        fontFamily: 'Arial', fontSize: '20px', fontStyle: 'bold', color: '#67e8f9'
      }).setOrigin(0, 0.5),
      this.add.rectangle(640, 360, 2, 510, 0x334155, 0.9)
    ];

    const beginDrag = (channel: VolumeControlChannel, pointer: Phaser.Input.Pointer): void => {
      this.volumeDragging = channel;
      this.updateVolumeFromPointer(channel, pointer.x / UI_SCALE);
    };
    const addVolumeRow = (
      channel: VolumeControlChannel,
      y: number,
      label: string,
      max: number
    ): void => {
      const labelText = this.add.text(80, y, label, {
        fontFamily: uiFont,
        fontSize: '16px',
        color: '#fffef6',
        resolution: 2,
        shadow: textShadow
      }).setOrigin(0, 0.5);
      const hitTrack = this.add.rectangle(
        SETTINGS_VOLUME_TRACK_X + SETTINGS_VOLUME_TRACK_WIDTH / 2,
        y,
        SETTINGS_VOLUME_TRACK_WIDTH,
        28,
        0xffffff,
        0.001
      ).setInteractive({ useHandCursor: true });
      const track = this.add.rectangle(
        SETTINGS_VOLUME_TRACK_X + SETTINGS_VOLUME_TRACK_WIDTH / 2,
        y,
        SETTINGS_VOLUME_TRACK_WIDTH,
        4,
        frameColor,
        0.2
      ).setStrokeStyle(1, frameColor, 0.34);
      const fill = this.add.rectangle(
        SETTINGS_VOLUME_TRACK_X,
        y,
        SETTINGS_VOLUME_TRACK_WIDTH,
        4,
        0xe9ead2,
        0.82
      ).setOrigin(0, 0.5);
      const thumb = this.add.circle(
        SETTINGS_VOLUME_TRACK_X + SETTINGS_VOLUME_TRACK_WIDTH,
        y,
        7,
        0x66736e,
        0.9
      )
        .setStrokeStyle(1.5, frameColor, 0.95)
        .setInteractive({ useHandCursor: true });
      const valueText = this.add.text(570, y, '', {
        fontFamily: uiFont,
        fontSize: '14px',
        color: '#fffef6',
        resolution: 2,
        shadow: textShadow
      }).setOrigin(0.5);
      const rowDivider = this.add.rectangle(325, y + 24, 490, 1, frameColor, 0.1);
      hitTrack.on('pointerdown', (pointer: Phaser.Input.Pointer) => beginDrag(channel, pointer));
      thumb.on('pointerdown', (pointer: Phaser.Input.Pointer) => beginDrag(channel, pointer));
      this.volumeSliders[channel] = { fill, thumb, valueText, max };
      objects.push(labelText, hitTrack, track, fill, thumb, valueText, rowDivider);
    };

    const audioRows: Array<[VolumeControlChannel, string, number]> = [
      ['master', '主音量', MAX_MASTER_VOLUME],
      ['bgm', 'BGM', MAX_CHANNEL_VOLUME],
      ['rhythm', '节拍与轻重喊声', MAX_CHANNEL_VOLUME]
    ];
    audioRows.forEach(([channel, label, max], index) => {
      addVolumeRow(channel, 175 + index * 80, label, max);
    });

    const addCombatTab = (page: CombatSettingsPage, x: number, label: string): void => {
      const rect = this.add.rectangle(x, 116, 126, 30, 0x334155)
        .setStrokeStyle(1, 0x64748b)
        .setInteractive({ useHandCursor: true });
      const text = this.add.text(x, 116, label, {
        fontFamily: 'Arial', fontSize: '15px', fontStyle: 'bold', color: '#e2e8f0'
      }).setOrigin(0.5);
      rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointer.event.stopPropagation();
        this.setCombatSettingsPage(page);
      });
      this.combatTabButtons[page] = rect;
      debugObjects.push(rect, text);
    };
    addCombatTab('speed', 650, '速度 / 频率');
    addCombatTab('playerDamage', 760, '玩家伤害');
    addCombatTab('comboMeter', 870, '量表 / Fever');
    addCombatTab('enemy', 980, '敌人 / 掉落');
    addCombatTab('boss', 1090, 'Boss');
    addCombatTab('mode', 1200, '模式 / 导出');

    const speedPageObjects: Phaser.GameObjects.GameObject[] = [];
    const playerDamagePageObjects: Phaser.GameObjects.GameObject[] = [];
    const comboMeterPageObjects: Phaser.GameObjects.GameObject[] = [];
    const enemyPageObjects: Phaser.GameObjects.GameObject[] = [];
    const bossPageObjects: Phaser.GameObjects.GameObject[] = [];
    const modePageObjects: Phaser.GameObjects.GameObject[] = [];
    const addStepButton = (
      target: Phaser.GameObjects.GameObject[],
      x: number,
      y: number,
      label: string,
      onClick: () => void
    ): void => {
      const rect = this.add.rectangle(x, y, 38, 30, 0x334155)
        .setStrokeStyle(1, 0x94a3b8)
        .setInteractive({ useHandCursor: true });
      const text = this.add.text(x, y, label, {
        fontFamily: 'Arial', fontSize: '19px', color: '#ffffff'
      }).setOrigin(0.5);
      rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointer.event.stopPropagation();
        onClick();
      });
      target.push(rect, text);
    };
    const addCombatRow = (
      target: Phaser.GameObjects.GameObject[],
      key: CombatSettingKey,
      y: number,
      label: string,
      step: number
    ): void => {
      target.push(this.add.text(690, y, label, {
        fontFamily: 'Arial', fontSize: '16px', color: '#cbd5e1'
      }).setOrigin(0, 0.5));
      const isBpmKey = BPM_SETTING_KEYS.includes(key as BpmSettingKey);
      const initialValue = isBpmKey
        ? `${this.tuningEditor[key as BpmSettingKey].toFixed(2)} BPM`
        : '';
      const valueText = this.add.text(1030, y, initialValue, {
        fontFamily: 'Arial', fontSize: '15px', color: '#67e8f9'
      }).setOrigin(0.5);
      if (isBpmKey) {
        valueText.setInteractive({ useHandCursor: true });
        valueText.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          pointer.event.stopPropagation();
          this.promptForBpmSetting(key as BpmSettingKey);
        });
        valueText.on('pointerover', () => valueText.setColor('#ffffff'));
        valueText.on('pointerout', () => valueText.setColor('#67e8f9'));
      }
      this.combatValueTexts[key] = valueText;
      target.push(valueText);
      addStepButton(target, 960, y, '−', () => this.adjustCombatSetting(key, -step));
      addStepButton(target, 1100, y, '+', () => this.adjustCombatSetting(key, step));
    };

    addCombatRow(speedPageObjects, 'playerMoveSpeed', 145, '玩家移动速度', 20);
    addCombatRow(speedPageObjects, 'glowstickBulletSpeed', 190, '荧光棒弹速', 20);
    addCombatRow(speedPageObjects, 'glowstickLightAttackSpeed', 235, '荧光棒轻击速度', 0.1);
    addCombatRow(speedPageObjects, 'glowstickHeavyAttackSpeed', 280, '荧光棒重击速度', 0.1);
    addCombatRow(speedPageObjects, 'batonSweepSpeed', 325, '警棍弧弹飞行速度', 0.1);
    addCombatRow(speedPageObjects, 'batonLightAttackSpeed', 370, '警棍轻击速度', 0.1);
    addCombatRow(speedPageObjects, 'batonHeavyAttackSpeed', 415, '警棍重击速度', 0.1);
    addCombatRow(speedPageObjects, 'smallGuardBulletSpeed', 460, '保安弹速', 20);
    addCombatRow(speedPageObjects, 'smallGuardAttackFrequency', 505, '保安攻击频率', 0.05);
    addCombatRow(speedPageObjects, 'fanBulletSpeed', 550, '粉丝弹速', 20);
    addCombatRow(speedPageObjects, 'fanAttackFrequency', 595, '粉丝攻击频率', 0.05);
    addCombatRow(speedPageObjects, 'batonHoldFireFrequency', 640, '警棍长按发波频率', 0.5);

    const playerDamageRows: Array<[CombatSettingKey, string, number]> = [
      ['glowstickLightDamage', '荧光棒轻击基础伤害', 1],
      ['glowstickHeavyDamage', '荧光棒重击基础伤害', 1],
      ['batonLightDamage', '警棍轻击基础伤害', 1],
      ['batonHeavyDamage', '警棍重击基础伤害', 1],
      ['glowstickPerfectDamageMultiplier', '荧光棒 PERFECT 伤害', 0.1],
      ['glowstickGoodDamageMultiplier', '荧光棒 GOOD 伤害', 0.1],
      ['glowstickPoorDamageMultiplier', '荧光棒 POOR 伤害', 0.1],
      ['batonPerfectDamageMultiplier', '警棍 PERFECT 伤害', 0.1],
      ['batonGoodDamageMultiplier', '警棍 GOOD 伤害', 0.1],
      ['batonPoorDamageMultiplier', '警棍 POOR 伤害', 0.1]
    ];
    playerDamageRows.forEach(([key, label, step], index) => {
      addCombatRow(playerDamagePageObjects, key, 158 + index * 44, label, step);
    });

    const COMBO_METER_ROW_H = 40;
    const COMBO_METER_HEADER_H = 26;
    let comboMeterY = 145;

    const comboMeterRows: Array<[CombatSettingKey, string, number]> = [
      ['comboPerfectReward', 'PERFECT 单拍量表', 1],
      ['comboGoodReward', 'GOOD 单拍量表', 1],
      ['comboPatternCompleteReward', '完整四段 Pattern 奖励', 1],
      ['comboDecayPerSecond', '量表每秒衰减', 0.1],
      ['dodgeOnBeatCost', '踩拍闪避消耗 %', 1],
      ['dodgeOffBeatCost', '错拍闪避消耗 %', 1]
    ];
    comboMeterRows.forEach(([key, label, step]) => {
      addCombatRow(comboMeterPageObjects, key, comboMeterY, label, step);
      comboMeterY += COMBO_METER_ROW_H;
    });

    // BPM 拆成两类：判定节奏只影响拍点判定窗口，歌曲本身只影响 BGM 实际播放速度，二者互不影响。
    comboMeterPageObjects.push(this.add.text(690, comboMeterY, '判定节奏（只影响拍点判定，不改变音乐播放速度）', {
      fontFamily: 'Arial', fontSize: '14px', fontStyle: 'bold', color: '#fbbf24'
    }).setOrigin(0, 0.5));
    comboMeterY += COMBO_METER_HEADER_H;
    const rhythmBpmRows: Array<[CombatSettingKey, string, number]> = [
      ['tutorialRhythmBpm', '教学关判定节奏 BPM', 0.5],
      ['levelRhythmBpm', '第一关判定节奏 BPM', 0.5]
    ];
    rhythmBpmRows.forEach(([key, label, step]) => {
      addCombatRow(comboMeterPageObjects, key, comboMeterY, label, step);
      comboMeterY += COMBO_METER_ROW_H;
    });

    comboMeterPageObjects.push(this.add.text(690, comboMeterY, '歌曲本身（只改变 BGM 播放速度，不影响判定拍点）', {
      fontFamily: 'Arial', fontSize: '14px', fontStyle: 'bold', color: '#67e8f9'
    }).setOrigin(0, 0.5));
    comboMeterY += COMBO_METER_HEADER_H;
    const songBpmRows: Array<[CombatSettingKey, string, number]> = [
      ['tutorialSongBpm', '教学关歌曲播放 BPM', 0.5],
      ['levelSongBpm', '第一关歌曲播放 BPM', 0.5]
    ];
    songBpmRows.forEach(([key, label, step]) => {
      addCombatRow(comboMeterPageObjects, key, comboMeterY, label, step);
      comboMeterY += COMBO_METER_ROW_H;
    });

    addCombatRow(comboMeterPageObjects, 'levelBeatAlignmentOffsetMs', comboMeterY, '正式关节拍对齐偏移', 5);
    comboMeterY += COMBO_METER_ROW_H;
    comboMeterPageObjects.push(this.add.text(690, comboMeterY, '点击 BPM 数值可直接输入（40–240）；关闭 P Menu 后立即重新对齐。', {
      fontFamily: 'Arial', fontSize: '14px', color: '#94a3b8'
    }).setOrigin(0, 0.5));

    const enemyRows: Array<[CombatSettingKey, string, number]> = [
      ['enemyStraightBulletSpeedMultiplier', '敌人直射弹速倍率', 0.05],
      ['enemyBulletSizeMultiplier', '敌弹视觉 / 碰撞尺寸', 0.05],
      ['smallGuardDamage', '保安弹幕伤害', 1],
      ['fanDamage', '粉丝弹幕伤害', 1],
      ['glowstickDropChance', '荧光棒掉落概率', 0.05],
      ['batonDropChance', '警棍掉落概率', 0.05],
      ['waveSpawnMinBatchSize', '每批最少敌人数', 1],
      ['waveSpawnMaxBatchSize', '每批最多敌人数', 1],
      ['waveSpawnMinIntervalSeconds', '批次最短间隔', 0.5],
      ['waveSpawnMaxIntervalSeconds', '批次最长间隔', 0.5]
    ];
    enemyRows.forEach(([key, label, step], index) => {
      addCombatRow(enemyPageObjects, key, 150 + index * 47, label, step);
    });

    const bossRows: Array<[CombatSettingKey, string, number]> = [
      ['bossMaxHp', '最大生命', 100],
      ['bossSizeMultiplier', '体型倍率', 0.25],
      ['bossMoveSpeed', '移动速度', 5],
      ['bossAttackIntervalBeats', '攻击间隔（拍）', 1],
      ['bossProjectileDamage', '攻击伤害', 1],
      ['bossProjectileSpeed', '大弹丸速度', 10],
      ['bossCrescentSpeed', '半月波速度', 5],
      ['bossStompRadius', '践踏半径', 10],
      ['bossStompKnockback', '践踏击退', 20],
      ['bossNoteFormationSpeed', '音符阵列速度', 5],
      ['bossNoteFormationBulletSize', '音符子弹大小', 0.1],
      ['bossMinionCount', '随行小弟数量', 1]
    ];
    bossRows.forEach(([key, label, step], index) => {
      addCombatRow(bossPageObjects, key, 155 + index * 40, label, step);
    });

    const addHeavyModeToggle = (weaponId: WeaponId, y: number, label: string): void => {
      modePageObjects.push(this.add.text(690, y, label, {
        fontFamily: 'Arial', fontSize: '16px', color: '#cbd5e1'
      }).setOrigin(0, 0.5));
      const button = this.add.rectangle(1040, y, 150, 36, 0x334155)
        .setStrokeStyle(1, 0x94a3b8)
        .setInteractive({ useHandCursor: true });
      const text = this.add.text(1040, y, '', {
        fontFamily: 'Arial', fontSize: '15px', fontStyle: 'bold', color: '#ffffff'
      }).setOrigin(0.5);
      button.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointer.event.stopPropagation();
        if (weaponId === 'glowsticks') {
          this.tuningEditor.glowstickHeavyLaserEnabled = !this.tuningEditor.glowstickHeavyLaserEnabled;
        } else {
          this.tuningEditor.batonHeavyCrescentEnabled = !this.tuningEditor.batonHeavyCrescentEnabled;
        }
        this.refreshCombatControls();
      });
      this.heavyModeToggleButtons[weaponId] = button;
      this.heavyModeToggleTexts[weaponId] = text;
      modePageObjects.push(button, text);
    };
    modePageObjects.push(this.add.text(690, 155, '玩家瞄准模式', {
      fontFamily: 'Arial', fontSize: '16px', color: '#cbd5e1'
    }).setOrigin(0, 0.5));
    this.manualAimToggleButton = this.add.rectangle(1040, 155, 150, 36, 0x334155)
      .setStrokeStyle(1, 0x94a3b8)
      .setInteractive({ useHandCursor: true });
    this.manualAimToggleText = this.add.text(1040, 155, '', {
      fontFamily: 'Arial', fontSize: '15px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5);
    this.manualAimToggleButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.tuningEditor.manualAimEnabled = !this.tuningEditor.manualAimEnabled;
      this.player.refreshAimDirection();
      this.refreshCombatControls();
    });
    modePageObjects.push(this.manualAimToggleButton, this.manualAimToggleText);
    addHeavyModeToggle('glowsticks', 200, '荧光棒重击：贯屏激光');
    addHeavyModeToggle('baton', 245, '警棍重击：击退月牙波');
    addCombatRow(modePageObjects, 'glowstickHeavyChargeDelayMs', 295, '荧光棒重击充能延迟', 50);
    addCombatRow(modePageObjects, 'glowstickHeavyLaserThickness', 340, '荧光棒激光粗细', 4);
    addCombatRow(modePageObjects, 'batonHeavyCrescentRange', 385, '警棍重击最远距离', 40);
    addCombatRow(modePageObjects, 'batonLightSweepAngle', 430, '警棍轻击范围角度', 10);
    addCombatRow(modePageObjects, 'batonLightSweepRange', 475, '警棍轻击距离范围', 10);

    const saveButton = this.add.rectangle(810, 535, 220, 40, 0x92400e)
      .setStrokeStyle(2, 0xfbbf24, 0.95)
      .setInteractive({ useHandCursor: true });
    const saveText = this.add.text(810, 535, '保存当前配置', {
      fontFamily: 'Arial', fontSize: '17px', fontStyle: 'bold', color: '#fff7ed'
    }).setOrigin(0.5);
    const exportButton = this.add.rectangle(1060, 535, 220, 40, 0x0f766e)
      .setStrokeStyle(2, 0x67e8f9, 0.95)
      .setInteractive({ useHandCursor: true });
    const exportText = this.add.text(1060, 535, '导出参数 TXT', {
      fontFamily: 'Arial', fontSize: '17px', fontStyle: 'bold', color: '#ecfeff'
    }).setOrigin(0.5);
    const persistenceHint = this.add.text(690, 573, '保存会写入本浏览器并在刷新后自动恢复；导出仍生成 TXT 文件。', {
      fontFamily: 'Arial', fontSize: '14px', color: '#94a3b8'
    }).setOrigin(0, 0.5);
    saveButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      const saved = this.tuningEditor.savePersistedConfig();
      persistenceHint
        .setColor(saved ? '#86efac' : '#fca5a5')
        .setText(saved ? '配置已保存；刷新或下次打开游戏时会自动恢复。' : '保存失败：浏览器未允许本机存储。');
    });
    exportButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();
      this.tuningEditor.downloadCombatConfigTxt();
    });
    modePageObjects.push(saveButton, saveText, exportButton, exportText, persistenceHint);

    this.combatPageContainers.speed = this.add.container(0, 0, speedPageObjects);
    this.combatPageContainers.playerDamage = this.add.container(0, 0, playerDamagePageObjects);
    this.combatPageContainers.comboMeter = this.add.container(0, 0, comboMeterPageObjects);
    this.combatPageContainers.enemy = this.add.container(0, 0, enemyPageObjects);
    this.combatPageContainers.boss = this.add.container(0, 0, bossPageObjects);
    this.combatPageContainers.mode = this.add.container(0, 0, modePageObjects);
    debugObjects.push(
      this.combatPageContainers.speed,
      this.combatPageContainers.playerDamage,
      this.combatPageContainers.comboMeter,
      this.combatPageContainers.enemy,
      this.combatPageContainers.boss,
      this.combatPageContainers.mode
    );

    const fpvLabel = this.add.text(80, 470, '右下 FPV 观察窗', {
      fontFamily: 'Arial', fontSize: '16px', color: '#cbd5e1'
    }).setOrigin(0, 0.5);
    this.fpvToggleButton = this.add.rectangle(430, 470, 130, 34, 0x0f766e)
      .setStrokeStyle(2, 0x67e8f9, 0.95)
      .setInteractive({ useHandCursor: true });
    this.fpvToggleText = this.add.text(430, 470, '', {
      fontFamily: 'Arial', fontSize: '15px', fontStyle: 'bold', color: '#ecfeff'
    }).setOrigin(0.5);
    const hint = this.add.text(320, 660, '按 Esc 关闭音量设置', {
      fontFamily: uiFont,
      fontSize: '13px',
      color: '#fffef6',
      resolution: 2,
      shadow: textShadow
    }).setAlpha(0.76).setOrigin(0.5);
    objects.push(hint);
    objects.push(fpvLabel, this.fpvToggleButton, this.fpvToggleText);
    this.tuningEditor.container.add(debugObjects);
    // 新增的分页容器与按钮也要归零 scrollFactor，否则 P 面板命中区同样偏移
    applyScreenLayerScrollFactor(this.tuningEditor.container);

    this.volumePanel = this.add.container(0, 0, objects)
      .setDepth(2000)
      .setPosition(CAMERA_BASE_SCROLL_X, CAMERA_BASE_SCROLL_Y)
      .setScale(UI_SCALE / MAIN_CAMERA_BASE_ZOOM)
      .setVisible(false)
      .setActive(false);
    applyScreenLayerScrollFactor(this.volumePanel);

    this.fpvToggleButton.on('pointerdown', () => this.setFpvWindowEnabled(!this.fpvWindowEnabled));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.volumeDragging && this.volumePanelVisible) {
        this.updateVolumeFromPointer(this.volumeDragging, pointer.x / UI_SCALE);
      }
    });
    this.input.on('pointerup', () => {
      this.volumeDragging = null;
    });
    this.refreshVolumeControl();
    this.refreshCombatControls();
    this.setCombatSettingsPage(this.combatSettingsPage);
    this.refreshFpvToggle();
  }

  private setCombatSettingsPage(page: CombatSettingsPage): void {
    this.combatSettingsPage = page;
    for (const candidate of ['speed', 'playerDamage', 'comboMeter', 'enemy', 'boss', 'mode'] as const) {
      const active = candidate === page;
      const pageContainer = this.combatPageContainers[candidate];
      pageContainer?.setVisible(active).setActive(active);
      pageContainer?.each((child: Phaser.GameObjects.GameObject) => {
        if (child.input) child.input.enabled = active;
      });
      this.combatTabButtons[candidate]?.setFillStyle(active ? 0x0f766e : 0x334155);
      this.combatTabButtons[candidate]?.setStrokeStyle(1, active ? 0x67e8f9 : 0x64748b);
    }
  }

  /**
   * 设置打开时抓取面板后方的当前画面，只更新这一张暂停帧。
   * 先扩大采样范围再模糊，可避免玻璃四边出现透明黑边；Canvas 与 WebGL 都能使用。
   */
  private captureVolumePanelBackdrop(token: number): void {
    const texture = this.volumePanelFrostTexture;
    if (!texture) {
      this.volumePanel.setVisible(this.volumePanelVisible && token === this.volumePanelCaptureToken);
      return;
    }

    // volumePanel 的 screenLayer 偏移和反向缩放会精确抵消 camera zoom，截图区域直接按 UI_SCALE 换算。
    const panelX = Math.round(SETTINGS_PANEL_X * UI_SCALE);
    const panelY = Math.round(SETTINGS_PANEL_Y * UI_SCALE);
    const panelWidth = Math.round(SETTINGS_PANEL_WIDTH * UI_SCALE);
    const panelHeight = Math.round(SETTINGS_PANEL_HEIGHT * UI_SCALE);
    const padding = SETTINGS_PANEL_CAPTURE_PADDING;
    const captureX = Math.max(0, panelX - padding);
    const captureY = Math.max(0, panelY - padding);
    const captureWidth = Math.min(VIEW_WIDTH - captureX, panelWidth + padding * 2);
    const captureHeight = Math.min(VIEW_HEIGHT - captureY, panelHeight + padding * 2);
    const offsetX = panelX - captureX;
    const offsetY = panelY - captureY;

    const reveal = (): void => {
      if (token !== this.volumePanelCaptureToken || !this.volumePanelVisible) return;
      this.volumePanel.setVisible(true).setActive(true);
    };

    this.game.renderer.snapshotArea(
      captureX,
      captureY,
      captureWidth,
      captureHeight,
      (snapshot) => {
        if (token !== this.volumePanelCaptureToken || !this.volumePanelVisible) return;
        if (snapshot instanceof HTMLImageElement) {
          const context = texture.context;
          context.save();
          context.clearRect(0, 0, texture.width, texture.height);
          context.imageSmoothingEnabled = true;
          context.filter = 'blur(14px) saturate(82%) brightness(106%)';
          context.drawImage(
            snapshot,
            0,
            0,
            snapshot.naturalWidth || snapshot.width,
            snapshot.naturalHeight || snapshot.height,
            -offsetX,
            -offsetY,
            captureWidth,
            captureHeight
          );
          context.restore();
          texture.refresh();
        }
        reveal();
      },
      'image/png'
    );

    // 极端情况下浏览器截图回调被延迟，也先显示浅色透明面板，不把输入锁在不可见状态。
    window.setTimeout(reveal, 180);
  }

  private setVolumePanelVisible(visible: boolean): void {
    if (visible && this.gameOverFrozen) return;
    this.volumePanelVisible = visible;
    this.volumeDragging = null;
    const captureToken = ++this.volumePanelCaptureToken;
    this.volumePanel.setVisible(false).setActive(visible);
    if (visible) {
      this.refreshVolumeControl();
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
      this.captureVolumePanelBackdrop(captureToken);
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
    if (visible && this.gameOverFrozen) return;
    this.tuningEditor.setVisible(visible);
    if (visible) {
      this.refreshCombatControls();
      this.setCombatSettingsPage(this.combatSettingsPage);
      this.refreshFpvToggle();
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
      const selected = this.isFormalLevelState()
        ? BGM_TRACKS[this.tuningEditor.levelBgmSlot]
        : BGM_TRACKS[this.tuningEditor.tutorialBgmSlot];
      this.switchBgmTrack(selected);
      const formalLevel = this.isFormalLevelState();
      if (this.rhythmBpmDirty || this.songBpmDirty || (this.levelBgmAlignmentDirty && formalLevel)) {
        this.rhythmBpmDirty = false;
        this.songBpmDirty = false;
        this.levelBgmAlignmentDirty = false;
        this.bgm.stop();
        this.playBgmAlignedToBeat(this.bgmFirstBeat);
      }
    }
  }

  private isFormalLevelState(): boolean {
    return this.state === 'levelIntroWalk'
      || this.state === 'levelDialogue'
      || this.state === 'playing'
      || this.state === 'intermission'
      || this.state === 'victory'
      || this.state === 'over';
  }

  private currentRhythmBpm(): number {
    return this.isFormalLevelState()
      ? this.tuningEditor.levelRhythmBpm
      : this.tuningEditor.tutorialRhythmBpm;
  }

  /** 歌曲本身实际播放的 BPM，只决定 BGM 播放速度，和判定节拍（currentRhythmBpm）互不影响。 */
  private currentSongBpm(): number {
    return this.isFormalLevelState()
      ? this.tuningEditor.levelSongBpm
      : this.tuningEditor.tutorialSongBpm;
  }
  private getFpvMiniScene(): FpvMiniScene | undefined {
    return this.scene.isActive('FpvMiniScene') ? (this.scene.get('FpvMiniScene') as FpvMiniScene) : undefined;
  }

  private updateVolumeFromPointer(channel: VolumeControlChannel, pointerX: number): void {
    const slider = this.volumeSliders[channel];
    if (!slider) return;
    const ratio = Phaser.Math.Clamp(
      (pointerX - SETTINGS_VOLUME_TRACK_X) / SETTINGS_VOLUME_TRACK_WIDTH,
      0,
      1
    );
    const soundManager = this.sound as Phaser.Sound.WebAudioSoundManager;
    if (channel === 'master') {
      this.masterVolume = ratio * slider.max;
      soundManager.masterVolumeNode.gain.setTargetAtTime(this.masterVolume, soundManager.context.currentTime, 0.01);
    } else if (channel === 'bgm') {
      this.bgmChannelVolume = ratio * slider.max;
      this.bgm.setVolume(BGM_VOLUME * this.bgmChannelVolume);
    } else {
      this.audioChannelVolumes[channel] = ratio * slider.max;
      this.applyAudioCategoryVolumes();
    }
    this.refreshVolumeControl();
  }

  private refreshVolumeControl(): void {
    const values: Record<VolumeControlChannel, number> = {
      master: this.masterVolume,
      bgm: this.bgmChannelVolume,
      ...this.audioChannelVolumes
    };
    for (const [channel, slider] of Object.entries(this.volumeSliders) as Array<
      [VolumeControlChannel, VolumeSliderVisual]
    >) {
      const value = values[channel];
      const ratio = Phaser.Math.Clamp(value / slider.max, 0, 1);
      slider.fill.displayWidth = SETTINGS_VOLUME_TRACK_WIDTH * ratio;
      slider.thumb.x = SETTINGS_VOLUME_TRACK_X + SETTINGS_VOLUME_TRACK_WIDTH * ratio;
      slider.valueText.setText(`${Math.round(value * 100)}%`);
    }
  }

  private applyAudioCategoryVolumes(): void {
    this.conductor?.setSfxVolume(this.audioChannelVolumes.rhythm);
  }

  private adjustCombatSetting(key: CombatSettingKey, delta: number): void {
    switch (key) {
      case 'playerMoveSpeed':
        this.tuningEditor.playerMoveSpeed = Phaser.Math.Clamp(
          this.tuningEditor.playerMoveSpeed + delta,
          80,
          600
        );
        break;
      case 'glowstickBulletSpeed':
        this.tuningEditor.glowstickBulletSpeed = Phaser.Math.Clamp(
          this.tuningEditor.glowstickBulletSpeed + delta,
          100,
          800
        );
        break;
      case 'glowstickLightAttackSpeed':
      case 'glowstickHeavyAttackSpeed':
      case 'batonSweepSpeed':
      case 'batonLightAttackSpeed':
      case 'batonHeavyAttackSpeed':
        this.tuningEditor[key] = Phaser.Math.Clamp(this.tuningEditor[key] + delta, 0.5, 2);
        break;
      case 'smallGuardBulletSpeed':
      case 'fanBulletSpeed':
        this.tuningEditor[key] = Phaser.Math.Clamp(this.tuningEditor[key] + delta, 40, 600);
        break;
      case 'smallGuardAttackFrequency':
      case 'fanAttackFrequency':
        this.tuningEditor[key] = Phaser.Math.Clamp(this.tuningEditor[key] + delta, 0.05, 8);
        break;
      case 'batonHoldFireFrequency':
        this.tuningEditor.batonHoldFireFrequency = Phaser.Math.Clamp(
          this.tuningEditor.batonHoldFireFrequency + delta,
          0.5,
          20
        );
        break;
      case 'enemyStraightBulletSpeedMultiplier':
        this.tuningEditor.enemyStraightBulletSpeedMultiplier = Phaser.Math.Clamp(
          this.tuningEditor.enemyStraightBulletSpeedMultiplier + delta,
          1,
          3
        );
        break;
      case 'enemyBulletSizeMultiplier':
        this.tuningEditor.enemyBulletSizeMultiplier = Phaser.Math.Clamp(
          this.tuningEditor.enemyBulletSizeMultiplier + delta,
          0.5,
          3
        );
        break;
      case 'waveSpawnMinBatchSize':
        this.tuningEditor.waveSpawnMinBatchSize = Phaser.Math.Clamp(
          Math.round(this.tuningEditor.waveSpawnMinBatchSize + delta), 1, 20
        );
        this.tuningEditor.waveSpawnMaxBatchSize = Math.max(
          this.tuningEditor.waveSpawnMaxBatchSize,
          this.tuningEditor.waveSpawnMinBatchSize
        );
        break;
      case 'waveSpawnMaxBatchSize':
        this.tuningEditor.waveSpawnMaxBatchSize = Phaser.Math.Clamp(
          Math.round(this.tuningEditor.waveSpawnMaxBatchSize + delta), 1, 20
        );
        this.tuningEditor.waveSpawnMinBatchSize = Math.min(
          this.tuningEditor.waveSpawnMinBatchSize,
          this.tuningEditor.waveSpawnMaxBatchSize
        );
        break;
      case 'waveSpawnMinIntervalSeconds':
        this.tuningEditor.waveSpawnMinIntervalSeconds = Phaser.Math.Clamp(
          Math.round((this.tuningEditor.waveSpawnMinIntervalSeconds + delta) * 2) / 2, 0.5, 30
        );
        this.tuningEditor.waveSpawnMaxIntervalSeconds = Math.max(
          this.tuningEditor.waveSpawnMaxIntervalSeconds,
          this.tuningEditor.waveSpawnMinIntervalSeconds
        );
        break;
      case 'waveSpawnMaxIntervalSeconds':
        this.tuningEditor.waveSpawnMaxIntervalSeconds = Phaser.Math.Clamp(
          Math.round((this.tuningEditor.waveSpawnMaxIntervalSeconds + delta) * 2) / 2, 0.5, 30
        );
        this.tuningEditor.waveSpawnMinIntervalSeconds = Math.min(
          this.tuningEditor.waveSpawnMinIntervalSeconds,
          this.tuningEditor.waveSpawnMaxIntervalSeconds
        );
        break;
      case 'glowstickHeavyChargeDelayMs':
        this.tuningEditor.glowstickHeavyChargeDelayMs = Phaser.Math.Clamp(
          this.tuningEditor.glowstickHeavyChargeDelayMs + delta,
          0,
          1500
        );
        break;
      case 'glowstickHeavyLaserThickness':
        this.tuningEditor.glowstickHeavyLaserThickness = Phaser.Math.Clamp(
          this.tuningEditor.glowstickHeavyLaserThickness + delta,
          12,
          160
        );
        break;
      case 'batonHeavyCrescentRange':
        this.tuningEditor.batonHeavyCrescentRange = Phaser.Math.Clamp(
          this.tuningEditor.batonHeavyCrescentRange + delta,
          120,
          1600
        );
        break;
      case 'batonLightSweepAngle':
        this.tuningEditor.batonLightSweepAngle = Phaser.Math.Clamp(
          this.tuningEditor.batonLightSweepAngle + delta,
          30,
          180
        );
        break;
      case 'batonLightSweepRange':
        this.tuningEditor.batonLightSweepRange = Phaser.Math.Clamp(
          this.tuningEditor.batonLightSweepRange + delta,
          40,
          400
        );
        break;
      case 'glowstickLightDamage':
        this.tuningEditor.weaponAttackDamage.glowsticks.light = Phaser.Math.Clamp(
          this.tuningEditor.weaponAttackDamage.glowsticks.light + delta,
          0,
          100
        );
        break;
      case 'glowstickHeavyDamage':
        this.tuningEditor.weaponAttackDamage.glowsticks.heavy = Phaser.Math.Clamp(
          this.tuningEditor.weaponAttackDamage.glowsticks.heavy + delta,
          0,
          100
        );
        break;
      case 'batonLightDamage':
        this.tuningEditor.weaponAttackDamage.baton.light = Phaser.Math.Clamp(
          this.tuningEditor.weaponAttackDamage.baton.light + delta,
          0,
          100
        );
        break;
      case 'batonHeavyDamage':
        this.tuningEditor.weaponAttackDamage.baton.heavy = Phaser.Math.Clamp(
          this.tuningEditor.weaponAttackDamage.baton.heavy + delta,
          0,
          100
        );
        break;
      case 'glowstickPerfectDamageMultiplier':
        this.tuningEditor.weaponJudgementDamageMultipliers.glowsticks.perfect = Phaser.Math.Clamp(
          this.tuningEditor.weaponJudgementDamageMultipliers.glowsticks.perfect + delta,
          0,
          3
        );
        break;
      case 'glowstickGoodDamageMultiplier':
        this.tuningEditor.weaponJudgementDamageMultipliers.glowsticks.good = Phaser.Math.Clamp(
          this.tuningEditor.weaponJudgementDamageMultipliers.glowsticks.good + delta,
          0,
          3
        );
        break;
      case 'glowstickPoorDamageMultiplier':
        this.tuningEditor.weaponJudgementDamageMultipliers.glowsticks.poor = Phaser.Math.Clamp(
          this.tuningEditor.weaponJudgementDamageMultipliers.glowsticks.poor + delta,
          0,
          3
        );
        break;
      case 'batonPerfectDamageMultiplier':
        this.tuningEditor.weaponJudgementDamageMultipliers.baton.perfect = Phaser.Math.Clamp(
          this.tuningEditor.weaponJudgementDamageMultipliers.baton.perfect + delta,
          0,
          3
        );
        break;
      case 'batonGoodDamageMultiplier':
        this.tuningEditor.weaponJudgementDamageMultipliers.baton.good = Phaser.Math.Clamp(
          this.tuningEditor.weaponJudgementDamageMultipliers.baton.good + delta,
          0,
          3
        );
        break;
      case 'batonPoorDamageMultiplier':
        this.tuningEditor.weaponJudgementDamageMultipliers.baton.poor = Phaser.Math.Clamp(
          this.tuningEditor.weaponJudgementDamageMultipliers.baton.poor + delta,
          0,
          3
        );
        break;
      case 'comboPerfectReward':
      case 'comboGoodReward':
      case 'comboPatternCompleteReward':
        this.tuningEditor[key] = Phaser.Math.Clamp(this.tuningEditor[key] + delta, 0, 100);
        this.syncComboEnergyRewards();
        break;
      case 'comboDecayPerSecond':
        this.tuningEditor.comboDecayPerSecond = Phaser.Math.Clamp(
          Math.round((this.tuningEditor.comboDecayPerSecond + delta) * 10) / 10,
          0,
          20
        );
        break;
      case 'tutorialRhythmBpm':
      case 'levelRhythmBpm':
        this.tuningEditor[key] = Phaser.Math.Clamp(
          Math.round((this.tuningEditor[key] + delta) * 10) / 10,
          40,
          240
        );
        this.rhythmBpmDirty = true;
        break;
      case 'tutorialSongBpm':
      case 'levelSongBpm':
        this.tuningEditor[key] = Phaser.Math.Clamp(
          Math.round((this.tuningEditor[key] + delta) * 10) / 10,
          40,
          240
        );
        this.songBpmDirty = true;
        break;
      case 'dodgeOnBeatCost':
        this.tuningEditor.dodgeOnBeatCost = Phaser.Math.Clamp(this.tuningEditor.dodgeOnBeatCost + delta, 0, 100);
        break;
      case 'dodgeOffBeatCost':
        this.tuningEditor.dodgeOffBeatCost = Phaser.Math.Clamp(this.tuningEditor.dodgeOffBeatCost + delta, 0, 100);
        break;
      case 'levelBeatAlignmentOffsetMs':
        this.tuningEditor.levelBeatAlignmentOffsetMs = Phaser.Math.Clamp(
          Math.round(this.tuningEditor.levelBeatAlignmentOffsetMs + delta),
          -500,
          500
        );
        this.levelBgmAlignmentDirty = true;
        break;
      case 'smallGuardDamage':
        this.tuningEditor.enemyProjectileDamage.smallGuard = Phaser.Math.Clamp(
          this.tuningEditor.enemyProjectileDamage.smallGuard + delta,
          0,
          100
        );
        this.syncEnemyProjectileDamage('smallGuard');
        break;
      case 'fanDamage':
        this.tuningEditor.enemyProjectileDamage.fan = Phaser.Math.Clamp(
          this.tuningEditor.enemyProjectileDamage.fan + delta,
          0,
          100
        );
        this.syncEnemyProjectileDamage('fan');
        break;
      case 'glowstickDropChance':
        this.tuningEditor.weaponDropChances.glowsticks = Phaser.Math.Clamp(
          this.tuningEditor.weaponDropChances.glowsticks + delta,
          0,
          1
        );
        break;
      case 'batonDropChance':
        this.tuningEditor.weaponDropChances.baton = Phaser.Math.Clamp(
          this.tuningEditor.weaponDropChances.baton + delta,
          0,
          1
        );
        break;
      case 'bossMaxHp':
        this.tuningEditor.bossMaxHp = Phaser.Math.Clamp(this.tuningEditor.bossMaxHp + delta, 100, 10000);
        this.syncActiveBossMaxHp();
        break;
      case 'bossSizeMultiplier':
        this.tuningEditor.bossSizeMultiplier = Phaser.Math.Clamp(
          this.tuningEditor.bossSizeMultiplier + delta, 2, 6
        );
        this.syncActiveBossSize();
        break;
      case 'bossMoveSpeed':
        this.tuningEditor.bossMoveSpeed = Phaser.Math.Clamp(this.tuningEditor.bossMoveSpeed + delta, 0, 160);
        break;
      case 'bossAttackIntervalBeats':
        this.tuningEditor.bossAttackIntervalBeats = Phaser.Math.Clamp(
          Math.round(this.tuningEditor.bossAttackIntervalBeats + delta), 1, 16
        );
        break;
      case 'bossProjectileDamage':
        this.tuningEditor.bossProjectileDamage = Phaser.Math.Clamp(this.tuningEditor.bossProjectileDamage + delta, 0, 100);
        break;
      case 'bossProjectileSpeed':
        this.tuningEditor.bossProjectileSpeed = Phaser.Math.Clamp(this.tuningEditor.bossProjectileSpeed + delta, 40, 800);
        break;
      case 'bossCrescentSpeed':
        this.tuningEditor.bossCrescentSpeed = Phaser.Math.Clamp(this.tuningEditor.bossCrescentSpeed + delta, 20, 400);
        break;
      case 'bossStompRadius':
        this.tuningEditor.bossStompRadius = Phaser.Math.Clamp(this.tuningEditor.bossStompRadius + delta, 80, 600);
        break;
      case 'bossStompKnockback':
        this.tuningEditor.bossStompKnockback = Phaser.Math.Clamp(this.tuningEditor.bossStompKnockback + delta, 0, 1200);
        break;
      case 'bossNoteFormationSpeed':
        this.tuningEditor.bossNoteFormationSpeed = Phaser.Math.Clamp(this.tuningEditor.bossNoteFormationSpeed + delta, 20, 300);
        break;
      case 'bossNoteFormationBulletSize':
        this.tuningEditor.bossNoteFormationBulletSize = Phaser.Math.Clamp(
          this.tuningEditor.bossNoteFormationBulletSize + delta, 0.5, 2
        );
        break;
      case 'bossMinionCount':
        this.tuningEditor.bossMinionCount = Phaser.Math.Clamp(
          Math.round(this.tuningEditor.bossMinionCount + delta), 0, 20
        );
        break;
    }
    this.refreshCombatControls();
  }

  private promptForBpmSetting(key: BpmSettingKey): void {
    const labels: Record<BpmSettingKey, string> = {
      tutorialRhythmBpm: '教学关判定节奏 BPM',
      levelRhythmBpm: '第一关判定节奏 BPM',
      tutorialSongBpm: '教学关歌曲播放 BPM',
      levelSongBpm: '第一关歌曲播放 BPM'
    };
    const input = window.prompt(`${labels[key]}\n请输入 40–240 之间的数值（支持小数）：`, `${this.tuningEditor[key]}`);
    if (input === null) return;
    const parsed = Number(input.trim());
    if (!Number.isFinite(parsed)) return;
    this.tuningEditor[key] = Phaser.Math.Clamp(Math.round(parsed * 100) / 100, 40, 240);
    if (key === 'tutorialSongBpm' || key === 'levelSongBpm') this.songBpmDirty = true;
    else this.rhythmBpmDirty = true;
    this.refreshCombatControls();
  }

  private refreshCombatControls(): void {
    const percent = (value: number): string => `${Math.round(value * 100)}%`;
    const values: Record<CombatSettingKey, string> = {
      playerMoveSpeed: `${Math.round(this.tuningEditor.playerMoveSpeed)} px/s`,
      glowstickBulletSpeed: `${Math.round(this.tuningEditor.glowstickBulletSpeed)} px/s`,
      glowstickLightAttackSpeed: percent(this.tuningEditor.glowstickLightAttackSpeed),
      glowstickHeavyAttackSpeed: percent(this.tuningEditor.glowstickHeavyAttackSpeed),
      batonSweepSpeed: percent(this.tuningEditor.batonSweepSpeed),
      batonLightAttackSpeed: percent(this.tuningEditor.batonLightAttackSpeed),
      batonHeavyAttackSpeed: percent(this.tuningEditor.batonHeavyAttackSpeed),
      batonHoldFireFrequency: `${this.tuningEditor.batonHoldFireFrequency.toFixed(1)} 次/秒`,
      smallGuardBulletSpeed: `${Math.round(this.tuningEditor.smallGuardBulletSpeed)} px/s`,
      smallGuardAttackFrequency: `${this.tuningEditor.smallGuardAttackFrequency.toFixed(2)} 次/拍`,
      fanBulletSpeed: `${Math.round(this.tuningEditor.fanBulletSpeed)} px/s`,
      fanAttackFrequency: `${this.tuningEditor.fanAttackFrequency.toFixed(2)} 次/拍`,
      enemyStraightBulletSpeedMultiplier: percent(this.tuningEditor.enemyStraightBulletSpeedMultiplier),
      enemyBulletSizeMultiplier: percent(this.tuningEditor.enemyBulletSizeMultiplier),
      glowstickHeavyChargeDelayMs: `${Math.round(this.tuningEditor.glowstickHeavyChargeDelayMs)} ms`,
      glowstickHeavyLaserThickness: `${Math.round(this.tuningEditor.glowstickHeavyLaserThickness)} px`,
      batonHeavyCrescentRange: `${Math.round(this.tuningEditor.batonHeavyCrescentRange)} px`,
      batonLightSweepAngle: `${Math.round(this.tuningEditor.batonLightSweepAngle)}°`,
      batonLightSweepRange: `${Math.round(this.tuningEditor.batonLightSweepRange)} px`,
      glowstickLightDamage: `${Math.round(this.tuningEditor.weaponAttackDamage.glowsticks.light)} 点`,
      glowstickHeavyDamage: `${Math.round(this.tuningEditor.weaponAttackDamage.glowsticks.heavy)} 点`,
      batonLightDamage: `${Math.round(this.tuningEditor.weaponAttackDamage.baton.light)} 点`,
      batonHeavyDamage: `${Math.round(this.tuningEditor.weaponAttackDamage.baton.heavy)} 点`,
      glowstickPerfectDamageMultiplier: percent(
        this.tuningEditor.weaponJudgementDamageMultipliers.glowsticks.perfect
      ),
      glowstickGoodDamageMultiplier: percent(this.tuningEditor.weaponJudgementDamageMultipliers.glowsticks.good),
      glowstickPoorDamageMultiplier: percent(this.tuningEditor.weaponJudgementDamageMultipliers.glowsticks.poor),
      batonPerfectDamageMultiplier: percent(this.tuningEditor.weaponJudgementDamageMultipliers.baton.perfect),
      batonGoodDamageMultiplier: percent(this.tuningEditor.weaponJudgementDamageMultipliers.baton.good),
      batonPoorDamageMultiplier: percent(this.tuningEditor.weaponJudgementDamageMultipliers.baton.poor),
      comboPerfectReward: `${this.tuningEditor.comboPerfectReward} 点`,
      comboGoodReward: `${this.tuningEditor.comboGoodReward} 点`,
      comboPatternCompleteReward: `${this.tuningEditor.comboPatternCompleteReward} 点`,
      comboDecayPerSecond: `${this.tuningEditor.comboDecayPerSecond.toFixed(1)} 点/秒`,
      tutorialRhythmBpm: `${this.tuningEditor.tutorialRhythmBpm.toFixed(2)} BPM`,
      levelRhythmBpm: `${this.tuningEditor.levelRhythmBpm.toFixed(2)} BPM`,
      tutorialSongBpm: `${this.tuningEditor.tutorialSongBpm.toFixed(2)} BPM`,
      levelSongBpm: `${this.tuningEditor.levelSongBpm.toFixed(2)} BPM`,
      levelBeatAlignmentOffsetMs: `${this.tuningEditor.levelBeatAlignmentOffsetMs >= 0 ? '+' : ''}${Math.round(this.tuningEditor.levelBeatAlignmentOffsetMs)} ms`,
      dodgeOnBeatCost: `${Math.round(this.tuningEditor.dodgeOnBeatCost)}%`,
      dodgeOffBeatCost: `${Math.round(this.tuningEditor.dodgeOffBeatCost)}%`,
      smallGuardDamage: `${Math.round(this.tuningEditor.enemyProjectileDamage.smallGuard)} 点`,
      fanDamage: `${Math.round(this.tuningEditor.enemyProjectileDamage.fan)} 点`,
      glowstickDropChance: percent(this.tuningEditor.weaponDropChances.glowsticks),
      batonDropChance: percent(this.tuningEditor.weaponDropChances.baton),
      waveSpawnMinBatchSize: `${Math.round(this.tuningEditor.waveSpawnMinBatchSize)} 名`,
      waveSpawnMaxBatchSize: `${Math.round(this.tuningEditor.waveSpawnMaxBatchSize)} 名`,
      waveSpawnMinIntervalSeconds: `${this.tuningEditor.waveSpawnMinIntervalSeconds.toFixed(1)} 秒`,
      waveSpawnMaxIntervalSeconds: `${this.tuningEditor.waveSpawnMaxIntervalSeconds.toFixed(1)} 秒`
      ,bossMaxHp: `${Math.round(this.tuningEditor.bossMaxHp)} 点`
      ,bossSizeMultiplier: `${this.tuningEditor.bossSizeMultiplier.toFixed(2)}x`
      ,bossMoveSpeed: `${Math.round(this.tuningEditor.bossMoveSpeed)} px/s`
      ,bossAttackIntervalBeats: `${Math.round(this.tuningEditor.bossAttackIntervalBeats)} 拍`
      ,bossProjectileDamage: `${Math.round(this.tuningEditor.bossProjectileDamage)} 点`
      ,bossProjectileSpeed: `${Math.round(this.tuningEditor.bossProjectileSpeed)} px/s`
      ,bossCrescentSpeed: `${Math.round(this.tuningEditor.bossCrescentSpeed)} px/s`
      ,bossStompRadius: `${Math.round(this.tuningEditor.bossStompRadius)} px`
      ,bossStompKnockback: `${Math.round(this.tuningEditor.bossStompKnockback)} px/s`
      ,bossNoteFormationSpeed: `${Math.round(this.tuningEditor.bossNoteFormationSpeed)} px/s`
      ,bossNoteFormationBulletSize: percent(this.tuningEditor.bossNoteFormationBulletSize)
      ,bossMinionCount: `${Math.round(this.tuningEditor.bossMinionCount)} 名`
    };
    for (const [key, text] of Object.entries(this.combatValueTexts) as Array<
      [CombatSettingKey, Phaser.GameObjects.Text]
    >) text.setText(values[key]);
    const modeEnabled: Record<WeaponId, boolean> = {
      glowsticks: this.tuningEditor.glowstickHeavyLaserEnabled,
      baton: this.tuningEditor.batonHeavyCrescentEnabled
    };
    for (const weaponId of ['glowsticks', 'baton'] as const) {
      const enabled = modeEnabled[weaponId];
      this.heavyModeToggleButtons[weaponId]?.setFillStyle(enabled ? 0x0f766e : 0x334155);
      this.heavyModeToggleTexts[weaponId]?.setText(enabled ? '新模式开启' : '沿用旧模式');
    }
    if (this.manualAimToggleButton && this.manualAimToggleText) {
      this.manualAimToggleButton.setFillStyle(this.tuningEditor.manualAimEnabled ? 0x0f766e : 0x334155);
      this.manualAimToggleText.setText(this.tuningEditor.manualAimEnabled ? '手动瞄准' : '自动瞄准');
    }
  }

  private syncComboEnergyRewards(): void {
    this.combo.setEnergyRewards({
      perfect: this.tuningEditor.comboPerfectReward,
      good: this.tuningEditor.comboGoodReward,
      patternComplete: this.tuningEditor.comboPatternCompleteReward
    });
  }

  private syncActiveBossMaxHp(): void {
    const boss = this.enemies.find((enemy): enemy is BossGuard => enemy instanceof BossGuard);
    if (!boss || boss.dead) return;
    const ratio = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
    boss.maxHp = this.tuningEditor.bossMaxHp;
    boss.hp = Math.max(1, boss.maxHp * ratio);
    this.onBossHealthChanged(boss.hp, boss.maxHp);
  }

  private syncActiveBossSize(): void {
    const boss = this.enemies.find((enemy): enemy is BossGuard => enemy instanceof BossGuard);
    if (!boss || boss.dead) return;
    boss.setSizeMultiplier(this.tuningEditor.bossSizeMultiplier);
  }

  private syncEnemyProjectileDamage(kind: 'smallGuard' | 'fan'): void {
    if (!this.bullets) return;
    for (const obj of this.bullets.getChildren()) {
      const bullet = obj as Phaser.GameObjects.Rectangle;
      const sourceKind = bullet.getData('sourceKind') as EnemyKind;
      if (sourceKind === kind || (kind === 'smallGuard' && sourceKind === 'midGuard')) {
        bullet.setData('damage', this.tuningEditor.getEnemyProjectileDamage(sourceKind));
      }
    }
  }

  /** bgm3 长度不是整拍；每 616 拍按 Conductor 重新开始，避免 Phaser 原生循环累计漂移。 */
  private onBgmComplete(): void {
    if (!this.conductor.started) return;
    this.bgmFirstBeat += this.currentBgmTrack.loopBeats;
    this.playBgmAlignedToBeat(this.bgmFirstBeat);
  }

  // ---------- 教学 ----------

  /** 锁定玩家输入，让主角从画面左侧自动走到教学站位。 */
  private startTutorialPrelude(): void {
    this.state = 'tutorialIntroWalk';
    this.stageEnvironment.showTutorial();
    this.clearTutorialCharacters();
    this.destroyTutorialControlGuide();
    this.destroyTutorialDialogue();
    this.patternPanel?.destroy(true);
    this.patternPanel = undefined;
    this.patternIcons = [];
    this.hud.setBeatGuideVisible(false);
    this.hud.setGameplayHudVisible(false);
    this.hud.setTutorialComboVisible(false);
    this.hud.setVictoryVisible(false);
    this.hud.setWave('');

    this.player.aimAngle = 0;
    this.player.rawAimAngle = 0;
    this.player.setScriptedPosition(TUTORIAL_INTRO_START_X, TUTORIAL_INTRO_Y);
    this.player.setScriptedWalk(true);

    const travel = { progress: 0 };
    this.tweens.add({
      targets: travel,
      progress: 1,
      duration: TUTORIAL_INTRO_WALK_DURATION_MS,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.player.setScriptedPosition(
          Phaser.Math.Linear(TUTORIAL_INTRO_START_X, TUTORIAL_INTRO_TARGET_X, travel.progress),
          TUTORIAL_INTRO_Y
        );
      },
      onComplete: () => {
        if (this.state !== 'tutorialIntroWalk') return;
        this.player.setScriptedPosition(TUTORIAL_INTRO_TARGET_X, TUTORIAL_INTRO_Y);
        this.player.setScriptedWalk(false);
        this.startTutorialDialogue();
      }
    });
  }

  /** 显示三句入场对白；只接受鼠标左键或键盘轻击键推进。 */
  private startTutorialDialogue(): void {
    this.startPlayerDialogue(TUTORIAL_DIALOGUE_LINES, 'tutorialDialogue');
  }

  private startPlayerDialogue(
    lines: readonly string[],
    dialogueState: 'tutorialDialogue' | 'tutorialEnergyDialogue' | 'levelDialogue'
  ): void {
    this.state = dialogueState;
    this.activeDialogueLines = lines;
    this.tutorialDialogueIndex = 0;
    this.tutorialDialogueTransitioning = false;

    const bubbleWidth = worldSize(330);
    const bubbleHeight = worldSize(104);
    const pixel = worldSize(3);
    const bubble = this.add.graphics();
    // 圆润像素气泡：块状阴影和粗像素边保留像素感，圆角、猫耳与粉色角标增加可爱感。
    bubble.fillStyle(0x000000, 0.22);
    bubble.fillRoundedRect(
      -bubbleWidth / 2 + pixel * 2,
      -bubbleHeight / 2 + pixel * 2,
      bubbleWidth,
      bubbleHeight,
      worldSize(16)
    );
    bubble.fillStyle(0x000000, 1);
    bubble.fillTriangle(-worldSize(26), bubbleHeight / 2 - pixel, 0, bubbleHeight / 2 + worldSize(24), worldSize(22), bubbleHeight / 2 - pixel);
    bubble.fillRoundedRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, worldSize(16));
    bubble.fillRect(-bubbleWidth / 2 + worldSize(34), -bubbleHeight / 2 - pixel * 2, worldSize(22), pixel * 3);
    bubble.fillRect(bubbleWidth / 2 - worldSize(56), -bubbleHeight / 2 - pixel * 2, worldSize(22), pixel * 3);
    bubble.fillStyle(0xffffff, 1);
    bubble.fillTriangle(-worldSize(18), bubbleHeight / 2 - pixel * 2, 0, bubbleHeight / 2 + worldSize(14), worldSize(14), bubbleHeight / 2 - pixel * 2);
    bubble.fillRoundedRect(
      -bubbleWidth / 2 + pixel,
      -bubbleHeight / 2 + pixel,
      bubbleWidth - pixel * 2,
      bubbleHeight - pixel * 2,
      worldSize(13)
    );
    bubble.fillRect(-bubbleWidth / 2 + worldSize(38), -bubbleHeight / 2 - pixel, worldSize(14), pixel * 2);
    bubble.fillRect(bubbleWidth / 2 - worldSize(52), -bubbleHeight / 2 - pixel, worldSize(14), pixel * 2);
    bubble.fillStyle(0xf9a8d4, 1);
    bubble.fillRect(-bubbleWidth / 2 + worldSize(20), -worldSize(6), pixel * 2, pixel * 2);
    bubble.fillRect(bubbleWidth / 2 - worldSize(28), -worldSize(6), pixel * 2, pixel * 2);

    this.tutorialDialogueText = this.add.text(0, -worldSize(6), lines[0], {
      fontFamily: '"Arial Black", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
      fontSize: `${worldSize(16)}px`,
      fontStyle: 'bold',
      color: '#000000',
      stroke: '#000000',
      strokeThickness: worldSize(0.55),
      align: 'center',
      fixedWidth: bubbleWidth - worldSize(52),
      wordWrap: { width: bubbleWidth - worldSize(52), useAdvancedWrap: true },
      lineSpacing: worldSize(3)
    }).setOrigin(0.5);
    const hint = this.add
      .text(bubbleWidth / 2 - worldSize(20), bubbleHeight / 2 - worldSize(14), '左键 / "  继续  ›', {
        fontFamily: '"Arial Black", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
        fontSize: `${worldSize(9)}px`,
        fontStyle: 'bold',
        color: '#000000',
        stroke: '#000000',
        strokeThickness: worldSize(0.4)
      })
      .setOrigin(1, 0.5)
      .setAlpha(0.85);

    this.tutorialDialogue = this.add
      .container(this.player.x, this.player.y - worldSize(138), [bubble, this.tutorialDialogueText, hint])
      .setDepth(30)
      .setAlpha(0);
    this.tweens.add({ targets: this.tutorialDialogue, alpha: 1, duration: 180, ease: 'Sine.easeOut' });
    this.tweens.add({ targets: hint, alpha: 0.42, duration: 600, yoyo: true, repeat: -1 });
  }

  private updateTutorialDialoguePosition(): void {
    this.tutorialDialogue?.setPosition(this.player.x, this.player.y - worldSize(138));
  }

  private advanceTutorialDialogue(): void {
    if (
      (this.state !== 'tutorialDialogue'
        && this.state !== 'tutorialEnergyDialogue'
        && this.state !== 'levelDialogue')
      || this.tutorialDialogueTransitioning
    ) return;
    const dialogueState = this.state;
    this.tutorialDialogueTransitioning = true;
    const nextIndex = this.tutorialDialogueIndex + 1;
    if (nextIndex < this.activeDialogueLines.length && this.tutorialDialogueText) {
      this.tweens.add({
        targets: this.tutorialDialogueText,
        alpha: 0,
        duration: 70,
        onComplete: () => {
          this.tutorialDialogueIndex = nextIndex;
          this.tutorialDialogueText?.setText(this.activeDialogueLines[nextIndex]);
          this.tweens.add({
            targets: this.tutorialDialogueText,
            alpha: 1,
            duration: 110,
            onComplete: () => { this.tutorialDialogueTransitioning = false; }
          });
        }
      });
      return;
    }

    this.tweens.add({
      targets: this.tutorialDialogue,
      alpha: 0,
      duration: 160,
      onComplete: () => {
        this.destroyTutorialDialogue();
        if (dialogueState === 'tutorialDialogue') this.startTutorial();
        else if (dialogueState === 'tutorialEnergyDialogue') this.finishTutorial();
        else this.startFirstLevelCountdown();
      }
    });
  }

  private destroyTutorialDialogue(): void {
    if (this.tutorialDialogue) {
      this.tweens?.killTweensOf(this.tutorialDialogue.list);
      this.tweens?.killTweensOf(this.tutorialDialogue);
      this.tutorialDialogue.destroy(true);
    }
    this.tutorialDialogue = undefined;
    this.tutorialDialogueText = undefined;
    this.tutorialDialogueIndex = 0;
    this.tutorialDialogueTransitioning = false;
  }

  /** 开场教学：四项操作提示同时出现；3 次有效节拍输入加 1 次成功闪避后讲解能量。 */
  private startTutorial(): void {
    this.state = 'tutorial';
    this.destroyTutorialDialogue();
    this.player.setScriptedWalk(false);
    this.stageEnvironment.showTutorial();
    this.clearTutorialCharacters();
    this.spawnTutorialCharacter();
    this.tutorialStreak = 0;
    this.tutorialTimingOffsets = [];
    this.tutorialCalibrationBeats.clear();
    this.tutorialCompletedPatterns = 0;
    this.tutorialDodgeCompleted = false;
    this.tutorialEnergyDialogueStarted = false;
    this.tutorialCalibratedOffset = 0;
    this.combo.setInputLatencyOffset(0);
    this.combo.setProgressGainEnabled(true);
    this.hud.setBeatGuideVisible(false);
    this.hud.setGameplayHudVisible(false);
    this.hud.setTutorialComboVisible(true);
    this.buildPatternPanel(true);
    this.createTutorialControlGuide();
    this.updateTutorialStreakText();
    this.hud.setWave('教学中');
  }

  /** 按 bg1.psd 原坐标显示石子前景与四张操作卡；只改变视觉，不参与输入或判定。 */
  private createTutorialControlGuide(): void {
    this.destroyTutorialControlGuide();
    const guide = this.add
      .container(CAMERA_BASE_SCROLL_X, CAMERA_BASE_SCROLL_Y)
      .setDepth(15)
      .setScale(PSD_LAYOUT_SCALE / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0)
      .setName('tutorial-psd-ui');
    const bottomRocks = this.add
      .image(TUTORIAL_BOTTOM_ROCKS_LAYOUT.x, TUTORIAL_BOTTOM_ROCKS_LAYOUT.y, TUTORIAL_BOTTOM_ROCKS_KEY)
      .setOrigin(0)
      .setDisplaySize(TUTORIAL_BOTTOM_ROCKS_LAYOUT.width, TUTORIAL_BOTTOM_ROCKS_LAYOUT.height);
    const rows = TUTORIAL_CONTROL_LAYOUTS.map((layout) =>
      this.add
        .image(layout.x, layout.y, layout.key)
        .setOrigin(0)
        .setDisplaySize(TUTORIAL_CONTROL_WIDTH, TUTORIAL_CONTROL_HEIGHT)
        .setAlpha(0)
    );

    // PSD 中石子原本烘焙在底图里；拆成前景保留遮挡层级，操作任务卡绘制在最上方。
    guide.add([bottomRocks, ...rows]);
    this.tutorialControlGuide = guide;
    this.tutorialControlRows = rows;
    this.startTutorialControlSequence();
  }

  /** 四张操作卡同时出现并常驻，直到教学结束。 */
  private startTutorialControlSequence(): void {
    this.tutorialControlRunId++;
    this.tutorialControlTaskArmed = true;
    this.tutorialAttackTasksCompleted.clear();
    for (const row of this.tutorialControlRows) row.setVisible(false).setAlpha(0);
    for (const taskIndex of [0, 1, 2, 3]) {
      this.showTutorialControlTask(taskIndex, TUTORIAL_CONTROL_ENTRANCE_DELAY);
    }
  }

  private showTutorialControlTask(taskIndex: number, delay = 0): void {
    const row = this.tutorialControlRows[taskIndex];
    const guide = this.tutorialControlGuide;
    if (!row || !guide?.active || this.state !== 'tutorial') return;
    const runId = this.tutorialControlRunId;
    this.tweens.killTweensOf(row);
    row.setVisible(true).setAlpha(0);
    this.tweens.add({
      targets: row,
      alpha: 1,
      delay,
      duration: TUTORIAL_CONTROL_ENTRANCE_DURATION,
      ease: 'Sine.easeOut',
      onStart: () => {
        if (
          runId === this.tutorialControlRunId &&
          this.state === 'tutorial' &&
          this.tutorialControlGuide === guide
        ) {
          this.tutorialControlTaskArmed = true;
        }
      }
    });
  }

  /**
   * 操作卡只负责提示，不再逐项消失；真正的结束条件由节拍输入和成功闪避共同决定。
   */
  private completeTutorialControlTask(taskIndex: number, deferUntilSettingsClose = false): boolean {
    if (this.state !== 'tutorial' || !this.tutorialControlTaskArmed) return false;

    void taskIndex;
    void deferUntilSettingsClose;
    return true;
  }

  private resumeTutorialControlAfterSettings(): void {
  }

  private destroyTutorialControlGuide(): void {
    this.tutorialControlRunId++;
    this.tutorialControlTaskArmed = false;
    this.tweens?.killTweensOf(this.tutorialControlRows);
    this.tutorialControlRows = [];
    this.tutorialControlGuide?.destroy(true);
    this.tutorialControlGuide = undefined;
  }

  /** 教学使用项目方提供的透明连段面板；正式关只在连招中显示紧凑节奏条。 */
  private buildPatternPanel(tutorial: boolean): void {
    this.patternPanel?.destroy(true);
    this.patternPanel = undefined;
    this.patternIcons = [];
    this.patternPanelMode = tutorial ? 'tutorial' : 'compact';
    this.tutorialBeatHighlights = [];
    this.tutorialHitHighlights = [];
    this.tutorialStreakText = undefined;
    this.batonHoldTrack = undefined;
    this.batonHoldFill = undefined;
    this.batonHoldLabel = undefined;

    const ui = this.add
      .container(
        CAMERA_BASE_SCROLL_X + (tutorial ? 0 : hd(600) / MAIN_CAMERA_BASE_ZOOM),
        CAMERA_BASE_SCROLL_Y
      )
      .setDepth(15)
      .setScale(
        tutorial
          ? PSD_LAYOUT_SCALE / MAIN_CAMERA_BASE_ZOOM
          : (UI_SCALE * FORMAL_PATTERN_SCALE) / MAIN_CAMERA_BASE_ZOOM
      )
      .setScrollFactor(0);

    if (tutorial) {
      const panel = this.add
        .image(TUTORIAL_PATTERN_PANEL_X, TUTORIAL_PATTERN_PANEL_Y, TUTORIAL_PATTERN_PANEL_KEY)
        .setOrigin(0)
        .setDisplaySize(TUTORIAL_PATTERN_PANEL_WIDTH, TUTORIAL_PATTERN_PANEL_HEIGHT);
      ui.add(panel);

      const createHighlightLayer = (): Phaser.GameObjects.Image[] =>
        TUTORIAL_PATTERN_PANEL_CROPS.map((crop) => {
          const highlight = this.add
            .image(TUTORIAL_PATTERN_PANEL_X, TUTORIAL_PATTERN_PANEL_Y, TUTORIAL_PATTERN_PANEL_KEY)
            .setOrigin(0)
            .setDisplaySize(TUTORIAL_PATTERN_PANEL_WIDTH, TUTORIAL_PATTERN_PANEL_HEIGHT)
            .setCrop(crop.x, crop.y, crop.width, crop.height)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0);
          ui.add(highlight);
          return highlight;
        });

      this.tutorialBeatHighlights = createHighlightLayer();
      this.tutorialHitHighlights = createHighlightLayer();
    } else {
      // 默认以白色显示当前连招；只有正确输入才短暂恢复轻 / 重拍色。
      const xs = [-108, -36, 36, 108];
      this.combo.pattern.forEach((key, i) => {
        const icon: Phaser.GameObjects.Shape = key === 'L'
          ? this.add.circle(xs[i], FORMAL_PATTERN_ICON_Y, 14).setStrokeStyle(3, FORMAL_PATTERN_BASE_COLOR)
          : this.add.rectangle(xs[i], FORMAL_PATTERN_ICON_Y, 22, 22, FORMAL_PATTERN_BASE_COLOR).setAngle(45);
        ui.add(icon);
        this.patternIcons.push(icon);
      });
      if (this.player.weapon.id === 'baton') {
        // 长按段现在是第 3→4 拍（xs[2]→xs[3]），按下/松开箭头和长按条都要跟着挪到最后两格。
        const pressMark = this.add.text(xs[2], FORMAL_PATTERN_ICON_Y, '↓', {
          fontFamily: 'Arial', fontSize: '13px', fontStyle: 'bold', color: '#1f2937'
        }).setOrigin(0.5);
        const releaseMark = this.add.text(xs[3], FORMAL_PATTERN_ICON_Y, '↑', {
          fontFamily: 'Arial', fontSize: '13px', fontStyle: 'bold', color: '#1f2937'
        }).setOrigin(0.5);
        const holdCenterX = (xs[2] + xs[3]) / 2;
        this.batonHoldTrack = this.add.rectangle(holdCenterX, FORMAL_PATTERN_ICON_Y + 30, 72, 6, 0x475569, 0.9);
        this.batonHoldFill = this.add.rectangle(xs[2], FORMAL_PATTERN_ICON_Y + 30, 1, 6, FORMAL_PATTERN_HEAVY_COLOR, 1)
          .setOrigin(0, 0.5)
          .setVisible(false);
        this.batonHoldLabel = this.add.text(holdCenterX, FORMAL_PATTERN_ICON_Y + 43, '第3拍按下 · 第4拍松开', {
          fontFamily: 'Arial', fontSize: '10px', fontStyle: 'bold', color: '#f8fafc'
        }).setOrigin(0.5);
        ui.add([pressMark, releaseMark, this.batonHoldTrack, this.batonHoldFill, this.batonHoldLabel]);
      }
    }
    this.patternPanel = ui;
    this.formalPatternBaseX = ui.x;
    this.formalPatternBaseY = ui.y;
    if (!tutorial) ui.setVisible(false);
  }

  /** 每拍高亮当前拍的节拍块（教学与游戏通用） */
  private pulsePatternIcon(beatIdx: number): void {
    if (this.patternPanelMode === 'tutorial') {
      const highlight = this.tutorialBeatHighlights[beatIdx];
      if (!highlight) return;
      this.tweens.killTweensOf(highlight);
      highlight.setAlpha(0.42);
      this.tweens.add({ targets: highlight, alpha: 0, duration: 150, ease: 'Sine.easeOut' });
      return;
    }

    if (!this.patternPanel?.visible) return;
    const icon = this.patternIcons[beatIdx];
    if (!icon) return;
    icon.setScale(1.35);
    this.tweens.add({ targets: icon, scaleX: 1, scaleY: 1, duration: 150 });
  }

  private updateTutorialStreakText(): void {
    const calibration = this.tutorialTimingOffsets.length > 0
      ? `　延迟校准 ${Math.round(this.tutorialCalibratedOffset * 1000)}ms`
      : '　延迟校准中';
    this.tutorialStreakText?.setText(`连续完成连招 ${this.tutorialStreak} / ${TUTORIAL_TARGET_STREAK}${calibration}`);
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
   * 教学校准允许“当前连招步骤按键正确但尚未落入旧窗口”的输入成为候选，
   * 这样输入链路本身慢于旧 100ms 窗口时，仍能把判定拉回正确位置。
   */
  private recordTutorialCalibrationCandidate(btn: 'L' | 'H'): void {
    const { n, offset } = this.conductor.nearestBeat(this.conductor.now());
    if (n < 0 || this.tutorialCalibrationBeats.has(n)) return;
    if (btn !== this.combo.expectedInput || Math.abs(offset) > TUTORIAL_CALIBRATION_CANDIDATE_WINDOW) return;
    this.tutorialCalibrationBeats.add(n);
    this.recordTutorialTiming(offset);
  }

  private median(values: number[]): number {
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
  }

  /** 教学角色按拍移动和口吐弹幕，每两小节从池塘中刷新一只。 */
  private onTutorialBeat(info: BeatInfo): void {
    for (const character of this.tutorialCharacters) {
      character.pulseBeat(false);
      character.onBeat(info);
    }
    if (info.beatInMeasure === 0 && info.measure > 0 && info.measure % 4 === 0) this.refreshTutorialCharacter();
  }

  private spawnTutorialCharacter(): void {
    const character = new TutorialCharacter(this, hd(946), hd(365));
    this.tutorialCharacters.push(character);
    // 教学角色也进入玩家攻击判定组；其死亡路径不会影响正式波次或掉落。
    this.enemyGroup.add(character.go);
    character.onSpawned();
  }

  /** 16 拍后先让当前教学角色死亡退场，再生成下一只，避免无过渡重叠。 */
  private refreshTutorialCharacter(): void {
    const previous = this.tutorialCharacters.shift();
    if (!previous) {
      this.spawnTutorialCharacter();
      return;
    }
    previous.retire();
    this.time.delayedCall(220, () => {
      if (this.state === 'tutorial' && this.tutorialCharacters.length === 0) this.spawnTutorialCharacter();
    });
  }

  private clearTutorialCharacters(): void {
    this.tutorialCharacters.forEach((character) => character.destroy());
    this.tutorialCharacters = [];
  }

  private recordTutorialCompletedPattern(): void {
    if (this.state !== 'tutorial' || this.tutorialEnergyDialogueStarted) return;
    this.tutorialCompletedPatterns++;
    this.maybeStartTutorialEnergyDialogue();
  }

  private recordTutorialDodge(): void {
    if (this.state !== 'tutorial' || this.tutorialEnergyDialogueStarted) return;
    this.tutorialDodgeCompleted = true;
    this.maybeStartTutorialEnergyDialogue();
  }

  private maybeStartTutorialEnergyDialogue(): void {
    if (
      this.tutorialEnergyDialogueStarted
      || this.tutorialCompletedPatterns < TUTORIAL_TARGET_STREAK
      || !this.tutorialDodgeCompleted
    ) return;
    this.tutorialEnergyDialogueStarted = true;
    this.startPlayerDialogue(TUTORIAL_ENERGY_DIALOGUE_LINES, 'tutorialEnergyDialogue');
  }

  /** 连招中的错拍或错键立即清零教学连招计数。 */
  private failTutorialCombo(): void {
    if (this.tutorialStreak > 0) {
      this.tutorialStreak = 0;
      this.updateTutorialStreakText();
    }
    this.spawnTutorialVerdict('✕', '#f87171');
  }

  /** 命中反馈：对应节拍块处扩散绿环（教学与游戏通用） */
  private flashPatternIcon(beatIdx: number): void {
    if (this.patternPanelMode === 'tutorial') {
      const highlight = this.tutorialHitHighlights[beatIdx];
      if (!highlight) return;
      this.tweens.killTweensOf(highlight);
      highlight.setAlpha(0.9);
      this.tweens.add({ targets: highlight, alpha: 0, duration: 220, ease: 'Sine.easeOut' });
      return;
    }

    const icon = this.patternIcons[beatIdx];
    if (!icon || !this.patternPanel) return;
    const panel = this.patternPanel;
    const hitColor = this.combo.pattern[beatIdx] === 'H'
      ? FORMAL_PATTERN_HEAVY_COLOR
      : FORMAL_PATTERN_LIGHT_COLOR;
    this.setFormalPatternIconColor(beatIdx, hitColor);
    // 第一关顶部的四拍节奏条：正确命中时围绕原位快速上下颤动。
    this.tweens.killTweensOf(panel);
    panel.setY(this.formalPatternBaseY);
    this.tweens.addCounter({
      from: 0,
      to: Math.PI * 4,
      duration: 180,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        const phase = tween.getValue() ?? 0;
        panel.setY(this.formalPatternBaseY + Math.sin(phase) * 6);
      },
      onComplete: () => panel.setY(this.formalPatternBaseY)
    });
    const ring = this.add.circle(icon.x, icon.y, 16).setStrokeStyle(3, hitColor, 0.82);
    panel.add(ring);
    this.tweens.add({
      targets: ring,
      scale: 1.9,
      alpha: 0,
      duration: FORMAL_PATTERN_HIT_FLASH_MS,
      onComplete: () => ring.destroy()
    });
    this.time.delayedCall(FORMAL_PATTERN_HIT_FLASH_MS, () => {
      if (
        !icon.active
        || this.patternPanelMode !== 'compact'
        || this.patternPanel !== panel
        || this.patternIcons[beatIdx] !== icon
      ) return;
      this.setFormalPatternIconColor(beatIdx, FORMAL_PATTERN_BASE_COLOR);
    });
  }

  private setFormalPatternIconColor(beatIdx: number, color: number): void {
    const icon = this.patternIcons[beatIdx];
    if (!icon) return;
    if (this.combo.pattern[beatIdx] === 'L') icon.setStrokeStyle(3, color, 1);
    else icon.setFillStyle(color, 1);
  }

  private showFormalComboPattern(): void {
    if (this.patternPanelMode !== 'compact' || !this.patternPanel) return;
    this.formalPatternVisibilityRun++;
    this.tweens.killTweensOf(this.patternPanel);
    this.patternPanel.setPosition(this.formalPatternBaseX, this.formalPatternBaseY).setVisible(true).setAlpha(1);
    this.patternIcons.forEach((_, i) => this.setFormalPatternIconColor(i, FORMAL_PATTERN_BASE_COLOR));
  }

  private hideFormalComboPattern(delay = 0): void {
    if (this.patternPanelMode !== 'compact' || !this.patternPanel) return;
    const run = ++this.formalPatternVisibilityRun;
    const hide = () => {
      if (run !== this.formalPatternVisibilityRun || this.combo.isComboActive || !this.patternPanel) return;
      this.patternPanel.setPosition(this.formalPatternBaseX, this.formalPatternBaseY).setVisible(false);
    };
    if (delay > 0) this.time.delayedCall(delay, hide);
    else hide();
  }

  private flashAndHideFormalComboPattern(): void {
    if (this.patternPanelMode !== 'compact' || !this.patternPanel) return;
    const panel = this.patternPanel;
    const run = ++this.formalPatternVisibilityRun;
    this.tweens.killTweensOf(panel);
    panel.setPosition(this.formalPatternBaseX, this.formalPatternBaseY).setVisible(true).setAlpha(1);
    this.patternIcons.forEach((_, i) => this.setFormalPatternIconColor(i, 0xfca5a5));
    this.tweens.add({
      targets: panel,
      x: this.formalPatternBaseX + 10,
      duration: 34,
      yoyo: true,
      repeat: 3,
      onComplete: () => panel.setX(this.formalPatternBaseX)
    });
    this.time.delayedCall(250, () => {
      if (run !== this.formalPatternVisibilityRun || this.combo.isComboActive || this.patternPanel !== panel) return;
      panel.setPosition(this.formalPatternBaseX, panel.y).setVisible(false);
    });
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

  private retryTutorial(): void {
    this.confirmUi?.destroy();
    this.confirmUi = undefined;
    this.startTutorial();
  }

  private finishTutorial(): void {
    this.confirmUi?.destroy();
    this.confirmUi = undefined;
    this.destroyTutorialControlGuide();
    this.clearTutorialCharacters();
    this.patternPanel?.destroy(true);
    this.patternPanel = undefined;
    this.patternIcons = [];
    this.hud.setBeatGuideVisible(false);
    this.hud.setGameplayHudVisible(false);
    this.hud.setTutorialComboVisible(false);
    this.hud.setWave('');
    this.startTutorialOutro();
  }

  private startTutorialOutro(): void {
    this.state = 'tutorialOutro';
    this.tutorialOutroFinished = false;
    this.bgm?.stop();
    this.conductor.pause();

    const screenX = CAMERA_BASE_SCROLL_X + VIEW_WIDTH / (2 * MAIN_CAMERA_BASE_ZOOM);
    const screenY = CAMERA_BASE_SCROLL_Y + VIEW_HEIGHT / (2 * MAIN_CAMERA_BASE_ZOOM);
    this.tutorialOutroBackdrop = this.add
      .rectangle(
        screenX,
        screenY,
        VIEW_WIDTH / MAIN_CAMERA_BASE_ZOOM,
        VIEW_HEIGHT / MAIN_CAMERA_BASE_ZOOM,
        0x000000,
        1
      )
      .setScrollFactor(0)
      .setDepth(5000);
    this.tutorialOutroText = this.add
      .text(screenX, screenY, '加载过场动画…', {
        fontFamily: 'Arial, Microsoft YaHei, sans-serif',
        fontSize: `${hd(18)}px`,
        color: '#ffffff'
      })
      .setOrigin(0.5)
      .setScale(1 / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0)
      .setDepth(5002);

    if (this.cache.video.exists(POST_TUTORIAL_VIDEO_KEY)) {
      this.playTutorialOutroVideo();
      return;
    }

    queuePostTutorialVideo(this);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.state !== 'tutorialOutro' || this.tutorialOutroFinished) return;
      if (this.cache.video.exists(POST_TUTORIAL_VIDEO_KEY)) this.playTutorialOutroVideo();
      else this.finishTutorialOutro();
    });
    startBackgroundLoad(this);
  }

  private playTutorialOutroVideo(): void {
    if (this.state !== 'tutorialOutro' || this.tutorialOutroFinished || this.tutorialOutroVideo) return;
    this.tutorialOutroText?.destroy();
    const screenX = CAMERA_BASE_SCROLL_X + VIEW_WIDTH / (2 * MAIN_CAMERA_BASE_ZOOM);
    const screenY = CAMERA_BASE_SCROLL_Y + VIEW_HEIGHT / (2 * MAIN_CAMERA_BASE_ZOOM);
    this.tutorialOutroVideo = this.add
      .video(screenX, screenY, POST_TUTORIAL_VIDEO_KEY)
      .setScrollFactor(0)
      .setDepth(5001);
    this.tutorialOutroVideo.once(
      Phaser.GameObjects.Events.VIDEO_CREATED,
      () => this.tutorialOutroVideo?.setDisplaySize(
        VIEW_WIDTH / MAIN_CAMERA_BASE_ZOOM,
        VIEW_HEIGHT / MAIN_CAMERA_BASE_ZOOM
      )
    );
    this.tutorialOutroVideo.on(Phaser.GameObjects.Events.VIDEO_COMPLETE, this.finishTutorialOutro, this);
    this.tutorialOutroVideo.on(Phaser.GameObjects.Events.VIDEO_ERROR, this.finishTutorialOutro, this);
    this.tutorialOutroText = this.add
      .text(
        CAMERA_BASE_SCROLL_X + (VIEW_WIDTH - hd(20)) / MAIN_CAMERA_BASE_ZOOM,
        CAMERA_BASE_SCROLL_Y + (VIEW_HEIGHT - hd(20)) / MAIN_CAMERA_BASE_ZOOM,
        '空格跳过',
        {
          fontFamily: 'Arial, Microsoft YaHei, sans-serif',
          fontSize: `${hd(12)}px`,
          color: '#ffffff'
        }
      )
      .setOrigin(1)
      .setScale(1 / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0)
      .setAlpha(0.75)
      .setDepth(5002);
    this.tutorialOutroVideo.setMute(false).setVolume(1).play(false);
  }

  private finishTutorialOutro(): void {
    if (this.state !== 'tutorialOutro' || this.tutorialOutroFinished) return;
    this.tutorialOutroFinished = true;
    this.destroyTutorialOutro();
    this.beginFirstLevel();
  }

  private destroyTutorialOutro(): void {
    this.tutorialOutroVideo?.off(Phaser.GameObjects.Events.VIDEO_COMPLETE, this.finishTutorialOutro, this);
    this.tutorialOutroVideo?.off(Phaser.GameObjects.Events.VIDEO_ERROR, this.finishTutorialOutro, this);
    this.tutorialOutroVideo?.stop(false);
    this.tutorialOutroVideo?.destroy();
    this.tutorialOutroBackdrop?.destroy();
    this.tutorialOutroText?.destroy();
    this.tutorialOutroVideo = undefined;
    this.tutorialOutroBackdrop = undefined;
    this.tutorialOutroText = undefined;
  }

  private beginFirstLevel(): void {
    // 正式关切换为紧凑四拍图标条；两关均不再创建整场扩散框。
    this.buildPatternPanel(false);
    this.hud.setBeatGuideVisible(false);
    this.hud.setGameplayHudVisible(false);
    this.hud.setTutorialComboVisible(false);
    // 教学期间积累的 Fever 能量清零，正式开局从零开始
    this.combo.progress = 0;
    this.combo.setProgressGainEnabled(false);
    this.lastComboLevel = 0;
    this.hud.setCombo(0, 0);
    this.stageEnvironment.showSecondLevel();
    this.state = 'levelIntroWalk';
    const levelTrack = BGM_TRACKS[this.tuningEditor.levelBgmSlot];
    this.conductor.setSfxVolume(this.audioChannelVolumes.rhythm);
    this.conductor.start();
    if (this.cache.audio.exists(levelTrack.key)) {
      this.switchBgmTrack(levelTrack, false);
      this.bgmFirstBeat = 0;
      this.playBgmAlignedToBeat(this.bgmFirstBeat);
    } else {
      this.switchBgmTrack(levelTrack, true);
    }
    this.hud.setWave('');

    this.player.aimAngle = 0;
    this.player.rawAimAngle = 0;
    this.player.setScriptedPosition(TUTORIAL_INTRO_START_X, TUTORIAL_INTRO_Y);
    this.player.setScriptedWalk(true);
    const travel = { progress: 0 };
    this.tweens.add({
      targets: travel,
      progress: 1,
      duration: TUTORIAL_INTRO_WALK_DURATION_MS,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.player.setScriptedPosition(
          Phaser.Math.Linear(TUTORIAL_INTRO_START_X, FIRST_LEVEL_INTRO_TARGET_X, travel.progress),
          TUTORIAL_INTRO_Y
        );
      },
      onComplete: () => {
        if (this.state !== 'levelIntroWalk') return;
        this.player.setScriptedPosition(FIRST_LEVEL_INTRO_TARGET_X, TUTORIAL_INTRO_Y);
        this.player.setScriptedWalk(false);
        this.startPlayerDialogue(FIRST_LEVEL_DIALOGUE_LINES, 'levelDialogue');
      }
    });
  }

  /** 第一关对白结束后进行真实 5 秒倒计时；攻击可用，但正确输入不增加 ComboMeter。 */
  private startFirstLevelCountdown(): void {
    this.player.setScriptedWalk(false);
    this.state = 'intermission';
    this.hud.setGameplayHudVisible(true);
    this.countdownTimer?.remove();
    this.countdownRemaining = 5;
    this.showCountdownTick('5', '#facc15');
    this.countdownTimer = this.time.addEvent({
      delay: 1000,
      repeat: 4,
      callback: () => {
        if (this.state !== 'intermission' || this.countdownRemaining < 0) return;
        this.countdownRemaining--;
        if (this.countdownRemaining > 0) {
          this.showCountdownTick(
            String(this.countdownRemaining),
            this.countdownRemaining <= 2 ? '#f97316' : '#facc15'
          );
          return;
        }
        this.countdownRemaining = -1;
        this.countdownTimer = undefined;
        this.combo.startSwitch(this.player.weapon.pattern);
        this.patternPanel?.setVisible(false);
        this.startWave(0);
      }
    });
  }

  /** 倒计时数字每秒弹出一次，数字越小越接近警示色。 */
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
      .setPosition(
        CAMERA_BASE_SCROLL_X + hd(640) / MAIN_CAMERA_BASE_ZOOM,
        CAMERA_BASE_SCROLL_Y + hd(300) / MAIN_CAMERA_BASE_ZOOM
      )
      .setScale(UI_SCALE / MAIN_CAMERA_BASE_ZOOM)
      .setScrollFactor(0)
      .setScale(1.5 * UI_SCALE / MAIN_CAMERA_BASE_ZOOM);
    this.tweens.add({
      targets: text,
      scaleX: UI_SCALE / MAIN_CAMERA_BASE_ZOOM,
      scaleY: UI_SCALE / MAIN_CAMERA_BASE_ZOOM,
      duration: 120,
      ease: 'Back.easeOut'
    });
    this.tweens.add({
      targets: text,
      alpha: 0,
      delay: 650,
      duration: 220,
      onComplete: () => text.destroy()
    });
  }

  private startWave(idx: number): void {
    if (this.state === 'over') return;
    this.combo.setProgressGainEnabled(true);
    this.waveSpawnTimer?.remove();
    this.waveAdvanceTimer?.remove();
    this.waveSpawnTimer = undefined;
    this.waveAdvanceTimer = undefined;
    this.waveIdx = idx;
    this.displayedWaveNumber++;
    this.state = 'playing';
    this.hud.setWave(`Wave ${this.displayedWaveNumber}`);
    this.flashMessage(idx === BOSS_WAVE_INDEX ? 'BOSS：警卫长' : `WAVE ${this.displayedWaveNumber}`);
    this.pendingWaveSpawns = this.buildWaveSpawnQueue(idx);
    this.spawnNextWaveBatch();
  }

  private updateBatonHoldUi(): void {
    if (!this.batonHoldTrack || !this.batonHoldFill || !this.batonHoldLabel) return;
    if (!this.batonHeavyHeld || !this.combo.expectsHeavyRelease) return;
    const expectedBeat = this.combo.expectedComboBeat;
    const progress = Phaser.Math.Clamp(
      this.conductor.beatFloatAt(this.conductor.now()) - (expectedBeat - 1),
      0,
      1
    );
    this.batonHoldTrack.setFillStyle(0x78350f, 0.95);
    this.batonHoldFill
      .setVisible(true)
      .setFillStyle(FORMAL_PATTERN_HEAVY_COLOR, 1)
      .setDisplaySize(Math.max(1, 72 * progress), 6);
    if (this.time.now >= this.batonHoldFeedbackUntil) {
      this.batonHoldLabel.setText('持续按住').setColor('#fde68a');
    }
  }

  private showBatonHoldPressFeedback(judgement: AttackJudgement): void {
    if (!this.batonHoldTrack || !this.batonHoldFill || !this.batonHoldLabel) return;
    this.batonHoldFeedbackUntil = this.time.now + 180;
    const missed = judgement === 'poor';
    this.batonHoldTrack.setFillStyle(missed ? 0x7f1d1d : 0x78350f, 0.95);
    this.batonHoldFill
      .setVisible(true)
      .setDisplaySize(1, 6)
      .setFillStyle(missed ? 0xef4444 : FORMAL_PATTERN_HEAVY_COLOR, 1);
    this.batonHoldLabel
      .setText(`按下 ${judgement === 'perfect' ? 'PERFECT' : judgement === 'good' ? 'GOOD' : 'MISS'}`)
      .setColor(judgement === 'perfect' ? '#fff4b8' : judgement === 'good' ? '#bfdbfe' : '#fecaca');
  }

  private showBatonHoldReleaseFeedback(success: boolean, judgement: AttackJudgement): void {
    if (!this.batonHoldTrack || !this.batonHoldFill || !this.batonHoldLabel) return;
    this.batonHoldFeedbackUntil = Infinity;
    this.batonHoldFill
      .setVisible(true)
      .setDisplaySize(72, 6)
      .setFillStyle(success ? 0x4ade80 : 0xef4444, 1);
    this.batonHoldTrack.setFillStyle(success ? 0x14532d : 0x7f1d1d, 0.95);
    this.batonHoldLabel
      .setText(success ? `松开 ${judgement === 'perfect' ? 'PERFECT' : 'GOOD'}` : '松开 MISS')
      .setColor(success ? '#bbf7d0' : '#fecaca');
  }

  private buildWaveSpawnQueue(idx: number): WaveEnemyFactory[] {
    const queue: WaveEnemyFactory[] = [];
    if (idx === BOSS_WAVE_INDEX) {
      const bossX = ARENA.x + ARENA.width - worldSize(150);
      const bossY = ARENA.y + ARENA.height / 2;
      queue.push(() => new BossGuard(this, bossX, bossY));
      const minionCount = Math.max(0, Math.round(this.tuningEditor.bossMinionCount));
      for (let index = 0; index < minionCount; index++) {
        const [x, y] = this.spawnPointOnArenaEdge(index, Math.max(1, minionCount));
        queue.push(() => new FanEnemy(this, x, y));
      }
      return queue;
    }

    if (idx === 0) {
      const [guardX, guardY] = this.spawnPointOnArenaEdge(0, 2);
      const [fanX, fanY] = this.spawnPointOnArenaEdge(1, 2);
      queue.push(
        () => new SmallGuard(this, guardX, guardY),
        () => new FanEnemy(this, fanX, fanY)
      );
      return queue;
    }
    // Wave 2 / 3 保留一粉丝两保安的三人小队；从 Wave 4 起改为一粉丝一保安。
    const pairedFormation = idx >= 3;
    const groupCount = WAVE_ENEMY_COUNTS[idx] / (pairedFormation ? 2 : 3);
    for (let group = 0; group < groupCount; group++) {
      const [x, y] = this.spawnPointOnArenaEdge(group, groupCount);
      const towardCenter = Phaser.Math.Angle.Between(x, y, VIEW_WIDTH / 2, VIEW_HEIGHT / 2);
      const side = Phaser.Math.DegToRad(90);
      const offset = worldSize(34);
      const guardAX = x + Math.cos(towardCenter + side) * offset;
      const guardAY = y + Math.sin(towardCenter + side) * offset;
      queue.push(
        () => new FanEnemy(this, x, y),
        () => new SmallGuard(this, guardAX, guardAY)
      );
      if (!pairedFormation) {
        const guardBX = x + Math.cos(towardCenter - side) * offset;
        const guardBY = y + Math.sin(towardCenter - side) * offset;
        queue.push(() => new SmallGuard(this, guardBX, guardBY));
      }
    }
    return queue;
  }

  private spawnNextWaveBatch(): void {
    this.waveSpawnTimer = undefined;
    if (this.state !== 'playing' || this.pendingWaveSpawns.length === 0) {
      this.tryCompleteWave();
      return;
    }

    const minBatchSize = Math.max(1, Math.round(Math.min(
      this.tuningEditor.waveSpawnMinBatchSize,
      this.tuningEditor.waveSpawnMaxBatchSize
    )));
    const maxBatchSize = Math.max(minBatchSize, Math.round(Math.max(
      this.tuningEditor.waveSpawnMinBatchSize,
      this.tuningEditor.waveSpawnMaxBatchSize
    )));
    const batchSize = Math.min(
      this.pendingWaveSpawns.length,
      Phaser.Math.Between(minBatchSize, maxBatchSize)
    );
    for (const createEnemy of this.pendingWaveSpawns.splice(0, batchSize)) {
      this.addWaveEnemy(createEnemy());
    }

    if (this.pendingWaveSpawns.length === 0) {
      this.tryCompleteWave();
      return;
    }

    const minInterval = Math.max(0.5, Math.min(
      this.tuningEditor.waveSpawnMinIntervalSeconds,
      this.tuningEditor.waveSpawnMaxIntervalSeconds
    ));
    const maxInterval = Math.max(minInterval, Math.max(
      this.tuningEditor.waveSpawnMinIntervalSeconds,
      this.tuningEditor.waveSpawnMaxIntervalSeconds
    ));
    const delayMs = Phaser.Math.FloatBetween(minInterval, maxInterval) * 1000;
    this.waveSpawnTimer = this.time.delayedCall(delayMs, this.spawnNextWaveBatch, [], this);
  }

  private tryCompleteWave(): void {
    if (
      this.state !== 'playing'
      || this.pendingWaveSpawns.length > 0
      || this.waveSpawnTimer
      || this.enemies.length > 0
      || this.waveAdvanceTimer
    ) return;

    const completedBossWave = this.waveIdx === BOSS_WAVE_INDEX;
    if (completedBossWave) {
      this.finishVictory();
      return;
    }
    this.state = 'intermission';
    this.waveAdvanceTimer = this.time.delayedCall(2000, () => {
      this.waveAdvanceTimer = undefined;
      if (this.state === 'over') return;
      this.startWave(this.waveIdx + 1);
    });
  }

  /** Boss 波清空后停在胜利画面；不再启动循环波次，所有单位和时钟保持冻结。 */
  private finishVictory(): void {
    if (this.victoryAchieved) return;
    this.victoryAchieved = true;
    this.state = 'victory';
    this.waveSpawnTimer?.remove();
    this.waveAdvanceTimer?.remove();
    this.waveSpawnTimer = undefined;
    this.waveAdvanceTimer = undefined;
    this.pendingWaveSpawns = [];
    this.endBatonHeavyHold(false);
    this.clearAllProjectiles();
    this.player.enterGameOverIdle();
    this.hud.setBossHealthVisible(false);
    this.hud.setVictoryVisible(true);
    this.gameOverFrozen = true;
    this.conductor.pause();
    this.sound.pauseAll();
    this.physics.world.pause();
    this.tweens.pauseAll();
    this.anims.pauseAll();
    this.time.paused = true;
    this.getFpvMiniScene()?.setPanelPaused(true);
  }

  private addWaveEnemy(enemy: Enemy): void {
    this.enemies.push(enemy);
    this.enemyGroup.add(enemy.go);
    enemy.onSpawned();
  }

  onEnemyKilled(enemy: Enemy): void {
    this.enemies = this.enemies.filter((e) => e !== enemy);

    // 保安掉警棍，粉丝掉荧光棒；玩家已持有或场上已有时不重复生成。
    const drop = enemy.kind === 'smallGuard' ? BATON : enemy.kind === 'fan' ? GLOWSTICKS : undefined;
    if (
      drop
      && this.player.weapon.id !== drop.id
      && !this.pickups.some((pickup) => pickup.weapon.id === drop.id)
      && passesDropChance(this.tuningEditor.getWeaponDropChance(drop.id))
    ) {
      this.spawnPickup(enemy.x, enemy.y, drop);
    }

    this.tryCompleteWave();
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
    if (this.state === 'over') return;
    this.state = 'over';
    this.waveSpawnTimer?.remove();
    this.waveAdvanceTimer?.remove();
    this.waveSpawnTimer = undefined;
    this.waveAdvanceTimer = undefined;
    this.pendingWaveSpawns = [];
    this.endBatonHeavyHold(false);
    this.clearAllProjectiles();
    this.player.die();
    for (const enemy of this.enemies) enemy.enterGameOverIdle();
    this.arenaCorrectFeedback.setVisible(false);
    this.showGameOverMessage();
    this.player.go.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.freezeGameplayAfterDeath();
    });
  }

  /** 死亡动画播完后把时间、物理、补间、动画与音频一并冻结，玩家停在末帧。 */
  private freezeGameplayAfterDeath(): void {
    if (this.gameOverFrozen) return;
    this.gameOverFrozen = true;
    this.player.go.stop();
    this.player.go.setAlpha(1);
    this.conductor.pause();
    this.sound.pauseAll();
    this.physics.world.pause();
    this.tweens.pauseAll();
    this.anims.pauseAll();
    this.time.paused = true;
    this.getFpvMiniScene()?.setPanelPaused(true);
  }

  /** 结束画面不遮住场内单位；所有单位原地 Idle，提示保持在屏幕层。 */
  private showGameOverMessage(): void {
    const camera = this.cameras.main;
    const view = camera.worldView;
    const message = this.add
      .text(view.centerX, view.bottom - 72, '我怒闯演唱会失败。\n按R再试一次。', {
        fontFamily: 'Arial',
        fontSize: '24px',
        color: '#e5e7eb',
        align: 'center',
        backgroundColor: '#0f172acc',
        padding: { x: 24, y: 14 },
        stroke: '#000000',
        strokeThickness: 5
      })
      .setOrigin(0.5, 1)
      .setDepth(1003)
      .setAlpha(0)
      .setScale(1 / MAIN_CAMERA_BASE_ZOOM);
    this.tweens.add({ targets: message, alpha: 1, duration: 220 });
  }

  getAutoAimAngle(moveAngle: number): number {
    let nearest: Enemy | undefined;
    let bestScore = Infinity;
    let bestIsInMovementCone = false;
    const halfPriorityCone = Phaser.Math.DegToRad(22.5);

    for (const enemy of [...this.enemies, ...this.tutorialCharacters]) {
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

  getPlayerWeaponAttackSpeed(weaponId: WeaponId, heavy: boolean): number {
    if (weaponId === 'baton') {
      return heavy
        ? this.tuningEditor.batonHeavyAttackSpeed
        : this.tuningEditor.batonLightAttackSpeed;
    }
    return heavy
      ? this.tuningEditor.glowstickHeavyAttackSpeed
      : this.tuningEditor.glowstickLightAttackSpeed;
  }

  scheduleEnemyAttacks(kind: EnemyKind, globalBeat: number, attack: () => void): void {
    const frequency = kind === 'fan'
      ? this.tuningEditor.fanAttackFrequency
      : this.tuningEditor.smallGuardAttackFrequency;
    const shotsBeforeBeat = Math.floor(globalBeat * frequency + 0.000001);
    const shotsThroughBeat = Math.floor((globalBeat + 1) * frequency + 0.000001);
    const shotCount = shotsThroughBeat - shotsBeforeBeat;
    for (let index = 0; index < shotCount; index += 1) {
      const delayMs = (this.conductor.beatDur * 1000 * index) / shotCount;
      if (delayMs <= 0) attack();
      else this.time.delayedCall(delayMs, attack);
    }
  }

  private getEnemyBulletSpeed(kind: EnemyKind): number {
    if (kind === 'bossGuard') return this.tuningEditor.bossProjectileSpeed;
    return kind === 'fan'
      ? this.tuningEditor.fanBulletSpeed
      : this.tuningEditor.smallGuardBulletSpeed;
  }

  /** 将敌人瞄准角吸附到最近的八方向扇区中线（每档 45°）。 */
  quantizeEnemyAttackAngle(angle: number): number {
    const sectorAngle = Math.PI / 4;
    return Phaser.Math.Angle.Wrap(Math.round(Phaser.Math.Angle.Wrap(angle) / sectorAngle) * sectorAngle);
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

  /**
   * 将实体亮芯、饱和外壳与贴边柔光烘进同一张纹理。
   * 运行时只显示一个 NORMAL Image，避免多个半透明对象叠成空心轮廓或夹白光团。
   */
  private ensurePlayerProjectileTexture(onBeat: boolean): string {
    const textureKey = onBeat ? PLAYER_PROJECTILE_ON_BEAT_TEXTURE : PLAYER_PROJECTILE_TEXTURE;
    if (this.textures.exists(textureKey)) return textureKey;

    const width = 128;
    const height = 64;
    const texture = this.textures.createCanvas(textureKey, width, height);
    if (!texture) return '__WHITE';

    const shellColor = 0xd92f3d;
    const midColor = onBeat ? 0xff7a82 : 0xff6470;
    const coreColor = onBeat ? 0xfffff7 : 0xfff6f3;
    const shellWidth = width * (PLAYER_LINE_VISIBLE_LENGTH_SCALE / PLAYER_LINE_GLOW_LENGTH_SCALE);
    const shellHeight = height * (PLAYER_LINE_CORE_THICKNESS_SCALE / PLAYER_LINE_GLOW_THICKNESS_SCALE);
    const coreWidth = shellWidth * 0.76;
    const coreHeight = shellHeight * 0.54;
    this.paintCompositeCapsule(
      texture.context,
      width,
      height,
      shellWidth,
      shellHeight,
      coreWidth,
      coreHeight,
      shellColor,
      midColor,
      coreColor
    );
    texture.refresh();
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    return textureKey;
  }

  private ensureEnemyProjectileTexture(
    sourceKind: EnemyKind,
    visualDiameter: number,
    bossStyle: BossProjectileStyle = 'triple',
    tutorialPink = false
  ): string {
    const textureKey = tutorialPink
      ? TUTORIAL_PINK_PROJECTILE_TEXTURE
      : sourceKind === 'fan'
      ? FAN_PROJECTILE_TEXTURE
      : sourceKind === 'bossGuard'
        ? bossStyle === 'note' ? BOSS_NOTE_PROJECTILE_TEXTURE : BOSS_TRIPLE_PROJECTILE_TEXTURE
        : GUARD_PROJECTILE_TEXTURE;
    if (this.textures.exists(textureKey)) return textureKey;

    const size = 64;
    const texture = this.textures.createCanvas(textureKey, size, size);
    if (!texture) return '__WHITE';

    const shellColor = tutorialPink
      ? 0xdb2777
      : sourceKind === 'fan'
      ? 0xd92c16
      : sourceKind === 'bossGuard'
        ? bossStyle === 'note' ? 0x15803d : 0x1d4ed8
        : 0x18b6cf;
    const midColor = tutorialPink
      ? 0xf472b6
      : sourceKind === 'fan'
      ? 0xff7832
      : sourceKind === 'bossGuard'
        ? bossStyle === 'note' ? 0x4ade80 : 0x60a5fa
        : 0x7ff7ff;
    const coreColor = tutorialPink
      ? 0xfdf2f8
      : sourceKind === 'fan'
      ? 0xfff6cf
      : sourceKind === 'bossGuard'
        ? bossStyle === 'note' ? 0xf0fdf4 : 0xeff6ff
        : 0xf2ffff;
    const displayDiameter = visualDiameter * 0.96 + ENEMY_PROJECTILE_GLOW_DISTANCE * 2;
    const shellRadius = (visualDiameter * 0.48 * size) / displayDiameter;
    this.paintCompositePoint(texture.context, size, shellRadius, shellColor, midColor, coreColor);
    texture.refresh();
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    return textureKey;
  }

  private paintCompositeCapsule(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    shellWidth: number,
    shellHeight: number,
    coreWidth: number,
    coreHeight: number,
    shellColor: number,
    midColor: number,
    coreColor: number
  ): void {
    const image = context.createImageData(width, height);
    const centerX = (width - 1) * 0.5;
    const centerY = (height - 1) * 0.5;
    const shellRadius = shellHeight * 0.5;
    const coreRadius = coreHeight * 0.5;
    const shellHalfSpine = Math.max(0, shellWidth * 0.5 - shellRadius);
    const midWidth = shellWidth * 0.9;
    const midHeight = shellHeight * 0.82;
    const midRadius = midHeight * 0.5;
    const midHalfSpine = Math.max(0, midWidth * 0.5 - midRadius);
    const coreHalfSpine = Math.max(0, coreWidth * 0.5 - coreRadius);
    const shellRgb = this.colorChannels(shellColor);
    const midRgb = this.colorChannels(midColor);
    const coreRgb = this.colorChannels(coreColor);
    const haloSigma = 2.6;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const shellNearestX = Phaser.Math.Clamp(x, centerX - shellHalfSpine, centerX + shellHalfSpine);
        const midNearestX = Phaser.Math.Clamp(x, centerX - midHalfSpine, centerX + midHalfSpine);
        const coreNearestX = Phaser.Math.Clamp(x, centerX - coreHalfSpine, centerX + coreHalfSpine);
        const shellSdf = Math.hypot(x - shellNearestX, y - centerY) - shellRadius;
        const midSdf = Math.hypot(x - midNearestX, y - centerY) - midRadius;
        const coreSdf = Math.hypot(x - coreNearestX, y - centerY) - coreRadius;
        this.writeCompositePixel(
          image.data,
          (y * width + x) * 4,
          shellRgb,
          midRgb,
          coreRgb,
          shellSdf,
          midSdf,
          coreSdf,
          haloSigma
        );
      }
    }
    context.putImageData(image, 0, 0);
  }

  private paintCompositePoint(
    context: CanvasRenderingContext2D,
    size: number,
    shellRadius: number,
    shellColor: number,
    midColor: number,
    coreColor: number
  ): void {
    const image = context.createImageData(size, size);
    const center = (size - 1) * 0.5;
    const midRadius = shellRadius * 0.82;
    const coreRadius = shellRadius * 0.56;
    const shellRgb = this.colorChannels(shellColor);
    const midRgb = this.colorChannels(midColor);
    const coreRgb = this.colorChannels(coreColor);
    const haloSigma = 2.4;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const distance = Math.hypot(x - center, y - center);
        this.writeCompositePixel(
          image.data,
          (y * size + x) * 4,
          shellRgb,
          midRgb,
          coreRgb,
          distance - shellRadius,
          distance - midRadius,
          distance - coreRadius,
          haloSigma
        );
      }
    }
    context.putImageData(image, 0, 0);
  }

  private writeCompositePixel(
    data: Uint8ClampedArray,
    index: number,
    shellRgb: { r: number; g: number; b: number },
    midRgb: { r: number; g: number; b: number },
    coreRgb: { r: number; g: number; b: number },
    shellSdf: number,
    midSdf: number,
    coreSdf: number,
    haloSigma: number
  ): void {
    const shellCoverage = Phaser.Math.Clamp(0.5 - shellSdf, 0, 1);
    const midCoverage = Phaser.Math.Clamp(0.5 - midSdf, 0, 1);
    const coreCoverage = Phaser.Math.Clamp(0.5 - coreSdf, 0, 1);
    const outsideDistance = Math.max(0, shellSdf);
    const haloAlpha = shellSdf > -0.5
      ? 0.24 * Math.exp(-(outsideDistance * outsideDistance) / (2 * haloSigma * haloSigma))
      : 0;
    const shellAlpha = shellCoverage + haloAlpha * (1 - shellCoverage);
    const midAndShellAlpha = midCoverage + shellAlpha * (1 - midCoverage);
    const outAlpha = coreCoverage + midAndShellAlpha * (1 - coreCoverage);
    if (outAlpha <= 0.001) return;

    const shellWeight = shellAlpha * (1 - midCoverage) * (1 - coreCoverage);
    const midWeight = midCoverage * (1 - coreCoverage);
    data[index] = Math.round((coreRgb.r * coreCoverage + midRgb.r * midWeight + shellRgb.r * shellWeight) / outAlpha);
    data[index + 1] = Math.round((coreRgb.g * coreCoverage + midRgb.g * midWeight + shellRgb.g * shellWeight) / outAlpha);
    data[index + 2] = Math.round((coreRgb.b * coreCoverage + midRgb.b * midWeight + shellRgb.b * shellWeight) / outAlpha);
    data[index + 3] = Math.round(outAlpha * 255);
  }

  private colorChannels(color: number): { r: number; g: number; b: number } {
    return {
      r: (color >> 16) & 0xff,
      g: (color >> 8) & 0xff,
      b: color & 0xff
    };
  }

  private positionStraightBulletHitboxes(
    bullet: Phaser.GameObjects.Rectangle,
    length: number,
    size: number,
    angle: number
  ): void {
    const offsetX = (bullet.getData('projectileVisualOffsetX') as number | undefined) ?? 0;
    const offsetY = (bullet.getData('projectileVisualOffsetY') as number | undefined) ?? 0;
    const projectileVisual = bullet.getData('projectileVisual') as Phaser.GameObjects.Image | undefined;
    if (projectileVisual?.active) {
      projectileVisual
        .setPosition(bullet.x + offsetX, bullet.y + offsetY)
        .setRotation(bullet.rotation)
        .setVisible(bullet.visible);
    }
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
        if (group === this.bullets) this.applyEnemyBulletSize(bullet);
        this.positionStraightBulletHitboxes(
          bullet,
          bullet.getData('hitboxLength') as number,
          bullet.getData('hitboxSize') as number,
          bullet.getData('hitboxAngle') as number
        );
      }
    }
  }

  /** P Menu 的敌弹尺寸会同时作用到当前存量弹幕的可见图像与全部碰撞采样体。 */
  private applyEnemyBulletSize(bullet: Phaser.GameObjects.Rectangle): void {
    const sizeMultiplier = this.tuningEditor.enemyBulletSizeMultiplier;
    if (bullet.getData('appliedSizeMultiplier') === sizeMultiplier) return;

    const baseVisualDiameter = bullet.getData('baseVisualDiameter') as number;
    const baseCompositeDiameter = bullet.getData('baseCompositeDiameter') as number;
    const baseHitboxSize = bullet.getData('baseHitboxSize') as number;
    const baseHitboxLength = bullet.getData('baseHitboxLength') as number;
    const hitboxSize = baseHitboxSize * sizeMultiplier;
    const hitboxLength = baseHitboxLength * sizeMultiplier;
    const projectileVisual = bullet.getData('projectileVisual') as Phaser.GameObjects.Image | undefined;
    projectileVisual?.setDisplaySize(baseCompositeDiameter * sizeMultiplier, baseCompositeDiameter * sizeMultiplier);
    (bullet.body as Phaser.Physics.Arcade.Body).setSize(hitboxSize, hitboxSize, true);
    for (const hitbox of (bullet.getData('hitboxes') as Phaser.GameObjects.Rectangle[] | undefined) ?? []) {
      (hitbox.body as Phaser.Physics.Arcade.Body).setSize(hitboxSize, hitboxSize, true);
    }
    bullet.setData('visualDiameter', baseVisualDiameter * sizeMultiplier);
    bullet.setData('hitboxSize', hitboxSize);
    bullet.setData('hitboxLength', hitboxLength);
    bullet.setData('trailThickness', hitboxSize);
    bullet.setData('appliedSizeMultiplier', sizeMultiplier);
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
    if (this.state === 'over') return;

    // 背景律动与输入连招解耦：每一拍都是同一种鼓点与轻脉冲。
    if (
      this.state !== 'tutorialIntroWalk'
      && this.state !== 'tutorialDialogue'
      && this.state !== 'levelIntroWalk'
      && this.state !== 'levelDialogue'
    ) {
      this.player.onBeat(false);
    }
    this.stageEnvironment.pulse(false);
    this.hud.onBeat(0);
    this.getFpvMiniScene()?.onBeat(false);
    this.pulsePickups();
    if (this.patternPanelMode === 'tutorial' || this.combo.isComboActive) {
      this.pulsePatternIcon(this.combo.expectedStep);
    }
    if (this.state === 'tutorial') this.onTutorialBeat(info);
    if (this.lastRhythmHitBeat < info.globalBeat - 1) this.breakRhythmCombo();

    // 节拍脉冲：平时按 Combo 等级增强（积累感），Fever 期间最强并闪烁边框
    const fever = this.combo.feverActive();
    this.hud.beatPulse(this.combo.level, fever);
    if (fever) {
      this.feverBorder.setAlpha(0.9);
      this.tweens.add({ targets: this.feverBorder, alpha: 0.25, duration: 350 });
    }

    if (this.state === 'playing') {
      for (const enemy of [...this.enemies]) {
        enemy.pulseBeat(false);
        enemy.onBeat(info);
      }
    }
  }

  // ---------- 攻击 ----------

  private performWeaponAttack(
    beatIdx: number,
    onBeat: boolean,
    attackInput: 'L' | 'H',
    judgement: AttackJudgement
  ): void {
    const weapon = this.player.weapon;
    const spec = getAttackSpec(weapon.id, beatIdx);
    const mult = this.combo.damageMultiplier;
    // 动作、音效和角色特效必须跟随玩家实际按下的轻/重攻击，
    // 不能在错误输入时仍按目标节拍类型播放另一套表现。
    const heavy = attackInput === 'H';
    const angle = this.player.aimAngle;
    const attackOrigin = this.player.getAttackOrigin();

    const damage = this.tuningEditor.getWeaponAttackDamage(weapon.id, heavy);
    const judgementDamageMultiplier = this.tuningEditor.getWeaponJudgementDamageMultiplier(
      weapon.id,
      judgement
    );
    const tunedDamage = damage * mult * judgementDamageMultiplier;
    const projectileCount = onBeat ? this.getCorrectProjectileCount(weapon.id) : 1;
    const projectileLengthScale = onBeat ? 1 : 0.5;
    const projectileRangeScale = onBeat ? 1 : 0.5;
    const batonAngleTier = Math.min(2, Math.floor(this.combo.level / 2));
    const batonSweepScale = (onBeat ? 1 : 0.5) * (1 + batonAngleTier * 0.25);
    const attackAngles = [angle];
    this.player.playAttackAnimation(heavy);
    // playAttackAnimation 会先把武器放到本次挥击的起手角；此后读取发光端，
    // 才能让直射亮芯在左右朝向和轻 / 重挥击下都从武器尖端出发。
    const glowstickEmitter = weapon.id === 'baton'
      ? attackOrigin
      : this.player.getGlowstickEmitterPosition();
    if (onBeat) {
      const feedbackOrigin = weapon.id === 'baton' ? attackOrigin : glowstickEmitter;
      this.spawnOnBeatAttackFx(
        feedbackOrigin.x,
        feedbackOrigin.y,
        heavy,
        spec.color,
        weapon.id === 'baton',
        // 警棍本身每帧都在更新弧线扫击；不额外缩放主相机，
        // 避免移动中的连续挥击让镜头产生“被拉住”的顿挫感。
        weapon.id !== 'baton'
      );
    }
    const useGlowstickLaser = heavy
      && weapon.id === 'glowsticks'
      && this.tuningEditor.glowstickHeavyLaserEnabled;
    const useBatonCrescent = heavy
      && weapon.id === 'baton'
      && this.tuningEditor.batonHeavyCrescentEnabled;
    if (useGlowstickLaser) {
      this.spawnGlowstickLaser(
        glowstickEmitter.x,
        glowstickEmitter.y,
        angle,
        tunedDamage,
        onBeat
      );
    } else if (useBatonCrescent) {
      this.spawnBatonCrescent(
        attackOrigin.x,
        attackOrigin.y,
        angle,
        tunedDamage,
        onBeat
      );
    } else for (const attackAngle of attackAngles) {
      if (weapon.id === 'baton') {
        this.spawnBatonSweep(
          attackOrigin.x,
          attackOrigin.y,
          attackAngle,
          tunedDamage,
          projectileCount,
          heavy,
          onBeat,
          projectileLengthScale,
          batonSweepScale
        );
      } else {
        this.spawnPlayerShotgun(
          glowstickEmitter.x,
          glowstickEmitter.y,
          attackAngle,
          heavy ? 560 : 480,
          tunedDamage,
          PLAYER_BULLET_COLOR,
          projectileCount,
          onBeat,
          projectileLengthScale,
          projectileRangeScale,
          0
        );
      }
    }

    // Fever Time：每次成功攻击额外释放清屏音波（轻=扇形，重=全圆）
    if (onBeat && this.combo.feverActive()) {
      if (heavy) {
        this.spawnSoundWave(attackOrigin.x, attackOrigin.y, angle, 180, 190, 14 * mult);
      } else {
        this.spawnSoundWave(attackOrigin.x, attackOrigin.y, angle, 55, 230, 10 * mult);
      }
    }
  }

  /**
   * 踩拍攻击的强调反馈：警棍保留局部冲击环，荧光棒只强化实际线性亮芯；
   * 两者继续保留音符与相机微推拉，避免荧光棒尖端附近出现错位的圆形叠层。
   */
  private spawnOnBeatAttackFx(
    x: number,
    y: number,
    heavy: boolean,
    color: number,
    showRadialBurst: boolean,
    useCameraPunch = true
  ): void {
    if (showRadialBurst) {
      const outer = this.add.circle(x, y, 16).setStrokeStyle(heavy ? 5 : 4, color, 0.95).setDepth(6);
      const inner = this.add
        .circle(x, y, 10)
        .setStrokeStyle(3, this.mixColorWithWhite(color, 0.66), 0.9)
        .setDepth(6);
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
    }

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

    // 相机微推拉只用于非警棍攻击。警棍扫击自身已经持续重绘，
    // 叠加镜头缩放会让跟随移动看起来发生短促回拉。
    if (useCameraPunch) {
      const cam = this.cameras.main;
      this.tweens.killTweensOf(cam);
      cam.setZoom(MAIN_CAMERA_BASE_ZOOM);
      this.tweens.add({
        targets: cam,
        zoom: MAIN_CAMERA_BASE_ZOOM * (heavy ? 1.01875 : 1.00375),
        duration: 60,
        yoyo: true,
        ease: 'Quad.easeOut'
      });
    }
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
    const gfx = this.add.graphics().setDepth(6).setBlendMode(Phaser.BlendModes.NORMAL).enableFilters();
    const filters = gfx.filters;
    if (filters) {
      const glow = filters.internal.addGlow(0xf97316, 0.52, 0.08, 1, false, 2, worldSize(26));
      glow.setPaddingOverride(null);
      const bloom = filters.internal.addParallelFilters();
      bloom.top.addThreshold(0.04, 1);
      bloom.top.addBlur(2, 11, 11, 0.42, 0xf97316, 3);
      bloom.blend.blendMode = Phaser.BlendModes.ADD;
      bloom.blend.amount = 0.14;
    }
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
        const waveAlpha = 1 - counter.value * 0.8;
        const strokeWave = (): void => {
          if (full) {
            gfx.strokeCircle(x, y, radius);
          } else {
            gfx.beginPath();
            gfx.arc(x, y, radius, angle - halfRad, angle + halfRad, false);
            gfx.strokePath();
          }
        };
        gfx.clear();
        gfx.lineStyle(worldSize(5), 0xf97316, waveAlpha * 0.78);
        strokeWave();
        gfx.lineStyle(worldSize(2), this.mixColorWithWhite(0xf97316, 0.52), waveAlpha * 0.82);
        strokeWave();
        // 波前清弹
        for (const obj of this.bullets.getChildren().slice()) {
          const bullet = obj as Phaser.GameObjects.Rectangle;
          if (inSector(bullet.x, bullet.y, radius)) this.destroyEnemyBullet(bullet);
        }
        // 波前伤害（每个敌人只结算一次）
        for (const enemy of [...this.enemies, ...this.tutorialCharacters]) {
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
    for (const enemy of [...this.enemies, ...this.tutorialCharacters]) {
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

  spawnBullet(
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    sourceKind: EnemyKind,
    straightShot = false,
    visualScale = 1,
    _despawnBeats = 8,
    bossStyle: BossProjectileStyle = 'triple',
    tutorialPink = false
  ): Phaser.GameObjects.Rectangle {
    const speedMultiplier = straightShot ? this.tuningEditor.enemyStraightBulletSpeedMultiplier : 1;
    const fanOrbDiameter = worldSize(9);
    const displayColor = tutorialPink
      ? 0xec4899
      : sourceKind === 'fan'
      ? FAN_BULLET_COLOR
      : sourceKind === 'bossGuard'
        ? bossStyle === 'note' ? BOSS_NOTE_BULLET_COLOR : BOSS_TRIPLE_BULLET_COLOR
        : GUARD_BULLET_COLOR;
    const baseDiameter = sourceKind === 'fan' ? fanOrbDiameter : ENEMY_BULLET_THICKNESS;
    const visualDiameter = baseDiameter * visualScale;
    const compositeDiameter = visualDiameter * 0.96 + ENEMY_PROJECTILE_GLOW_DISTANCE * 2;
    const bullet = this.add
      .rectangle(x, y, ENEMY_BULLET_THICKNESS, ENEMY_BULLET_THICKNESS, displayColor, 0)
      .setRotation(angle)
      .setDepth(4);
    const projectileVisual = this.add
      .image(x, y, this.ensureEnemyProjectileTexture(sourceKind, visualDiameter, bossStyle, tutorialPink))
      .setDisplaySize(compositeDiameter, compositeDiameter)
      .setDepth(4)
      .setBlendMode(Phaser.BlendModes.NORMAL);
    this.bullets.add(bullet);
    const body = bullet.body as Phaser.Physics.Arcade.Body;
    const hitboxSize = (sourceKind === 'fan' ? fanOrbDiameter : ENEMY_BULLET_THICKNESS) * visualScale;
    const hitboxLength = (sourceKind === 'fan' ? fanOrbDiameter : ENEMY_BULLET_LENGTH) * visualScale;
    body.setSize(hitboxSize, hitboxSize, true);
    body.setVelocity(Math.cos(angle) * speed * speedMultiplier, Math.sin(angle) * speed * speedMultiplier);
    bullet.setData('damage', damage);
    bullet.setData('angle', angle);
    bullet.setData('baseSpeed', speed * speedMultiplier);
    bullet.setData('straightShot', straightShot);
    bullet.setData('sourceKind', sourceKind);
    bullet.setData('tutorialAttack', tutorialPink);
    bullet.setData('visualColor', displayColor);
    bullet.setData('despawnBeat', Infinity);
    bullet.setData('projectileVisual', projectileVisual);
    bullet.setData('baseVisualDiameter', visualDiameter);
    bullet.setData('baseCompositeDiameter', compositeDiameter);
    bullet.setData('baseHitboxSize', hitboxSize);
    bullet.setData('baseHitboxLength', hitboxLength);
    bullet.setData('trailColor', displayColor);
    bullet.setData('trailThickness', hitboxSize);
    bullet.setData('bursting', this.tuningEditor.enemyBulletBeatSurgeEnabled);
    bullet.setData('hitboxMode', 'straight');
    bullet.setData('hitboxLength', hitboxLength);
    bullet.setData('hitboxSize', hitboxSize);
    bullet.setData('hitboxAngle', angle);
    this.createBulletHitboxes(bullet, this.enemyBulletHitboxes, hitboxSize);
    this.applyEnemyBulletSize(bullet);
    this.positionStraightBulletHitboxes(
      bullet,
      bullet.getData('hitboxLength') as number,
      bullet.getData('hitboxSize') as number,
      angle
    );
    return bullet;
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
      if (bullet.getData('bossSpecialProjectile')) continue;
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      const angle = bullet.getData('angle') as number;
      const sourceKind = bullet.getData('sourceKind') as EnemyKind;

      const speedMultiplier = bullet.getData('straightShot')
        ? this.tuningEditor.enemyStraightBulletSpeedMultiplier
        : 1;
      const baseSpeed = this.getEnemyBulletSpeed(sourceKind) * speedMultiplier;
      bullet.setData('baseSpeed', baseSpeed);
      const speed = this.tuningEditor.enemyBulletBeatSurgeEnabled
        ? baseSpeed * normalizedSpeedMultiplier
        : baseSpeed;
      body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      bullet.setData('bursting', this.tuningEditor.enemyBulletBeatSurgeEnabled && touchesSurgeWindow);
    }
  }

  spawnEnemyProjectile(
    x: number,
    y: number,
    angle: number,
    sourceKind: EnemyKind,
    tutorialPink = false
  ): void {
    const shotAngle = this.quantizeEnemyAttackAngle(angle);
    const attackAngles: number[] = [];
    const isSpreadAttack = sourceKind === 'fan'
      && !tutorialPink
      && Math.random() < this.tuningEditor.fanSpiralAttackChance;
    if (isSpreadAttack) {
      const ballsPerArc = 10;
      const arcSpan = Phaser.Math.DegToRad(54);
      for (let arcIndex = 0; arcIndex < 3; arcIndex += 1) {
        const arcCenter = shotAngle + Phaser.Math.DegToRad(arcIndex * 120);
        for (let ballIndex = 0; ballIndex < ballsPerArc; ballIndex += 1) {
          const arcProgress = ballIndex / (ballsPerArc - 1) - 0.5;
          attackAngles.push(arcCenter + arcProgress * arcSpan);
        }
      }
    } else {
      attackAngles.push(shotAngle);
    }
    const spawnRadius = sourceKind === 'fan' ? worldSize(8) : worldSize(26);
    for (const attackAngle of attackAngles) {
      this.spawnBullet(
        x + Math.cos(attackAngle) * spawnRadius,
        y + Math.sin(attackAngle) * spawnRadius,
        attackAngle,
        this.getEnemyBulletSpeed(sourceKind),
        this.tuningEditor.getEnemyProjectileDamage(sourceKind),
        sourceKind,
        !isSpreadAttack,
        1,
        8,
        'triple',
        tutorialPink
      );
    }
  }

  private updateSpecialEnemyProjectiles(): void {
    for (const obj of this.bullets.getChildren()) {
      const sync = obj.getData('syncSpecialProjectile') as (() => void) | undefined;
      sync?.();
    }
  }

  spawnBossTripleShot(x: number, y: number, angle: number): void {
    const fire = (shotIndex: number): void => {
      if (this.state !== 'playing') return;
      const config = this.getBossCombatConfig();
      const aimedAngle = shotIndex === 0
        ? angle
        : Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
      const muzzle = worldSize(72);
      const bullet = this.spawnBullet(
        x + Math.cos(aimedAngle) * muzzle,
        y + Math.sin(aimedAngle) * muzzle,
        aimedAngle,
        config.projectileSpeed,
        config.projectileDamage,
        'bossGuard',
        false,
        3,
        18,
        'triple'
      );
      bullet.setData('bossSpecialProjectile', true);
    };
    fire(0);
    this.time.delayedCall(180, () => fire(1));
    this.time.delayedCall(360, () => fire(2));
  }

  spawnBossCrescentWave(x: number, y: number, angle: number): void {
    const config = this.getBossCombatConfig();
    const radius = worldSize(100);
    const owner = this.add.rectangle(x, y, 8, 8, 0xffffff, 0).setDepth(5);
    const visual = this.add.graphics({ x, y }).setDepth(5).setRotation(angle);
    visual.lineStyle(worldSize(25), 0x4c1d95, 0.3);
    visual.beginPath();
    visual.arc(0, 0, radius, -1.18, 1.18, false);
    visual.strokePath();
    visual.lineStyle(worldSize(9), BOSS_CRESCENT_COLOR, 0.92);
    visual.beginPath();
    visual.arc(0, 0, radius, -1.18, 1.18, false);
    visual.strokePath();
    visual.lineStyle(worldSize(3), 0xf3e8ff, 0.9);
    visual.beginPath();
    visual.arc(0, 0, radius, -1.18, 1.18, false);
    visual.strokePath();
    this.bullets.add(owner);
    const hitboxes: Phaser.GameObjects.Rectangle[] = [];
    for (let index = 0; index < 7; index++) {
      const hitbox = this.add.rectangle(x, y, worldSize(30), worldSize(30), 0xffffff, 0);
      this.enemyBulletHitboxes.add(hitbox);
      hitbox.setData('ownerBullet', owner);
      hitboxes.push(hitbox);
    }
    owner.setData('damage', config.projectileDamage);
    owner.setData('sourceKind', 'bossGuard');
    owner.setData('visualColor', BOSS_CRESCENT_COLOR);
    owner.setData('projectileVisual', visual);
    owner.setData('hitboxes', hitboxes);
    owner.setData('despawnBeat', Infinity);
    owner.setData('bossSpecialProjectile', true);
    owner.setData('skipTrail', true);
    const positionParts = (): void => {
      visual.setPosition(owner.x, owner.y);
      hitboxes.forEach((hitbox, index) => {
        if (!hitbox.active) return;
        const sampleAngle = angle - 1.18 + (2.36 * index) / (hitboxes.length - 1);
        const hx = owner.x + Math.cos(sampleAngle) * radius;
        const hy = owner.y + Math.sin(sampleAngle) * radius;
        hitbox.setPosition(hx, hy);
        (hitbox.body as Phaser.Physics.Arcade.Body).reset(hx, hy);
      });
    };
    positionParts();
    (owner.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(angle) * config.crescentSpeed,
      Math.sin(angle) * config.crescentSpeed
    );
    owner.setData('syncSpecialProjectile', positionParts);
  }

  spawnBossStomp(x: number, y: number): void {
    const config = this.getBossCombatConfig();
    const ring = this.add.graphics().setDepth(6);
    const progress = { value: 0 };
    let resolved = false;
    this.tweens.add({
      targets: progress,
      value: 1,
      duration: 460,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        const radius = worldSize(30) + progress.value * (config.stompRadius - worldSize(30));
        ring.clear();
        ring.lineStyle(worldSize(18), 0x7f1d1d, (1 - progress.value) * 0.32);
        ring.strokeCircle(x, y, radius);
        ring.lineStyle(worldSize(5), 0xff7a72, 1 - progress.value * 0.75);
        ring.strokeCircle(x, y, radius);
        if (!resolved && Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) <= radius + this.player.body.halfWidth) {
          resolved = true;
          const knockbackAngle = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
          this.player.takeDamage(config.projectileDamage);
          this.player.applyKnockback(knockbackAngle, config.stompKnockback);
        }
      },
      onComplete: () => ring.destroy()
    });
  }

  spawnBossNoteFormation(): void {
    const config = this.getBossCombatConfig();
    const points = new Set<string>();
    const add = (column: number, row: number): void => { points.add(`${column},${row}`); };
    for (let row = 0; row <= 10; row++) add(8, row);
    for (let column = 2; column <= 8; column++) add(column, 1);
    for (let row = 1; row <= 7; row++) add(2, row);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= 2) {
          add(2 + dx, 8 + dy);
          add(8 + dx, 11 + dy);
        }
      }
    }
    const spacing = worldSize(31);
    const startX = ARENA.x + ARENA.width + worldSize(90);
    const topY = ARENA.y + ARENA.height / 2 - worldSize(190);
    for (const encoded of points) {
      const [column, row] = encoded.split(',').map(Number);
      const bullet = this.spawnBullet(
        startX + column * spacing,
        topY + row * spacing,
        Math.PI,
        config.noteFormationSpeed,
        config.projectileDamage,
        'bossGuard',
        false,
        config.noteFormationBulletSize,
        64,
        'note'
      );
      bullet.setData('bossSpecialProjectile', true);
    }
  }

  private spawnPlayerShotgun(
    emitterX: number,
    emitterY: number,
    angle: number,
    _speed: number,
    damage: number,
    color: number,
    pelletCount: number,
    onBeat = false,
    lengthScale = 1,
    rangeScale = 1,
    knockbackSpeed = 0
  ): void {
    const bulletLength = PLAYER_BULLET_LENGTH * lengthScale;
    const offsets = Array.from({ length: pelletCount }, (_, index) => {
      if (index === 0) return 0;
      const side = index % 2 === 1 ? -1 : 1;
      return side * Math.ceil(index / 2) * 7.5;
    });
    for (const offset of offsets) {
      const shotAngle = angle + Phaser.Math.DegToRad(offset);
      const directionX = Math.cos(shotAngle);
      const directionY = Math.sin(shotAngle);
      const visualStartX = emitterX + directionX * PLAYER_STRAIGHT_MUZZLE_GAP;
      const visualStartY = emitterY + directionY * PLAYER_STRAIGHT_MUZZLE_GAP;
      // 判定段仍从武器端前置后的点开始，宿主位于原判定段中点；
      // 可见胶囊稍后仅向前端内收并锁住既有尾端，不改变宿主或三点方盒覆盖。
      const spawnX = visualStartX + directionX * bulletLength * 0.5;
      const spawnY = visualStartY + directionY * bulletLength * 0.5;
      const bullet = this.add.rectangle(
        spawnX,
        spawnY,
        bulletLength,
        BULLET_THICKNESS,
        color,
        0
      )
        .setDisplaySize(
          bulletLength * PLAYER_LINE_CORE_LENGTH_SCALE,
          BULLET_THICKNESS * PLAYER_LINE_CORE_THICKNESS_SCALE
        )
        .setRotation(shotAngle)
        .setDepth(4);
      const projectileVisual = this.add
        .image(spawnX, spawnY, this.ensurePlayerProjectileTexture(onBeat))
        .setDisplaySize(
          bulletLength * PLAYER_LINE_GLOW_LENGTH_SCALE,
          BULLET_THICKNESS * PLAYER_LINE_GLOW_THICKNESS_SCALE
        )
        .setRotation(shotAngle)
        .setBlendMode(Phaser.BlendModes.NORMAL)
        .setDepth(4);
      this.playerBullets.add(bullet);
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      body.setSize(BULLET_THICKNESS, BULLET_THICKNESS, true);
      const velocity = this.physics.velocityFromRotation(shotAngle, this.tuningEditor.glowstickBulletSpeed);
      body.setVelocity(velocity.x, velocity.y);
      bullet.setData('damage', damage);
      bullet.setData('despawnBeat', Infinity);
      bullet.setData('launchX', spawnX);
      bullet.setData('launchY', spawnY);
      bullet.setData(
        'maxTravelDistance',
        this.tuningEditor.glowstickInfiniteRange
          ? Infinity
          : this.tuningEditor.glowstickMaxRange * rangeScale
      );
      bullet.setData('visualColor', color);
      bullet.setData('projectileVisual', projectileVisual);
      const visualCenterOffset =
        -bulletLength * (PLAYER_LINE_CORE_LENGTH_SCALE - PLAYER_LINE_VISIBLE_LENGTH_SCALE) * 0.5;
      bullet.setData('projectileVisualOffsetX', directionX * visualCenterOffset);
      bullet.setData('projectileVisualOffsetY', directionY * visualCenterOffset);
      bullet.setData('fpvDisplayWidth', bulletLength * PLAYER_LINE_VISIBLE_LENGTH_SCALE);
      bullet.setData('fpvDisplayHeight', BULLET_THICKNESS * PLAYER_LINE_CORE_THICKNESS_SCALE);
      bullet.setData('trailColor', color);
      bullet.setData('trailThickness', BULLET_THICKNESS);
      bullet.setData('knockbackAngle', shotAngle);
      bullet.setData('knockbackSpeed', knockbackSpeed);
      bullet.setData('hitboxMode', 'straight');
      bullet.setData('hitboxLength', bulletLength);
      bullet.setData('hitboxSize', BULLET_THICKNESS);
      bullet.setData('hitboxAngle', shotAngle);
      this.createBulletHitboxes(bullet, this.playerBulletHitboxes, BULLET_THICKNESS);
      this.positionStraightBulletHitboxes(bullet, bulletLength, BULLET_THICKNESS, shotAngle);
    }
  }

  private spawnBatonSweep(
    originX: number,
    originY: number,
    aimAngle: number,
    damage: number,
    bulletCount: number,
    heavy: boolean,
    onBeat = false,
    lengthScale = 1,
    sweepScale = 1
  ): void {
    const clockwise = !heavy;
    const lightHalfSweep = Phaser.Math.DegToRad(this.tuningEditor.batonLightSweepAngle / 2);
    const halfSweep = (heavy ? Math.PI / 3 : lightHalfSweep) * sweepScale;
    const startAngle = aimAngle + (clockwise ? -halfSweep : halfSweep);
    const endAngle = aimAngle + (clockwise ? halfSweep : -halfSweep);
    const middleRadius = heavy ? worldSize(74 * 1.25) : this.tuningEditor.batonLightSweepRange;
    const layerSpacing = worldSize(20 * 1.15);
    const layerTemplates = [
      { radius: middleRadius, lengthScale: 1 },
      { radius: middleRadius - layerSpacing, lengthScale: 0.5 },
      { radius: middleRadius + layerSpacing, lengthScale: 1.5 }
    ];
    const activeLayers = layerTemplates.slice(0, Phaser.Math.Clamp(bulletCount, 1, 3));
    const baseLength = worldSize((heavy ? 62 : 46) * 1.5);
    const bullets = activeLayers.map(({ radius, lengthScale: layerLengthScale }) => {
      const arcLength = baseLength * layerLengthScale * lengthScale;
      const halfArcAngle = arcLength / (2 * radius);
      const glowVisual = this.add
        .graphics()
        .setDepth(3.999)
        .setBlendMode(Phaser.BlendModes.ADD);
      const visual = this.add
        .graphics()
        .setDepth(4)
        .setBlendMode(Phaser.BlendModes.NORMAL);
      const bullet = this.add
        .rectangle(originX, originY, arcLength, BULLET_THICKNESS + 4, BATON_BULLET_COLOR, 0)
        .setDepth(4);
      this.playerBullets.add(bullet);
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      body.setSize(arcLength, BULLET_THICKNESS + 4);
      body.setVelocity(0, 0);
      bullet.setData('damage', damage);
      bullet.setData('despawnBeat', Infinity);
      bullet.setData('batonVisual', visual);
      bullet.setData('batonGlowVisual', glowVisual);
      bullet.setData('trailColor', BATON_BULLET_COLOR);
      bullet.setData('trailThickness', BULLET_THICKNESS + 4);
      // 扫击 Graphics 已连续绘制整条弧线；再为每一帧生成运动尾迹只会
      // 制造大量短命对象，且不会增加可读性。
      bullet.setData('skipTrail', true);
      bullet.setData('knockbackSpeed', heavy ? BATON_HEAVY_KNOCKBACK_SPEED : BATON_KNOCKBACK_SPEED);
      bullet.setData('hitboxMode', 'arc');
      this.createBulletHitboxes(bullet, this.playerBulletHitboxes, BULLET_THICKNESS);
      return { bullet, visual, glowVisual, radius, halfArcAngle };
    });

    const sweep = { progress: 0 };
    const updatePositions = (): void => {
      const angle = Phaser.Math.Linear(startAngle, endAngle, sweep.progress);
      for (const { bullet, visual, glowVisual, radius, halfArcAngle } of bullets) {
        if (!bullet.active) continue;
        const x = originX + Math.cos(angle) * radius;
        const y = originY + Math.sin(angle) * radius;
        const bodyAngle = angle + Math.PI / 2;
        bullet.setPosition(x, y).setRotation(bodyAngle);
        (bullet.body as Phaser.Physics.Arcade.Body).reset(x, y);
        this.positionArcBulletHitboxes(bullet, originX, originY, radius, angle, halfArcAngle);
        bullet.setData('knockbackAngle', angle + (clockwise ? Math.PI / 2 : -Math.PI / 2));
        glowVisual.clear();
        glowVisual.lineStyle(
          BULLET_THICKNESS * 2.4,
          BATON_BULLET_COLOR,
          onBeat ? 0.07 : 0.05
        );
        glowVisual.beginPath();
        glowVisual.arc(originX, originY, radius, angle - halfArcAngle, angle + halfArcAngle, false);
        glowVisual.strokePath();
        visual.clear();
        // 主体使用正常混合保留实色轮廓；单独的低 Alpha ADD 线只负责贴边泛光。
        // 仍不为每条弧线创建实时滤镜，避免高 Combo 时打断主循环。
        visual.lineStyle(BULLET_THICKNESS, BATON_BULLET_COLOR, 0.9);
        visual.beginPath();
        visual.arc(originX, originY, radius, angle - halfArcAngle, angle + halfArcAngle, false);
        visual.strokePath();
        visual.lineStyle(
          BULLET_THICKNESS * 0.3,
          this.mixColorWithWhite(BATON_BULLET_COLOR, onBeat ? 0.72 : 0.56),
          onBeat ? 0.9 : 0.82
        );
        visual.beginPath();
        visual.arc(originX, originY, radius, angle - halfArcAngle, angle + halfArcAngle, false);
        visual.strokePath();
      }
    };
    updatePositions();
    this.tweens.add({
      targets: sweep,
      progress: 1,
      duration: 150 / this.tuningEditor.batonSweepSpeed,
      ease: 'Linear',
      onUpdate: updatePositions,
      onComplete: () => {
        for (const { bullet } of bullets) {
          if (bullet.active) this.destroyPlayerBullet(bullet);
        }
      }
    });
  }

  /**
   * 保留既有运动尾迹的尺寸、生成频率和寿命；只把合成改为 ADD，
   * 使尾迹与迁移后的自发光配色自然融合。
   */
  private updateBulletTrails(deltaMs: number): void {
    const now = this.time.now;
    const dt = Math.max(deltaMs, 1) / 1000;
    for (const group of [this.bullets, this.playerBullets]) {
      for (const obj of group.getChildren()) {
        const bullet = obj as Phaser.GameObjects.Rectangle;
        if (bullet.getData('skipTrail')) continue;
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
        const alpha = Phaser.Math.Clamp(0.03 + speed / 8000, 0.04, 0.09);
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
          .setDepth(3)
          .setBlendMode(Phaser.BlendModes.ADD);
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
    const batonVisual = bullet.getData('batonVisual') as Phaser.GameObjects.Graphics | undefined;
    if (batonVisual?.active) batonVisual.destroy();
    const batonGlowVisual = bullet.getData('batonGlowVisual') as Phaser.GameObjects.Graphics | undefined;
    if (batonGlowVisual?.active) batonGlowVisual.destroy();
    const projectileVisual = bullet.getData('projectileVisual') as Phaser.GameObjects.Image | undefined;
    if (projectileVisual?.active) projectileVisual.destroy();
    this.destroyBulletHitboxes(bullet);
    if (bullet.active) bullet.destroy();
  }


  private destroyEnemyBullet(bullet: Phaser.GameObjects.Rectangle): void {
    const heldTrail = bullet.getData('heldTrail') as Phaser.GameObjects.Rectangle | undefined;
    if (heldTrail?.active) heldTrail.destroy();
    const projectileVisual = bullet.getData('projectileVisual') as Phaser.GameObjects.GameObject | undefined;
    this.tweens.killTweensOf(bullet);
    if (projectileVisual) this.tweens.killTweensOf(projectileVisual);
    if (projectileVisual?.active) projectileVisual.destroy();
    this.destroyBulletHitboxes(bullet);
    if (bullet.active) bullet.destroy();
  }

  private clearAllProjectiles(): void {
    for (const effect of [...this.activeSpecialAttackFx]) {
      this.destroySpecialAttackFx(effect);
    }
    for (const obj of this.playerBullets.getChildren().slice()) {
      this.destroyPlayerBullet(obj as Phaser.GameObjects.Rectangle);
    }
    for (const obj of this.bullets.getChildren().slice()) {
      this.destroyEnemyBullet(obj as Phaser.GameObjects.Rectangle);
    }
    this.playerBulletHitboxes.clear(true, true);
    this.enemyBulletHitboxes.clear(true, true);
  }

  /** 将弹体颜色向白色抬亮，保留色相并给 Glow 留出自然的亮芯。 */
  private mixColorWithWhite(color: number, amount: number): number {
    const ratio = Phaser.Math.Clamp(amount, 0, 1);
    const red = (color >> 16) & 0xff;
    const green = (color >> 8) & 0xff;
    const blue = color & 0xff;
    return (
      Math.round(Phaser.Math.Linear(red, 255, ratio)) << 16
      | Math.round(Phaser.Math.Linear(green, 255, ratio)) << 8
      | Math.round(Phaser.Math.Linear(blue, 255, ratio))
    );
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
        .rectangle(
          x,
          y,
          worldSize(strong ? 12 : 8),
          worldSize(3),
          i % 2 === 0 ? color : this.mixColorWithWhite(color, 0.58)
        )
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

  /** 敌人死亡时在尸体位置播放一次性爆炸粒子与冲击环。 */
  spawnEnemyDeathExplosion(x: number, y: number, kind: EnemyKind): void {
    const primaryColor = kind === 'fan' ? 0xff7832 : 0x52efff;
    const hotColor = kind === 'fan' ? 0xffb54a : 0xb7f7ff;
    const white = 0xffffff;

    // 两层冲击环：一层冷白快波，一层主色慢波。
    [
      { radius: 12, width: 5, color: white, scale: 4.4, duration: 240 },
      { radius: 20, width: 9, color: primaryColor, scale: 5.6, duration: 420 }
    ].forEach((ringConfig, index) => {
      const ring = this.add
        .circle(x, y, worldSize(ringConfig.radius))
        .setStrokeStyle(worldSize(ringConfig.width), ringConfig.color, 0.95)
        .setDepth(8)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: ring,
        scale: ringConfig.scale,
        alpha: 0,
        duration: ringConfig.duration,
        delay: index * 35,
        ease: 'Quad.easeOut',
        onComplete: () => ring.destroy()
      });
    });

    // 放射状长条溅射，方向随机、长短随机，比单纯圆点更接近爆炸碎片。
    const splashCount = 18;
    for (let i = 0; i < splashCount; i++) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = worldSize(Phaser.Math.FloatBetween(90, 190));
      const length = worldSize(Phaser.Math.FloatBetween(28, 58));
      const width = worldSize(Phaser.Math.FloatBetween(4, 8));
      const color = i % 3 === 0 ? white : i % 3 === 1 ? hotColor : primaryColor;
      const shard = this.add
        .rectangle(x, y, length, width, color, 1)
        .setRotation(angle)
        .setDepth(9)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: shard,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: 0.18,
        duration: Phaser.Math.Between(260, 430),
        ease: 'Expo.easeOut',
        onComplete: () => shard.destroy()
      });
    }

    // 主爆炸烟 / 火球粒子：数量更多、扩散更快。
    const fireEmitter = this.add
      .particles(x, y, '__WHITE', {
        speed: { min: 180, max: 560 },
        lifespan: { min: 400, max: 820 },
        scale: { start: 1, end: 0 },
        alpha: { start: 1, end: 0 },
        angle: { min: 0, max: 360 },
        quantity: 1,
        emitting: false,
        color: [primaryColor, hotColor, 0xffe08a, white],
        blendMode: Phaser.BlendModes.ADD
      })
      .setDepth(8);
    fireEmitter.explode(54);

    // 第二层高速火花，形成更明显的溅射拖尾。
    const sparkEmitter = this.add
      .particles(x, y, '__WHITE', {
        speed: { min: 320, max: 760 },
        lifespan: { min: 220, max: 430 },
        scale: { start: 0.42, end: 0 },
        alpha: { start: 1, end: 0 },
        angle: { min: 0, max: 360 },
        quantity: 1,
        emitting: false,
        color: [white, hotColor],
        blendMode: Phaser.BlendModes.ADD
      })
      .setDepth(9);
    sparkEmitter.explode(30);

    this.time.delayedCall(900, () => {
      if (fireEmitter.active) fireEmitter.destroy();
      if (sparkEmitter.active) sparkEmitter.destroy();
    });
  }

  /** 正确踩拍时叠加一次比普通拍点更粗、更亮并向外淡出的场地框反馈。 */
  private flashArenaCorrectJudgement(heavy: boolean): void {
    if (this.state !== 'tutorial' && this.state !== 'playing' && this.state !== 'intermission') return;
    const baseColor = heavy ? ARENA_BEAT_HEAVY_COLOR : ARENA_BEAT_LIGHT_COLOR;
    const color = this.interpolateRgb(baseColor, 0xffffff, this.arenaRhythmIntensity * 0.35);
    this.tweens.killTweensOf(this.arenaCorrectFeedback);
    const baseWidth = (heavy ? 11 : 8) * 2 + this.arenaRhythmIntensity * 8;
    this.arenaCorrectFeedback
      .setVisible(true)
      .setScale(1)
      .setAlpha(0.5)
      .setStrokeStyle(baseWidth, color, 1);
    this.tweens.add({
      targets: this.arenaCorrectFeedback,
      scale: heavy ? 1.035 : 1.025,
      alpha: 0,
      duration: heavy ? 310 : 240,
      ease: 'Quad.easeOut',
      onComplete: () => this.arenaCorrectFeedback.setVisible(false).setScale(1)
    });
    this.tweens.addCounter({
      from: baseWidth,
      // 重拍框末端不再继续膨胀到 1.5x；收至此前最终粗度的 75%。
      to: baseWidth * (heavy ? 1.125 : 1.5),
      duration: heavy ? 310 : 240,
      ease: 'Quad.easeOut',
      onUpdate: (tween) => this.arenaCorrectFeedback.setStrokeStyle(tween.getValue() ?? baseWidth, color, 1)
    });
    // 仅重拍判定正确时触发完整的边缘粒子/光屑冲击。
    if (heavy) this.spawnComboBorderSplash(true);
  }

  private registerRhythmHit(globalBeat: number, heavy: boolean): void {
    this.rhythmComboStreak = globalBeat === this.lastRhythmHitBeat + 1
      ? this.rhythmComboStreak + 1
      : 1;
    this.lastRhythmHitBeat = globalBeat;
    this.arenaRhythmIntensity = Phaser.Math.Clamp(
      this.arenaRhythmIntensity + 0.24 + Math.min(this.rhythmComboStreak, 4) * 0.025,
      0,
      1
    );
    if (heavy) this.arenaRhythmIntensity = 1;
  }

  private breakRhythmCombo(dimImmediately = true): void {
    this.rhythmComboStreak = 0;
    if (dimImmediately) this.arenaRhythmIntensity *= 0.45;
  }

  private updateArenaRhythmIntensity(deltaMs: number): void {
    if (this.state === 'over' || this.state === 'title') return;
    const fadePerSecond = 0.18 / Math.max(this.conductor.beatDur, 0.001);
    this.arenaRhythmIntensity = Math.max(
      0,
      this.arenaRhythmIntensity - fadePerSecond * Math.max(0, deltaMs) / 1000
    );
  }

  /** 正确重拍：保留判定框的原有光屑、冲击框与光带。 */
  private spawnComboBorderSplash(heavy: boolean): void {
    const colors = heavy
      ? [ARENA_BEAT_HEAVY_COLOR, 0xfbbf24, 0xffffff]
      : [ARENA_BEAT_LIGHT_COLOR, 0x67e8f9, 0xffffff];
    const impactColor = heavy ? ARENA_BEAT_HEAVY_COLOR : ARENA_BEAT_LIGHT_COLOR;
    const centerX = SCREEN_ARENA_CENTER_X;
    const centerY = SCREEN_ARENA_CENTER_Y;
    // 判定框四边原有光屑与星爆不受场景物件顶部节拍粒子影响。
    const particleCount = 84;
    for (let index = 0; index < particleCount; index++) {
      const edge = index % 4;
      const along = Phaser.Math.FloatBetween(0.015, 0.985);
      let x = ARENA.x;
      let y = ARENA.y;
      let nx = -1;
      let ny = 0;
      if (edge === 0) {
        y += ARENA.height * along;
      } else if (edge === 1) {
        x += ARENA.width;
        y += ARENA.height * along;
        nx = 1;
      } else if (edge === 2) {
        x += ARENA.width * along;
        nx = 0;
        ny = -1;
      } else {
        x += ARENA.width * along;
        y += ARENA.height;
        nx = 0;
        ny = 1;
      }
      const tangentX = -ny;
      const tangentY = nx;
      // 顶边靠近屏幕边缘，主要向场内喷射；其余边缘保留向内 / 向外的层次。
      const edgeSequence = Math.floor(index / 4);
      const inward = edge === 2 ? edgeSequence % 4 !== 0 : edgeSequence % 4 === 0;
      const normalDirection = inward ? -1 : 1;
      const spread = Phaser.Math.FloatBetween(-68, 68);
      const distance = inward
        ? Phaser.Math.FloatBetween(42, heavy ? 118 : 96)
        : Phaser.Math.FloatBetween(edge === 2 ? 20 : 64, heavy ? 156 : 132);
      // 少量粒子随机升级为更远、更粗、更亮的烟花主束；其余保持细小，避免整屏同质爆炸。
      const firework = heavy && Math.random() < 0.16;
      const burstDistance = firework ? distance * Phaser.Math.FloatBetween(1.65, 2.15) : distance;
      const length = firework
        ? Phaser.Math.FloatBetween(74, 138)
        : Phaser.Math.FloatBetween(18, heavy ? 52 : 44);
      const shard = this.add
        .rectangle(
          x,
          y,
          length,
          firework ? Phaser.Math.FloatBetween(9, 16) : Phaser.Math.FloatBetween(4, 10),
          Phaser.Utils.Array.GetRandom(colors),
          firework ? 1 : inward ? 0.82 : 1
        )
        .setRotation(Math.atan2(ny * normalDirection, nx * normalDirection) + Phaser.Math.FloatBetween(-0.6, 0.6))
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(9 + (inward ? 0.02 : 0));
      this.tweens.add({
        targets: shard,
        x: x + nx * burstDistance * normalDirection + tangentX * spread,
        y: y + ny * burstDistance * normalDirection + tangentY * spread,
        scaleX: 0.08,
        scaleY: 0.2,
        alpha: 0,
        angle: shard.angle + Phaser.Math.Between(-85, 85),
        delay: (index % 3) * 28 + Phaser.Math.Between(0, 55),
        duration: Phaser.Math.Between(firework ? 620 : 440, firework ? 980 : heavy ? 820 : 700),
        ease: 'Expo.easeOut',
        onComplete: () => shard.destroy()
      });
    }

    // 两层边框波一快一慢拉开，避免大量光屑只形成一瞬间的噪点。
    [
      { color: 0xffffff, width: heavy ? 36 : 30, startScale: 0.985, endScale: 1.035, delay: 0, duration: 380 },
      { color: impactColor, width: heavy ? 28 : 24, startScale: 1, endScale: 1.065, delay: 65, duration: 620 }
    ].forEach((pulseConfig) => {
      const pulse = this.add
        .rectangle(centerX, centerY, SCREEN_ARENA_WIDTH, SCREEN_ARENA_HEIGHT)
        .setStrokeStyle(pulseConfig.width, pulseConfig.color, 1)
        .setScale(pulseConfig.startScale)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(9.1)
        .setScrollFactor(0);
      this.tweens.add({
        targets: pulse,
        scale: pulseConfig.endScale,
        alpha: 0,
        delay: pulseConfig.delay,
        duration: pulseConfig.duration,
        ease: 'Cubic.easeOut',
        onComplete: () => pulse.destroy()
      });
    });

    // 四条宽光带在边缘同时炸开，让完整 Combo 在高速战斗中也能被余光捕捉。
    [
      { x: centerX, y: SCREEN_ARENA_Y, width: SCREEN_ARENA_WIDTH, height: 36 / MAIN_CAMERA_BASE_ZOOM, scaleX: 1.035, scaleY: 4.2 },
      { x: centerX, y: SCREEN_ARENA_Y + SCREEN_ARENA_HEIGHT, width: SCREEN_ARENA_WIDTH, height: 36 / MAIN_CAMERA_BASE_ZOOM, scaleX: 1.035, scaleY: 4.2 },
      { x: SCREEN_ARENA_X, y: centerY, width: 36 / MAIN_CAMERA_BASE_ZOOM, height: SCREEN_ARENA_HEIGHT, scaleX: 4.2, scaleY: 1.035 },
      { x: SCREEN_ARENA_X + SCREEN_ARENA_WIDTH, y: centerY, width: 36 / MAIN_CAMERA_BASE_ZOOM, height: SCREEN_ARENA_HEIGHT, scaleX: 4.2, scaleY: 1.035 }
    ].forEach((bandConfig, index) => {
      const band = this.add
        .rectangle(bandConfig.x, bandConfig.y, bandConfig.width, bandConfig.height, impactColor, 0.78)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(8.95)
        .setScrollFactor(0);
      this.tweens.add({
        targets: band,
        scaleX: bandConfig.scaleX,
        scaleY: bandConfig.scaleY,
        alpha: 0,
        delay: index * 16,
        duration: heavy ? 380 : 320,
        ease: 'Expo.easeOut',
        onComplete: () => band.destroy()
      });
    });

    // 角点星爆提供清晰的四角节拍落点，旋转后再淡出。
    [
      [ARENA.x, ARENA.y],
      [ARENA.x + ARENA.width, ARENA.y],
      [ARENA.x, ARENA.y + ARENA.height],
      [ARENA.x + ARENA.width, ARENA.y + ARENA.height]
    ].forEach(([x, y], index) => {
      const star = this.add
        .star(x, y, 4, 7, heavy ? 38 : 32, index % 2 === 0 ? 0xffffff : impactColor, 1)
        .setRotation(Math.PI / 4)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(9.2);
      this.tweens.add({
        targets: star,
        scale: heavy ? 2.6 : 2.2,
        angle: star.angle + (index % 2 === 0 ? 100 : -100),
        alpha: 0,
        delay: index * 18,
        duration: heavy ? 560 : 480,
        ease: 'Back.easeOut',
        onComplete: () => star.destroy()
      });
    });

    this.cameras.main.shake(heavy ? 115 : 90, heavy ? 0.0028 : 0.0021);
  }

  /** 正确输入时，不同武器按 ComboMeter 使用各自的弹幕层数上限。 */
  private getCorrectProjectileCount(weaponId: string): number {
    if (weaponId === 'baton') {
      return Math.min(3, 1 + Math.floor(this.combo.level / 2));
    }
    return Math.min(5, 1 + this.combo.level);
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
        const launchX = bullet.getData('launchX') as number | undefined;
        const launchY = bullet.getData('launchY') as number | undefined;
        const maxTravelDistance = bullet.getData('maxTravelDistance') as number | undefined;
        const exceededPlayerRange = group === this.playerBullets
          && launchX !== undefined
          && launchY !== undefined
          && maxTravelDistance !== undefined
          && Phaser.Math.Distance.Between(launchX, launchY, bullet.x, bullet.y) >= maxTravelDistance;
        if (
          beatFloat >= (bullet.getData('despawnBeat') as number) ||
          (group === this.playerBullets && (outsideArena || exceededPlayerRange))
        ) {
          if (group === this.playerBullets) this.destroyPlayerBullet(bullet);
          else this.destroyEnemyBullet(bullet);
        }
      }
    }
  }

  /** 闪避进行到三分之二时，释放 Fever 重拍同款全圆清屏音波。 */
  triggerDodgeFeverWave(x: number, y: number): void {
    this.spawnSoundWave(x, y, this.player.aimAngle, 180, 190, 14 * this.combo.damageMultiplier);
  }

  /**
   * 首拍命中后，仅将剩余的第 2 / 3 / 4 拍按旧小节预告框的速度、层级和缩放曲线呈现。
   * 预告不参与碰撞或判定；目标拍到达后仍由实际输入决定成败。
   */
  private updateComboArenaBeatCues(): void {
    const active = this.combo.isComboActive
      && this.conductor.started
      && (this.state === 'tutorial' || this.state === 'playing' || this.state === 'intermission');
    if (!active) {
      this.arenaBeatCues.forEach((cue) => cue.setVisible(false));
      return;
    }

    const beatFloat = this.conductor.beatFloatAt(this.conductor.now());
    const firstTargetBeat = this.combo.expectedComboBeat;
    const firstStep = this.combo.expectedStep;
    const remaining = this.combo.pattern.length - firstStep;
    for (let index = 0; index < ARENA_BEAT_CUE_COUNT; index++) {
      const cue = this.arenaBeatCues[index];
      if (index >= remaining || firstTargetBeat < 0) {
        cue.setVisible(false);
        continue;
      }

      const targetBeat = firstTargetBeat + index;
      const progress = Phaser.Math.Clamp(
        (beatFloat - (targetBeat - ARENA_BEAT_CUE_DURATION_BEATS)) / ARENA_BEAT_CUE_DURATION_BEATS,
        0,
        1
      );
      const step = firstStep + index;
      const heavy = this.combo.pattern[step] === 'H';
      const baseColor = heavy ? ARENA_BEAT_HEAVY_COLOR : ARENA_BEAT_LIGHT_COLOR;
      const color = this.interpolateRgb(baseColor, 0xffffff, this.arenaRhythmIntensity * 0.32);
      const alpha = this.getComboArenaBeatCueAlpha(progress, heavy)
        * Phaser.Math.Linear(0.42, 1, this.arenaRhythmIntensity);
      cue
        .setVisible(progress < 1)
        .setScale(Phaser.Math.Linear(ARENA_BEAT_CUE_START_SCALE, 1, this.getComboArenaBeatCueScaleProgress(progress)))
        .setAlpha(alpha)
        .setStrokeStyle(
          (heavy ? 5 : 3) + this.arenaRhythmIntensity * (heavy ? 4 : 3),
          color,
          1
        );
    }
  }

  private getComboArenaBeatCueAlpha(progress: number, heavy: boolean): number {
    const adjustedProgress = heavy
      ? Phaser.Math.Clamp(progress / ARENA_BEAT_HEAVY_ALPHA_PEAK_PROGRESS, 0, 1)
      : progress;
    return Phaser.Math.Linear(ARENA_BEAT_CUE_MIN_ALPHA, 1, Phaser.Math.Easing.Expo.In(adjustedProgress));
  }

  /** 与旧小节框相同：进入提前输入窗时，方框刚好完成一半视觉路程。 */
  private getComboArenaBeatCueScaleProgress(progress: number): number {
    const cueDuration = this.conductor.beatDur * ARENA_BEAT_CUE_DURATION_BEATS;
    const judgementStartProgress = Phaser.Math.Clamp(1 - INPUT_EARLY_WINDOW / cueDuration, 0.5001, 0.999);
    let lowerExponent = 0;
    let upperExponent = 24;
    for (let iteration = 0; iteration < 20; iteration++) {
      const exponent = (lowerExponent + upperExponent) * 0.5;
      const atJudgementStart = Math.expm1(exponent * judgementStartProgress) / Math.expm1(exponent);
      if (atJudgementStart > ARENA_BEAT_CUE_JUDGEMENT_SCALE_PROGRESS) lowerExponent = exponent;
      else upperExponent = exponent;
    }
    const exponent = (lowerExponent + upperExponent) * 0.5;
    const clampedProgress = Phaser.Math.Clamp(progress, 0, 1);
    return Math.expm1(exponent * clampedProgress) / Math.expm1(exponent);
  }

  /** 踩拍/错拍闪避消耗的百分比在 P Menu 里可调；Fever 中等比例缩短剩余持续时间。 */
  consumeDodgeComboMeter(onBeat: boolean): boolean {
    const cost = onBeat ? this.tuningEditor.dodgeOnBeatCost : this.tuningEditor.dodgeOffBeatCost;
    if (!this.combo.canSpendProgress(cost)) {
      this.hud.flashComboInsufficient();
      return false;
    }
    const feverEnded = this.combo.spendProgress(cost);
    if (feverEnded) {
      this.endFever();
    } else if (this.combo.feverActive()) {
      this.hud.setFeverCountdown(this.combo.feverRemainRatio());
    } else {
      this.refreshComboHUD();
    }
    return true;
  }

  // ---------- 拾取 ----------

  private spawnPickup(x: number, y: number, weapon: WeaponDef): void {
    const go = this.add.container(x, y).setDepth(2);
    const isGlowstick = weapon.id === GLOWSTICKS.id;
    const color = isGlowstick ? 0xffa340 : 0x9be8ff;
    const ring = this.add
      .circle(0, 0, worldSize(27))
      .setStrokeStyle(worldSize(3.5), color, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .enableFilters();
    const ringGlow = ring.filters?.internal.addGlow(color, 1.25, 0.12, 1, false, 2, worldSize(24)) ?? null;
    if (ringGlow) ringGlow.setPaddingOverride(null);
    const weaponVisual = this.add
      .image(0, 0, isGlowstick ? 'player-weapon-glowsticks' : 'player-weapon-baton')
      .setScale(isGlowstick ? 0.56 : 0.5)
      .setRotation(isGlowstick ? -Math.PI / 4 : -Math.PI / 8)
      .enableFilters();
    const weaponGlow = weaponVisual.filters?.internal.addGlow(color, 1.15, 0.08, 1, false, 2, worldSize(18)) ?? null;
    if (weaponGlow) weaponGlow.setPaddingOverride(null);
    go.add([ring, weaponVisual]);
    this.pickups.push({ go, weaponVisual, ring, ringGlow, weaponGlow, baseY: y, weapon });
  }

  private pulsePickups(): void {
    const riseDuration = Math.max(80, this.conductor.beatDur * 420);
    for (const pickup of this.pickups) {
      this.tweens.killTweensOf(pickup.go);
      this.tweens.killTweensOf(pickup.ring);
      pickup.go.setY(pickup.baseY);
      pickup.weaponVisual.setTintFill();
      pickup.ring.setScale(0.82).setAlpha(1);
      if (pickup.ringGlow) pickup.ringGlow.outerStrength = 1.15;
      if (pickup.weaponGlow) pickup.weaponGlow.outerStrength = 1.05;
      this.time.delayedCall(90, () => {
        if (pickup.weaponVisual.active) pickup.weaponVisual.clearTint();
      });
      this.tweens.add({
        targets: pickup.go,
        y: pickup.baseY - 10,
        duration: riseDuration,
        ease: 'Sine.Out',
        yoyo: true
      });
      this.tweens.add({
        targets: pickup.ring,
        scale: 1.8,
        alpha: 0.28,
        duration: riseDuration,
        ease: 'Sine.Out',
        yoyo: true,
        onComplete: () => {
          if (pickup.ring.active) pickup.ring.setScale(1).setAlpha(0.96);
          if (pickup.ringGlow) pickup.ringGlow.outerStrength = 1.45;
          if (pickup.weaponGlow) pickup.weaponGlow.outerStrength = 1.35;
        }
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
    this.endBatonHeavyHold(false);
    this.player.weapon = weapon;
    this.combo.startSwitch(weapon.pattern);
    this.hud.setPattern(weapon.pattern, weapon.name);
    this.buildPatternPanel(this.state === 'tutorial');
    this.hud.setState('武器已切换 · 等待玩家输入');
    this.time.delayedCall(900, () => {
      if (this.state !== 'over') this.hud.setState('');
    });
  }

  // ---------- HUD ----------

  private refreshComboHUD(): void {
    const level = this.combo.level;
    if (level > this.lastComboLevel) {
      this.hud.pulseCombo();
    }
    this.lastComboLevel = level;
    this.hud.setCombo(this.combo.progress, level);

    // Meter 满 → 教学与正式战斗统一进入 Fever Time 并触发扫屏清弹。
    if (
      level === 5
      && !this.combo.feverActive()
      && (this.state === 'tutorial' || this.state === 'playing' || this.state === 'intermission')
    ) {
      this.enterFever();
    }
  }

  private enterFever(): void {
    this.combo.startFever();
    this.triggerFeverScreenClear();
    this.hud.setFever(true);
    this.hud.feverBurst();
    this.cameras.main.shake(200, 0.005);
    this.feverBorder.setAlpha(0.9);
  }

  /** 荧光棒新重击：从发光端射到当前画面边缘，沿线上的每个敌人各受击一次。 */
  private spawnGlowstickLaser(
    originX: number,
    originY: number,
    angle: number,
    damage: number,
    onBeat: boolean
  ): void {
    const chargeDelay = this.tuningEditor.glowstickHeavyChargeDelayMs;
    if (chargeDelay <= 0) {
      this.fireGlowstickLaser(originX, originY, angle, damage, onBeat);
      return;
    }
    const chargeGlow = this.add.graphics({ x: originX, y: originY })
      .setName('glowstick-heavy-laser-charge-glow')
      .setDepth(6.999)
      .setScale(0.45)
      .setAlpha(0.3)
      .setBlendMode(Phaser.BlendModes.ADD);
    chargeGlow.lineStyle(worldSize(onBeat ? 8 : 5), PLAYER_BULLET_COLOR, 0.1);
    chargeGlow.strokeCircle(0, 0, worldSize(onBeat ? 24 : 16));
    const charge = this.add.graphics({ x: originX, y: originY })
      .setName('glowstick-heavy-laser-charge')
      .setDepth(7)
      .setScale(0.45)
      .setAlpha(0.3)
      .setBlendMode(Phaser.BlendModes.NORMAL);
    charge.lineStyle(worldSize(onBeat ? 8 : 5), PLAYER_BULLET_COLOR, 0.86);
    charge.strokeCircle(0, 0, worldSize(onBeat ? 24 : 16));
    charge.lineStyle(worldSize(3), this.mixColorWithWhite(PLAYER_BULLET_COLOR, 0.68), 0.9);
    charge.strokeCircle(0, 0, worldSize(onBeat ? 10 : 7));
    charge.setData('attackGlowVisual', chargeGlow);
    this.activeSpecialAttackFx.add(charge);
    this.tweens.add({
      targets: [charge, chargeGlow],
      scale: 1.55,
      alpha: 0.62,
      duration: chargeDelay,
      ease: 'Cubic.easeIn'
    });
    const timer = this.time.delayedCall(chargeDelay, () => {
      this.activeSpecialAttackTimers.delete(charge);
      this.destroySpecialAttackFx(charge);
      if (this.state === 'over') return;
      this.fireGlowstickLaser(originX, originY, angle, damage, onBeat);
    });
    this.activeSpecialAttackTimers.set(charge, timer);
  }

  private fireGlowstickLaser(
    originX: number,
    originY: number,
    angle: number,
    damage: number,
    onBeat: boolean
  ): void {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const length = this.distanceToViewportEdge(originX, originY, directionX, directionY);
    const endX = originX + directionX * length;
    const endY = originY + directionY * length;
    const beamHalfWidth = this.tuningEditor.glowstickHeavyLaserThickness * (onBeat ? 0.5 : 0.275);
    const laserGlow = this.add.graphics()
      .setName('glowstick-heavy-laser-glow')
      .setDepth(6.999)
      .setBlendMode(Phaser.BlendModes.ADD);
    laserGlow.lineStyle(beamHalfWidth * 2.8, PLAYER_BULLET_COLOR, 0.06);
    laserGlow.lineBetween(originX, originY, endX, endY);
    const laser = this.add.graphics()
      .setName('glowstick-heavy-laser')
      .setDepth(7)
      .setBlendMode(Phaser.BlendModes.NORMAL);
    laser.lineStyle(beamHalfWidth * 1.45, PLAYER_BULLET_COLOR, 0.86);
    laser.lineBetween(originX, originY, endX, endY);
    laser.lineStyle(
      Math.max(worldSize(4), beamHalfWidth * 0.38),
      this.mixColorWithWhite(PLAYER_BULLET_COLOR, 0.72),
      0.92
    );
    laser.lineBetween(originX, originY, endX, endY);
    laser.setData('attackGlowVisual', laserGlow);
    this.activeSpecialAttackFx.add(laser);

    for (const enemy of [...this.enemies]) {
      if (enemy.dead) continue;
      const offsetX = enemy.x - originX;
      const offsetY = enemy.y - originY;
      const projection = offsetX * directionX + offsetY * directionY;
      if (projection < 0 || projection > length) continue;
      const perpendicularDistance = Math.abs(offsetX * directionY - offsetY * directionX);
      if (perpendicularDistance > beamHalfWidth + enemy.radius) continue;
      enemy.takeDamage(Math.round(damage));
    }

    this.tweens.add({
      targets: [laser, laserGlow],
      alpha: 0,
      duration: onBeat ? 240 : 170,
      ease: 'Cubic.easeOut',
      onComplete: () => this.destroySpecialAttackFx(laser)
    });
  }

  /** 警棍新重击：向准星方向飞行的月牙波，每名敌人最多命中一次并施加强击退。 */
  private spawnBatonCrescent(
    originX: number,
    originY: number,
    angle: number,
    damage: number,
    onBeat: boolean
  ): void {
    const radius = worldSize(onBeat ? 48 : 34);
    const angleTier = Math.min(2, Math.floor(this.combo.level / 2));
    const angleScale = 1 + angleTier * 0.25;
    const crescentHalfAngle = 0.95 * angleScale;
    const range = this.tuningEditor.batonHeavyCrescentRange * (onBeat ? 1 : 0.5);
    const crescentGlow = this.add.graphics({ x: originX, y: originY })
      .setName('baton-heavy-crescent-glow')
      .setDepth(6.999)
      .setRotation(angle)
      .setBlendMode(Phaser.BlendModes.ADD);
    crescentGlow.lineStyle(worldSize(onBeat ? 24 : 16), BATON_BULLET_COLOR, 0.06);
    crescentGlow.beginPath();
    crescentGlow.arc(0, 0, radius, -crescentHalfAngle, crescentHalfAngle, false);
    crescentGlow.strokePath();
    const crescent = this.add.graphics({ x: originX, y: originY })
      .setName('baton-heavy-crescent')
      .setDepth(7)
      .setRotation(angle)
      .setBlendMode(Phaser.BlendModes.NORMAL);
    crescent.setData('maxRange', range);
    crescent.setData('slowdownStartDistance', range * 0.85);
    crescent.lineStyle(worldSize(onBeat ? 9 : 6), BATON_BULLET_COLOR, 0.86);
    crescent.beginPath();
    crescent.arc(0, 0, radius, -crescentHalfAngle, crescentHalfAngle, false);
    crescent.strokePath();
    crescent.lineStyle(
      worldSize(onBeat ? 3 : 2),
      this.mixColorWithWhite(BATON_BULLET_COLOR, 0.68),
      0.9
    );
    crescent.beginPath();
    crescent.arc(0, 0, radius, -crescentHalfAngle, crescentHalfAngle, false);
    crescent.strokePath();
    crescent.setData('attackGlowVisual', crescentGlow);
    this.activeSpecialAttackFx.add(crescent);

    const hitEnemies = new Set<Enemy>();
    const hitRadius = radius * angleScale + worldSize(onBeat ? 18 : 12);
    const checkHits = (): void => {
      for (const enemy of [...this.enemies]) {
        if (enemy.dead || hitEnemies.has(enemy)) continue;
        if (Phaser.Math.Distance.Between(crescent.x, crescent.y, enemy.x, enemy.y) > hitRadius + enemy.radius) {
          continue;
        }
        hitEnemies.add(enemy);
        enemy.takeDamage(Math.round(damage), angle, BATON_CRESCENT_KNOCKBACK_SPEED);
      }
    };
    checkHits();
    const speed = worldSize(720) * this.tuningEditor.batonSweepSpeed;
    this.tweens.add({
      targets: [crescent, crescentGlow],
      x: originX + Math.cos(angle) * range,
      y: originY + Math.sin(angle) * range,
      duration: range / speed * 1000,
      // 前 70% 时间到达 85% 距离；最后 15% 行程以二次 ease-out 明显减速至零。
      ease: (progress: number): number => {
        if (progress <= 0.7) return progress / 0.7 * 0.85;
        const tail = (progress - 0.7) / 0.3;
        return 0.85 + 0.15 * (1 - (1 - tail) * (1 - tail));
      },
      onUpdate: checkHits,
      onComplete: () => {
        this.tweens.add({
          targets: [crescent, crescentGlow],
          alpha: 0,
          scaleX: 1.16,
          scaleY: 1.16,
          delay: 90,
          duration: 110,
          ease: 'Cubic.easeOut',
          onComplete: () => this.destroySpecialAttackFx(crescent)
        });
      }
    });
  }

  private distanceToViewportEdge(x: number, y: number, directionX: number, directionY: number): number {
    const distances: number[] = [];
    if (directionX > 0.0001) distances.push((VIEW_WIDTH - x) / directionX);
    else if (directionX < -0.0001) distances.push((0 - x) / directionX);
    if (directionY > 0.0001) distances.push((VIEW_HEIGHT - y) / directionY);
    else if (directionY < -0.0001) distances.push((0 - y) / directionY);
    return Math.max(0, Math.min(...distances.filter((distance) => distance >= 0)));
  }

  private destroySpecialAttackFx(effect: Phaser.GameObjects.Graphics): void {
    const glow = effect.getData('attackGlowVisual') as Phaser.GameObjects.Graphics | undefined;
    const timer = this.activeSpecialAttackTimers.get(effect);
    if (timer) {
      timer.remove();
      this.activeSpecialAttackTimers.delete(effect);
    }
    this.activeSpecialAttackFx.delete(effect);
    this.tweens.killTweensOf(effect);
    if (glow) {
      this.tweens.killTweensOf(glow);
      if (glow.active) glow.destroy();
    }
    if (effect.active) effect.destroy();
  }

  /** Fever 满格或按 C 调试时，以贯穿全屏的竖向发光条从左向右逐列清除敌弹。 */
  private triggerFeverScreenClear(): void {
    const enemyBullets = this.bullets.getChildren().slice() as Phaser.GameObjects.Rectangle[];
    const makeStrip = (
      x: number,
      width: number,
      color: number,
      alpha: number,
      blendMode = Phaser.BlendModes.ADD
    ) => this.add
      .rectangle(x, 0, width, VIEW_HEIGHT * 1.08, color, alpha)
      .setBlendMode(blendMode);
    const sweep = this.add.container(-180, VIEW_HEIGHT / 2, [
      makeStrip(-70, 260, 0xff7a00, 0.015),
      makeStrip(-24, 132, 0xffa31a, 0.035),
      makeStrip(10, 62, 0xffd166, 0.08),
      makeStrip(34, 16, 0xffffff, 0.88, Phaser.BlendModes.NORMAL),
      makeStrip(52, 28, 0xfff1a8, 0.12)
    ])
      .setName('fever-screen-clear-sweep')
      .setScrollFactor(0)
      .setDepth(19);
    this.tweens.add({
      targets: sweep,
      x: VIEW_WIDTH + 180,
      duration: 760,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const camera = this.cameras.main;
        for (const bullet of enemyBullets) {
          if (!bullet.active) continue;
          const bulletScreenX = (bullet.x - camera.worldView.x) * camera.zoom;
          if (bulletScreenX <= sweep.x + 52) this.destroyEnemyBullet(bullet);
        }
      },
      onComplete: () => {
        for (const bullet of enemyBullets) {
          if (bullet.active) this.destroyEnemyBullet(bullet);
        }
        sweep.destroy(true);
      }
    });
  }

  private endFever(): void {
    this.hud.setFever(false);
    this.tweens.add({ targets: this.feverBorder, alpha: 0, duration: 300 });
    this.lastComboLevel = 0;
    this.refreshComboHUD();
  }

}
