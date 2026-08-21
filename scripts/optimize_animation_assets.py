#!/usr/bin/env python
"""帧序列抽帧 + PNG 调色板量化压缩，用于核显机型的素材侧优化。

抽帧（循环动画减半，攻击特效不动）：
  保留奇数帧（1,3,5,...）并重命名为连续序号；dash/roll/death 使用固定
  duration 注册，Phaser 会自动均分帧时长；idle/run 用 frameRate 注册，
  代码侧需同步把 frameRate 减半（见本次一并修改的 4 个 *Animation.ts）。

压缩（带误差校验，不达标自动跳过量化）：
  RGBA → 256 色调色板（FASTOCTREE，含 alpha）。仅当逐像素最大误差 ≤ MAX_DIFF
  且平均误差 ≤ MEAN_DIFF 才采用量化结果，否则仅做无损重压。照片类背景会
  自动落入"仅无损重压"路径，不会被强行降色。

用法：D:\\Tools\\Miniconda\\python.exe scripts/optimize_animation_assets.py [--dry-run]
依赖：Pillow。幂等：已抽帧的目录自动跳过。
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(REPO, "public", "assets", "images")
DRY = "--dry-run" in sys.argv

MAX_DIFF = 24
MEAN_DIFF = 1.0

# (目录, 文件前缀, 序号是否补零, 原帧数)。保留奇数帧后重命名为 1..N/2。
DECIMATE = [
    ("characters/player/animation/idle", "player_idle-", False, 8),
    ("characters/player/animation/run", "player_run_", True, 8),
    ("characters/player/animation/dash", "player_dash_", True, 12),
    ("characters/player/animation/death01", "player_death01_", True, 8),
    ("characters/player/animation/death02", "player_death02_", True, 8),
    ("characters/npc/npc_fan01/idle", "npc_fan01_idle_", True, 8),
    ("characters/npc/npc_fan01/run", "npc_fan01_run_", True, 8),
    ("characters/npc/npc_guard01/idle", "npc_guard01_idle_", True, 8),
    ("characters/npc/npc_guard01/run", "npc_guard01_run_", True, 8),
    ("characters/npc/npc_tutorial01/idle", "npc_tutorial01_idle_", True, 8),
    ("characters/npc/npc_tutorial01/run", "npc_tutorial01_run_", True, 8),
    ("characters/npc/npc_tutorial01/roll", "npc_tutorial01_roll_", True, 12),
]

# 量化压缩的根目录（运行时会解码进显存/内存的图）。
QUANTIZE_ROOTS = [
    "characters",
    "environment",
    "ui",
    "weapons",
    "backgrounds/pond-stage",
    "backgrounds/pink-stage",
    "backgrounds/intro",
]


def frame_name(prefix: str, padded: bool, index: int) -> str:
    return f"{prefix}{index:02d}.png" if padded else f"{prefix}{index}.png"


def decimate() -> tuple[int, int]:
    removed = 0
    kept = 0
    for rel, prefix, padded, total in DECIMATE:
        directory = os.path.join(IMAGES, rel)
        have = [f for f in os.listdir(directory) if f.startswith(prefix) and f.endswith(".png")]
        if len(have) == total // 2:
            print(f"  跳过（已抽帧）: {rel}")
            kept += len(have)
            continue
        if len(have) != total:
            raise SystemExit(f"{rel}: 期望 {total} 帧，实际 {len(have)}，中止以免误删")
        keep_src = list(range(1, total + 1, 2))
        for new_idx, src_idx in enumerate(keep_src, start=1):
            src = os.path.join(directory, frame_name(prefix, padded, src_idx))
            dst = os.path.join(directory, frame_name(prefix, padded, new_idx))
            if src != dst and not DRY:
                os.replace(src, dst)
        for src_idx in range(len(keep_src) + 1, total + 1):
            path = os.path.join(directory, frame_name(prefix, padded, src_idx))
            if os.path.exists(path):
                if not DRY:
                    os.remove(path)
                removed += 1
        kept += len(keep_src)
        print(f"  {rel}: {total} → {len(keep_src)} 帧")
    return kept, removed


def quantize_file(path: str) -> tuple[int, int, str]:
    before = os.path.getsize(path)
    img = Image.open(path)
    img.load()
    if img.mode not in ("RGBA", "RGB", "P", "LA", "L"):
        img.close()
        return before, before, "跳过(模式)"
    mode = img.mode
    rgba = img.convert("RGBA")
    img.close()  # Windows 上不关句柄无法 os.replace 原文件

    pal = rgba.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
    restored = pal.convert("RGBA")
    a = np.asarray(rgba, dtype=np.int16)
    b = np.asarray(restored, dtype=np.int16)
    diff = np.abs(a - b)
    max_diff = int(diff.max())
    mean = float(diff.mean())

    tmp = path + ".opt"
    if max_diff <= MAX_DIFF and mean <= MEAN_DIFF:
        pal.save(tmp, format="PNG", optimize=True)
        tag = f"量化(max={max_diff},mean={mean:.2f})"
    else:
        rgba.save(tmp, format="PNG", optimize=True) if mode == "RGBA" else rgba.convert(mode).save(tmp, format="PNG", optimize=True)
        tag = f"仅重压(max={max_diff},mean={mean:.2f})"
    after = os.path.getsize(tmp)
    if after < before and not DRY:
        replace_with_retry(tmp, path)
    else:
        os.remove(tmp)
        after = before
        tag += " 保留原文件"
    return before, after, tag


def replace_with_retry(tmp: str, path: str, attempts: int = 5) -> None:
    """dev server / 杀毒软件可能瞬时占用目标文件；重试后退化为覆盖写入。"""
    import shutil
    import time
    for i in range(attempts):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.4 * (i + 1))
    shutil.copyfile(tmp, path)
    os.remove(tmp)


def quantize_all() -> tuple[int, int, int]:
    total_before = 0
    total_after = 0
    n = 0
    for root in QUANTIZE_ROOTS:
        base = os.path.join(IMAGES, root)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, files in os.walk(base):
            for f in sorted(files):
                if not f.lower().endswith(".png"):
                    continue
                path = os.path.join(dirpath, f)
                before, after, tag = quantize_file(path)
                total_before += before
                total_after += after
                n += 1
                if after < before and (before - after) > 20 * 1024:
                    rel = os.path.relpath(path, IMAGES)
                    print(f"  {rel}: {before//1024}KB → {after//1024}KB  {tag}")
    return n, total_before, total_after


def main() -> None:
    print("== 抽帧 ==" + ("（dry-run）" if DRY else ""))
    kept, removed = decimate()
    print(f"循环动画帧: 保留 {kept}，删除 {removed}")
    print("\n== 量化压缩 ==")
    n, before, after = quantize_all()
    print(f"\n处理 {n} 个 PNG：{before/1048576:.2f}MB → {after/1048576:.2f}MB "
          f"(-{(before-after)/1048576:.2f}MB, -{(1-after/max(before,1))*100:.0f}%)")


if __name__ == "__main__":
    main()
