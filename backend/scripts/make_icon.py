"""Draws the Diffloupe app icon: diff lines inside a navy loupe on white."""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
SCALE = 4

TILE = (100, 100, 924, 924)
TILE_RADIUS = 185
LENS = 216
RING = 30
HANDLE_LENGTH = 190
HANDLE_WIDTH = 70
FRAME = (40, 56, 89, 255)
HANDLE = (31, 44, 72, 255)
GLASS = (246, 248, 252, 255)
LINES = [
    (-0.64, 0.36, (170, 176, 190, 255)),
    (-0.40, 0.70, (127, 199, 132, 255)),
    (-0.70, 0.12, (240, 128, 110, 255)),
    (-0.40, 0.58, (170, 176, 190, 255)),
]
LINE_HEIGHT = 50
LINE_GAP = 32


def box(cx: float, cy: float, r: float) -> list[float]:
    return [(cx - r) * SCALE, (cy - r) * SCALE, (cx + r) * SCALE, (cy + r) * SCALE]


def main(out: Path) -> None:
    big = SIZE * SCALE
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))

    shadow = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [TILE[0] * SCALE, (TILE[1] + 12) * SCALE, TILE[2] * SCALE, (TILE[3] + 12) * SCALE],
        TILE_RADIUS * SCALE,
        fill=(0, 0, 0, 70),
    )
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18 * SCALE)))
    ImageDraw.Draw(image).rounded_rectangle(
        [v * SCALE for v in TILE], TILE_RADIUS * SCALE, fill=(255, 255, 255, 255)
    )

    angle = math.radians(45)
    start = LENS + RING / 2
    end = LENS + HANDLE_LENGTH
    reach = end * math.cos(angle) + HANDLE_WIDTH / 2
    middle = (TILE[0] + TILE[2]) / 2
    cx = cy = middle - (reach - (LENS + RING)) / 2
    draw = ImageDraw.Draw(image)
    tip = (cx + end * math.cos(angle), cy + end * math.sin(angle))
    draw.line(
        [
            ((cx + start * math.cos(angle)) * SCALE, (cy + start * math.sin(angle)) * SCALE),
            (tip[0] * SCALE, tip[1] * SCALE),
        ],
        fill=HANDLE,
        width=HANDLE_WIDTH * SCALE,
    )
    draw.ellipse(box(tip[0], tip[1], HANDLE_WIDTH / 2), fill=HANDLE)
    draw.ellipse(box(cx, cy, LENS + RING), fill=FRAME)
    draw.ellipse(box(cx, cy, LENS), fill=GLASS)

    total = len(LINES) * LINE_HEIGHT + (len(LINES) - 1) * LINE_GAP
    top = cy - total / 2
    for index, (left, right, color) in enumerate(LINES):
        y = top + index * (LINE_HEIGHT + LINE_GAP)
        draw.rounded_rectangle(
            [
                (cx + left * LENS) * SCALE,
                y * SCALE,
                (cx + right * LENS) * SCALE,
                (y + LINE_HEIGHT) * SCALE,
            ],
            LINE_HEIGHT / 2 * SCALE,
            fill=color,
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    image.resize((SIZE, SIZE), Image.LANCZOS).save(out)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
