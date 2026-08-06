import Phaser from 'phaser';
import { Conductor, type BeatInfo } from '../core/Conductor';
import { Sfx } from '../core/Sfx';
import { ComboSystem } from '../game/ComboSystem';
import { HUD } from '../game/HUD';
import { Player } from '../game/Player';
import { BATON, GLOWSTICKS, getAttackSpec, type WeaponDef } from '../game/weapons';
import { BigFan, Enemy, MidGuard, SmallGuard, type EnemyKind } from '../game/enemies';

const BPM = 120;
const ARENA = { x: 12, y: 12, width: 1256, height: 696 };

type GameState = 'title' | 'playing' | 'intermission' | 'over';

const WAVES: EnemyKind[][] = [
  ['smallGuard', 'smallGuard'],
  ['smallGuard', 'smallGuard', 'midGuard'],
  ['smallGuard', 'midGuard', 'bigFan']
];

const SPAWN_POINTS: [number, number][] = [
  [120, 120],
  [1160, 120],
  [120, 600],
  [1160, 600],
  [640, 110]
];

interface Pickup {
  go: Phaser.GameObjects.Rectangle;
  weapon: WeaponDef;
}

export class MainScene extends Phaser.Scene {
  conductor!: Conductor;
  sfx!: Sfx;
  combo!: ComboSystem;
  hud!: HUD;
  player!: Player;

  private enemies: Enemy[] = [];
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private pickups: Pickup[] = [];
  private state: GameState = 'title';
  private waveIdx = -1;
  private lastComboLevel = 0;
  private feverBorder!: Phaser.GameObjects.Graphics;

  constructor() {
    super('MainScene');
  }

  create(): void {
    this.enemies = [];
    this.pickups = [];
    this.state = 'title';
    this.waveIdx = -1;
    this.lastComboLevel = 0;

    this.physics.world.setBounds(ARENA.x, ARENA.y, ARENA.width, ARENA.height);
    const border = this.add.graphics().setDepth(1);
    border.lineStyle(3, 0x475569, 1);
    border.strokeRect(ARENA.x, ARENA.y, ARENA.width, ARENA.height);

    // Fever Time 期间的橙色边框光效（随节拍脉冲）
    this.feverBorder = this.add.graphics().setDepth(7).setAlpha(0);
    this.feverBorder.lineStyle(6, 0xf97316, 1);
    this.feverBorder.strokeRect(ARENA.x + 3, ARENA.y + 3, ARENA.width - 6, ARENA.height - 6);

    this.conductor = new Conductor(this, BPM);
    this.sfx = new Sfx(this.conductor.ctx);
    this.combo = new ComboSystem(this.conductor, GLOWSTICKS.pattern);
    this.hud = new HUD(this, this.conductor);
    this.player = new Player(this, 640, 400);

    this.hud.setPattern(GLOWSTICKS.pattern, GLOWSTICKS.name);
    this.hud.setHp(this.player.hp, this.player.maxHp);

    this.enemyGroup = this.physics.add.group();
    this.bullets = this.physics.add.group();

    this.physics.add.collider(this.player.go, this.enemyGroup);
    this.physics.add.collider(this.enemyGroup, this.enemyGroup);
    this.physics.add.overlap(this.player.go, this.bullets, (_playerGO, bulletGO) => {
      if (this.state !== 'playing') return;
      const bullet = bulletGO as Phaser.GameObjects.Arc;
      this.player.takeDamage(bullet.getData('damage') as number);
      bullet.destroy();
    });

    this.conductor.on('beat', this.onBeat, this);

    this.setupInput();
    this.showTitle();
  }

