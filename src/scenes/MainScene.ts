import Phaser from 'phaser';
import { Conductor, type BeatInfo } from '../core/Conductor';
import { Sfx } from '../core/Sfx';
import { ComboSystem } from '../game/ComboSystem';
import { HUD } from '../game/HUD';
import { Player, PLAYER_RADIUS } from '../game/Player';
import { BATON, GLOWSTICKS, getAttackSpec, type WeaponDef } from '../game/weapons';
import { Enemy, FanEnemy, SmallGuard } from '../game/enemies';
import { GAMEPAD_BUTTON, rumbleParameters, type RumbleKind } from '../game/GamepadControls';
import { WORLD_OBJECT_SCALE, worldDepth, worldSize } from '../game/visualScale';

// bgm3.mp3 的实测节拍：对全曲 onset 包络做自相关 + 网格相位搜索得出 BPM，首拍在文件内 0.026s 处。
const BPM = 146.32;
const BGM_FIRST_BEAT_OFFSET = 0.026;
const BGM_VOLUME = 0.3;
const BGM_LOOP_BEATS = 616;
const DEFAULT_MASTER_VOLUME = 1.5;
const MAX_MASTER_VOLUME = 3;
const VOLUME_TRACK_X = 440;
const VOLUME_TRACK_WIDTH = 400;
const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 720;
const ARENA_MARGIN = 12;
const RHYTHM_EDGE_BAND = 82;
const ARENA = {
  x: ARENA_MARGIN + RHYTHM_EDGE_BAND,
  y: ARENA_MARGIN,
  width: VIEW_WIDTH - (ARENA_MARGIN + RHYTHM_EDGE_BAND) * 2,
  height: VIEW_HEIGHT - ARENA_MARGIN * 2 - RHYTHM_EDGE_BAND
};
const PLAYER_BULLET_LENGTH = worldSize(38);
const ENEMY_BULLET_LENGTH = worldSize(36 * 0.75);
const BULLET_THICKNESS = worldSize(10);
const ENEMY_BULLET_THICKNESS = BULLET_THICKNESS * 0.75;
const PLAYER_BULLET_SPEED = 360;
const ENEMY_DRIFT_SPEED = 6;
const ENEMY_BEAT_BURST_SPEED = 600;
const ENEMY_BEAT_BURST_WINDOW = 0.1;
const PLAYER_BULLET_COLOR = 0xef4444;
const BATON_BULLET_COLOR = 0xa855f7;
const GLOWSTICK_KNOCKBACK_SPEED = 150;
const BATON_KNOCKBACK_SPEED = GLOWSTICK_KNOCKBACK_SPEED * 1.25;

type GameState = 'title' | 'tutorial' | 'tutorialConfirm' | 'playing' | 'intermission' | 'over';

/** 教学要求连续全对的小节数 */
const TUTORIAL_TARGET_STREAK = 3;
type BeatSfxCue = 'playerHurt' | 'feverStart' | 'enemyHurt' | 'pickup';

