// 默认教学 / 正式曲目的节拍重新按全曲 onset 包络与网格相位搜索校准；loopBeats 同步按完整音频时长取整。
export interface BgmTrack {
  key: string;
  label: string;
  /** 音频文件原始速度下实测的 BPM，用于换算播放倍率。 */
  sourceBpm: number;
  firstBeatOffset: number;
  loopBeats: number;
}

export const BGM_TRACKS: readonly BgmTrack[] = [
  { key: 'bgm-1', label: 'bgm1.mp3', sourceBpm: 145, firstBeatOffset: 0.012, loopBeats: 498 },
  { key: 'bgm-2', label: 'bgm2.mp3', sourceBpm: 174.002, firstBeatOffset: 0.231, loopBeats: 616 },
  { key: 'bgm-3', label: 'bgm3.mp3', sourceBpm: 146.32, firstBeatOffset: 0.026, loopBeats: 616 },
  { key: 'bgm-0', label: 'bgm0.mp3', sourceBpm: 153.04, firstBeatOffset: 0.245, loopBeats: 436 }
];

export const DEFAULT_TUTORIAL_BGM_SLOT = 3;
export const DEFAULT_LEVEL_BGM_SLOT = 1;

/** BGM 文件在 assets 下的相对路径。 */
export const bgmAssetPath = (track: BgmTrack): string => `audio/music/${track.label}`;
