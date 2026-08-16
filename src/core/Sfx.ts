export type SfxCategory = 'combat' | 'damage' | 'combo' | 'pickup' | 'fever';

/** 战斗反馈使用 WebAudio 合成；轻重节拍喊声由 Conductor 播放外部采样。 */
export class Sfx {
  private ctx: AudioContext | null;
  private destination: AudioNode | null;
  private categoryVolumes: Record<SfxCategory, number> = {
    combat: 1,
    damage: 1,
    combo: 1,
    pickup: 1,
    fever: 1
  };

  constructor(ctx: AudioContext | null, destination: AudioNode | null = null) {
    this.ctx = ctx;
    this.destination = destination;
  }

  setCategoryVolume(category: SfxCategory, volume: number): void {
    this.categoryVolumes[category] = Math.max(0, volume);
  }

  private tone(
    freqFrom: number,
    freqTo: number,
    dur: number,
    type: OscillatorType,
    gainVal: number,
    category: SfxCategory,
    startDelay = 0
  ): void {
    if (!this.ctx) return;
    const outputGain = gainVal * this.categoryVolumes[category];
    if (outputGain <= 0) return;
    const t0 = this.ctx.currentTime + startDelay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t0);
    if (freqTo !== freqFrom) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), t0 + dur);
    }
    gain.gain.setValueAtTime(outputGain, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.destination ?? this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 攻击命中：短促打击音，轻重不同音高 */
  attack(heavy: boolean): void {
    this.tone(heavy ? 220 : 330, heavy ? 110 : 220, 0.09, 'square', 0.12, 'combat');
  }

  /** 输入错误：刺耳的下行噪音 */
  error(): void {
    this.tone(240, 70, 0.28, 'sawtooth', 0.22, 'combat');
  }

  /** ComboMeter 升级：上行的清脆提示音 */
  levelUp(): void {
    this.tone(660, 660, 0.07, 'sine', 0.18, 'combo');
    this.tone(880, 880, 0.09, 'sine', 0.18, 'combo', 0.08);
  }

  /** ComboMeter 清零：下行短音 */
  comboBreak(): void {
    this.tone(440, 220, 0.15, 'triangle', 0.15, 'combo');
  }

  /** 拾取武器 */
  pickup(): void {
    this.tone(523, 523, 0.07, 'sine', 0.15, 'pickup');
    this.tone(784, 784, 0.1, 'sine', 0.15, 'pickup', 0.07);
  }

  /** 玩家受伤 */
  hurt(): void {
    this.tone(140, 60, 0.18, 'square', 0.18, 'damage');
  }

  /** Enemy hit, deliberately lighter than player damage. */
  enemyHurt(): void {
    this.tone(520, 260, 0.1, 'triangle', 0.1, 'damage');
  }

  /** 敌人死亡 */
  enemyDie(): void {
    this.tone(330, 55, 0.25, 'triangle', 0.16, 'damage');
  }

  /** 进入 Fever Time：上行琶音 */
  feverStart(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, i) => this.tone(freq, freq, 0.12, 'sine', 0.2, 'fever', i * 0.09));
  }

  /** Fever 音波 */
  feverWave(): void {
    this.tone(1200, 300, 0.18, 'sine', 0.1, 'fever');
  }

  /** Fever 结束：下行提示 */
  feverEnd(): void {
    this.tone(784, 392, 0.3, 'triangle', 0.15, 'fever');
  }
}
