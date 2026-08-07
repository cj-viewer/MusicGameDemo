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
 * 只负责节拍计时与事件；实际发声（音乐/鼓点）由 MusicDirector 按此时钟对齐调度。
 */
export class Conductor extends Phaser.Events.EventEmitter {
  readonly beatsPerMeasure = 4;

  readonly ctx: AudioContext | null = null;

  private _bpm: number;
  private _beatDur: number;
  private startTime = 0;
  private _started = false;
  private lastEmittedBeat = -1;

  constructor(scene: Phaser.Scene, bpm: number) {
    super();
    this._bpm = bpm;
    this._beatDur = 60 / bpm;
    const sm = scene.sound as Phaser.Sound.WebAudioSoundManager;
    this.ctx = sm.context ?? null;
  }

  get bpm(): number {
    return this._bpm;
  }

  get beatDur(): number {
    return this._beatDur;
  }

  get started(): boolean {
    return this._started;
  }

  /** 仅允许在 start() 之前切换 BPM（选曲阶段） */
  setBpm(bpm: number): void {
    if (this._started) return;
    this._bpm = bpm;
    this._beatDur = 60 / bpm;
  }

  now(): number {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  /** lead：从现在到第 0 拍的前导时间（歌曲有前奏时会比默认值长） */
  start(lead = 0.2): void {
    this.startTime = this.now() + lead;
    this.lastEmittedBeat = -1;
    this._started = true;
  }

  update(): void {
    if (!this._started) return;
    const t = this.now();

    const current = Math.floor((t - this.startTime) / this._beatDur);
    // 页面挂起（切后台）后主循环冻结而音频时钟仍在走：跳过积压节拍，避免恢复时爆发式补发
    if (current - this.lastEmittedBeat > 2) {
      this.lastEmittedBeat = current - 1;
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
    return this.startTime + n * this._beatDur;
  }

  /** 当前时间对应的浮点拍位置（可为负，表示尚未到第 0 拍） */
  beatFloatAt(t: number): number {
    return (t - this.startTime) / this._beatDur;
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
}
