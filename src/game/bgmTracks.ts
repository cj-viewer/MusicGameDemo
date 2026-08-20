// 节拍基准由 scripts/measure_audio_timing.py 实测并做八段相位平整性交叉验证：
// 固定候选 BPM 把全曲分八段分别估相位，只有相位不随时间漂移的 BPM 才是真值
// （bgm0=153.057、bgm2=174.002 八段相位平整；旧值在同一检验下明显摆动）。
// sourceBpm 的相对误差会随播放逐拍累积成鼓点-音乐漂移，改动前必须重跑脚本。
export interface BgmTrack {
  key: string;
  label: string;
  /** 音频文件原始速度下实测的 BPM，用于换算播放倍率。 */
  sourceBpm: number;
  firstBeatOffset: number;
  loopBeats: number;
}

export const BGM_TRACKS: readonly BgmTrack[] = [
  { key: 'bgm-1', label: 'bgm1.mp3', sourceBpm: 145, firstBeatOffset: 0.0, loopBeats: 498 },
  { key: 'bgm-2', label: 'bgm2.mp3', sourceBpm: 174.002, firstBeatOffset: 0.19, loopBeats: 616 },
  { key: 'bgm-3', label: 'bgm3.mp3', sourceBpm: 146.32, firstBeatOffset: 0.02, loopBeats: 616 },
  { key: 'bgm-0', label: 'bgm0.mp3', sourceBpm: 153.057, firstBeatOffset: 0.0, loopBeats: 436 }
];

export const DEFAULT_TUTORIAL_BGM_SLOT = 3;
export const DEFAULT_LEVEL_BGM_SLOT = 0;

/** BGM 文件在 assets 下的相对路径。 */
export const bgmAssetPath = (track: BgmTrack): string => `audio/music/${track.label}`;
