import Phaser from 'phaser';

const IDLE_CUE_GAIN = 0.16;
const CORRECT_CUE_GAINS = [0.28, 0.4, 0.52, 0.64] as const;

interface ScheduledCue {
  sound: Phaser.Sound.WebAudioSound;
  time: number;
}

export interface BeatInfo {
  /** 从开始起的整数拍序号 */
  globalBeat: number;
  /** 小节内拍序号 0~3 */
  beatInMeasure: number;
  measure: number;
  /** 该拍的理论时间（Conductor 时钟，秒） */
  time: number;
}

/** 当前武器在一个四拍小节内要求的输入类型。 */
export type BeatCue = 'L' | 'H';

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
  private cuePattern: [BeatCue, BeatCue, BeatCue, BeatCue] = ['L', 'L', 'H', 'L'];
  private scene: Phaser.Scene;
  private customBeatAudioReady: boolean;
  private correctCueGains = new Map<number, number>();
  private scheduledCues = new Map<number, ScheduledCue>();

  constructor(scene: Phaser.Scene, bpm: number) {
    super();
    this.scene = scene;
    this.bpm = bpm;
    this.beatDur = 60 / bpm;
    const sm = scene.sound as Phaser.Sound.WebAudioSoundManager;
    this.ctx = sm.context ?? null;
    this.customBeatAudioReady = scene.cache.audio.exists('beat-light') && scene.cache.audio.exists('beat-heavy');
    if (!this.customBeatAudioReady) {
      console.error('Custom beat audio failed to load; synthesized beat fallback is disabled.');
    }
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

  /**
   * 节拍器提示音与当前武器的小节连段保持一致：轻拍为低音，重拍为高音。
   * 只会影响尚未调度的提示音，因此切换武器后下一个未播放拍点立即使用新模式。
   */
  setCuePattern(pattern: [BeatCue, BeatCue, BeatCue, BeatCue]): void {
    this.cuePattern = [...pattern];
  }

  update(): void {
    if (!this._started) return;
    const t = this.now();

    // 提前调度节拍器音效，保证发声时刻精确
    if (this.ctx) {
      const horizon = t + 0.12;
      while (this.timeOfBeat(this.nextClickBeat) < horizon) {
        const heavy = this.cuePattern[this.nextClickBeat % this.beatsPerMeasure] === 'H';
        this.scheduleClick(this.nextClickBeat, this.timeOfBeat(this.nextClickBeat), heavy);
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
    for (const beat of [...this.correctCueGains.keys()]) {
      if (beat < current - 1) this.correctCueGains.delete(beat);
    }
  }

  registerCorrectAttack(globalBeat: number): void {
    if (!this.ctx || globalBeat < 0) return;
    const gainValue = CORRECT_CUE_GAINS[globalBeat % this.beatsPerMeasure];
    this.correctCueGains.set(globalBeat, gainValue);
    const scheduled = this.scheduledCues.get(globalBeat);

    if (scheduled) {
      scheduled.sound.setVolume(gainValue);
      return;
    }

    if (this.now() >= this.timeOfBeat(globalBeat)) {
      const heavy = this.cuePattern[globalBeat % this.beatsPerMeasure] === 'H';
      this.playCue(globalBeat, this.now(), heavy, gainValue);
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

  private scheduleClick(beat: number, time: number, heavy: boolean): void {
    if (!this.ctx || !this.customBeatAudioReady) return;
    const gainValue = this.correctCueGains.get(beat) ?? IDLE_CUE_GAIN;
    this.playCue(beat, time, heavy, gainValue);
  }

  private playCue(beat: number, time: number, heavy: boolean, gainValue: number): void {
    if (!this.customBeatAudioReady) return;
    const key = heavy ? 'beat-heavy' : 'beat-light';
    const sound = this.scene.sound.add(key, { volume: gainValue }) as Phaser.Sound.WebAudioSound;
    const scheduled = { sound, time };
    this.scheduledCues.set(beat, scheduled);
    sound.once(Phaser.Sound.Events.COMPLETE, () => {
      if (this.scheduledCues.get(beat) === scheduled) this.scheduledCues.delete(beat);
      sound.destroy();
    });
    sound.play({ delay: Math.max(0, time - this.now()), volume: gainValue });
  }
}
