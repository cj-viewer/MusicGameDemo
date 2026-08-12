import Phaser from 'phaser';
import { Conductor, type BeatInfo } from '../core/Conductor';
import { Sfx } from '../core/Sfx';
import { ComboSystem } from '../game/ComboSystem';
import { HUD } from '../game/HUD';
import { Player, PLAYER_RADIUS } from '../game/Player';
import { BATON, GLOWSTICKS, getAttackSpec, type WeaponDef } from '../game/weapons';
import { Enemy, FanEnemy, SmallGuard } from '../game/enemies';
import { GAMEPAD_BUTTON, rumbleParameters, type RumbleKind } from '../game/GamepadControls';

// bgm3.mp3 的实测节拍：对全曲 onset 包络做自相关 + 网格相位搜索得出 BPM，首拍在文件内 0.026s 处。
const BPM = 146.32;
const BGM_FIRST_BEAT_OFFSET = 0.026;
const BGM_VOLUME = 0.5;
const ARENA = { x: 12, y: 12, width: 1256, height: 696 };
const PLAYER_BULLET_LENGTH = 38;
const ENEMY_BULLET_LENGTH = 36 * 0.75;
const BULLET_THICKNESS = 10;
const ENEMY_BULLET_THICKNESS = BULLET_THICKNESS * 0.75;
const PLAYER_BULLET_SPEED = 320;
const ENEMY_DRIFT_SPEED = 6;
const ENEMY_BEAT_BURST_SPEED = 600;
const ENEMY_BEAT_BURST_WINDOW = 0.1;
const PLAYER_BULLET_COLOR = 0xef4444;
const BATON_BULLET_COLOR = 0xa855f7;
const GLOWSTICK_KNOCKBACK_SPEED = 150;
const BATON_KNOCKBACK_SPEED = GLOWSTICK_KNOCKBACK_SPEED * 1.25;

