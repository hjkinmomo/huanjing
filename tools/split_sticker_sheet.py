from __future__ import annotations

import argparse
from collections import deque
import json
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Split an alpha sticker sheet into padded square PNG assets.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--names", required=True, help="Comma-separated row-major asset names.")
    parser.add_argument("--rows", type=int, default=4)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--size", type=int, default=384)
    parser.add_argument("--padding", type=int, default=16)
    parser.add_argument("--prefix", default="")
    parser.add_argument("--chroma-auto", action="store_true", help="Derive a chroma key from the source border.")
    parser.add_argument("--chroma-tolerance", type=float, default=42.0)
    parser.add_argument("--chroma-softness", type=float, default=48.0)
    parser.add_argument("--alpha-sheet", type=Path, help="Optional cleaned RGBA sheet for QA evidence.")
    parser.add_argument("--metrics", type=Path)
    parser.add_argument("--contact-sheet", type=Path)
    return parser.parse_args()


def chroma_to_alpha(source: Image.Image, tolerance: float, softness: float) -> Image.Image:
    rgba = np.asarray(source.convert("RGBA"), dtype=np.float32).copy()
    rgb = rgba[:, :, :3]
    border_width = max(4, min(source.width, source.height) // 64)
    border = np.concatenate((
        rgb[:border_width].reshape(-1, 3),
        rgb[-border_width:].reshape(-1, 3),
        rgb[:, :border_width].reshape(-1, 3),
        rgb[:, -border_width:].reshape(-1, 3),
    ))
    key = np.median(border, axis=0)
    if not (key[0] > 170 and key[2] > 170 and key[1] < 120):
        raise ValueError(f"auto chroma border is not magenta-like: {key.round(1).tolist()}")
    softness = max(1.0, softness)
    distance = np.linalg.norm(rgb - key, axis=2)
    alpha = np.clip((distance - max(0.0, tolerance)) / softness, 0.0, 1.0)
    # Reverse the key-color blend on partially transparent edge pixels to avoid magenta halos.
    safe_alpha = np.maximum(alpha, 0.08)[:, :, None]
    foreground = np.clip((rgb - (1.0 - alpha[:, :, None]) * key) / safe_alpha, 0.0, 255.0)
    rgba[:, :, :3] = np.where(alpha[:, :, None] > 0.0, foreground, 0.0)
    rgba[:, :, 3] = np.round(alpha * 255.0)
    return Image.fromarray(rgba.astype(np.uint8), mode="RGBA")


def label_components(binary: np.ndarray) -> tuple[np.ndarray, list[dict[str, float | int]]]:
    """Label 8-connected alpha components without requiring SciPy."""
    height, width = binary.shape
    labels = np.zeros((height, width), dtype=np.int32)
    components: list[dict[str, float | int]] = []
    component_id = 0
    for start_y in range(height):
        for start_x in range(width):
            if not binary[start_y, start_x] or labels[start_y, start_x] != 0:
                continue
            component_id += 1
            labels[start_y, start_x] = component_id
            pending = deque([(start_y, start_x)])
            area = 0
            sum_x = 0
            sum_y = 0
            min_x = max_x = start_x
            min_y = max_y = start_y
            while pending:
                y, x = pending.popleft()
                area += 1
                sum_x += x
                sum_y += y
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
                for neighbor_y in range(max(0, y - 1), min(height, y + 2)):
                    for neighbor_x in range(max(0, x - 1), min(width, x + 2)):
                        if binary[neighbor_y, neighbor_x] and labels[neighbor_y, neighbor_x] == 0:
                            labels[neighbor_y, neighbor_x] = component_id
                            pending.append((neighbor_y, neighbor_x))
            components.append({
                "id": component_id,
                "area": area,
                "center_x": sum_x / area,
                "center_y": sum_y / area,
                "left": min_x,
                "top": min_y,
                "right": max_x + 1,
                "bottom": max_y + 1,
            })
    return labels, components


def split_sheet(args: argparse.Namespace) -> list[dict[str, object]]:
    names = [item.strip() for item in args.names.split(",") if item.strip()]
    expected = args.rows * args.columns
    if len(names) != expected:
        raise ValueError(f"expected {expected} names, received {len(names)}")
    if args.size <= args.padding * 2:
        raise ValueError("size must exceed twice the padding")

    source = Image.open(args.input).convert("RGBA")
    if args.chroma_auto:
        source = chroma_to_alpha(source, args.chroma_tolerance, args.chroma_softness)
    if args.alpha_sheet:
        args.alpha_sheet.parent.mkdir(parents=True, exist_ok=True)
        source.save(args.alpha_sheet, optimize=True)
    alpha_array = np.asarray(source.getchannel("A"))
    binary = alpha_array > 8
    labels, components = label_components(binary)
    groups: list[list[int]] = [[] for _ in range(expected)]
    component_details: dict[int, dict[str, object]] = {}
    for component in components:
        component_id = int(component["id"])
        area = int(component["area"])
        if area < 6:
            continue
        center_x = float(component["center_x"])
        center_y = float(component["center_y"])
        column = min(args.columns - 1, max(0, int(center_x * args.columns / source.width)))
        row = min(args.rows - 1, max(0, int(center_y * args.rows / source.height)))
        group_index = row * args.columns + column
        groups[group_index].append(component_id)
        component_details[component_id] = {
            "area": area,
            "center": [round(float(center_x), 2), round(float(center_y), 2)],
            "assignedCell": group_index + 1,
        }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    metrics: list[dict[str, object]] = []
    for index, name in enumerate(names):
        row, column = divmod(index, args.columns)
        left = round(column * source.width / args.columns)
        top = round(row * source.height / args.rows)
        right = round((column + 1) * source.width / args.columns)
        bottom = round((row + 1) * source.height / args.rows)
        component_ids = groups[index]
        if not component_ids:
            raise ValueError(f"cell {index + 1} ({name}) has no assigned alpha components")
        assigned = np.isin(labels, component_ids)
        assigned_alpha = np.where(assigned, alpha_array, 0).astype(np.uint8)
        alpha = Image.fromarray(assigned_alpha, mode="L")
        bounds = alpha.getbbox()
        if not bounds:
            raise ValueError(f"cell {index + 1} ({name}) is fully transparent")
        isolated = source.copy()
        isolated.putalpha(alpha)
        subject = isolated.crop(bounds)
        available = args.size - args.padding * 2
        scale = min(available / subject.width, available / subject.height, 1.0)
        if scale < 1.0:
            subject = subject.resize(
                (max(1, round(subject.width * scale)), max(1, round(subject.height * scale))),
                Image.Resampling.LANCZOS,
            )
        canvas = Image.new("RGBA", (args.size, args.size), (0, 0, 0, 0))
        x = (args.size - subject.width) // 2
        y = (args.size - subject.height) // 2
        canvas.alpha_composite(subject, (x, y))
        filename = f"{args.prefix}{name}.png"
        output_path = args.output_dir / filename
        canvas.save(output_path, optimize=True)
        output_alpha = canvas.getchannel("A")
        border_alpha = max(
            output_alpha.crop((0, 0, args.size, 1)).getextrema()[1],
            output_alpha.crop((0, args.size - 1, args.size, args.size)).getextrema()[1],
            output_alpha.crop((0, 0, 1, args.size)).getextrema()[1],
            output_alpha.crop((args.size - 1, 0, args.size, args.size)).getextrema()[1],
        )
        metrics.append({
            "index": index + 1,
            "name": name,
            "file": str(output_path),
            "sourceCell": [left, top, right, bottom],
            "sourceBounds": list(bounds),
            "componentCount": len(component_ids),
            "components": [component_details[item] for item in component_ids],
            "subjectSize": [subject.width, subject.height],
            "canvasSize": [args.size, args.size],
            "borderAlphaMax": border_alpha,
            "opaqueCoverage": round(sum(value > 240 for value in output_alpha.get_flattened_data()) / (args.size * args.size), 4),
        })
    return metrics


def build_contact_sheet(paths: list[Path], target: Path, columns: int, tile_size: int = 256) -> None:
    rows = (len(paths) + columns - 1) // columns
    checker = Image.new("RGB", (tile_size * columns, tile_size * rows), "white")
    pixels = checker.load()
    block = 16
    for y in range(checker.height):
        for x in range(checker.width):
            if (x // block + y // block) % 2:
                pixels[x, y] = (226, 226, 226)
    for index, path in enumerate(paths):
        sticker = Image.open(path).convert("RGBA")
        sticker.thumbnail((tile_size - 12, tile_size - 12), Image.Resampling.LANCZOS)
        x = (index % columns) * tile_size + (tile_size - sticker.width) // 2
        y = (index // columns) * tile_size + (tile_size - sticker.height) // 2
        checker.paste(sticker, (x, y), sticker)
    target.parent.mkdir(parents=True, exist_ok=True)
    checker.save(target, optimize=True)


def main() -> None:
    args = parse_args()
    metrics = split_sheet(args)
    payload = {"ok": all(item["borderAlphaMax"] == 0 for item in metrics), "count": len(metrics), "items": metrics}
    target = args.metrics or args.output_dir / "split-metrics.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.contact_sheet:
        build_contact_sheet([Path(item["file"]) for item in metrics], args.contact_sheet, args.columns)
    print(json.dumps({"ok": payload["ok"], "count": payload["count"], "metrics": str(target)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
