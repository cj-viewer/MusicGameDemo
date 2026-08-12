import Phaser from 'phaser';
import type { Conductor } from '../core/Conductor';
import type { BeatKey } from './weapons';

const BAR_CENTER_X = 640;
const BAR_Y = 668;
const PANEL_WIDTH = 780;
// Combo 环半径为 22px，向右移动自身宽度的一半，即 22px。
const METER_X = BAR_CENTER_X - 448;
const STATE_X = BAR_CENTER_X + 400;
const HP_X = 20;
// 与 ComboMeter 同一基线放在左下：缩短至不压住圆环。
const HP_Y = BAR_Y;
const HP_WIDTH = 124;
/** 预览未来 3 拍（旧版 2 拍的 1.5 倍），相邻拍间距 120px；到达中心即拍点。 */
const LOOKAHEAD_BEATS = 3;
const NOTE_SPACING = 120;
const TRAVEL_DIST = LOOKAHEAD_BEATS * NOTE_SPACING;

interface NoteView {
  left: Phaser.GameObjects.Shape;
  right: Phaser.GameObjects.Shape;
  consumed: boolean;
}

interface MeasureDividerView {
  left: Phaser.GameObjects.Container;
  right: Phaser.GameObjects.Container;
}

/**
 * 战斗 HUD：
 * 判定条为单中心点样式——节奏块（○轻 ◆重）从两侧向中心移动，汇聚到中心点的瞬间即拍点。
 * 另含 ComboMeter 圆环（Fever 倒计时）、HP 条、波次/状态文本。
 */
export class HUD {
  private scene: Phaser.Scene;
  private conductor: Conductor;

  private notes = new Map<number, NoteView>();
  private measureDividers = new Map<number, MeasureDividerView>();
  private pattern: BeatKey[] = ['L', 'L', 'L', 'L'];
  private weaponName = '';
  private beatGuideVisible = false;

  private centerMark: Phaser.GameObjects.Arc;
  private centerLine: Phaser.GameObjects.Line;
  private meterGfx: Phaser.GameObjects.Graphics;
  private meterText: Phaser.GameObjects.Text;
  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBar: Phaser.GameObjects.Rectangle;
  private hpText: Phaser.GameObjects.Text;
  private waveText: Phaser.GameObjects.Text;
  private stateText: Phaser.GameObjects.Text;
  private weaponText: Phaser.GameObjects.Text;
  private messageText: Phaser.GameObjects.Text;
  private staminaWarnText: Phaser.GameObjects.Text;
  private panel: Phaser.GameObjects.Rectangle;
  private feverText: Phaser.GameObjects.Text;
  private feverMode = false;
  private hpBaseColor = 0x4ade80;
  private hpPulseUntil = 0;

