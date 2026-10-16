#!/usr/bin/env python3
"""Convert a blue-on-white raster logo into a self-contained vector SVG."""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from PIL import Image


def foreground(pixel: tuple[int, int, int]) -> bool:
    red, green, blue = pixel
    return (
        max(pixel) - min(pixel) > 18
        and blue > red
        and blue > green * 0.85
        and red + green + blue < 700
    )


def row_runs(image: Image.Image, y: int) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for x in range(image.width):
        active = foreground(image.getpixel((x, y)))
        if active and start is None:
            start = x
        elif not active and start is not None:
            runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, image.width))
    return runs


def vector_rectangles(image: Image.Image) -> list[tuple[int, int, int, int]]:
    rectangles: list[tuple[int, int, int, int]] = []
    active: dict[tuple[int, int], tuple[int, int, int, int]] = {}
    for y in range(image.height):
        spans = row_runs(image, y)
        current: dict[tuple[int, int], tuple[int, int, int, int]] = {}
        for x0, x1 in spans:
            key = (x0, x1)
            if key in active:
                old_x0, old_y0, old_x1, _old_y1 = active[key]
                current[key] = (old_x0, old_y0, old_x1, y + 1)
            else:
                current[key] = (x0, y, x1, y + 1)
        for key, rectangle in active.items():
            if key not in current:
                rectangles.append(rectangle)
        active = current
    rectangles.extend(active.values())
    return rectangles


def dominant_blue(image: Image.Image) -> str:
    colors = Counter(pixel for pixel in image.get_flattened_data() if foreground(pixel))
    if not colors:
        raise ValueError("No blue logo pixels were found")
    red, green, blue = colors.most_common(1)[0][0]
    return f"#{red:02X}{green:02X}{blue:02X}"


def convert(source: Path, destination: Path) -> None:
    image = Image.open(source).convert("RGB")
    color = dominant_blue(image)
    rectangles = vector_rectangles(image)
    path_data = "".join(
        f"M{x0} {y0}H{x1}V{y1}H{x0}Z"
        for x0, y0, x1, y1 in rectangles
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {image.width} {image.height}" '
        f'width="{image.width}" height="{image.height}">'
        f'<path fill="{color}" d="{path_data}"/>'
        "</svg>"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(svg, encoding="utf-8")
    print(f"{source.name} -> {destination.name}: {image.width}x{image.height}, {color}, {len(rectangles)} vector rectangles")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pairs", nargs="+", help="Alternating source raster and destination SVG paths")
    args = parser.parse_args()
    if len(args.pairs) % 2:
        parser.error("Provide source/destination pairs")
    for index in range(0, len(args.pairs), 2):
        convert(Path(args.pairs[index]), Path(args.pairs[index + 1]))


if __name__ == "__main__":
    main()