type GameState = 'title' | 'playing' | 'intermission' | 'over';
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
  private pendingBeatSfx = new Set<BeatSfxCue>();
  private gamepadButtonState = { dodge: false, attack: false };
  /** 调试：B 键切换判定框显示（红=受击判定，绿=武器/子弹判定），重开局保留开关状态 */
  private debugHitboxes = false;
  private debugGfx!: Phaser.GameObjects.Graphics;

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
    this.pendingBeatSfx.clear();
    this.gamepadButtonState = { dodge: false, attack: false };
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

    this.conductor = new Conductor(this, BPM);
    this.sfx = new Sfx(this.conductor.ctx);
    this.bgm = this.sound.add('bgm', { loop: true, volume: BGM_VOLUME });
    this.combo = new ComboSystem(this.conductor, GLOWSTICKS.pattern);
    this.hud = new HUD(this, this.conductor);
    this.player = new Player(this, 640, 400);

    this.hud.setPattern(GLOWSTICKS.pattern, GLOWSTICKS.name);
    this.conductor.setCuePattern(GLOWSTICKS.pattern);
    this.hud.setHp(this.player.hp, this.player.maxHp);

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
    this.showTitle();
  }

  update(_time: number, delta: number): void {
    this.conductor.update();
    this.hud.update();
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
      if (this.state === 'title') {
        this.startGame();
        return;
      }
      if (this.state === 'over') return;

      const btn = pointer.rightButtonDown() ? 'H' : pointer.leftButtonDown() ? 'L' : null;
      if (!btn) return;
      this.handleAttackInput(btn);
    });

    this.input.keyboard!.on('keydown-SHIFT', () => {
      if (this.state === 'playing' || this.state === 'intermission') {
        this.player.tryDodge();
      }
    });

    this.input.keyboard!.on('keydown-R', () => {
      this.scene.restart();
    });

    // 调试：B 键切换判定框显示
    this.input.keyboard!.on('keydown-B', () => {
      this.debugHitboxes = !this.debugHitboxes;
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
      this.conductor.registerCorrectAttack(result.globalBeat);
      this.performWeaponAttack(result.beatIdx, false, 5, true);
      this.hud.flashSuccess(result.globalBeat);
      this.refreshComboHUD();
      if (pad) this.rumbleGamepad(pad, btn === 'H' ? 'heavy' : 'light');
    } else if (result.type === 'wrong') {
      this.performWeaponAttack(result.beatIdx, false, 1, false);
      this.sfx.error();
      this.player.errorFlash();
      this.hud.flashError();
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
    if (this.state !== 'playing' && this.state !== 'intermission') return;

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
    this.playBgmAlignedToBeat();
    this.state = 'intermission';
    this.time.delayedCall(400, () => this.startWave(0));
  }

  /**
   * 让 bgm3.mp3 的首拍（文件内 BGM_FIRST_BEAT_OFFSET 秒处）与 Conductor 的第 0 拍对齐：
   * 若倒数时间足够则用 delay 等到那一刻播放，否则直接以 seek 跳过已经过去的部分。
   */
  private playBgmAlignedToBeat(): void {
    const delayToBeat0 = this.conductor.timeOfBeat(0) - this.conductor.now();
    if (delayToBeat0 >= BGM_FIRST_BEAT_OFFSET) {
      this.bgm.play({ delay: delayToBeat0 - BGM_FIRST_BEAT_OFFSET });
    } else {
      this.bgm.play({ seek: BGM_FIRST_BEAT_OFFSET - delayToBeat0 });
    }
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

    const tick = this.combo.onBeat(info);
    if (tick.demoAttack !== undefined) {
      this.hud.setState('自动演示中…');
      this.performWeaponAttack(tick.demoAttack, true, 5, true);
      this.hud.flashSuccess(info.globalBeat);
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

    const damage = spec.kind === 'charge' ? 8 : spec.damage;
    this.sfx.attack(heavy);
    this.player.playAttackAnimation(angle);
    if (weapon.id === 'baton') {
      this.spawnBatonSweep(
        this.player.x,
        this.player.y,
        angle,
        damage * mult,
        enableFever ? 3 : 1,
        heavy
      );
    } else {
      this.spawnPlayerShotgun(
        this.player.x,
        this.player.y,
        angle,
        heavy ? 560 : 480,
        damage * mult,
        PLAYER_BULLET_COLOR,
        pelletCount
      );
    }

    if (weapon.id !== 'baton' && spec.kind === 'charge') {
      const ring = this.add.circle(this.player.x, this.player.y, 20).setStrokeStyle(3, spec.color, 0.9).setDepth(6);
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
        gfx.lineStyle(5, 0xf97316, 1 - counter.value * 0.8);
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
      x + Math.cos(angle) * 26,
      y + Math.sin(angle) * 26,
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
    pelletCount: number
  ): void {
    const judgedBeat = this.conductor.nearestBeat(this.conductor.now()).n;
    const despawnBeat = Math.max(0, judgedBeat + 1);
    for (let i = 0; i < pelletCount; i++) {
      const offset = pelletCount === 1 ? 0 : -15 + (30 * i) / (pelletCount - 1);
      const shotAngle = angle + Phaser.Math.DegToRad(offset);
      const bullet = this.add.rectangle(
        x + Math.cos(shotAngle) * (PLAYER_RADIUS + 8),
        y + Math.sin(shotAngle) * (PLAYER_RADIUS + 8),
        PLAYER_BULLET_LENGTH,
        BULLET_THICKNESS,
        color
      ).setRotation(shotAngle).setDepth(4);
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
    heavy: boolean
  ): void {
    const clockwise = !heavy;
    const halfSweep = heavy ? Math.PI / 3 : Math.PI / 4;
    const startAngle = aimAngle + (clockwise ? -halfSweep : halfSweep);
    const endAngle = aimAngle + (clockwise ? halfSweep : -halfSweep);
    const middleRadius = 74 * 1.25;
    const layerSpacing = 20 * 1.15;
    const radii = bulletCount === 1
      ? [middleRadius]
      : [middleRadius - layerSpacing, middleRadius, middleRadius + layerSpacing];
    const lengthScales = bulletCount === 1 ? [1] : [0.5, 1, 1.5];
    const baseLength = (heavy ? 62 : 46) * 1.5;
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
        const length = Phaser.Math.Clamp(speed * 0.045, 8, 42);
        const alpha = Phaser.Math.Clamp(0.06 + speed / 4000, 0.08, 0.24);
        const color = (bullet.getData('trailColor') as number | undefined) ?? bullet.fillColor;
        const thickness = (bullet.getData('trailThickness') as number | undefined) ?? BULLET_THICKNESS;
        const trail = this.add
          .rectangle(
            bullet.x - Math.cos(angle) * length * 0.55,
            bullet.y - Math.sin(angle) * length * 0.55,
            length,
            Math.max(3, thickness * 0.65),
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
    const ring = this.add.circle(x, y, strong ? 20 : 10).setStrokeStyle(strong ? 5 : 3, color, 0.95).setDepth(8);
    this.tweens.add({
      targets: ring,
      scale: strong ? 3 : 2,
      alpha: 0,
      duration: strong ? 260 : 140,
      onComplete: () => ring.destroy()
    });
    for (let i = 0; i < (strong ? 8 : 4); i++) {
      const sparkAngle = (Math.PI * 2 * i) / (strong ? 8 : 4);
      const spark = this.add.rectangle(x, y, strong ? 12 : 8, 3, i % 2 === 0 ? color : 0xffffff).setDepth(8);
      spark.setRotation(sparkAngle);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(sparkAngle) * (strong ? 42 : 24),
        y: y + Math.sin(sparkAngle) * (strong ? 42 : 24),
        alpha: 0,
        duration: strong ? 220 : 120,
        onComplete: () => spark.destroy()
      });
    }
    this.cameras.main.shake(strong ? 130 : 45, strong ? 0.005 : 0.0015);
    if (strong) this.cameras.main.flash(90, 255, 40, 40, false);
  }

  private createRhythmEdgeBlocks(): void {
    const heights = [18, 34, 25, 46, 22, 39, 28, 52];
    const colors = [0x9333ea, 0xc084fc, 0xdb2777, 0xf472b6];
    const edgeXs = [44, 86, 128, 170, 212, 254, 296, 338, 942, 984, 1026, 1068, 1110, 1152, 1194, 1236];
    edgeXs.forEach((x, index) => {
      const height = heights[index % heights.length];
      const color = colors[index % colors.length];
      const top = this.add.rectangle(x, ARENA.y, 22, height, color, 0.2).setOrigin(0.5, 0).setDepth(1);
      const bottom = this.add
        .rectangle(x, ARENA.y + ARENA.height, 22, height, color, 0.2)
        .setOrigin(0.5, 1)
        .setDepth(1);
      this.rhythmBlocks.push(top, bottom);
    });
  }

  private pulseRhythmEdgeBlocks(heavy: boolean): void {
    this.tweens.killTweensOf(this.rhythmBlocks);
    for (const block of this.rhythmBlocks) {
      block.setScale(1);
      block.setAlpha(heavy ? 0.55 : 0.32);
    }
    this.tweens.add({
      targets: this.rhythmBlocks,
      scaleY: heavy ? 1.9 : 1.25,
      alpha: heavy ? 0.85 : 0.48,
      duration: heavy ? 150 : 100,
      yoyo: true,
      ease: 'Quad.easeOut'
    });
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
    const ring = this.add.circle(x, y, 12).setStrokeStyle(3, 0xffffff, 0.9).setDepth(6);
    this.tweens.add({
      targets: ring,
      scale: radius / 12,
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
        parts.push(this.add.rectangle(offset, 0, 30, 7.5, 0xef4444).setRotation(-Math.PI / 2));
        colors.push(0xef4444);
      }
    } else {
      parts.push(this.add.rectangle(0, 0, 51, 9, 0xa855f7).setRotation(-Math.PI / 2));
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

    // Meter 满 → 进入 Fever Time
    if (level === 5 && !this.combo.feverActive()) {
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
