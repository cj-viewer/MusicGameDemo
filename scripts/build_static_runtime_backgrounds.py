#!/usr/bin/env python
"""Build low-memory static WebP backgrounds for the runtime.

The authored PNGs and the 35 pink-stage layers remain untouched as source
assets. The runtime derivatives are 1280 x 720 so Phaser can scale them to the
2560 x 1440 pixel-art canvas with an exact 2x ratio.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from PIL import Image, ImageOps

from rebuild_pink_stage_layers import PROP_SOURCES, export_box


ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "public/assets/images"
TARGET_SIZE = (1280, 720)
WEBP_QUALITY = 82


def save_webp(image: Image.Image, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    fitted = ImageOps.fit(image.convert("RGB"), TARGET_SIZE, method=Image.Resampling.LANCZOS)
    fitted.save(output, "WEBP", quality=WEBP_QUALITY, method=6)
    digest = hashlib.sha256(output.read_bytes()).hexdigest().upper()
    print(f"{output.relative_to(ROOT)}: {output.stat().st_size} bytes, sha256={digest}")


def build_static_pink_stage() -> Image.Image:
    base_path = IMAGES / "backgrounds/pink-stage/pink-stage-runtime-base.png"
    objects_dir = IMAGES / "environment/pink-stage/objects"
    with Image.open(base_path) as base_image:
        composed = base_image.convert("RGBA")
    for source in PROP_SOURCES:
        item = export_box(source)
        with Image.open(objects_dir / source.file) as prop_image:
            composed.alpha_composite(prop_image.convert("RGBA"), (item.x, item.y))
    return composed


def main() -> None:
    with Image.open(IMAGES / "backgrounds/intro/intro-title-background.png") as image:
        save_webp(image, IMAGES / "backgrounds/intro/intro-title-background-1280.webp")
    with Image.open(IMAGES / "backgrounds/pond-stage/pond-stage-background.png") as image:
        save_webp(image, IMAGES / "backgrounds/pond-stage/pond-stage-background-1280.webp")
    save_webp(
        build_static_pink_stage(),
        IMAGES / "backgrounds/pink-stage/pink-stage-static-1280.webp",
    )


if __name__ == "__main__":
    main()
