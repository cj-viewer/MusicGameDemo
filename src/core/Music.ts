import type { Conductor } from './Conductor';
import type { TrackDef } from './tracks';

/** 已解码的歌曲缓存（scene.restart 后无需重新解码） */
const bufferCache = new Map<string, AudioBuffer>();

/** F → G → Em → Am（王道进行），MIDI 音高 */
const CHORDS: number[][] = [
  [53, 57, 60],
  [55, 59, 62],
  [52, 55, 59],
  [57, 60, 64]
];
const BASS_ROOTS = [41, 43, 40, 45];
const ARP_PATTERN = [0, 1, 2, 1];

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 音乐总监：与 Conductor 时钟对齐地播放音乐。
 * - synth 轨：WebAudio 现场合成的四四拍电子伴奏（鼓组 + 贝斯 + 和弦 + 琶音），
 *   以 16 分音符为粒度提前调度，节拍即鼓点；
 * - file 轨：播放用户自备歌曲，按 firstBeatOffset 把歌曲第一拍对齐到 Conductor 的第 0 拍。
 */
export class MusicDirector {
  private ctx: AudioContext | null;
  private master: GainNode | null = null;
  private conductor: Conductor | null = null;
  private source: AudioBufferSourceNode | null = null;
  private fileBuffer: AudioBuffer | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private synthActive = false;
  private playing = false;
  /** 下一个待调度的 16 分音符序号 */
  private nextStep = 0;

  constructor(ctx: AudioContext | null) {
    this.ctx = ctx;
  }

  /** file 轨需要先下载解码；synth 轨为空操作。失败会抛异常，由调用方决定回退。 */
  async prepare(track: TrackDef): Promise<void> {
    if (!this.ctx || track.kind !== 'file') return;
    let buf = bufferCache.get(track.url);
    if (!buf) {
      const resp = await fetch(track.url);
      if (!resp.ok) throw new Error(`加载音乐失败: HTTP ${resp.status}`);
      buf = await this.ctx.decodeAudioData(await resp.arrayBuffer());
      bufferCache.set(track.url, buf);
    }
    this.fileBuffer = buf;
  }

  /** 在 conductor.start() 之后立刻调用 */
  start(conductor: Conductor, track: TrackDef): void {
    if (!this.ctx) return;
    this.stop();
    this.conductor = conductor;
    this.playing = true;

    this.master = this.ctx.createGain();
    this.master.gain.value = track.kind === 'file' ? (track.gain ?? 0.8) : 0.4;
    this.master.connect(this.ctx.destination);

    if (track.kind === 'file' && this.fileBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.fileBuffer;
      src.connect(this.master);
      // 歌曲内 firstBeatOffset 秒处对齐到第 0 拍
      const startAt = conductor.timeOfBeat(0) - track.firstBeatOffset;
      const now = this.ctx.currentTime;
      if (startAt >= now + 0.005) {
        src.start(startAt);
      } else {
        src.start(now, Math.min(now - startAt, this.fileBuffer.duration));
      }
      this.source = src;
      this.synthActive = false;
    } else {
      this.synthActive = true;
      this.nextStep = 0;
    }
  }

  stop(): void {
    this.playing = false;
    this.synthActive = false;
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // 尚未 start 或已结束
      }
      this.source.disconnect();
      this.source = null;
    }
    if (this.master) {
      this.master.disconnect();
      this.master = null;
    }
  }

  /** 每帧调用：为 synth 轨提前调度即将到来的音符 */
  update(): void {
    if (!this.playing || !this.synthActive || !this.ctx || !this.conductor) return;
    const now = this.ctx.currentTime;
    const horizon = now + 0.25;
    for (;;) {
      const t = this.conductor.timeOfBeat(this.nextStep / 4);
      if (t >= horizon) break;
      // 页面挂起后跳过积压的过期音符，避免恢复时爆发式补发
      if (t >= now - 0.05) this.scheduleStep(this.nextStep, t);
      this.nextStep++;
    }
  }

  // ---------- 合成曲编排 ----------

  private scheduleStep(step: number, t: number): void {
    const measure = Math.floor(step / 16);
    const stepInMeasure = step % 16;
    const beat = Math.floor(stepInMeasure / 4);
    const sub = stepInMeasure % 4;
    const chordIdx = measure % 4;
    // 每 8 小节在 A/B 段间切换：B 段加入琶音与更密的和弦，制造推进感
    const sectionB = measure % 16 >= 8;

    if (sub === 0) this.kick(t);
    if (sub === 0 && (beat === 1 || beat === 3)) this.snare(t);
    if (sub === 0 || sub === 2) this.hat(t, sub === 2);
    if (sub === 0 || sub === 2) this.bass(t, BASS_ROOTS[chordIdx] + (sub === 2 ? 12 : 0));
    if (stepInMeasure === 0 || (sectionB && stepInMeasure === 8)) this.stab(t, CHORDS[chordIdx]);
    if (sectionB) this.pluck(t, CHORDS[chordIdx][ARP_PATTERN[sub]] + 24);
  }

  // ---------- 音色 ----------

  private tone(
    t: number,
    dur: number,
    type: OscillatorType,
    freq: number,
    peak: number,
    shape?: (osc: OscillatorNode, gain: GainNode) => AudioNode
  ): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    const out = shape ? shape(osc, gain) : gain;
    out.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(t: number, dur: number, peak: number, filterType: BiquadFilterType, filterFreq: number): void {
    if (!this.ctx || !this.master) return;
    if (!this.noiseBuf) {
      const len = Math.floor(this.ctx.sampleRate * 0.25);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private kick(t: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  private snare(t: number): void {
    this.noise(t, 0.09, 0.4, 'bandpass', 1800);
    this.tone(t, 0.06, 'triangle', 190, 0.2);
  }

  private hat(t: number, accent: boolean): void {
    this.noise(t, 0.035, accent ? 0.18 : 0.1, 'highpass', 7500);
  }

  private bass(t: number, midi: number): void {
    this.tone(t, 0.17, 'sawtooth', midiToFreq(midi), 0.35, (_, gain) => {
      const lp = this.ctx!.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 450;
      gain.connect(lp);
      return lp;
    });
  }

  private stab(t: number, midis: number[]): void {
    for (const midi of midis) {
      this.tone(t, 0.3, 'sawtooth', midiToFreq(midi), 0.09, (osc, gain) => {
        osc.detune.value = Math.random() * 10 - 5;
        const lp = this.ctx!.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1400;
        gain.connect(lp);
        return lp;
      });
    }
  }

  private pluck(t: number, midi: number): void {
    this.tone(t, 0.09, 'square', midiToFreq(midi), 0.07, (_, gain) => {
      const lp = this.ctx!.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      gain.connect(lp);
      return lp;
    });
  }
}
