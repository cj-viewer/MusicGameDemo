import Phaser from 'phaser';
import type { Conductor, BeatInfo } from '../core/Conductor';
import type { BeatKey } from './weapons';

/** 攻击输入判定窗口：拍点前后各 0.1 秒 */
export const INPUT_WINDOW = 0.1;

export type InputResult =
  | { type: 'correct'; beatIdx: number; globalBeat: number; rawTimingOffset: number }
  | { type: 'protectedCorrect'; beatIdx: number; globalBeat: number; rawTimingOffset: number }
  | { type: 'wrong'; beatIdx: number }
  | { type: 'ignored'; reason: 'protected' | 'consumed' | 'notStarted' };

export interface BeatTickResult {
  /** 本拍需要系统自动演示的攻击拍序号（0~3） */
  demoAttack?: number;
  /** 自动演示是否在本拍结束 */
  demoEnded?: boolean;
}

/** Fever Time 持续拍数（4 小节） */
export const FEVER_DURATION_BEATS = 16;
export const FEVER_ENERGY_MULTIPLIER = 3;
export const FEVER_ACTIVE_GAIN_SCALE = 0.5;

const LEVEL_DAMAGE_BONUS = [0, 0.1, 0.15, 0.2, 0.25, 0.3];

/**
 * 轻重连段判定 + ComboMeter。
 * 规则见《简化玩法策划案（原型版）》：
 * - 窗口内按对会积攒 Fever 能量；错误输入不积攒，但不会清空或锁定小节；
 * - 空拍无惩罚；换武器后到自动演示结束为保护期（输入忽略、不清零）。
 */
export class ComboSystem {
  progress = 0;
  pattern: [BeatKey, BeatKey, BeatKey, BeatKey];

  /** 保护期（切换武器 + 自动演示）持续到该整数拍 */
  private protectedUntilBeat = -1;
  private demoStart = -1;
  private demoEnd = -1;
  /** 已消耗的拍（防止一拍多次攻击） */
  private consumedBeat = -1;
  /** Fever Time 持续到该整数拍，-1 表示未激活 */
  private feverUntilBeat = -1;
  /** 教学以玩家真实输入时间估算的设备延迟；正值表示输入到达程序时偏晚。 */
  private inputLatencyOffset = 0;

  private conductor: Conductor;

  constructor(conductor: Conductor, pattern: [BeatKey, BeatKey, BeatKey, BeatKey]) {
    this.conductor = conductor;
    this.pattern = pattern;
  }

  get level(): number {
    return this.progress >= 100 ? 5 : Math.floor(this.progress / 20);
  }

  get damageMultiplier(): number {
    return 1 + LEVEL_DAMAGE_BONUS[this.level];
  }

  feverActive(): boolean {
    return this.conductor.beatFloatAt(this.conductor.now()) < this.feverUntilBeat;
  }

  /** Fever 剩余比例 0~1，用于 HUD 倒计时环 */
  feverRemainRatio(): number {
    if (!this.feverActive()) return 0;
    const bf = this.conductor.beatFloatAt(this.conductor.now());
    return Phaser.Math.Clamp((this.feverUntilBeat - bf) / FEVER_DURATION_BEATS, 0, 1);
  }

  /** 按浮点拍位置精确结束 Fever，避免小数拍回充被量化成整拍。 */
  updateFever(): boolean {
    if (this.feverUntilBeat <= 0) return false;
    if (this.conductor.beatFloatAt(this.conductor.now()) < this.feverUntilBeat) return false;
    this.feverUntilBeat = -1;
    this.progress = 0;
    return true;
  }

  /** Meter 满时进入 Fever Time；结束后 Meter 清零重新积累 */
  startFever(): void {
    const bf = this.conductor.beatFloatAt(this.conductor.now());
    this.feverUntilBeat = Math.floor(Math.max(bf, 0)) + FEVER_DURATION_BEATS;
  }

  isProtected(): boolean {
    return this.conductor.beatFloatAt(this.conductor.now()) < this.protectedUntilBeat;
  }

  isDemoActive(): boolean {
    const b = Math.floor(this.conductor.beatFloatAt(this.conductor.now()));
    return b >= this.demoStart && b < this.demoEnd;
  }

  /**
   * 校准值只平移判定时钟，不修改音频节拍本身。限制在 120ms 内，避免一次异常输入扩大窗口。
   */
  setInputLatencyOffset(seconds: number): void {
    this.inputLatencyOffset = Phaser.Math.Clamp(seconds, -0.12, 0.12);
  }

  getInputLatencyOffset(): number {
    return this.inputLatencyOffset;
  }

