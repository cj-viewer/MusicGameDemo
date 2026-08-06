import Phaser from 'phaser';
import type { Conductor, BeatInfo } from '../core/Conductor';
import type { BeatKey } from './weapons';

/** 攻击输入判定窗口：拍点前后各 0.2 秒 */
export const INPUT_WINDOW = 0.2;

export type InputResult =
  | { type: 'correct'; beatIdx: number; globalBeat: number }
  | { type: 'wrong'; beatIdx: number }
  | { type: 'ignored'; reason: 'locked' | 'protected' | 'consumed' | 'notStarted' };

export interface BeatTickResult {
  /** 本拍需要系统自动演示的攻击拍序号（0~3） */
  demoAttack?: number;
  /** 自动演示是否在本拍结束 */
  demoEnded?: boolean;
  /** Fever Time 是否在本拍结束 */
  feverEnded?: boolean;
}

/** Fever Time 持续拍数（4 小节） */
export const FEVER_DURATION_BEATS = 16;

const LEVEL_DAMAGE_BONUS = [0, 0.1, 0.15, 0.2, 0.25, 0.3];

/**
 * 轻重连段判定 + ComboMeter。
 * 规则见《简化玩法策划案（原型版）》：
 * - 窗口内按对 → 攻击 + Meter+2%；按错/窗口外 → 本小节锁定 + Meter 清零；
 * - 空拍无惩罚；换武器后到自动演示结束为保护期（输入忽略、不清零）。
 */
export class ComboSystem {
  progress = 0;
  pattern: [BeatKey, BeatKey, BeatKey, BeatKey];

  /** 错误锁定持续到该整数拍（该拍起恢复输入） */
  private lockedUntilBeat = -1;
  /** 保护期（切换武器 + 自动演示）持续到该整数拍 */
  private protectedUntilBeat = -1;
  private demoStart = -1;
  private demoEnd = -1;
  /** 已消耗的拍（防止一拍多次攻击） */
  private consumedBeat = -1;
  /** Fever Time 持续到该整数拍，-1 表示未激活 */
  private feverUntilBeat = -1;

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

  /** Meter 满时进入 Fever Time；结束后 Meter 清零重新积累 */
  startFever(): void {
    const bf = this.conductor.beatFloatAt(this.conductor.now());
    this.feverUntilBeat = Math.floor(Math.max(bf, 0)) + FEVER_DURATION_BEATS;
  }

  /** 当前小节是否处于错误锁定状态 */
  isLocked(): boolean {
    return this.conductor.beatFloatAt(this.conductor.now()) < this.lockedUntilBeat;
  }

  isProtected(): boolean {
    return this.conductor.beatFloatAt(this.conductor.now()) < this.protectedUntilBeat;
  }

  isDemoActive(): boolean {
    const b = Math.floor(this.conductor.beatFloatAt(this.conductor.now()));
    return b >= this.demoStart && b < this.demoEnd;
  }

  handleInput(btn: BeatKey, t: number): InputResult {
    if (!this.conductor.started) return { type: 'ignored', reason: 'notStarted' };
    const bf = this.conductor.beatFloatAt(t);
    if (bf < this.protectedUntilBeat) return { type: 'ignored', reason: 'protected' };
    if (bf < this.lockedUntilBeat) return { type: 'ignored', reason: 'locked' };

    const { n, offset } = this.conductor.nearestBeat(t);

    if (Math.abs(offset) > INPUT_WINDOW || n < 0) {
      this.fail(bf);
      return { type: 'wrong', beatIdx: ((n % 4) + 4) % 4 };
    }
    if (n === this.consumedBeat) {
      return { type: 'ignored', reason: 'consumed' };
    }

    const beatIdx = n % 4;
    if (btn === this.pattern[beatIdx]) {
      this.consumedBeat = n;
      this.progress = Math.min(100, this.progress + 2);
      return { type: 'correct', beatIdx, globalBeat: n };
    }

    this.fail(bf);
    return { type: 'wrong', beatIdx };
  }

  /** 踩拍闪避等额外奖励 */
  addProgress(amount: number): void {
    this.progress = Math.min(100, this.progress + amount);
  }

  private fail(beatFloat: number): void {
    this.progress = 0;
    // 锁定到当前小节结束
    this.lockedUntilBeat = (Math.floor(Math.max(beatFloat, 0) / 4) + 1) * 4;
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
    this.lockedUntilBeat = -1;
    this.consumedBeat = -1;
  }

  onBeat(info: BeatInfo): BeatTickResult {
    const result: BeatTickResult = {};
    if (info.globalBeat >= this.demoStart && info.globalBeat < this.demoEnd) {
      result.demoAttack = info.beatInMeasure;
      this.progress = Math.min(100, this.progress + 2);
    }
    if (info.globalBeat === this.demoEnd) {
      result.demoEnded = true;
      this.demoStart = -1;
      this.demoEnd = -1;
    }
    if (this.feverUntilBeat > 0 && info.globalBeat >= this.feverUntilBeat) {
      this.feverUntilBeat = -1;
      this.progress = 0;
      result.feverEnded = true;
    }
    return result;
  }
}
