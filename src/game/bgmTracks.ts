// bgm3.mp3 的实测节拍：对全曲 onset 包络做自相关 + 网格相位搜索得出 BPM，首拍在文件内 0.026s 处。
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
  { key: 'bgm-2', label: 'bgm2.mp3', sourceBpm: 176.47, firstBeatOffset: 0.02, loopBeats: 624 },
  { key: 'bgm-3', label: 'bgm3.mp3', sourceBpm: 146.32, firstBeatOffset: 0.026, loopBeats: 616 },
  { key: 'bgm-0', label: 'bgm0.mp3', sourceBpm: 153.846, firstBeatOffset: 0.09, loopBeats: 438 }
];

export const DEFAULT_TUTORIAL_BGM_SLOT = 3;
export const DEFAULT_LEVEL_BGM_SLOT = 0;

/** BGM 文件在 assets 下的相对路径。 */
export const bgmAssetPath = (track: BgmTrack): string => `audio/music/${track.label}`;
