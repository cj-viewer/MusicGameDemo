#!/usr/bin/env python3
"""Rebuild the pink-stage base and prop layers from the approved reference pixels.

The generated matte is used only to decide alpha coverage. Every visible RGB pixel in
the prop exports comes from ``pink-stage-reference.jpg`` so the runtime palette cannot
drift when the layers are regenerated.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


CANVAS_WIDTH = 1920
CANVAS_HEIGHT = 1080


@dataclass(frozen=True)
class PropSource:
    id: int
    file: str
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class PropExport:
    source: PropSource
    x: int
    y: int
    width: int
    height: int


# Yellow-box coordinates from the original 1918 x 1081 extraction guide.
PROP_SOURCES = (
    PropSource(1, "object-01-foliage-strip-left.png", 69, 0, 69, 117),
    PropSource(2, "object-02-tree-cluster-left.png", 154, 0, 72, 149),
    PropSource(3, "object-03-foliage-column-left.png", 449, 0, 81, 197),
    PropSource(4, "object-04-foliage-column-right.png", 1377, 0, 84, 95),
    PropSource(5, "object-05-frog-totem-booth.png", 1477, 0, 105, 282),
    PropSource(6, "object-06-canopy-foliage-right.png", 1596, 0, 117, 57),
    PropSource(9, "object-09-hanging-sign-right.png", 1768, 0, 89, 209),
    PropSource(10, "object-10-edge-pillar-right.png", 1882, 0, 34, 202),
    PropSource(11, "object-11-entrance-gate.png", 638, 1, 601, 311),
    PropSource(12, "object-12-entrance-pillar-left.png", 552, 3, 132, 266),
    PropSource(15, "object-15-entrance-pillar-right.png", 1218, 6, 133, 265),
    PropSource(16, "object-16-edge-foliage-left.png", 8, 7, 37, 103),
    PropSource(17, "object-17-vending-stack-left.png", 328, 7, 136, 224),
    PropSource(18, "object-18-small-robed-statue.png", 1598, 56, 60, 165),
    PropSource(19, "object-19-vending-stack-right.png", 1389, 109, 76, 223),
    PropSource(20, "object-20-hanging-sign-left.png", 22, 130, 88, 270),
    PropSource(21, "object-21-small-stage-statue.png", 1013, 184, 42, 113),
    PropSource(22, "object-22-standing-sign-green.png", 263, 202, 116, 218),
    PropSource(23, "object-23-barrier-long.png", 784, 205, 216, 98),
    PropSource(24, "object-24-barrier-short.png", 1072, 213, 74, 89),
    PropSource(25, "object-25-control-post.png", 82, 305, 63, 130),
    PropSource(26, "object-26-trash-bin.png", 367, 349, 122, 104),
    PropSource(27, "object-27-music-sign-right.png", 1724, 369, 108, 203),
    PropSource(28, "object-28-crashed-vehicle.png", 4, 423, 253, 228),
    PropSource(29, "object-29-ground-rock.png", 314, 434, 109, 86),
    PropSource(30, "object-30-edge-sign-right.png", 1850, 463, 57, 280),
    PropSource(31, "object-31-frog-shop.png", 1526, 512, 317, 401),
    PropSource(32, "object-32-blue-creature-pillar.png", 354, 637, 216, 265),
    PropSource(33, "object-33-hanging-sign-bottom-left.png", 10, 672, 285, 222),
    PropSource(34, "object-34-pink-sign-bottom-right.png", 1367, 683, 135, 270),
    PropSource(35, "object-35-edge-figure-right.png", 1863, 772, 42, 130),
    PropSource(36, "object-36-small-canister.png", 583, 805, 73, 121),
    PropSource(37, "object-37-foliage-bank-bottom-left.png", 0, 880, 830, 201),
    PropSource(38, "object-38-foliage-bank-bottom-right.png", 1120, 880, 798, 201),
    PropSource(39, "object-39-low-wall-bottom-center.png", 843, 1023, 249, 49),
)


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--reference",
        type=Path,
        default=root / "docs/图片和附件/pink-stage-reference.jpg",
    )
    parser.add_argument(
        "--matte",
        type=Path,
        default=root / "docs/图片和附件/pink-stage-segmentation-matte.png",
    )
    parser.add_argument(
        "--base-source",
        type=Path,
        default=root / "docs/图片和附件/pink-stage-clean-inpaint-source.png",
    )
    parser.add_argument(
        "--clean-base-output",
        type=Path,
        default=root / "public/assets/images/backgrounds/pink-stage/pink-stage-clean-background.png",
    )
    parser.add_argument(
        "--runtime-base-output",
        type=Path,
        default=root / "public/assets/images/backgrounds/pink-stage/pink-stage-runtime-base.png",
    )
    parser.add_argument(
        "--objects-dir",
        type=Path,
        default=root / "public/assets/images/environment/pink-stage/objects",
    )
    parser.add_argument(
        "--generated-ts",
        type=Path,
        default=root / "src/game/pinkStageProps.generated.ts",
    )
    parser.add_argument("--preview-out", type=Path)
    parser.add_argument("--debug-alpha-out", type=Path)
    return parser.parse_args()


def scale_source_box(prop: PropSource) -> tuple[int, int, int, int]:
    sx = CANVAS_WIDTH / 1918
    sy = CANVAS_HEIGHT / 1081
    x0 = round(prop.x * sx)
    y0 = round(prop.y * sy)
    x1 = round((prop.x + prop.width) * sx)
    y1 = round((prop.y + prop.height) * sy)
    return x0, y0, x1, y1


def export_box(prop: PropSource) -> PropExport:
    x0, y0, x1, y1 = scale_source_box(prop)
    left = 30
    right = 30
    top = 22
    bottom = 54

    if prop.id == 11:
        left = right = 26
        top = 4
        bottom = 38
    elif prop.id in (37, 38):
        left = right = 30
        top = 32
        bottom = 0
    elif prop.id == 39:
        left = right = 32
        top = 28
        bottom = 8

    ex0 = max(0, x0 - left)
    ey0 = max(0, y0 - top)
    ex1 = min(CANVAS_WIDTH, x1 + right)
    ey1 = min(CANVAS_HEIGHT, y1 + bottom)
    return PropExport(prop, ex0, ey0, ex1 - ex0, ey1 - ey0)


def average_saturation(rgb: np.ndarray) -> float:
    data = rgb.astype(np.float32) / 255.0
    maximum = data.max(axis=2)
    minimum = data.min(axis=2)
    return float(np.where(maximum > 0, (maximum - minimum) / maximum, 0).mean())


def match_base_tone(reference: Image.Image, base: Image.Image) -> Image.Image:
    reference_rgb = np.asarray(reference.convert("RGB"))
    base = base.convert("RGB").resize((CANVAS_WIDTH, CANVAS_HEIGHT), Image.Resampling.LANCZOS)
    base_rgb = np.asarray(base)

    # This central window is unobstructed courtyard in the approved reference.
    y0, y1 = 400, 800
    x0, x1 = 700, 1200
    ref_sample = reference_rgb[y0:y1, x0:x1]
    base_sample = base_rgb[y0:y1, x0:x1]
    saturation_scale = np.clip(
        average_saturation(ref_sample) / max(average_saturation(base_sample), 1e-6),
        0.85,
        1.15,
    )
    matched = ImageEnhance.Color(base).enhance(float(saturation_scale))
    matched_rgb = np.asarray(matched).astype(np.float32)
    channel_delta = (
        ref_sample.astype(np.float32).mean(axis=(0, 1))
        - matched_rgb[y0:y1, x0:x1].mean(axis=(0, 1))
    )
    matched_rgb = np.clip(matched_rgb + channel_delta, 0, 255).astype(np.uint8)
    return Image.fromarray(matched_rgb, "RGB")


def build_alpha(
    reference: Image.Image,
    base: Image.Image,
    matte: Image.Image,
    exports: tuple[PropExport, ...],
) -> tuple[np.ndarray, np.ndarray]:
    reference_rgb = np.asarray(reference.convert("RGB")).astype(np.int16)
    base_rgb = np.asarray(base.convert("RGB")).astype(np.int16)
    matte_l = np.asarray(
        matte.convert("L").resize((CANVAS_WIDTH, CANVAS_HEIGHT), Image.Resampling.BICUBIC)
    )

    union = np.zeros((CANVAS_HEIGHT, CANVAS_WIDTH), dtype=bool)
    for item in exports:
        union[item.y : item.y + item.height, item.x : item.x + item.width] = True

    core_seed = Image.fromarray(np.where(matte_l >= 160, 255, 0).astype(np.uint8), "L")
    near_core = np.asarray(core_seed.filter(ImageFilter.MaxFilter(61))) > 0
    difference = np.abs(reference_rgb - base_rgb).max(axis=2)
    foreground = ((matte_l >= 14) | ((difference >= 18) & near_core)) & union

    # The source reference contains faint but important machines and silhouettes inside
    # the security-gate opening. Keep that whole interior source patch losslessly.
    foreground[70:274, 758:1165] = True
    # The low wall sits flush against the bottom edge and was read as black background
    # by the grayscale matte. Recover it from its strong difference to the clean plate.
    low_wall = next(item for item in exports if item.source.id == 39)
    wall_slice = np.s_[
        low_wall.y : low_wall.y + low_wall.height,
        low_wall.x : low_wall.x + low_wall.width,
    ]
    foreground[wall_slice] |= difference[wall_slice] >= 14

    solid = Image.fromarray(np.where(foreground, 255, 0).astype(np.uint8), "L")
    feather = np.asarray(solid.filter(ImageFilter.GaussianBlur(1.15))).astype(np.float32)
    alpha = np.where(foreground, 255.0, feather)

    # Some generated shadow blobs reach an expanded crop boundary. Fade only that
    # outer safety margin so the source patch never leaves a rectangular tone seam.
    union_soft = np.asarray(
        Image.fromarray(np.where(union, 255, 0).astype(np.uint8), "L").filter(
            ImageFilter.GaussianBlur(5.0)
        )
    ).astype(np.float32)
    union_soft[:6, :][union[:6, :]] = 255
    union_soft[-6:, :][union[-6:, :]] = 255
    union_soft[:, :6][union[:, :6]] = 255
    union_soft[:, -6:][union[:, -6:]] = 255
    alpha *= union_soft / 255.0
    alpha[70:274, 758:1165] = 255
    alpha[alpha < 5] = 0
    alpha = alpha.astype(np.uint8)

    label = assign_pixels(exports)
    gate_index = next(index for index, item in enumerate(exports) if item.source.id == 11)
    label[70:274, 758:1165] = gate_index
    alpha[label < 0] = 0
    return alpha, label


def compose_clean_base(
    reference: Image.Image,
    inpaint_base: Image.Image,
    alpha: np.ndarray,
) -> Image.Image:
    """Keep untouched reference pixels outside removal zones.

    This prevents a globally regenerated clean plate from changing the palette or
    texture in areas that never needed inpainting. Under and immediately around each
    extracted object, the existing clean plate is still used with a soft transition.
    """

    removal = Image.fromarray(np.where(alpha > 0, 255, 0).astype(np.uint8), "L")
    removal = removal.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(5.0))
    weight = np.asarray(removal).astype(np.float32)[:, :, None] / 255.0
    reference_rgb = np.asarray(reference.convert("RGB")).astype(np.float32)
    inpaint_rgb = np.asarray(inpaint_base.convert("RGB")).astype(np.float32)
    clean_rgb = reference_rgb * (1.0 - weight) + inpaint_rgb * weight
    return Image.fromarray(np.clip(clean_rgb, 0, 255).astype(np.uint8), "RGB")


def assign_pixels(exports: tuple[PropExport, ...]) -> np.ndarray:
    yy, xx = np.indices((CANVAS_HEIGHT, CANVAS_WIDTH))
    best = np.full((CANVAS_HEIGHT, CANVAS_WIDTH), np.inf, dtype=np.float32)
    label = np.full((CANVAS_HEIGHT, CANVAS_WIDTH), -1, dtype=np.int16)

    for index, item in enumerate(exports):
        core_x0, core_y0, core_x1, core_y1 = scale_source_box(item.source)
        export_x1 = item.x + item.width
        export_y1 = item.y + item.height
        eligible = (xx >= item.x) & (xx < export_x1) & (yy >= item.y) & (yy < export_y1)

        dx = np.maximum(np.maximum(core_x0 - xx, 0), xx - (core_x1 - 1))
        dy = np.maximum(np.maximum(core_y0 - yy, 0), yy - (core_y1 - 1))
        distance = dx.astype(np.float32) ** 2 + dy.astype(np.float32) ** 2
        inside_core = (xx >= core_x0) & (xx < core_x1) & (yy >= core_y0) & (yy < core_y1)
        # When yellow boxes overlap, the more specific (smaller) object owns the pixel.
        area_tiebreak = (item.source.width * item.source.height) / 1_000_000.0
        score = np.where(inside_core, -1_000_000.0 + area_tiebreak, distance + area_tiebreak)
        update = eligible & (score < best)
        best[update] = score[update]
        label[update] = index

    return label


def write_props(
    reference: Image.Image,
    alpha: np.ndarray,
    label: np.ndarray,
    exports: tuple[PropExport, ...],
    output_dir: Path,
    icc_profile: bytes | None,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    rgb = np.asarray(reference.convert("RGB"))
    for index, item in enumerate(exports):
        x0, y0 = item.x, item.y
        x1, y1 = x0 + item.width, y0 + item.height
        crop_rgb = rgb[y0:y1, x0:x1]
        crop_alpha = np.where(label[y0:y1, x0:x1] == index, alpha[y0:y1, x0:x1], 0)
        rgba = np.dstack((crop_rgb, crop_alpha.astype(np.uint8)))
        save_args = {"icc_profile": icc_profile} if icc_profile else {}
        Image.fromarray(rgba, "RGBA").save(output_dir / item.source.file, **save_args)


def write_generated_ts(path: Path, exports: tuple[PropExport, ...]) -> None:
    rows = [
        "// Generated by scripts/rebuild_pink_stage_layers.py. Do not edit by hand.",
        "",
        "export interface PinkStageProp {",
        "  id: number;",
        "  file: string;",
        "  x: number;",
        "  y: number;",
        "  width: number;",
        "  height: number;",
        "}",
        "",
        f"export const PINK_STAGE_SOURCE_WIDTH = {CANVAS_WIDTH};",
        f"export const PINK_STAGE_SOURCE_HEIGHT = {CANVAS_HEIGHT};",
        "",
        "export const PINK_STAGE_PROPS: readonly PinkStageProp[] = [",
    ]
    for item in exports:
        rows.append(
            "  { "
            f"id: {item.source.id}, file: '{item.source.file}', x: {item.x}, y: {item.y}, "
            f"width: {item.width}, height: {item.height} "
            "},"
        )
    rows.extend((
        "];",
        "",
    ))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(rows), encoding="utf-8")


def composite_preview(
    base: Image.Image,
    objects_dir: Path,
    exports: tuple[PropExport, ...],
) -> Image.Image:
    preview = base.convert("RGBA")
    for item in exports:
        prop = Image.open(objects_dir / item.source.file).convert("RGBA")
        preview.alpha_composite(prop, (item.x, item.y))
    return preview


def main() -> None:
    args = parse_args()
    reference_file = Image.open(args.reference)
    icc_profile = reference_file.info.get("icc_profile")
    reference = reference_file.convert("RGB").resize(
        (CANVAS_WIDTH, CANVAS_HEIGHT), Image.Resampling.LANCZOS
    )
    inpaint_base = match_base_tone(reference, Image.open(args.base_source))
    exports = tuple(export_box(prop) for prop in PROP_SOURCES)
    alpha, label = build_alpha(reference, inpaint_base, Image.open(args.matte), exports)
    runtime_base = compose_clean_base(reference, inpaint_base, alpha)

    base_save_args = {"icc_profile": icc_profile} if icc_profile else {}
    inpaint_base.save(args.clean_base_output, **base_save_args)
    runtime_base.save(args.runtime_base_output, **base_save_args)
    write_props(reference, alpha, label, exports, args.objects_dir, icc_profile)
    write_generated_ts(args.generated_ts, exports)

    preview = composite_preview(runtime_base, args.objects_dir, exports)
    if args.preview_out:
        args.preview_out.parent.mkdir(parents=True, exist_ok=True)
        preview.save(args.preview_out, **base_save_args)
    if args.debug_alpha_out:
        args.debug_alpha_out.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(alpha, "L").save(args.debug_alpha_out)

    ref_rgb = np.asarray(reference, dtype=np.int16)
    preview_rgb = np.asarray(preview.convert("RGB"), dtype=np.int16)
    covered = alpha > 0
    exact = float(np.abs(ref_rgb[covered] - preview_rgb[covered]).mean()) if covered.any() else 0.0
    stats = {
        "canvas": [CANVAS_WIDTH, CANVAS_HEIGHT],
        "prop_count": len(exports),
        "foreground_coverage_percent": round(float(covered.mean() * 100), 2),
        "foreground_mean_absolute_error": round(exact, 4),
        "preview_mean_absolute_error": round(float(np.abs(ref_rgb - preview_rgb).mean()), 4),
    }
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
