import Phaser from 'phaser';

const CUE_SCHEDULE_AHEAD = 0.22;
/** 去除前段低能量/静音后，仍保留在响度峰值前的短起声。 */
const LIGHT_CALL_START = 0.105;
const HEAVY_CALL_START = 0.11;
const HEAVY_CUE_FADE_START = 0.33;
const HEAVY_CUE_FADE_END = 0.36;
/** 复用旧荧光棒轻攻击的方波下行音色。 */
const DRUM_GAIN = 0.36;
const DRUM_DURATION = 0.09;

export interface BeatInfo {
  /** 从开始起的整数拍序号 */
  globalBeat: number;
  /** 小节内拍序号 0~3 */
  beatInMeasure: number;
  measure: number;
  /** 该拍的理论时间（Conductor 时钟，秒） */
  time: number;
}

/** 玩家连招输入类型。 */
export type BeatCue = 'L' | 'H';

/**
 * 全局节拍时钟。以 WebAudio currentTime 为基准（无 WebAudio 时退化为 performance.now），
 * 驱动节拍事件并提前调度统一鼓点，保证节拍判定与声音精确对齐。
 */
export class Conductor extends Phaser.Events.EventEmitter {
  private _bpm: number;
  private _beatDur: number;
  readonly beatsPerMeasure = 4;

  readonly ctx: AudioContext | null = null;

  private startTime = 0;
  private _started = false;
  private pausedAt: number | null = null;
  private lastEmittedBeat = -1;
  private nextClickBeat = 0;
  private scene: Phaser.Scene;
  private playerCallAudioReady: boolean;
  private sfxVolume = 1;

  constructor(scene: Phaser.Scene, bpm: number) {
    super();
    this.scene = scene;
    this._bpm = bpm;
    this._beatDur = 60 / bpm;
    const sm = scene.sound as Phaser.Sound.WebAudioSoundManager;
    this.ctx = sm.context ?? null;
    this.playerCallAudioReady = scene.cache.audio.exists('beat-light') && scene.cache.audio.exists('beat-heavy');
    if (!this.playerCallAudioReady) {
      console.error('Player call audio failed to load; combo voice feedback is disabled.');
    }
  }

  get started(): boolean {
    return this._started;
  }

  get bpm(): number {
    return this._bpm;
  }

  get beatDur(): number {
    return this._beatDur;
  }

  /** 切换关卡音乐时保持当前拍号连续，只调整后续拍点间隔。 */
  retune(bpm: number): void {
    if (bpm <= 0 || bpm === this._bpm) return;
    const referenceTime = this.pausedAt ?? this.now();
    const beatFloat = this._started ? (referenceTime - this.startTime) / this._beatDur : 0;
    this._bpm = bpm;
    this._beatDur = 60 / bpm;
    if (this._started) {
      this.startTime = referenceTime - beatFloat * this._beatDur;
      this.nextClickBeat = Math.max(this.lastEmittedBeat + 1, Math.floor(beatFloat));
    }
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  now(): number {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  start(): void {
    this.startTime = this.now() + 0.2;
    this.lastEmittedBeat = -1;
    this.nextClickBeat = 0;
    this.pausedAt = null;
    this._started = true;
  }

  /** 暂停时冻结节拍相位；恢复后把暂停时长补回起点，避免音乐与判定跳拍。 */
  pause(): void {
    if (!this._started || this.pausedAt !== null) return;
    this.pausedAt = this.now();
  }

  resume(): void {
    if (this.pausedAt === null) return;
    this.startTime += this.now() - this.pausedAt;
    this.pausedAt = null;
  }

  /** 独立节拍喊声音量：作用于背景鼓点及之后触发的玩家轻重“嘿”。 */
  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, volume);
  }

  update(): void {
    if (!this._started || this.pausedAt !== null) return;
    const t = this.now();

    // 提前调度节拍器音效，保证发声时刻精确
    if (this.ctx) {
      const horizon = t + CUE_SCHEDULE_AHEAD;
      while (this.timeOfBeat(this.nextClickBeat) < horizon) {
        this.scheduleDrum(this.timeOfBeat(this.nextClickBeat));
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

  /** 背景节拍一律使用同一枚短促鼓点，不再映射武器 Pattern 的轻 / 重。 */
  private scheduleDrum(time: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const startTime = Math.max(time, this.now());
    const outputGain = DRUM_GAIN * this.sfxVolume;
    if (outputGain <= 0) return;
    osc.type = 'square';
    osc.frequency.setValueAtTime(330, startTime);
    osc.frequency.exponentialRampToValueAtTime(220, startTime + DRUM_DURATION);
    gain.gain.setValueAtTime(outputGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + DRUM_DURATION);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + DRUM_DURATION + 0.02);
  }

  /**
   * 连招内命中鼓点时才播放原有轻 / 重“嘿”。
   * 采样存在前置静音，直接 seek 到有效发声起点，避免听感晚于输入。
   */
  playPlayerCall(cue: BeatCue): void {
    if (!this.playerCallAudioReady) return;
    const heavy = cue === 'H';
    const key = heavy ? 'beat-heavy' : 'beat-light';
    const cueGain = this.sfxVolume;
    const sound = this.scene.sound.add(key, { volume: cueGain }) as Phaser.Sound.WebAudioSound;
    sound.once(Phaser.Sound.Events.COMPLETE, () => {
      sound.destroy();
    });
    const callStart = heavy ? HEAVY_CALL_START : LIGHT_CALL_START;
    sound.play({ seek: callStart, volume: cueGain });

    // 重声“嘿”避免尾音盖住下一枚统一鼓点。
    if (heavy && this.ctx) {
      const actualStartTime = this.now();
      const gain = sound.volumeNode.gain;
      gain.cancelScheduledValues(actualStartTime + HEAVY_CUE_FADE_START);
      gain.setValueAtTime(cueGain, actualStartTime + HEAVY_CUE_FADE_START);
      gain.linearRampToValueAtTime(0, actualStartTime + HEAVY_CUE_FADE_END);
    }
  }
}
