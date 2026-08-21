import type { Conductor } from '../core/Conductor';
import type { BeatKey } from './weapons';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Perfect：校准后距离拍点不超过 0.1 秒。 */
export const PERFECT_INPUT_WINDOW = 0.1;
/** 攻击输入判定窗口：拍点前可提前 0.2 秒。 */
export const INPUT_EARLY_WINDOW = 0.2;
/** 攻击输入判定窗口：拍点后同样保留 0.2 秒，构成对称的 Good 区间。 */
export const INPUT_LATE_WINDOW = 0.2;

export type AttackJudgement = 'perfect' | 'good' | 'poor';
export type AttackInputPhase = 'press' | 'release';

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
      comboStarted: boolean;
      comboCompleted: boolean;
    }
  | {
      type: 'wrong';
      beatIdx: number;
      timingOffset: number;
      judgement: 'poor';
      reason: 'offBeat' | 'wrongInput' | 'missedBeat';
      comboFailed: boolean;
    }
  | { type: 'ignored'; reason: 'consumed' | 'notStarted' };

export interface ComboEnergyRewards {
  perfect: number;
  good: number;
  patternComplete: number;
}

const LEVEL_DAMAGE_BONUS = [0, 0.1, 0.15, 0.2, 0.25, 0.3];

/**
 * 轻重连招判定 + ComboMeter。
 * 规则见《简化玩法策划案（原型版）》：
 * - 任意鼓点上的轻攻击均可起手；随后按当前武器的四段 Pattern 判定；
 * - 任意失拍或类型错误都按连招失败结算并回到待起手状态，错误攻击照常以 Poor 表现结算；
 * - 连招开始后，每一段都必须在紧接着的下一拍判定窗内完成；漏拍、错拍或类型错误都会失败；
 * - 换武器会中止旧连招并切换下一次起手规则。
 */
export class ComboSystem {
  progress = 0;
  pattern: [BeatKey, BeatKey, BeatKey, BeatKey];

  /** 已消耗的拍（防止一拍多次攻击） */
  private consumedBeat = -1;
  /** 是否正在等待当前武器连招的下一段输入。 */
  private comboActive = false;
  /** 正在等待的 Pattern 下标；只有 comboActive 为 true 时有效。 */
  private comboStep = 0;
  /** 正在等待的绝对拍号；用于在该拍判定窗结束后结算漏拍。 */
  private expectedBeat = -1;
  /** Fever 只覆盖清屏动画；由 MainScene 在清屏完成回调中显式结束。 */
  private feverEnabled = false;
  /** 教学以玩家真实输入时间估算的设备延迟；正值表示输入到达程序时偏晚。 */
  private inputLatencyOffset = 0;
  private energyRewards: ComboEnergyRewards = {
    perfect: 4,
    good: 3,
    patternComplete: 10
  };
  private progressGainEnabled = true;

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

  get isComboActive(): boolean {
    return this.comboActive;
  }

  /** 当前连招等待的按键；非连招状态永远以轻攻击起手。 */
  get expectedInput(): BeatKey {
    return this.comboActive ? this.pattern[this.comboStep] : 'L';
  }

  get expectedStep(): number {
    return this.comboActive ? this.comboStep : 0;
  }

  /** 当前连招下一段对应的绝对拍号；非连招状态返回 -1。 */
  get expectedComboBeat(): number {
    return this.comboActive ? this.expectedBeat : -1;
  }

  feverActive(): boolean {
    return this.feverEnabled;
  }

  /** Meter 满时进入清屏 Fever；Meter 立刻清零。 */
  startFever(): void {
    this.feverEnabled = true;
    this.progress = 0;
  }

  endFever(): void {
    this.feverEnabled = false;
    this.progress = 0;
  }

  /**
   * 校准值只平移判定时钟，不修改音频节拍本身。限制在 120ms 内，避免一次异常输入扩大窗口。
   */
  setInputLatencyOffset(seconds: number): void {
    this.inputLatencyOffset = clamp(seconds, -0.12, 0.12);
  }

  getInputLatencyOffset(): number {
    return this.inputLatencyOffset;
  }

  /** 警棍长按 Pattern 的第四拍必须由重击松开事件完成。 */
  get expectsHeavyRelease(): boolean {
    return this.comboActive && this.isBatonHoldPattern() && this.comboStep === 3;
  }

  setEnergyRewards(rewards: ComboEnergyRewards): void {
    this.energyRewards = {
      perfect: Math.max(0, rewards.perfect),
      good: Math.max(0, rewards.good),
      patternComplete: Math.max(0, rewards.patternComplete)
    };
  }

  /** 过场 / 倒计时仍允许攻击判定，但可临时冻结由正确输入产生的量表收益。 */
  setProgressGainEnabled(enabled: boolean): void {
    this.progressGainEnabled = enabled;
  }

