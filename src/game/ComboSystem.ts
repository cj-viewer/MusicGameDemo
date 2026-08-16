import Phaser from 'phaser';
import type { Conductor } from '../core/Conductor';
import type { BeatKey } from './weapons';

/** Perfect：校准后距离拍点不超过 0.1 秒。 */
export const PERFECT_INPUT_WINDOW = 0.1;
/** 攻击输入判定窗口：拍点前可提前 0.2 秒。 */
export const INPUT_EARLY_WINDOW = 0.2;
/** 攻击输入判定窗口：拍点后同样保留 0.2 秒，构成对称的 Good 区间。 */
export const INPUT_LATE_WINDOW = 0.2;

export type AttackJudgement = 'perfect' | 'good' | 'poor';

/** `offset` 为相对最近拍点的秒数：负值代表提前，正值代表滞后。 */
export function isWithinAttackInputWindow(offset: number): boolean {
  return offset >= -INPUT_EARLY_WINDOW && offset <= INPUT_LATE_WINDOW;
}

export function getAttackJudgement(offset: number): AttackJudgement {
  const absoluteOffset = Math.abs(offset);
  if (absoluteOffset <= PERFECT_INPUT_WINDOW) return 'perfect';
  if (isWithinAttackInputWindow(offset)) return 'good';
  return 'poor';
}

export type InputResult =
  | {
      type: 'correct';
      beatIdx: number;
      globalBeat: number;
      rawTimingOffset: number;
      timingOffset: number;
      judgement: Exclude<AttackJudgement, 'poor'>;
    }
  | {
      type: 'wrong';
      beatIdx: number;
      timingOffset: number;
      judgement: 'poor';
      reason: 'offBeat' | 'wrongInput';
    }
  | { type: 'ignored'; reason: 'consumed' | 'notStarted' };

/** Fever Time 持续拍数（4 小节） */
export const FEVER_DURATION_BEATS = 16;
export const FEVER_ENERGY_MULTIPLIER = 3;
export const FEVER_ACTIVE_GAIN_SCALE = 0.5;

const LEVEL_DAMAGE_BONUS = [0, 0.1, 0.15, 0.2, 0.25, 0.3];

/**
 * 轻重连段判定 + ComboMeter。
 * 规则见《简化玩法策划案（原型版）》：
 * - 窗口内按对会积攒 Fever 能量；错误输入不积攒，但不会清空或锁定小节；
 * - 空拍无惩罚；换武器只切换 pattern，不再自动演示或代替玩家攻击。
 */
export class ComboSystem {
  progress = 0;
  pattern: [BeatKey, BeatKey, BeatKey, BeatKey];

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
    const { n, offset } = this.conductor.nearestBeat(judgedTime);
    if (n >= 0 && n === this.consumedBeat) {
      return { type: 'ignored', reason: 'consumed' };
    }

    const timingJudgement = getAttackJudgement(offset);
    if (timingJudgement === 'poor' || n < 0) {
      if (n >= 0) this.consumedBeat = n;
      return {
        type: 'wrong',
        beatIdx: ((n % 4) + 4) % 4,
        timingOffset: offset,
        judgement: 'poor',
        reason: 'offBeat'
      };
    }

    const beatIdx = n % 4;
    if (btn === this.pattern[beatIdx]) {
      this.consumedBeat = n;
      this.addCorrectInputProgress(2);
      return {
        type: 'correct',
        beatIdx,
        globalBeat: n,
        rawTimingOffset: rawNearest.offset,
        timingOffset: offset,
        judgement: timingJudgement,
      };
    }

    this.consumedBeat = n;
    return {
      type: 'wrong',
      beatIdx,
      timingOffset: offset,
      judgement: 'poor',
      reason: 'wrongInput'
    };
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

  /** 切换武器只更新连段规则；攻击始终由玩家输入触发。 */
  startSwitch(pattern: [BeatKey, BeatKey, BeatKey, BeatKey]): void {
    this.pattern = pattern;
  }
}