  constructor(scene: Phaser.Scene, conductor: Conductor) {
    this.scene = scene;
    this.conductor = conductor;

    // 判定条背板
    this.panel = scene.add
      .rectangle(BAR_CENTER_X, BAR_Y, PANEL_WIDTH, 60, 0x0f172a, 0.75)
      .setStrokeStyle(1, 0x334155)
      .setDepth(10);

    // 中心判定点
    this.centerMark = scene.add
      .circle(BAR_CENTER_X, BAR_Y, 16)
      .setStrokeStyle(3, 0xffffff, 0.9)
      .setDepth(11);
    this.centerLine = scene.add
      .line(0, 0, BAR_CENTER_X, BAR_Y - 26, BAR_CENTER_X, BAR_Y + 26, 0xffffff, 0.35)
      .setOrigin(0)
      .setDepth(10);

    this.feverText = scene.add
      .text(METER_X, BAR_Y - 42, 'ComboMeter', {
        fontFamily: 'Arial',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#f97316'
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setVisible(true);

    this.meterGfx = scene.add.graphics().setDepth(10);
    this.meterText = scene.add
      .text(METER_X, BAR_Y, '0', { fontFamily: 'Arial', fontSize: '22px', color: '#facc15' })
      .setOrigin(0.5)
      .setDepth(11);

    // HP
    this.hpBarBg = scene.add
      .rectangle(HP_X, HP_Y, HP_WIDTH + 4, 18, 0x0f172a, 0.8)
      .setOrigin(0, 0.5)
      .setStrokeStyle(1, 0x334155)
      .setDepth(10);
    this.hpBar = scene.add.rectangle(HP_X + 2, HP_Y, HP_WIDTH, 14, 0x4ade80).setOrigin(0, 0.5).setDepth(10);
    this.hpText = scene.add
      .text(HP_X + HP_WIDTH / 2 + 2, HP_Y, '100 / 100', { fontFamily: 'Arial', fontSize: '13px', color: '#e2e8f0' })
      .setOrigin(0.5)
      .setDepth(10);

    this.waveText = scene.add
      .text(BAR_CENTER_X, 24, '', { fontFamily: 'Arial', fontSize: '20px', color: '#e2e8f0' })
      .setOrigin(0.5)
      .setDepth(10);

    this.weaponText = scene.add
      .text(BAR_CENTER_X, BAR_Y - 46, '', { fontFamily: 'Arial', fontSize: '15px', color: '#94a3b8' })
      .setOrigin(0.5)
      .setDepth(10);

    this.stateText = scene.add
      .text(STATE_X, BAR_Y, '', { fontFamily: 'Arial', fontSize: '15px', color: '#fbbf24' })
      .setOrigin(0, 0.5)
      .setDepth(10);

    this.messageText = scene.add
      .text(640, 320, '', {
        fontFamily: 'Arial',
        fontSize: '52px',
        color: '#ffffff',
        align: 'center',
        stroke: '#000000',
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setDepth(20);

    this.staminaWarnText = scene.add
      .text(BAR_CENTER_X, BAR_Y - 70, '体力不足！', { fontFamily: 'Arial', fontSize: '16px', color: '#f87171' })
      .setOrigin(0.5)
      .setDepth(10)
      .setAlpha(0);

    this.setCombo(0, 0);
    this.setBeatGuideVisible(false);
  }

  // ---------- 节奏块（两侧向中心汇聚） ----------

  /** 每帧调用：按 Conductor 时钟生成/移动/清理节奏块 */
  update(): void {
    if (!this.conductor.started) return;
    const now = this.conductor.now();
    const bf = this.conductor.beatFloatAt(now);
    this.updateHpAnticipation(now, bf);
    if (!this.beatGuideVisible) return;

    // 补充未来 LOOKAHEAD 内的节奏块
    const first = Math.max(0, Math.ceil(bf));
    const last = Math.max(0, Math.floor(bf + LOOKAHEAD_BEATS));
    for (let n = first; n <= last; n++) {
      if (!this.notes.has(n)) this.spawnNote(n);
    }

    const firstMeasure = Math.max(1, Math.ceil((bf + 0.5) / 4));
    const lastMeasure = Math.floor((bf + LOOKAHEAD_BEATS + 0.5) / 4);
    for (let measure = firstMeasure; measure <= lastMeasure; measure++) {
      if (!this.measureDividers.has(measure)) this.spawnMeasureDivider(measure);
    }

    for (const [n, note] of [...this.notes]) {
      if (note.consumed) continue;
      const beatTime = this.conductor.timeOfBeat(n);
      // 拍点过后 0.25s 仍未被击中 → 淡出移除
      if (now > beatTime + 0.25) {
        this.killNote(n);
        continue;
      }
      const progress = Math.max(0, (beatTime - now) / (this.conductor.beatDur * LOOKAHEAD_BEATS));
      const dx = TRAVEL_DIST * progress;
      note.left.x = BAR_CENTER_X - dx;
      note.right.x = BAR_CENTER_X + dx;
      note.left.setAlpha(0.95);
      note.right.setAlpha(0.95);
    }

    for (const [measure, divider] of [...this.measureDividers]) {
      const boundaryBeat = measure * 4 - 0.5;
      const boundaryTime = this.conductor.timeOfBeat(boundaryBeat);
      if (now > boundaryTime + 0.25) {
        this.killMeasureDivider(measure);
        continue;
      }
      const progress = Math.max(0, (boundaryTime - now) / (this.conductor.beatDur * LOOKAHEAD_BEATS));
      const dx = TRAVEL_DIST * progress;
      divider.left.x = BAR_CENTER_X - dx;
      divider.right.x = BAR_CENTER_X + dx;
      divider.left.setAlpha(1);
      divider.right.setAlpha(1);
    }
  }

  private spawnNote(n: number): void {
    const key = this.pattern[n % 4];
    const make = (): Phaser.GameObjects.Shape =>
      key === 'L'
        ? this.scene.add.circle(0, BAR_Y, 10).setStrokeStyle(3, 0x67e8f9).setDepth(11)
        : this.scene.add.rectangle(0, BAR_Y, 16, 16, 0xfbbf24).setAngle(45).setDepth(11);
    this.notes.set(n, { left: make(), right: make(), consumed: false });
  }

  private killNote(n: number): void {
    const note = this.notes.get(n);
    if (!note) return;
    this.notes.delete(n);
    this.scene.tweens.add({
      targets: [note.left, note.right],
      alpha: 0,
      duration: 120,
      onComplete: () => {
        note.left.destroy();
        note.right.destroy();
      }
    });
  }

  private spawnMeasureDivider(measure: number): void {
    const make = (): Phaser.GameObjects.Container => {
      const lineA = this.scene.add.rectangle(-4, 0, 4, 44, 0xf472b6).setStrokeStyle(1, 0xffffff, 0.9);
      const lineB = this.scene.add.rectangle(4, 0, 4, 44, 0xa855f7).setStrokeStyle(1, 0xffffff, 0.9);
      return this.scene.add.container(0, BAR_Y, [lineA, lineB]).setDepth(12);
    };
    this.measureDividers.set(measure, { left: make(), right: make() });
  }

  private killMeasureDivider(measure: number): void {
    const divider = this.measureDividers.get(measure);
    if (!divider) return;
    this.measureDividers.delete(measure);
    this.scene.tweens.add({
      targets: [divider.left, divider.right],
      alpha: 0,
      duration: 120,
      onComplete: () => {
        divider.left.destroy(true);
        divider.right.destroy(true);
      }
    });
  }

  /** 成功命中：对应节奏块在中心合并爆闪 */
  flashSuccess(globalBeat: number): void {
    if (!this.beatGuideVisible) return;
    const note = this.notes.get(globalBeat);
    if (note && !note.consumed) {
      note.consumed = true;
      this.notes.delete(globalBeat);
      this.scene.tweens.add({
        targets: [note.left, note.right],
        x: BAR_CENTER_X,
        scaleX: 1.6,
        scaleY: 1.6,
        alpha: 0,
        duration: 130,
        onComplete: () => {
          note.left.destroy();
          note.right.destroy();
        }
      });
    }
    const burst = this.scene.add.circle(BAR_CENTER_X, BAR_Y, 16).setStrokeStyle(3, 0xffffff, 0.9).setDepth(11);
    this.scene.tweens.add({
      targets: burst,
      scale: 2.2,
      alpha: 0,
      duration: 200,
      onComplete: () => burst.destroy()
    });
  }

  /** 错误输入只提供瞬时反馈，不再锁定本小节。 */
  flashError(): void {
    if (this.beatGuideVisible) this.centerMark.setStrokeStyle(3, 0xef4444, 0.9);
    this.scene.cameras.main.shake(100, 0.003);
    if (this.beatGuideVisible) {
      this.scene.time.delayedCall(180, () => this.centerMark.setStrokeStyle(3, 0xffffff, 0.9));
    }
  }

  setPattern(pattern: BeatKey[], weaponName: string): void {
    this.pattern = pattern;
    this.weaponName = weaponName;
    // 已生成的节奏块按旧连段显示，直接清掉按新连段重新生成
    for (const n of [...this.notes.keys()]) this.killNote(n);
    this.refreshWeaponText();
  }

  /** 上下节拍提示只在教学中显示；正式游戏仅保留武器名和 ComboMeter。 */
  setBeatGuideVisible(visible: boolean): void {
    this.beatGuideVisible = visible;
    this.panel.setVisible(visible);
    this.centerMark.setVisible(visible);
    this.centerLine.setVisible(visible);
    this.refreshWeaponText();

    if (visible) return;
    for (const note of this.notes.values()) {
      note.left.destroy();
      note.right.destroy();
    }
    this.notes.clear();
    for (const divider of this.measureDividers.values()) {
      divider.left.destroy(true);
      divider.right.destroy(true);
    }
    this.measureDividers.clear();
  }

  private refreshWeaponText(): void {
    if (!this.weaponName) {
      this.weaponText.setText('');
      return;
    }
    const patternText = this.pattern.map((key) => (key === 'L' ? '轻' : '重')).join(' → ');
    this.weaponText.setText(this.beatGuideVisible ? `${this.weaponName}　${patternText}` : this.weaponName);
  }

  onBeat(beatInMeasure: number): void {
    if (this.beatGuideVisible) {
      // 教学中的底部中心点随节拍脉冲
      this.centerMark.setScale(1.35);
      this.scene.tweens.add({ targets: this.centerMark, scaleX: 1, scaleY: 1, duration: 160 });
    }

    const heavy = this.pattern[beatInMeasure] === 'H';
    this.scene.tweens.killTweensOf([this.hpBarBg, this.hpBar]);
    this.hpPulseUntil = this.scene.time.now + (heavy ? 250 : 195);
    this.hpBarBg.scaleY = heavy ? 1.5 : 1.26;
    this.hpBar.scaleY = heavy ? 1.5 : 1.26;
    this.hpBar.setFillStyle(this.shiftColor(this.hpBaseColor, heavy ? 5 : 3, heavy ? 5 : 3));
    this.scene.tweens.add({
      targets: [this.hpBarBg, this.hpBar],
      scaleY: 1,
      duration: heavy ? 250 : 195,
      ease: 'Back.easeOut',
      onComplete: () => this.hpBar.setFillStyle(this.hpBaseColor)
    });
  }

  private updateHpAnticipation(now: number, beatFloat: number): void {
    if (this.scene.time.now < this.hpPulseUntil) return;
    const timeToBeat = this.conductor.timeToNextBeat(now);
    const anticipationWindow = this.conductor.beatDur * 0.42;
    const progress = Phaser.Math.Clamp(1 - timeToBeat / anticipationWindow, 0, 1);
    const eased = progress * progress;
    const nextBeat = Math.floor(beatFloat) + 1;
    const beatInMeasure = ((nextBeat % 4) + 4) % 4;
    const heavy = this.pattern[beatInMeasure] === 'H';
    const compressedScale = heavy ? 0.62 : 0.84;
    const scaleY = Phaser.Math.Linear(1, compressedScale, eased);
    this.hpBarBg.scaleY = scaleY;
    this.hpBar.scaleY = scaleY;
    const targetColor = this.shiftColor(this.hpBaseColor, heavy ? 5 : 3, heavy ? 5 : 3);
    this.hpBar.setFillStyle(this.interpolateRgb(this.hpBaseColor, targetColor, eased));
  }

  private shiftColor(colorValue: number, lighten: number, desaturate: number): number {
    const color = Phaser.Display.Color.ValueToColor(colorValue);
    color.lighten(lighten);
    color.desaturate(desaturate);
    return color.color;
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

  // ---------- ComboMeter / Fever ----------

  /**
   * 节拍脉冲：在 ComboMeter 处随节拍扩散圆环，等级越高越亮越大（积累感）；
   * Fever 期间脉冲最强并同步闪烁判定条边框。
   */
  beatPulse(level: number, fever: boolean): void {
    if (level <= 0 && !fever) return;
    const colors = [0x475569, 0x67e8f9, 0x67e8f9, 0xfacc15, 0xfacc15, 0xf97316];
    const color = fever ? 0xf97316 : colors[level];
    const ring = this.scene.add
      .circle(METER_X, BAR_Y, 22)
      .setStrokeStyle(fever ? 4 : 2 + level * 0.4, color, 0.9)
      .setDepth(10);
    this.scene.tweens.add({
      targets: ring,
      scale: fever ? 2.6 : 1.3 + level * 0.2,
      alpha: 0,
      duration: fever ? 400 : 300,
      onComplete: () => ring.destroy()
    });
    if (fever && this.beatGuideVisible) {
      this.panel.setStrokeStyle(3, 0xf97316, 1);
      this.scene.tweens.add({
        targets: this.feverText,
        scaleX: 1.4,
        scaleY: 1.4,
        yoyo: true,
        duration: 120
      });
    }
  }

  /** 进入 Fever Time 的爆发演出 */
  feverBurst(): void {
    const burst = this.scene.add
      .text(640, 360, 'FEVER TIME!', {
        fontFamily: 'Arial',
        fontSize: '72px',
        fontStyle: 'bold',
        color: '#f97316',
        stroke: '#ffffff',
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setScale(0.3)
      .setAlpha(0);
    this.scene.tweens.add({
      targets: burst,
      scale: 1,
      alpha: 1,
      duration: 250,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: burst,
          alpha: 0,
          y: 320,
          delay: 700,
          duration: 400,
          onComplete: () => burst.destroy()
        });
      }
    });
    // 判定条处的入场冲击环
    for (let i = 0; i < 3; i++) {
      const ring = this.scene.add
        .circle(METER_X, BAR_Y, 22)
        .setStrokeStyle(5, 0xf97316, 0.9)
        .setDepth(10);
      this.scene.tweens.add({
        targets: ring,
        scale: 4 + i * 2,
        alpha: 0,
        duration: 500,
        delay: i * 120,
        onComplete: () => ring.destroy()
      });
    }
  }

  setFever(active: boolean): void {
    this.feverMode = active;
    if (!active) {
      if (this.beatGuideVisible) this.panel.setStrokeStyle(1, 0x334155);
      this.feverText.setColor('#facc15');
      this.meterText.setColor('#facc15');
    } else {
      this.feverText.setColor('#f97316');
      this.meterText.setColor('#f97316');
    }
  }

  /** Fever 倒计时环（替代常规进度环） */
  setFeverCountdown(ratio: number): void {
    if (!this.feverMode) return;
    this.meterGfx.clear();
    this.meterGfx.lineStyle(3, 0x334155, 1);
    this.meterGfx.strokeCircle(METER_X, BAR_Y, 22);
    if (ratio > 0) {
      this.meterGfx.lineStyle(5, 0xf97316, 1);
      this.meterGfx.beginPath();
      this.meterGfx.arc(METER_X, BAR_Y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
      this.meterGfx.strokePath();
    }
    this.meterText.setText('F');
  }

  setCombo(progress: number, level: number): void {
    if (this.feverMode) return;
    this.meterGfx.clear();
    this.meterGfx.lineStyle(3, 0x334155, 1);
    this.meterGfx.strokeCircle(METER_X, BAR_Y, 22);
    const toNext = level >= 5 ? 1 : (progress - level * 20) / 20;
    if (toNext > 0) {
      this.meterGfx.lineStyle(4, level >= 5 ? 0xf97316 : 0xfacc15, 1);
      this.meterGfx.beginPath();
      this.meterGfx.arc(METER_X, BAR_Y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * toNext, false);
      this.meterGfx.strokePath();
    }
    this.meterText.setText(level > 0 ? `${level}` : '');
  }

  pulseCombo(): void {
    this.scene.tweens.add({
      targets: this.meterText,
      scaleX: 1.6,
      scaleY: 1.6,
      yoyo: true,
      duration: 120
    });
  }

  // ---------- 其他 ----------

  setState(text: string): void {
    this.stateText.setText(text);
  }

  setHp(hp: number, maxHp: number): void {
    this.hpBar.scaleX = Math.max(0, hp / maxHp);
    this.hpBaseColor = hp <= 30 ? 0xef4444 : 0x4ade80;
    if (this.scene.time.now >= this.hpPulseUntil) this.hpBar.setFillStyle(this.hpBaseColor);
    this.hpText.setText(`${hp} / ${maxHp}`);
  }

  setWave(text: string): void {
    this.waveText.setText(text);
  }

  message(text: string): void {
    this.messageText.setText(text);
  }

  flashStaminaWarning(): void {
    this.staminaWarnText.setAlpha(1);
    this.scene.tweens.add({ targets: this.staminaWarnText, alpha: 0, duration: 600, delay: 200 });
  }
}
