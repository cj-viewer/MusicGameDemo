#!/usr/bin/env python
"""测量节拍相关音频的真实发声时刻，用于校准代码中的对齐常量。

背景：背景鼓点由 WebAudio 振荡器在 Conductor 拍点上采样级精确发声；
音乐与它对不上时，误差只可能来自两处——
  1. bgmTracks.ts 里各曲目的 sourceBpm / firstBeatOffset 不准
     （BPM 相对误差会随播放逐拍累积成可听漂移）；
  2. Conductor.ts 里"嘿"声采样的 seek 常量（LIGHT/HEAVY_CALL_START）不准
     （采样文件自带前置静音，播放晚于输入）。

本脚本不是"播放音频文件"，而是解码后直接分析波形：
  - SFX：报告 -40/-30/-20 dB 起声时刻、最陡上升点与响度峰值；
  - BGM：对全曲 onset 包络在文档 BPM 附近做 (BPM, 相位) 二维网格搜索，
    输出精确 BPM、首拍相位，并按四段分别估相位验证漂移是否收敛。

用法：
  D:\\Tools\\Miniconda\\python.exe scripts/measure_audio_timing.py
依赖：numpy、ffmpeg（PATH 中或 winget 默认安装路径）。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

import numpy as np

SR = 48000
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(REPO, "public", "assets", "audio")

# 与 src/game/bgmTracks.ts、src/core/Conductor.ts 中的当前常量对照
DOC_TRACKS = [
    ("bgm0.mp3", 153.846, 0.09),
    ("bgm1.mp3", 145.0, 0.012),
    ("bgm2.mp3", 176.47, 0.02),
    ("bgm3.mp3", 146.32, 0.026),
]
DOC_SFX = [
    ("sfx-beat-light.mp3", 0.105),
    ("sfx-beat-heavy.mp3", 0.11),
]


def find_ffmpeg() -> str:
    ff = shutil.which("ffmpeg")
    if ff:
        return ff
    packages = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages")
    if os.path.isdir(packages):
        for root, _dirs, files in os.walk(packages):
            if "ffmpeg.exe" in files:
                return os.path.join(root, "ffmpeg.exe")
    sys.exit("找不到 ffmpeg，请先安装或加入 PATH")


FFMPEG = find_ffmpeg()


def decode(path: str) -> np.ndarray:
    """解码为 48kHz 单声道 float32。ffmpeg 会按 LAME 头去掉编码器延迟，
    与浏览器 decodeAudioData 的结果一致（此前已对 bgm1 逐样本核对过）。"""
    raw = subprocess.run(
        [FFMPEG, "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def rms_envelope(x: np.ndarray, win_ms: float, hop_ms: float) -> tuple[np.ndarray, float]:
    win = max(1, int(SR * win_ms / 1000))
    hop = max(1, int(SR * hop_ms / 1000))
    n = max(0, (len(x) - win) // hop)
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    frames = x[idx]
    rms = np.sqrt((frames.astype(np.float64) ** 2).mean(axis=1))
    return rms, hop / SR


def sfx_report(path: str) -> dict:
    x = decode(path)
    rms, dt = rms_envelope(x, win_ms=3.0, hop_ms=0.5)
    peak = float(rms.max())
    out: dict = {"duration": round(len(x) / SR, 4), "peak_time": round(float(rms.argmax()) * dt, 4)}
    for db in (40, 30, 20):
        thr = peak * 10 ** (-db / 20)
        above = np.nonzero(rms >= thr)[0]
        out[f"onset_-{db}dB"] = round(float(above[0]) * dt, 4) if len(above) else None
    rise = np.diff(rms)
    out["steepest_rise"] = round(float(rise.argmax()) * dt, 4)
    return out


def onset_strength(x: np.ndarray) -> tuple[np.ndarray, float]:
    """onset 包络：短窗 RMS 的半波整流差分。窗 6ms / 步 1ms，系统偏置 ~3ms。"""
    rms, dt = rms_envelope(x, win_ms=6.0, hop_ms=1.0)
    d = np.diff(rms)
    d[d < 0] = 0
    return d, dt


def grid_score(o: np.ndarray, dt: float, bpm: float, phase: float, t_end: float) -> float:
    period = 60.0 / bpm
    g = np.arange(phase, t_end, period)
    idx = np.minimum((g / dt).astype(np.int64), len(o) - 1)
    return float(o[idx].mean())


def refine(o: np.ndarray, dt: float, t_end: float, bpm0: float, phase0: float,
           bpm_span: float, phase_span: float, bpm_step: float, phase_step: float) -> tuple[float, float, float]:
    best = (-1.0, bpm0, phase0)
    for bpm in np.arange(bpm0 - bpm_span, bpm0 + bpm_span + bpm_step / 2, bpm_step):
        period = 60.0 / bpm
        lo = max(0.0, phase0 - phase_span)
        hi = min(period, phase0 + phase_span)
        for phase in np.arange(lo, hi, phase_step):
            s = grid_score(o, dt, bpm, phase, t_end)
            if s > best[0]:
                best = (s, float(bpm), float(phase))
    return best


def bgm_report(path: str, doc_bpm: float, doc_offset: float) -> dict:
    x = decode(path)
    o, dt = onset_strength(x)
    t_end = len(o) * dt

    # 粗搜：±1% BPM、全相位；再两轮细化
    period0 = 60.0 / doc_bpm
    best = (-1.0, doc_bpm, doc_offset)
    for bpm in np.arange(doc_bpm * 0.99, doc_bpm * 1.01, 0.05):
        period = 60.0 / bpm
        for phase in np.arange(0.0, period, 0.008):
            s = grid_score(o, dt, bpm, phase, t_end)
            if s > best[0]:
                best = (s, float(bpm), float(phase))
    _, bpm, phase = best
    _, bpm, phase = refine(o, dt, t_end, bpm, phase, 0.05, 0.02, 0.005, 0.002)
    _, bpm, phase = refine(o, dt, t_end, bpm, phase, 0.005, 0.004, 0.0005, 0.0005)

    # 固定 BPM，按四段分别估相位：若测得 BPM 准确，各段相位应一致
    quarters = []
    period = 60.0 / bpm
    seg = t_end / 4
    for k in range(4):
        s_lo, s_hi = k * seg, (k + 1) * seg
        mask_best = (-1.0, phase)
        for cand in np.arange(max(0.0, phase - 0.05), min(period, phase + 0.05), 0.001):
            g = np.arange(cand + np.ceil(max(0, s_lo - cand) / period) * period, s_hi, period)
            if len(g) == 0:
                continue
            idx = np.minimum((g / dt).astype(np.int64), len(o) - 1)
            s = float(o[idx].mean())
            if s > mask_best[0]:
                mask_best = (s, float(cand))
        quarters.append(round(mask_best[1], 4))

    drift_per_beat_ms = (60.0 / doc_bpm - 60.0 / bpm) * 1000
    return {
        "duration": round(len(x) / SR, 3),
        "doc_bpm": doc_bpm,
        "measured_bpm": round(bpm, 4),
        "bpm_rel_err_pct": round((doc_bpm - bpm) / bpm * 100, 4),
        "doc_first_beat": doc_offset,
        "measured_first_beat": round(phase, 4),
        "quarter_phases": quarters,
        "drift_per_beat_ms_if_doc_bpm_used": round(drift_per_beat_ms, 3),
        "drift_at_track_end_ms_if_doc_bpm_used": round(drift_per_beat_ms * t_end / (60.0 / bpm), 1),
    }


def main() -> None:
    result: dict = {"sfx": {}, "bgm": {}}
    for name, cur_seek in DOC_SFX:
        rep = sfx_report(os.path.join(AUDIO, "sfx", name))
        rep["current_seek_in_code"] = cur_seek
        result["sfx"][name] = rep
    for name, doc_bpm, doc_offset in DOC_TRACKS:
        result["bgm"][name] = bgm_report(os.path.join(AUDIO, "music", name), doc_bpm, doc_offset)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
