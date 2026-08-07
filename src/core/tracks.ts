/** 内置合成曲（无版权问题，随时可用） */
export interface SynthTrackDef {
  kind: 'synth';
  id: string;
  name: string;
  bpm: number;
}

/** 用户自备歌曲：放入 public/music/ 并在 public/music/tracks.json 中登记 */
export interface FileTrackDef {
  kind: 'file';
  id: string;
  name: string;
  bpm: number;
  /** 相对站点根的地址，例如 music/song.mp3 */
  url: string;
  /** 音频文件里第一拍出现的秒数（听感偏早就调大，偏晚就调小） */
  firstBeatOffset: number;
  /** 音乐音量 0~1，默认 0.8 */
  gain?: number;
}

export type TrackDef = SynthTrackDef | FileTrackDef;

export const TRACKS: TrackDef[] = [
  { kind: 'synth', id: 'neon-rush', name: '内置合成曲 Neon Rush', bpm: 128 }
];

let selected = 0;

export function getSelectedTrack(): TrackDef {
  return TRACKS[Math.min(selected, TRACKS.length - 1)];
}

export function cycleTrack(): TrackDef {
  selected = (selected + 1) % TRACKS.length;
  return getSelectedTrack();
}

let userTracksPromise: Promise<boolean> | null = null;

/**
 * 读取 public/music/tracks.json 注册用户自备歌曲（文件不存在则静默跳过）。
 * 返回是否新增了曲目。
 */
export function loadUserTracks(): Promise<boolean> {
  userTracksPromise ??= (async () => {
    try {
      const resp = await fetch('music/tracks.json', { cache: 'no-store' });
      if (!resp.ok) return false;
      const list = (await resp.json()) as Array<{
        name?: string;
        url?: string;
        bpm?: number;
        firstBeatOffset?: number;
        gain?: number;
      }>;
      if (!Array.isArray(list)) return false;
      let added = false;
      for (const e of list) {
        if (!e?.url || !e?.bpm) continue;
        if (TRACKS.some((t) => t.kind === 'file' && t.url === e.url)) continue;
        TRACKS.push({
          kind: 'file',
          id: e.url,
          name: e.name ?? e.url,
          url: e.url,
          bpm: e.bpm,
          firstBeatOffset: e.firstBeatOffset ?? 0,
          gain: e.gain
        });
        added = true;
      }
      return added;
    } catch {
      return false;
    }
  })();
  return userTracksPromise;
}
