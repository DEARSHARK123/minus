#!/usr/bin/env python3
"""Post-process Grok Imagine icon output -> RGBA 16/32 PNG under public/icons/pixel/."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "public" / "icons" / "pixel"
SRC_DIR = OUT / "_src"


def key_alpha(img: Image.Image) -> Image.Image:
    """Convert to RGBA; make near-black / near-white / flat gray bg transparent."""
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            # near black
            if mx < 28:
                px[x, y] = (r, g, b, 0)
                continue
            # near white
            if mn > 240:
                px[x, y] = (r, g, b, 0)
                continue
            # flat light gray bg (common in gen outputs)
            if mn > 200 and (mx - mn) < 18:
                px[x, y] = (r, g, b, 0)
                continue
            # flat mid-dark gray bg
            if 35 <= mx <= 55 and (mx - mn) < 12:
                px[x, y] = (r, g, b, 0)
                continue
    return rgba


def crop_content(img: Image.Image, pad: int = 2) -> Image.Image:
    """Crop to non-transparent content with small padding."""
    alpha = img.split()[-1]
    bbox = alpha.getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(img.width, r + pad)
    b = min(img.height, b + pad)
    return img.crop((l, t, r, b))


def to_square(img: Image.Image) -> Image.Image:
    """Pad to square transparent canvas, content centered."""
    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
    return canvas


def process(src: Path, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    SRC_DIR.mkdir(parents=True, exist_ok=True)

    img = Image.open(src)
    rgba = key_alpha(img)
    rgba = crop_content(rgba)
    rgba = to_square(rgba)

    # Keep a full-res transparent PNG for audit
    audit = SRC_DIR / f"{name}-src.png"
    rgba.save(audit, "PNG")

    for size in (32, 16):
        out = rgba.resize((size, size), Image.Resampling.NEAREST)
        dest = OUT / f"{name}-{size}.png"
        out.save(dest, "PNG")
        print(f"wrote {dest} ({size}x{size})")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: process-imagine-icon.py <src_image> <icon_name>", file=sys.stderr)
        sys.exit(2)
    process(Path(sys.argv[1]), sys.argv[2])
