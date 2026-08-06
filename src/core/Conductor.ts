import Phaser from 'phaser';

export interface BeatInfo {
  /** 从开始起的整数拍序号 */
  globalBeat: number;
  /** 小节内拍序号 0~3 */
  beatInMeasure: number;
  measure: number;
  /** 该拍的理论时间（Conductor 时钟，秒） */
  time: number;
}

/**
 * 全局节拍时钟。以 WebAudio currentTime 为基准（无 WebAudio 时退化为 performance.now），
 * 驱动节拍事件并提前调度节拍器音效，保证节拍判定与声音精确对齐。
 */
export class Conductor extends Phaser.Events.EventEmitter {
  readonly bpm: number;
  readonly beatDur: number;
  readonly beatsPerMeasure = 4;

  readonly ctx: AudioContext | null = null;

  private startTime = 0;
  private _started = false;
  private lastEmittedBeat = -1;
  private nextClickBeat = 0;

  constructor(scene: Phaser.Scene, bpm: number) {
    super();
    this.bpm = bpm;
    this.beatDur = 60 / bpm;
    const sm = scene.sound as Phaser.Sound.WebAudioSoundManager;
    this.ctx = sm.context ?? null;
  }

  get started(): boolean {
    return this._started;
  }

  now(): number {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  start(): void {
    this.startTime = this.now() + 0.2;
    this.lastEmittedBeat = -1;
    this.nextClickBeat = 0;
    this._started = true;
  }

  update(): void {
    if (!this._started) return;
    const t = this.now();

    // 提前调度节拍器音效，保证发声时刻精确
    if (this.ctx) {
      const horizon = t + 0.12;
      while (this.timeOfBeat(this.nextClickBeat) < horizon) {
        this.scheduleClick(this.timeOfBeat(this.nextClickBeat), this.nextClickBeat % this.beatsPerMeasure === 0);
        this.nextClickBeat++;
      }
    }

    const current = Math.floor((t - this.startTime) / this.beatDur);
    // 页面挂起（切后台）后主循环冻结而音频时钟仍在走：跳过积压节拍，避免恢复时爆发式补发
    if (current - this.lastEmittedBeat > 2) {
      this.lastEmittedBeat = current - 1;
      this.nextClickBeat = Math.max(this.nextClickBeat, current);
    }
    while (this.lastEmittedBeat < current) {
      this.lastEmittedBeat++;
      const n = this.lastEmittedBeat;
      if (n >= 0) {
        const info: BeatInfo = {
          globalBeat: n,
          beatInMeasure: n % this.beatsPerMeasure,
          measure: Math.floor(n / this.beatsPerMeasure),
          time: this.timeOfBeat(n)
        };
        this.emit('beat', info);
      }
    }
  }

  timeOfBeat(n: number): number {
    return this.startTime + n * this.beatDur;
  }

  /** 当前时间对应的浮点拍位置（可为负，表示尚未到第 0 拍） */
  beatFloatAt(t: number): number {
    return (t - this.startTime) / this.beatDur;
  }

  /** 距 t 最近的整数拍及偏移（秒，正值表示晚于拍点） */
  nearestBeat(t: number): { n: number; offset: number } {
    const n = Math.round(this.beatFloatAt(t));
    return { n, offset: t - this.timeOfBeat(n) };
  }

  /** t 到下一个整数拍的时长 */
  timeToNextBeat(t: number): number {
    const next = Math.floor(this.beatFloatAt(t)) + 1;
    return this.timeOfBeat(next) - t;
  }

  private scheduleClick(time: number, accent: boolean): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1046 : 660;
    gain.gain.setValueAtTime(accent ? 0.22 : 0.13, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.08);
  }
}