const WAVE_ENEMY_COUNTS = [2, 4, 8, 16, 32];

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

  private bgm!: Phaser.Sound.BaseSound;
  private bgmFirstBeat = 0;
  private masterVolume = DEFAULT_MASTER_VOLUME;
  private volumePanel!: Phaser.GameObjects.Container;
  private volumeFill!: Phaser.GameObjects.Rectangle;
  private volumeThumb!: Phaser.GameObjects.Arc;
  private volumeValueText!: Phaser.GameObjects.Text;
  private volumePanelVisible = false;
  private volumeDragging = false;

  private enemies: Enemy[] = [];
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private pickups: Pickup[] = [];
  private state: GameState = 'title';
  private waveIdx = -1;
  private lastComboLevel = 0;
  private feverBorder!: Phaser.GameObjects.Graphics;
  private rhythmBlocks: Phaser.GameObjects.Rectangle[] = [];
  private rhythmPulseUntil = 0;
  private pendingBeatSfx = new Set<BeatSfxCue>();
  private gamepadButtonState = { dodge: false, attack: false };
  /** 调试：B 键切换判定框显示（红=受击判定，绿=武器/子弹判定），重开局保留开关状态 */
  private debugHitboxes = false;
  private debugGfx!: Phaser.GameObjects.Graphics;

  /** 实验：V 键双人分屏（左=俯视移动位，右=FPV 节奏射击位），见 docs/split-coop-fpv.md */
  private splitMode = false;
  /** 主相机基准缩放：全屏 1，分屏 0.5；踩拍特效的相机推拉以此为基准 */
  private baseZoom = 1;

  // 连段面板（教学模式含说明与进度，游戏模式只保留节拍块，随武器连段重建）
  private patternPanel?: Phaser.GameObjects.Container;
  private patternIcons: Phaser.GameObjects.Shape[] = [];

  // 教学状态
  private tutorialStreakText?: Phaser.GameObjects.Text;
  private tutorialStreak = 0;
  private tutorialHitBeats = new Set<number>();
  private tutorialFailedMeasures = new Set<number>();
  private confirmUi?: Phaser.GameObjects.Container;
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
    this.load.image('player', asset('images/characters/player.png'));
    this.load.audio('beat-light', asset('audio/sfx/sfx-beat-light.mp3'));
    this.load.audio('beat-heavy', asset('audio/sfx/sfx-beat-heavy.mp3'));
    this.load.audio('bgm', asset('audio/music/bgm3.mp3'));
  }

  create(): void {
    // 重开局（R 键）会在同一个 Scene 实例上重新执行 create()，先停掉旧的 bgm 避免叠放
    this.sound.stopByKey('bgm');
    this.enemies = [];
    this.pickups = [];
    this.state = 'title';
    this.waveIdx = -1;
    this.lastComboLevel = 0;
    this.rhythmBlocks = [];
    this.rhythmPulseUntil = 0;
    this.pendingBeatSfx.clear();
    this.gamepadButtonState = { dodge: false, attack: false };
    this.patternPanel = undefined;
    this.patternIcons = [];
    this.confirmUi = undefined;
    this.tutorialStreakText = undefined;
    this.tutorialStreak = 0;
    this.tutorialHitBeats.clear();
    this.tutorialFailedMeasures.clear();
    this.suppressAttackUntil = 0;
    this.countdownRemaining = -1;
    this.createFanAnimations();

    this.physics.world.setBounds(ARENA.x, ARENA.y, ARENA.width, ARENA.height);
    const border = this.add.graphics().setDepth(1);
    border.lineStyle(3, 0x475569, 1);
    border.strokeRect(ARENA.x, ARENA.y, ARENA.width, ARENA.height);
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
    this.bgm = this.sound.add('bgm', { loop: false, volume: BGM_VOLUME });
    this.bgm.on(Phaser.Sound.Events.COMPLETE, this.onBgmComplete, this);
    this.combo = new ComboSystem(this.conductor, GLOWSTICKS.pattern);
    this.hud = new HUD(this, this.conductor);
    this.player = new Player(this, 640, 400);

    this.hud.setPattern(GLOWSTICKS.pattern, GLOWSTICKS.name);
    this.conductor.setCuePattern(GLOWSTICKS.pattern);
    this.hud.setHp(this.player.hp, this.player.maxHp);
    this.createVolumeControl();

    this.enemyGroup = this.physics.add.group();
    this.bullets = this.physics.add.group();
    this.playerBullets = this.physics.add.group();

    this.physics.add.collider(this.player.go, this.enemyGroup);
    this.physics.add.collider(this.enemyGroup, this.enemyGroup);
    this.physics.add.overlap(this.player.go, this.bullets, (_playerGO, bulletGO) => {
      if (this.state !== 'playing') return;
      const bullet = bulletGO as Phaser.GameObjects.Rectangle;
      this.player.takeDamage(bullet.getData('damage') as number);
      this.destroyEnemyBullet(bullet);
    });
    this.physics.add.overlap(this.playerBullets, this.enemyGroup, (bulletGO, enemyGO) => {
      const bullet = bulletGO as Phaser.GameObjects.Rectangle;
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
    // R 重开会重建相机，分屏状态需要重新应用
    this.applyCameraLayout();
    this.showTitle();
  }

  update(_time: number, delta: number): void {
    this.conductor.update();
    this.hud.update();
    this.updateRhythmEdgeAnticipation();
    if (this.combo.updateFever()) this.endFever();
    this.handleGamepadInput();
    this.drawDebugHitboxes();

    if (this.state === 'over' || this.state === 'title') return;

    this.player.update(this.time.now, delta);
    for (const enemy of this.enemies) enemy.update(delta);
    this.updateEnemyBulletMotion();
    this.updateBulletTrails(delta);
    this.cleanupBullets();
    this.checkPickups();

    if (this.combo.feverActive()) {
      this.hud.setFeverCountdown(this.combo.feverRemainRatio());
    }
  }

  // ---------- 输入 ----------

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.volumePanelVisible) return;
      if (this.state === 'title') {
        this.startGame();
        return;
      }
      if (this.state === 'over' || this.state === 'tutorialConfirm') return;
      if (this.time.now < this.suppressAttackUntil) return;

      const btn = pointer.rightButtonDown() ? 'H' : pointer.leftButtonDown() ? 'L' : null;
      if (!btn) return;
      // 分屏时左半屏归移动位，点击不触发射击；只有指针在右半屏才响应
      if (this.splitMode && pointer.x < 640) return;
      this.handleAttackInput(btn);
    });

    this.input.keyboard!.on('keydown-SHIFT', () => {
      if (this.state === 'playing' || this.state === 'intermission' || this.state === 'tutorial') {
        this.player.tryDodge();
      }
    });

    this.input.keyboard!.on('keydown-R', () => {
      this.scene.restart();
    });

    this.input.keyboard!.on('keydown-ALT', (event: KeyboardEvent) => {
      event.preventDefault();
      if (!event.repeat) this.setVolumePanelVisible(!this.volumePanelVisible);
    });

    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.volumePanelVisible) this.setVolumePanelVisible(false);
    });

    // 调试：B 键切换判定框显示
    this.input.keyboard!.on('keydown-B', () => {
      this.debugHitboxes = !this.debugHitboxes;
    });

    // 实验：V 键切换双人分屏
    this.input.keyboard!.on('keydown-V', () => {
      this.splitMode = !this.splitMode;
      this.applyCameraLayout();
    });

    // 原型调试键：F 直接充满 ComboMeter，便于快速验证 Fever Time
    this.input.keyboard!.on('keydown-F', () => {
      if (this.state === 'playing' || this.state === 'intermission') {
        this.combo.addProgress(100);
        this.refreshComboHUD();
      }
    });
  }

  private handleAttackInput(btn: 'L' | 'H', pad?: Phaser.Input.Gamepad.Gamepad): void {
    const result = this.combo.handleInput(btn, this.conductor.now());
    if (result.type === 'correct' || result.type === 'protectedCorrect') {
      this.performWeaponAttack(result.beatIdx, false, 5, true);
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
      if (pressed.attack) this.finishTutorial();
      else if (pressed.dodge) this.retryTutorial();
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

  private showTitle(): void {
    this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.6).setDepth(19).setName('titleOverlay');
    this.hud.message(
      '音乐弹幕原型\n\n' +
        'WASD 移动 · 鼠标瞄准\n左键=轻攻击 · 右键=重攻击（按节拍连段）\nShift=沿移动方向冲刺（踩拍消耗减半并清弹）\nB=显示判定框（调试）\n\n点击开始'
    );
  }

  private startGame(): void {
    this.children.getByName('titleOverlay')?.destroy();
    this.hud.message('');
    this.conductor.start();
    this.bgmFirstBeat = 0;
    this.playBgmAlignedToBeat(this.bgmFirstBeat);
    this.startTutorial();
  }

  /**
   * 让 bgm3.mp3 的首拍（文件内 BGM_FIRST_BEAT_OFFSET 秒处）与指定 Conductor 拍点对齐：
   * 若倒数时间足够则用 delay 等到那一刻播放，否则直接以 seek 跳过已经过去的部分。
   */
  private playBgmAlignedToBeat(firstBeat: number): void {
    const delayToFirstBeat = this.conductor.timeOfBeat(firstBeat) - this.conductor.now();
    if (delayToFirstBeat >= BGM_FIRST_BEAT_OFFSET) {
      this.bgm.play({ delay: delayToFirstBeat - BGM_FIRST_BEAT_OFFSET });
    } else {
      this.bgm.play({ seek: BGM_FIRST_BEAT_OFFSET - delayToFirstBeat });
    }
  }

  private createVolumeControl(): void {
    this.add
      .text(1250, 24, 'ALT  音量', { fontFamily: 'Arial', fontSize: '14px', color: '#94a3b8' })
      .setOrigin(1, 0.5)
      .setDepth(10);

    const shade = this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.55);
    const panel = this.add.rectangle(640, 330, 560, 180, 0x0f172a, 0.96).setStrokeStyle(2, 0x67e8f9, 0.9);
    const title = this.add
      .text(640, 275, '主音量', { fontFamily: 'Arial', fontSize: '28px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    const hint = this.add
      .text(640, 385, 'Alt / Esc 关闭', { fontFamily: 'Arial', fontSize: '14px', color: '#94a3b8' })
      .setOrigin(0.5);
    const track = this.add
      .rectangle(640, 335, VOLUME_TRACK_WIDTH, 12, 0x334155)
      .setStrokeStyle(1, 0x64748b)
      .setInteractive({ useHandCursor: true });
    this.volumeFill = this.add.rectangle(VOLUME_TRACK_X, 335, VOLUME_TRACK_WIDTH, 12, 0x67e8f9).setOrigin(0, 0.5);
    this.volumeThumb = this.add.circle(VOLUME_TRACK_X + VOLUME_TRACK_WIDTH, 335, 13, 0xffffff)
      .setStrokeStyle(3, 0x67e8f9)
      .setInteractive({ useHandCursor: true });
    this.volumeValueText = this.add
      .text(640, 305, '', { fontFamily: 'Arial', fontSize: '18px', color: '#67e8f9' })
      .setOrigin(0.5);

    this.volumePanel = this.add.container(0, 0, [shade, panel, title, hint, track, this.volumeFill, this.volumeThumb, this.volumeValueText])
      .setDepth(30)
      .setVisible(false);

    const beginDrag = (pointer: Phaser.Input.Pointer): void => {
      this.volumeDragging = true;
      this.updateVolumeFromPointer(pointer.x);
    };
    track.on('pointerdown', beginDrag);
    this.volumeThumb.on('pointerdown', beginDrag);
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.volumeDragging && this.volumePanelVisible) this.updateVolumeFromPointer(pointer.x);
    });
    this.input.on('pointerup', () => {
      this.volumeDragging = false;
    });
    this.refreshVolumeControl();
  }

  private setVolumePanelVisible(visible: boolean): void {
    this.volumePanelVisible = visible;
    this.volumeDragging = false;
    this.volumePanel.setVisible(visible);
    if (visible) {
      this.input.mouse?.releasePointerLock();
      this.input.setDefaultCursor('default');
      this.game.canvas.style.cursor = 'default';
    }
  }

  private updateVolumeFromPointer(pointerX: number): void {
    const ratio = Phaser.Math.Clamp((pointerX - VOLUME_TRACK_X) / VOLUME_TRACK_WIDTH, 0, 1);
    this.masterVolume = ratio * MAX_MASTER_VOLUME;
    const soundManager = this.sound as Phaser.Sound.WebAudioSoundManager;
    soundManager.masterVolumeNode.gain.setTargetAtTime(this.masterVolume, soundManager.context.currentTime, 0.01);
    this.refreshVolumeControl();
  }

  private refreshVolumeControl(): void {
    const ratio = this.masterVolume / MAX_MASTER_VOLUME;
    this.volumeFill.displayWidth = VOLUME_TRACK_WIDTH * ratio;
    this.volumeThumb.x = VOLUME_TRACK_X + VOLUME_TRACK_WIDTH * ratio;
    this.volumeValueText.setText(`${Math.round(this.masterVolume * 100)}%`);
  }

  /** bgm3 长度不是整拍；每 616 拍按 Conductor 重新开始，避免 Phaser 原生循环累计漂移。 */
  private onBgmComplete(): void {
    if (!this.conductor.started) return;
    this.bgmFirstBeat += BGM_LOOP_BEATS;
    this.playBgmAlignedToBeat(this.bgmFirstBeat);
  }

  // ---------- 教学 ----------

  /** 开场教学：不生成敌人，玩家跟随上方节拍点连打，连续 3 个小节全对后确认进入游戏 */
  private startTutorial(): void {
    this.state = 'tutorial';
    this.tutorialStreak = 0;
    this.tutorialHitBeats.clear();
    this.tutorialFailedMeasures.clear();
    this.buildPatternPanel(true);
    this.updateTutorialStreakText();
    this.hud.setWave('教学中');
    this.flashMessage('跟随节拍！');
  }

  /**
   * 重建顶部连段面板：按当前武器连段生成节拍块（○轻 ◆重）。
   * tutorial=true 时附带教学说明与连击进度；游戏模式为紧凑版。武器切换时以新连段重建。
   */
  private buildPatternPanel(tutorial: boolean): void {
    this.patternPanel?.destroy();
    this.patternIcons = [];
    this.tutorialStreakText = undefined;

    const ui = this.add.container(640, 0).setDepth(15);
    if (tutorial) {
      ui.add(this.add.rectangle(0, 122, 560, 180, 0x0f172a, 0.72).setStrokeStyle(1, 0x334155));
      ui.add(
        this.add
          .text(0, 56, '教学 · 按节拍打出连段', { fontFamily: 'Arial', fontSize: '22px', color: '#e2e8f0' })
          .setOrigin(0.5)
      );
      ui.add(
        this.add
          .text(0, 86, '左键 = 轻（○）　右键 = 重（◆）', { fontFamily: 'Arial', fontSize: '15px', color: '#94a3b8' })
          .setOrigin(0.5)
      );
    } else {
      ui.add(this.add.rectangle(0, 144, 350, 96, 0x0f172a, 0.55).setStrokeStyle(1, 0x334155));
    }

    const xs = [-108, -36, 36, 108];
    this.combo.pattern.forEach((key, i) => {
      const icon: Phaser.GameObjects.Shape = key === 'L'
        ? this.add.circle(xs[i], 128, 14).setStrokeStyle(3, 0x67e8f9)
        : this.add.rectangle(xs[i], 128, 22, 22, 0xfbbf24).setAngle(45);
      const label = this.add
        .text(xs[i], 160, key === 'L' ? '轻' : '重', {
          fontFamily: 'Arial',
          fontSize: '16px',
          color: key === 'L' ? '#67e8f9' : '#fbbf24'
        })
        .setOrigin(0.5);
      ui.add([icon, label]);
      this.patternIcons.push(icon);
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
    this.tutorialStreakText?.setText(`连续完整小节 ${this.tutorialStreak} / ${TUTORIAL_TARGET_STREAK}`);
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
    const ui = this.add.container(640, 360).setDepth(21);
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
      .text(0, -34, `连续 ${TUTORIAL_TARGET_STREAK} 个小节全部命中，节奏感不错！`, {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#e2e8f0'
      })
      .setOrigin(0.5);
    ui.add([overlay, title, sub]);
    ui.add(this.createConfirmButton(-130, 60, '进入游戏', 0x16a34a, () => this.finishTutorial()));
    ui.add(this.createConfirmButton(130, 60, '重新教学', 0x475569, () => this.retryTutorial()));
    this.confirmUi = ui;
  }

  private createConfirmButton(
    x: number,
    y: number,
    label: string,
    color: number,
    onClick: () => void
  ): Phaser.GameObjects.GameObject[] {
    const rect = this.add.rectangle(x, y, 210, 58, color, 0.95).setStrokeStyle(2, 0xffffff, 0.85);
    const text = this.add
      .text(x, y, label, { fontFamily: 'Arial', fontSize: '24px', color: '#ffffff' })
      .setOrigin(0.5);
    rect.setInteractive({ useHandCursor: true });
    rect.on('pointerover', () => rect.setScale(1.05));
    rect.on('pointerout', () => rect.setScale(1));
    rect.on('pointerdown', () => {
      this.suppressAttackUntil = this.time.now + 200;
      onClick();
    });
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
    // 教学面板换为游戏模式的紧凑连段面板
    this.buildPatternPanel(false);
    // 教学期间积累的 Fever 能量清零，正式开局从零开始
    this.combo.progress = 0;
    this.lastComboLevel = 0;
    this.hud.setCombo(0, 0);
    this.state = 'intermission';
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
      .setScale(1.5);
    this.tweens.add({ targets: text, scale: 1, duration: 120, ease: 'Back.easeOut' });
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
    this.state = 'playing';
    this.hud.setWave(`Wave ${idx + 1} / ${WAVE_ENEMY_COUNTS.length}`);
    this.flashMessage(`WAVE ${idx + 1}`);

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
        this.state = 'over';
        this.hud.message('VICTORY!\n\n按 R 重新开始');
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
    this.player.go.setAlpha(0.3);
    this.hud.message('FAILED...\n\n按 R 重新开始');
  }

  getAssistedAimAngle(mouseAngle: number): number {
    let nearest: Enemy | undefined;
    let nearestDistance = Infinity;
    const halfAssistCone = Math.PI / 4;

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const enemyAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      if (Math.abs(Phaser.Math.Angle.Wrap(enemyAngle - mouseAngle)) > halfAssistCone) continue;
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      if (distance < nearestDistance) {
        nearest = enemy;
        nearestDistance = distance;
      }
    }

    return nearest
      ? Phaser.Math.Angle.Between(this.player.x, this.player.y, nearest.x, nearest.y)
      : mouseAngle;
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
    for (const group of [this.playerBullets, this.bullets]) {
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
    this.pulseRhythmEdgeBlocks(this.combo.pattern[info.beatInMeasure] === 'H');
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

    // 相机微推拉：轻拍几乎不可察觉的顿挫，重拍稍强（以 baseZoom 为基准，兼容分屏）
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    cam.setZoom(this.baseZoom);
    this.tweens.add({
      targets: cam,
      zoom: this.baseZoom * (heavy ? 1.03 : 1.015),
      duration: 60,
      yoyo: true,
      ease: 'Quad.easeOut'
    });
  }

  // ---------- 实验：双人分屏（docs/split-coop-fpv.md） ----------

  /** 应用当前显示布局：分屏时主相机缩进左半屏并启动 FPV 场景，全屏时还原 */
  private applyCameraLayout(): void {
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    if (this.splitMode) {
      this.baseZoom = 0.5;
      cam.setViewport(0, 0, 640, 720);
      if (!this.scene.isActive('FpvScene')) this.scene.launch('FpvScene');
    } else {
      this.baseZoom = 1;
      cam.setViewport(0, 0, 1280, 720);
      if (this.scene.isActive('FpvScene')) this.scene.stop('FpvScene');
    }
    cam.setZoom(this.baseZoom);
    cam.centerOn(640, 360);
  }

  get isSplitMode(): boolean {
    return this.splitMode;
  }

  // FPV 场景的只读访问器，不改变任何游戏逻辑
  get fpvEnemies(): readonly Enemy[] {
    return this.enemies;
  }

  get fpvEnemyBullets(): Phaser.GameObjects.GameObject[] {
    return this.bullets ? this.bullets.getChildren() : [];
  }

  get fpvPlayerBullets(): Phaser.GameObjects.GameObject[] {
    return this.playerBullets ? this.playerBullets.getChildren() : [];
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
    body.setSize(ENEMY_BULLET_LENGTH, ENEMY_BULLET_THICKNESS);
    body.setVelocity(0, 0);
    bullet.setData('damage', damage);
    bullet.setData('angle', angle);
    bullet.setData('despawnBeat', Math.floor(this.conductor.beatFloatAt(this.conductor.now())) + 8);
    bullet.setData('trailColor', color);
    bullet.setData('trailThickness', ENEMY_BULLET_THICKNESS);
    bullet.setData('bursting', false);
    this.createHeldEnemyTrail(bullet);
  }

  spawnEnemyProjectile(x: number, y: number, angle: number, damage: number, color: number): void {
    this.spawnBullet(
      x + Math.cos(angle) * worldSize(26),
      y + Math.sin(angle) * worldSize(26),
      angle,
      0,
      damage,
      color
    );
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
      body.setSize(PLAYER_BULLET_LENGTH, BULLET_THICKNESS);
      const velocity = this.physics.velocityFromRotation(shotAngle, PLAYER_BULLET_SPEED);
      body.setVelocity(velocity.x, velocity.y);
      bullet.setData('damage', damage);
      bullet.setData('despawnBeat', despawnBeat);
      bullet.setData('trailColor', color);
      bullet.setData('trailThickness', BULLET_THICKNESS);
      bullet.setData('knockbackAngle', shotAngle);
      bullet.setData('knockbackSpeed', GLOWSTICK_KNOCKBACK_SPEED);
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
      return { bullet, visual, radius, halfArcAngle };
    });

    const sweep = { progress: 0 };
    const updatePositions = (): void => {
      const angle = Phaser.Math.Linear(startAngle, endAngle, sweep.progress);
      for (const { bullet, visual, radius, halfArcAngle } of bullets) {
        if (!bullet.active) continue;
        const x = originX + Math.cos(angle) * radius;
        const y = originY + Math.sin(angle) * radius;
        bullet.setPosition(x, y).setRotation(angle + Math.PI / 2);
        (bullet.body as Phaser.Physics.Arcade.Body).reset(x, y);
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
    if (bullet.active) bullet.destroy();
  }

  private createHeldEnemyTrail(bullet: Phaser.GameObjects.Rectangle): void {
    // 慢行阶段保持方向标记；下一次拍前快速移动开始时再清除。
    const angle = bullet.getData('angle') as number;
    const length = ENEMY_BULLET_LENGTH * 0.9;
    const trail = this.add
      .rectangle(0, 0, length, ENEMY_BULLET_THICKNESS * 0.55, bullet.fillColor, 0.16)
      .setRotation(angle)
      .setDepth(3);
    bullet.setData('heldTrail', trail);
    this.positionHeldEnemyTrail(bullet, trail);
  }

  private positionHeldEnemyTrail(
    bullet: Phaser.GameObjects.Rectangle,
    trail: Phaser.GameObjects.Rectangle
  ): void {
    const angle = bullet.getData('angle') as number;
    const offset = ENEMY_BULLET_LENGTH * 0.35 + trail.width * 0.5;
    trail.setPosition(bullet.x - Math.cos(angle) * offset, bullet.y - Math.sin(angle) * offset);
  }

  private destroyEnemyBullet(bullet: Phaser.GameObjects.Rectangle): void {
    const heldTrail = bullet.getData('heldTrail') as Phaser.GameObjects.Rectangle | undefined;
    if (heldTrail?.active) heldTrail.destroy();
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

    // 下边缘以屏幕底部为统一落脚点，随机宽高和轻微基线差制造拥挤的人群轮廓。
    for (let i = 0; i < 64; i++) {
      addCrowdBar(
        Phaser.Math.Between(6, VIEW_WIDTH - 6),
        Phaser.Math.Between(VIEW_HEIGHT - 7, VIEW_HEIGHT + 4),
        'bottom',
        50,
        42
      );
    }

    // 左右边缘继续使用竖直条；在预留带内随机散布并允许互相遮叠。
    for (let i = 0; i < 38; i++) {
      const y = Phaser.Math.Between(72, VIEW_HEIGHT - 4);
      addCrowdBar(Phaser.Math.Between(6, ARENA.x - 10), y, 'side');
      addCrowdBar(Phaser.Math.Between(ARENA.x + ARENA.width + 10, VIEW_WIDTH - 6), y, 'side');
    }
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

  private updateEnemyBulletMotion(): void {
    const timeToBeat = this.conductor.timeToNextBeat(this.conductor.now());
    const bursting = timeToBeat <= ENEMY_BEAT_BURST_WINDOW;
    const speed = bursting ? ENEMY_BEAT_BURST_SPEED : ENEMY_DRIFT_SPEED;
    for (const obj of this.bullets.getChildren()) {
      const bullet = obj as Phaser.GameObjects.Rectangle;
      const angle = bullet.getData('angle') as number;
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      const wasBursting = Boolean(bullet.getData('bursting'));
      if (bursting && !wasBursting) {
        const heldTrail = bullet.getData('heldTrail') as Phaser.GameObjects.Rectangle | undefined;
        if (heldTrail?.active) heldTrail.destroy();
        bullet.setData('heldTrail', undefined);
      } else if (!bursting && wasBursting) {
        this.createHeldEnemyTrail(bullet);
      }
      bullet.setData('bursting', bursting);
      const heldTrail = bullet.getData('heldTrail') as Phaser.GameObjects.Rectangle | undefined;
      if (heldTrail?.active) this.positionHeldEnemyTrail(bullet, heldTrail);
      body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    }
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

  /** 踩拍闪避的清弹震荡波 */
  triggerShockwave(x: number, y: number, radius: number): void {
    this.sfx.shockwave();
    for (const obj of this.bullets.getChildren().slice()) {
      const bullet = obj as Phaser.GameObjects.Rectangle;
      if (Phaser.Math.Distance.Between(x, y, bullet.x, bullet.y) <= radius) {
        this.destroyEnemyBullet(bullet);
      }
    }
    const shockwaveBaseRadius = worldSize(12);
    const ring = this.add
      .circle(x, y, shockwaveBaseRadius)
      .setStrokeStyle(worldSize(3), 0xffffff, 0.9)
      .setDepth(6);
    this.tweens.add({
      targets: ring,
      scale: radius / shockwaveBaseRadius,
      alpha: 0,
      duration: 250,
      onComplete: () => ring.destroy()
    });
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
    // 顶部连段面板随新武器连段重建
    this.buildPatternPanel(false);
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
