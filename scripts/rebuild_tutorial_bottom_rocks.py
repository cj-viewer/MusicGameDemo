"""Split the visible bg1.psd Rock group out of the tutorial background.

The committed tutorial background may intentionally differ from the latest PSD
outside the Rock group.  This script therefore replaces only the Rock group's
bounding box with the PSD's no-rock environment, preserving every other pixel
of the current runtime background.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from psd_tools import PSDImage


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BACKGROUND = (
    ROOT / "public/assets/images/backgrounds/pond-stage/pond-stage-background.png"
)
DEFAULT_ROCKS = ROOT / "public/assets/images/ui/tutorial/tutorial-bottom-rocks.png"
ENVIRONMENT_LAYER_NAMES = {"bg1", "Layer 11"}


def set_top_level_visibility(psd: PSDImage, visible_names: set[str]) -> None:
    for layer in psd:
        layer.visible = layer.name in visible_names


def save_rgba(image: Image.Image, path: Path, icc_profile: bytes | None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True, icc_profile=icc_profile)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("psd", type=Path, help="Path to the project-provided bg1.psd")
    parser.add_argument("--background", type=Path, default=DEFAULT_BACKGROUND)
    parser.add_argument("--rocks", type=Path, default=DEFAULT_ROCKS)
    args = parser.parse_args()

    psd = PSDImage.open(args.psd)
    if psd.size != (1920, 1080):
        raise ValueError(f"Expected a 1920x1080 PSD, got {psd.size}")

    rock_group = next((layer for layer in psd if layer.name == "Rock"), None)
    if rock_group is None or not rock_group.is_group():
        raise ValueError("bg1.psd does not contain the expected top-level Rock group")

    set_top_level_visibility(psd, ENVIRONMENT_LAYER_NAMES | {"Rock"})
    flattened_environment = psd.composite().convert("RGBA")

    set_top_level_visibility(psd, ENVIRONMENT_LAYER_NAMES)
    no_rock_environment = psd.composite().convert("RGBA")

    rock_group.visible = True
    rocks = rock_group.composite(force=True).convert("RGBA")
    rock_box = tuple(rock_group.bbox)
    expected_size = (rock_box[2] - rock_box[0], rock_box[3] - rock_box[1])
    if rocks.size != expected_size:
        raise ValueError(f"Rock composite has size {rocks.size}, expected {expected_size}")

    current_file = Image.open(args.background)
    icc_profile = current_file.info.get("icc_profile")
    current = current_file.convert("RGBA")
    if current.size != psd.size:
        raise ValueError(f"Runtime background has size {current.size}, expected {psd.size}")

    x0, y0, x1, y1 = rock_box
    flattened_runtime = current.copy()
    flattened_runtime.paste(flattened_environment.crop(rock_box), (x0, y0))
    current_region = np.asarray(current.crop(rock_box), dtype=np.int16)
    flat_region = np.asarray(flattened_environment.crop(rock_box), dtype=np.int16)
    base_region = np.asarray(no_rock_environment.crop(rock_box), dtype=np.int16)
    rock_alpha = np.asarray(rocks.getchannel("A")) > 0

    flat_error = int(np.abs(current_region - flat_region)[rock_alpha].max())
    base_error = int(np.abs(current_region - base_region).max())
    if flat_error > 1 and base_error > 1:
        raise ValueError(
            "The runtime background matches neither the flattened nor the already-split "
            f"PSD Rock region (flat max error {flat_error}, base max error {base_error})."
        )

    if flat_error <= 1:
        current.paste(no_rock_environment.crop(rock_box), (x0, y0))

    save_rgba(current, args.background, icc_profile)
    save_rgba(rocks, args.rocks, icc_profile)

    reconstructed = current.copy()
    reconstructed.alpha_composite(rocks, (x0, y0))
    reference = np.asarray(flattened_runtime, dtype=np.int16)
    rebuilt = np.asarray(reconstructed, dtype=np.int16)
    delta = np.abs(reference - rebuilt)
    print(
        f"rocks={rocks.size}@({x0},{y0}) max_error={int(delta.max())} "
        f"mae={float(delta.mean()):.8f}"
    )


if __name__ == "__main__":
    main()