  handleInput(btn: BeatKey, t: number): InputResult {
    if (!this.conductor.started) return { type: 'ignored', reason: 'notStarted' };
    const rawNearest = this.conductor.nearestBeat(t);
    const judgedTime = t - this.inputLatencyOffset;
    const bf = this.conductor.beatFloatAt(judgedTime);
    if (bf < this.protectedUntilBeat) {
      // 下一完整小节由系统独占演示，避免玩家输入与自动攻击重复计分。
      if (bf >= this.demoStart) return { type: 'ignored', reason: 'protected' };
      const { n, offset } = this.conductor.nearestBeat(judgedTime);
      if (
        Math.abs(offset) <= INPUT_WINDOW &&
        n >= 0 &&
        n !== this.consumedBeat &&
        btn === this.pattern[n % 4]
      ) {
        this.consumedBeat = n;
        this.addCorrectInputProgress(2);
        return { type: 'protectedCorrect', beatIdx: n % 4, globalBeat: n, rawTimingOffset: rawNearest.offset };
      }
      if (n >= 0 && n !== this.consumedBeat) {
        this.consumedBeat = n;
        return { type: 'wrong', beatIdx: n % 4 };
      }
      return { type: 'ignored', reason: 'consumed' };
    }

    const { n, offset } = this.conductor.nearestBeat(judgedTime);
    if (n >= 0 && n === this.consumedBeat) {
      return { type: 'ignored', reason: 'consumed' };
    }

    if (Math.abs(offset) > INPUT_WINDOW || n < 0) {
      if (n >= 0) this.consumedBeat = n;
      return { type: 'wrong', beatIdx: ((n % 4) + 4) % 4 };
    }

    const beatIdx = n % 4;
    if (btn === this.pattern[beatIdx]) {
      this.consumedBeat = n;
      this.addCorrectInputProgress(2);
      return { type: 'correct', beatIdx, globalBeat: n, rawTimingOffset: rawNearest.offset };
    }

    this.consumedBeat = n;
    return { type: 'wrong', beatIdx };
  }

  /** 所有 Fever 能量来源统一按当前获取倍率结算。 */
  addProgress(amount: number): void {
    this.progress = Math.min(100, this.progress + amount * FEVER_ENERGY_MULTIPLIER);
  }

  /**
   * 直接消耗 ComboMeter 点数。普通状态最低扣到 0；Fever 状态按总能量比例缩短持续拍数。
   * 返回 true 表示本次消耗使 Fever 立即结束。
   */
  spendProgress(amount: number): boolean {
    const clampedAmount = Math.max(0, amount);
    if (!this.feverActive()) {
      this.progress = Math.max(0, this.progress - clampedAmount);
      return false;
    }

    const beatFloat = Math.max(0, this.conductor.beatFloatAt(this.conductor.now()));
    this.feverUntilBeat -= (clampedAmount / 100) * FEVER_DURATION_BEATS;
    if (this.feverUntilBeat > beatFloat) return false;

    this.feverUntilBeat = -1;
    this.progress = 0;
    return true;
  }

  private addCorrectInputProgress(amount: number): void {
    if (!this.feverActive()) {
      this.addProgress(amount);
      return;
    }

    const gainedEnergy = amount * FEVER_ENERGY_MULTIPLIER * FEVER_ACTIVE_GAIN_SCALE;
    const extensionBeats = (gainedEnergy / 100) * FEVER_DURATION_BEATS;
    const beatFloat = Math.max(0, this.conductor.beatFloatAt(this.conductor.now()));
    this.feverUntilBeat = Math.min(
      beatFloat + FEVER_DURATION_BEATS,
      this.feverUntilBeat + extensionBeats
    );
  }

  /**
   * 切换武器：当前小节剩余部分为切换阶段，下一完整小节自动演示，再下一小节交还控制。
   */
  startSwitch(pattern: [BeatKey, BeatKey, BeatKey, BeatKey]): void {
    this.pattern = pattern;
    const bf = this.conductor.beatFloatAt(this.conductor.now());
    const m0 = (Math.floor(Math.max(bf, 0) / 4) + 1) * 4;
    this.demoStart = m0;
    this.demoEnd = m0 + 4;
    this.protectedUntilBeat = m0 + 4;
    this.consumedBeat = -1;
  }

  onBeat(info: BeatInfo): BeatTickResult {
    const result: BeatTickResult = {};
    if (info.globalBeat >= this.demoStart && info.globalBeat < this.demoEnd) {
      result.demoAttack = info.beatInMeasure;
      this.addProgress(2);
    }
    if (info.globalBeat === this.demoEnd) {
      result.demoEnded = true;
      this.demoStart = -1;
      this.demoEnd = -1;
    }
    return result;
  }
}