  handleInput(btn: BeatKey, t: number, phase: AttackInputPhase = 'press'): InputResult {
    if (!this.conductor.started) return { type: 'ignored', reason: 'notStarted' };
    const rawNearest = this.conductor.nearestBeat(t);
    const judgedTime = t - this.inputLatencyOffset;
    const { n, offset } = this.conductor.nearestBeat(judgedTime);
    if (n >= 0 && n === this.consumedBeat) {
      // 第三拍刚按下后立刻松开，不能被“本拍已消费”静默吞掉；它应立即打断长按连招。
      if (phase === 'release' && this.expectsHeavyRelease) {
        const beatIdx = this.comboStep;
        this.resetActiveCombo();
        return {
          type: 'wrong',
          beatIdx,
          timingOffset: offset,
          judgement: 'poor',
          reason: 'offBeat',
          comboFailed: true
        };
      }
      return { type: 'ignored', reason: 'consumed' };
    }

    const expectedStep = this.expectedStep;
    const timingJudgement = getAttackJudgement(offset);
    if (timingJudgement === 'poor' || n < 0) {
      if (n >= 0) this.consumedBeat = n;
      this.resetActiveCombo();
      return {
        type: 'wrong',
        beatIdx: expectedStep,
        timingOffset: offset,
        judgement: 'poor',
        reason: 'offBeat',
        comboFailed: true
      };
    }

    const startsCombo = !this.comboActive && btn === 'L' && phase === 'press';
    const expectedPhase: AttackInputPhase = this.expectsHeavyRelease ? 'release' : 'press';
    const matchesExpectedInput = this.comboActive
      && btn === this.pattern[this.comboStep]
      && phase === expectedPhase;
    if (startsCombo || matchesExpectedInput) {
      const beatIdx = this.comboActive ? this.comboStep : 0;
      const completesCombo = this.comboActive && this.comboStep === this.pattern.length - 1;
      this.consumedBeat = n;
      this.addCorrectInputProgress(this.energyRewards[timingJudgement]);
      if (completesCombo) {
        this.addCorrectInputProgress(this.energyRewards.patternComplete);
      }

      if (!this.comboActive) {
        this.comboActive = true;
        this.comboStep = 1;
      } else if (completesCombo) {
        this.resetActiveCombo();
      } else {
        this.comboStep++;
      }
      if (this.comboActive) this.expectedBeat = n + 1;

      return {
        type: 'correct',
        beatIdx,
        globalBeat: n,
        rawTimingOffset: rawNearest.offset,
        timingOffset: offset,
        judgement: timingJudgement,
        comboStarted: startsCombo,
        comboCompleted: completesCombo
      };
    }

    this.consumedBeat = n;
    this.resetActiveCombo();
    return {
      type: 'wrong',
      beatIdx: expectedStep,
      timingOffset: offset,
      judgement: 'poor',
      reason: 'wrongInput',
      comboFailed: true
    };
  }

  /**
   * 连招下一段在其 Good 判定窗结束后仍未输入时结算为漏拍。
   * 在场景 update 中轮询，使漏拍不依赖任何新的玩家输入。
   */
  updateComboTimeout(t: number): Extract<InputResult, { type: 'wrong' }> | undefined {
    if (!this.comboActive || this.expectedBeat < 0) return undefined;
    if (t <= this.conductor.timeOfBeat(this.expectedBeat) + INPUT_LATE_WINDOW) return undefined;

    const beatIdx = this.comboStep;
    this.consumedBeat = this.expectedBeat;
    this.resetActiveCombo();
    return {
      type: 'wrong',
      beatIdx,
      timingOffset: INPUT_LATE_WINDOW,
      judgement: 'poor',
      reason: 'missedBeat',
      comboFailed: true
    };
  }

  /** 直接增加 ComboMeter 点数；F 调试键使用此入口充满量表。 */
  addProgress(amount: number): void {
    this.progress = Math.min(100, this.progress + Math.max(0, amount));
  }

  /** 普通状态按点数衰减；清屏 Fever 期间 Meter 保持为 0。 */
  decayProgress(amount: number): void {
    if (this.feverActive()) return;
    this.progress = Math.max(0, this.progress - Math.max(0, amount));
  }

  /** Meter 清零后的清屏 Fever 不再提供可消费能量。 */
  canSpendProgress(amount: number): boolean {
    const required = Math.max(0, amount);
    if (required <= 0) return true;
    return this.progress + 1e-6 >= required;
  }

  /** 直接消耗 ComboMeter 点数，最低扣到 0。 */
  spendProgress(amount: number): void {
    const clampedAmount = Math.max(0, amount);
    this.progress = Math.max(0, this.progress - clampedAmount);
  }

  private addCorrectInputProgress(amount: number): void {
    if (!this.progressGainEnabled) return;
    if (!this.feverActive()) this.addProgress(amount);
  }

  /** 切换武器中止旧连招；攻击始终由玩家输入触发。 */
  startSwitch(pattern: [BeatKey, BeatKey, BeatKey, BeatKey]): void {
    this.resetActiveCombo();
    this.pattern = pattern;
  }

  private resetActiveCombo(): void {
    this.comboActive = false;
    this.comboStep = 0;
    this.expectedBeat = -1;
  }

  private isBatonHoldPattern(): boolean {
    return this.pattern[0] === 'L'
      && this.pattern[1] === 'L'
      && this.pattern[2] === 'H'
      && this.pattern[3] === 'H';
  }
}