  update(_time: number, delta: number): void {
    this.conductor.update();
    this.hud.update();

    if (this.state === 'over' || this.state === 'title') return;

    this.player.update(this.time.now);
    for (const enemy of this.enemies) enemy.update(delta);
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

      const result = this.combo.handleInput(btn, this.conductor.now());
      if (result.type === 'correct') {
        this.performWeaponAttack(result.beatIdx, false);
        this.hud.flashSuccess(result.globalBeat);
        this.refreshComboHUD();
      } else if (result.type === 'wrong') {
        this.sfx.error();
        this.player.errorFlash();
        this.hud.setLockedVisual();
        this.refreshComboHUD();
      }
    });

    this.input.keyboard!.on('keydown-SPACE', () => {
      if (this.state === 'playing' || this.state === 'intermission') {
        this.player.tryDodge();
      }
    });

    this.input.keyboard!.on('keydown-R', () => {
      this.scene.restart();
    });

    // 原型调试键：F 直接充满 ComboMeter，便于快速验证 Fever Time
    this.input.keyboard!.on('keydown-F', () => {
      if (this.state === 'playing' || this.state === 'intermission') {
        this.combo.addProgress(100);
        this.refreshComboHUD();
      }
    });
  }

  // ---------- 流程 ----------

  private showTitle(): void {
    this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.6).setDepth(19).setName('titleOverlay');
    this.hud.message(
      '音乐弹幕原型\n\n' +
        'WASD 移动 · 鼠标瞄准\n左键=轻攻击 · 右键=重攻击（按节拍连段）\n空格=闪避（踩拍消耗减半并清弹）\n\n点击开始'
    );
  }

  private startGame(): void {
    this.children.getByName('titleOverlay')?.destroy();
    this.hud.message('');
    this.conductor.start();
    this.state = 'intermission';
    this.time.delayedCall(400, () => this.startWave(0));
  }

  private startWave(idx: number): void {
    if (this.state === 'over') return;
    this.waveIdx = idx;
    this.state = 'playing';
    this.hud.setWave(`Wave ${idx + 1} / ${WAVES.length}`);
    this.flashMessage(`WAVE ${idx + 1}`);

    WAVES[idx].forEach((kind, i) => {
      const [x, y] = SPAWN_POINTS[i % SPAWN_POINTS.length];
      let enemy: Enemy;
      if (kind === 'smallGuard') enemy = new SmallGuard(this, x, y);
      else if (kind === 'midGuard') enemy = new MidGuard(this, x, y);
      else enemy = new BigFan(this, x, y);
      this.enemies.push(enemy);
      this.enemyGroup.add(enemy.go);
    });
  }

  onEnemyKilled(enemy: Enemy): void {
    this.enemies = this.enemies.filter((e) => e !== enemy);

    // 小型保安掉落伸缩警棍
    if (enemy.kind === 'smallGuard') {
      this.spawnPickup(enemy.x, enemy.y, BATON);
    }

    if (this.enemies.length === 0 && this.state === 'playing') {
      if (this.waveIdx >= WAVES.length - 1) {
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

  onPlayerDied(): void {
    this.state = 'over';
    this.player.go.setAlpha(0.3);
    this.hud.message('FAILED...\n\n按 R 重新开始');
  }

  private flashMessage(text: string): void {
    this.hud.message(text);
    this.time.delayedCall(1200, () => {
      if (this.state !== 'over') this.hud.message('');
    });
  }

  // ---------- 节拍 ----------

  private onBeat(info: BeatInfo): void {
    if (this.state === 'over' || this.state === 'title') return;

    this.player.onBeat();
    this.hud.onBeat(info.beatInMeasure);

    const tick = this.combo.onBeat(info);
    if (tick.demoAttack !== undefined) {
      this.hud.setState('自动演示中…');
      this.performWeaponAttack(tick.demoAttack, true);
      this.hud.flashSuccess(info.globalBeat);
      this.refreshComboHUD();
    }
    if (tick.demoEnded) {
      this.hud.setState('');
    }

    if (tick.feverEnded) {
      this.sfx.feverEnd();
      this.hud.setFever(false);
      this.tweens.add({ targets: this.feverBorder, alpha: 0, duration: 300 });
      this.lastComboLevel = 0; // Fever 结束清零不再额外播放 comboBreak 音
      this.refreshComboHUD();
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

  private performWeaponAttack(beatIdx: number, _demo: boolean): void {
    const weapon = this.player.weapon;
    const spec = getAttackSpec(weapon.id, beatIdx);
    const mult = this.combo.damageMultiplier;
    const heavy = weapon.pattern[beatIdx] === 'H';
    const angle = this.player.aimAngle;

    if (spec.kind === 'arc') {
      this.sfx.attack(heavy);
      this.spawnArcFx(this.player.x, this.player.y, angle, spec.radius, spec.halfArcDeg, spec.color);
      this.damageEnemiesInArc(this.player.x, this.player.y, angle, spec.radius, spec.halfArcDeg, spec.damage * mult);
    } else if (spec.kind === 'charge') {
      this.sfx.attack(heavy);
      const ring = this.add.circle(this.player.x, this.player.y, 20).setStrokeStyle(3, spec.color, 0.9).setDepth(6);
      this.tweens.add({ targets: ring, scale: 1.8, alpha: 0, duration: 250, onComplete: () => ring.destroy() });
    } else if (spec.kind === 'dash') {
      this.sfx.attack(heavy);
      this.performDash(spec.distance, spec.damage * mult, spec.color, angle);
    }

    // Fever Time：每次成功攻击额外释放清屏音波（轻=扇形，重=全圆）
    if (this.combo.feverActive()) {
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
          const bullet = obj as Phaser.GameObjects.Arc;
          if (inSector(bullet.x, bullet.y, radius)) bullet.destroy();
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

  private performDash(distance: number, damage: number, color: number, angle: number): void {
    const p = this.player;
    if (p.isDodging) return;
    const bounds = this.physics.world.bounds;
    const tx = Phaser.Math.Clamp(p.x + Math.cos(angle) * distance, bounds.left + 20, bounds.right - 20);
    const ty = Phaser.Math.Clamp(p.y + Math.sin(angle) * distance, bounds.top + 20, bounds.bottom - 20);
    p.isDodging = true;
    p.body.setVelocity(0, 0);
    p.body.enable = false;
    this.tweens.add({
      targets: p.go,
      x: tx,
      y: ty,
      duration: 150,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        p.isDodging = false;
        p.body.enable = true;
        p.body.reset(p.go.x, p.go.y);
        this.spawnArcFx(p.x, p.y, angle, 55, 180, color);
        this.damageEnemiesInArc(p.x, p.y, angle, 55, 180, damage);
      }
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

  spawnBullet(x: number, y: number, angle: number, speed: number, damage: number, color: number): void {
    const bullet = this.add.circle(x, y, 5, color).setDepth(4);
    this.bullets.add(bullet);
    const body = bullet.body as Phaser.Physics.Arcade.Body;
    body.setCircle(5);
    const v = this.physics.velocityFromRotation(angle, speed);
    body.setVelocity(v.x, v.y);
    bullet.setData('damage', damage);
  }

  private cleanupBullets(): void {
    const pad = 30;
    for (const obj of this.bullets.getChildren().slice()) {
      const bullet = obj as Phaser.GameObjects.Arc;
      if (
        bullet.x < ARENA.x - pad ||
        bullet.x > ARENA.x + ARENA.width + pad ||
        bullet.y < ARENA.y - pad ||
        bullet.y > ARENA.y + ARENA.height + pad
      ) {
        bullet.destroy();
      }
    }
  }

  /** 踩拍闪避的清弹震荡波 */
  triggerShockwave(x: number, y: number, radius: number): void {
    this.sfx.shockwave();
    for (const obj of this.bullets.getChildren().slice()) {
      const bullet = obj as Phaser.GameObjects.Arc;
      if (Phaser.Math.Distance.Between(x, y, bullet.x, bullet.y) <= radius) {
        bullet.destroy();
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
    const go = this.add.rectangle(x, y, 24, 10, 0xfbbf24).setDepth(2);
    this.tweens.add({ targets: go, angle: 360, duration: 2000, repeat: -1 });
    this.tweens.add({ targets: go, y: y - 8, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.pickups.push({ go, weapon });
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
    this.sfx.pickup();
    this.player.weapon = weapon;
    this.combo.startSwitch(weapon.pattern);
    this.hud.setPattern(weapon.pattern, weapon.name);
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
    this.sfx.feverStart();
    this.hud.setFever(true);
    this.hud.feverBurst();
    this.cameras.main.shake(200, 0.005);
    this.feverBorder.setAlpha(0.9);
  }
}
