#!/usr/bin/env python3
"""Process generated deskpet action strips into named 200x250 PNG frames."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


FRAME_W = 200
FRAME_H = 250
TARGET_W = 176
TARGET_H = 222
BOTTOM_PAD = 12

ACTION_DURATIONS = {
    "idle": [3600, 1800, 120, 160, 4200, 2200, 130, 5200],
    "walk": [150, 145, 150, 145, 150, 145, 150, 145],
    "sleep": [500, 650, 820, 1100, 1500, 2600, 5200, 30000],
    "wake": [220, 260, 300, 360, 440, 560, 700, 820],
    "drag": [115] * 8,
    "fall": [95, 105, 115, 130, 150, 175, 205, 240],
    "land": [120, 150, 190, 250, 340, 460, 620, 820],
    "edge": [320, 360, 420, 520, 720, 900, 1400, 2200],
    "peek": [130, 150, 180, 220, 280, 340, 420, 520],
    "return": [140, 155, 175, 210, 260, 340, 460, 620],
    "reminder": [180, 200, 230, 260, 500, 640, 780, 940],
    "coffee": [180, 220, 280, 360, 520, 720, 980, 1320],
    "work": [150, 165, 180, 220, 300, 420, 640, 900],
    "rabbit": [200, 240, 320, 460, 680, 900, 1180, 1500],
    "stomp": [95, 110, 130, 180, 260, 380, 520, 760],
    "ritual": [180, 220, 280, 360, 480, 640, 860, 1180],
    "care": [220, 260, 340, 460, 620, 860, 1180, 1600],
}


def parse_sources(items: list[str]) -> dict[str, Path]:
    sources: dict[str, Path] = {}
    for item in items:
        if "=" not in item:
            raise ValueError(f"source must be action=path, got {item!r}")
        action, path = item.split("=", 1)
        sources[action] = Path(path)
    return sources


def bbox_from_alpha(img: Image.Image) -> list[int] | None:
    arr = np.array(img.convert("RGBA"))
    ys, xs = np.where(arr[..., 3] > 8)
    if len(xs) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def label_components(img: Image.Image):
    arr = np.array(img.convert("RGBA"))
    mask = arr[..., 3] > 8
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    comps = []
    label = 0
    for y in range(h):
        xs = np.where(mask[y] & (labels[y] == 0))[0]
        for x0 in xs:
            if labels[y, x0] or not mask[y, x0]:
                continue
            label += 1
            queue = deque([(int(x0), y)])
            labels[y, x0] = label
            xs2: list[int] = []
            ys2: list[int] = []
            while queue:
                x, yy = queue.popleft()
                xs2.append(x)
                ys2.append(yy)
                for nx in (x - 1, x, x + 1):
                    for ny in (yy - 1, yy, yy + 1):
                        if nx == x and ny == yy:
                            continue
                        if 0 <= nx < w and 0 <= ny < h and labels[ny, nx] == 0 and mask[ny, nx]:
                            labels[ny, nx] = label
                            queue.append((nx, ny))
            bbox = (min(xs2), min(ys2), max(xs2) + 1, max(ys2) + 1)
            comps.append(
                {
                    "label": int(label),
                    "area": int(len(xs2)),
                    "bbox": [int(v) for v in bbox],
                    "center": [float((bbox[0] + bbox[2]) / 2), float((bbox[1] + bbox[3]) / 2)],
                }
            )
    return arr, labels, comps


def cleanup_frame(img: Image.Image) -> Image.Image:
    arr = np.array(img.convert("RGBA"))
    alpha = arr[..., 3]
    magenta = (
        (alpha > 0)
        & (arr[..., 0] > 180)
        & (arr[..., 1] < 150)
        & (arr[..., 2] > 150)
        & ((arr[..., 0].astype(int) - arr[..., 1].astype(int)) > 45)
        & ((arr[..., 2].astype(int) - arr[..., 1].astype(int)) > 45)
    )
    arr[magenta, 3] = 0
    arr[arr[..., 3] == 0, :3] = 0

    mask = arr[..., 3] > 8
    h, w = mask.shape
    visited = np.zeros((h, w), dtype=bool)
    comps: list[list[tuple[int, int]]] = []
    for y in range(h):
        xs = np.where(mask[y] & ~visited[y])[0]
        for x0 in xs:
            if visited[y, x0] or not mask[y, x0]:
                continue
            queue = deque([(int(x0), y)])
            visited[y, x0] = True
            pts: list[tuple[int, int]] = []
            while queue:
                x, yy = queue.popleft()
                pts.append((x, yy))
                for nx in (x - 1, x, x + 1):
                    for ny in (yy - 1, yy, yy + 1):
                        if nx == x and ny == yy:
                            continue
                        if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx] and mask[ny, nx]:
                            visited[ny, nx] = True
                            queue.append((nx, ny))
            comps.append(pts)
    if comps:
        largest = max(comps, key=len)
        keep = np.zeros((h, w), dtype=bool)
        for x, y in largest:
            keep[y, x] = True
        arr[~keep, 3] = 0
        arr[arr[..., 3] == 0, :3] = 0
    return Image.fromarray(arr, "RGBA")


def normalize_component(strip: Image.Image) -> tuple[list[Image.Image], dict]:
    arr, labels, comps = label_components(strip)
    if not comps:
        raise RuntimeError("no components")
    max_area = max(c["area"] for c in comps)
    plausible = []
    for comp in comps:
        x1, y1, x2, y2 = comp["bbox"]
        bw = x2 - x1
        bh = y2 - y1
        if comp["area"] >= max(150, max_area * 0.06) and bw >= 25 and bh >= 45:
            plausible.append(comp)
    if len(plausible) < 8:
        plausible = []
        for comp in comps:
            x1, y1, x2, y2 = comp["bbox"]
            bw = x2 - x1
            bh = y2 - y1
            if comp["area"] >= max(90, max_area * 0.025) and bw >= 15 and bh >= 45:
                plausible.append(comp)
    chosen = sorted(sorted(plausible, key=lambda c: c["area"], reverse=True)[:8], key=lambda c: c["center"][0])
    if len(chosen) != 8:
        raise RuntimeError(f"expected 8 components got {len(chosen)} total={len(comps)} plausible={len(plausible)}")

    scale = min(
        TARGET_W / max(c["bbox"][2] - c["bbox"][0] for c in chosen),
        TARGET_H / max(c["bbox"][3] - c["bbox"][1] for c in chosen),
        1.45,
    )
    frames: list[Image.Image] = []
    for comp in chosen:
        x1, y1, x2, y2 = comp["bbox"]
        crop = arr[y1:y2, x1:x2, :].copy()
        label_crop = labels[y1:y2, x1:x2]
        crop[label_crop != comp["label"], 3] = 0
        crop[crop[..., 3] == 0, :3] = 0
        img = Image.fromarray(crop, "RGBA")
        rw = max(1, int(round(img.size[0] * scale)))
        rh = max(1, int(round(img.size[1] * scale)))
        img = img.resize((rw, rh), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
        x = int(round((FRAME_W - rw) / 2))
        y = max(4, FRAME_H - BOTTOM_PAD - rh)
        canvas.alpha_composite(img, (x, y))
        frames.append(cleanup_frame(canvas))
    return frames, {"method": "components", "component_count": len(comps), "chosen": chosen, "scale": float(scale)}


def clean_slot(slot: Image.Image) -> Image.Image:
    return cleanup_frame(slot)


def normalize_slots(strip: Image.Image) -> tuple[list[Image.Image], dict]:
    sw, sh = strip.size
    slot_w = sw / 8
    slots: list[Image.Image] = []
    bboxes: list[list[int]] = []
    for i in range(8):
        left = int(round(i * slot_w))
        right = int(round((i + 1) * slot_w))
        slot = clean_slot(strip.crop((left, 0, right, sh)).convert("RGBA"))
        bbox = bbox_from_alpha(slot)
        if bbox is None:
            raise RuntimeError(f"empty slot {i}")
        slots.append(slot)
        bboxes.append(bbox)
    scale = min(
        TARGET_W / max(b[2] - b[0] for b in bboxes),
        TARGET_H / max(b[3] - b[1] for b in bboxes),
        1.45,
    )
    frames: list[Image.Image] = []
    for slot, bbox in zip(slots, bboxes):
        crop = slot.crop(tuple(bbox))
        rw = max(1, int(round(crop.size[0] * scale)))
        rh = max(1, int(round(crop.size[1] * scale)))
        crop = crop.resize((rw, rh), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
        x = int(round((FRAME_W - rw) / 2))
        y = max(4, FRAME_H - BOTTOM_PAD - rh)
        canvas.alpha_composite(crop, (x, y))
        frames.append(cleanup_frame(canvas))
    return frames, {"method": "slots", "source_size": [sw, sh], "slot_width": slot_w, "source_bboxes": bboxes, "scale": float(scale)}


def normalize_auto(strip: Image.Image) -> tuple[list[Image.Image], dict]:
    try:
        return normalize_component(strip)
    except Exception as exc:
        frames, meta = normalize_slots(strip)
        meta["fallback_reason"] = repr(exc)
        return frames, meta


def checker() -> Image.Image:
    bg = Image.new("RGBA", (FRAME_W, FRAME_H), (240, 240, 240, 255))
    draw = ImageDraw.Draw(bg)
    for yy in range(0, FRAME_H, 20):
        for xx in range(0, FRAME_W, 20):
            if ((xx // 20) + (yy // 20)) % 2:
                draw.rectangle([xx, yy, xx + 19, yy + 19], fill=(226, 226, 226, 255))
    return bg


def save_action_contact(batch: str, role: str, action: str, frames: list[Image.Image], out: Path) -> None:
    font = ImageFont.load_default()
    pad = 16
    label_h = 28
    gap = 10
    sheet = Image.new("RGBA", (pad * 2 + FRAME_W * 8 + gap * 7, pad * 2 + label_h + FRAME_H), (248, 248, 244, 255))
    draw = ImageDraw.Draw(sheet)
    draw.text((pad, 8), f"{batch} {role} {action}", fill=(20, 20, 20), font=font)
    for i, frame in enumerate(frames):
        x = pad + i * (FRAME_W + gap)
        y = pad + label_h
        bg = checker()
        bg.alpha_composite(frame)
        sheet.alpha_composite(bg, (x, y))
        draw.rectangle([x, y, x + FRAME_W - 1, y + FRAME_H - 1], outline=(80, 80, 80, 255))
        draw.text((x + 4, y + 4), f"{i:02d}", fill=(0, 0, 0), font=font)
    sheet.convert("RGB").save(out)


def frame_metrics(role: str, action: str, frames: list[Image.Image], meta: dict, contact: Path, preview: Path, frame_paths: list[Path]) -> dict:
    details = []
    magenta_total = 0
    hidden_total = 0
    corner_total = 0
    bboxes = []
    for i, img in enumerate(frames):
        arr = np.array(img.convert("RGBA"))
        alpha = arr[..., 3]
        magenta = int(
            (
                (alpha > 0)
                & (arr[..., 0] > 180)
                & (arr[..., 1] < 150)
                & (arr[..., 2] > 150)
                & ((arr[..., 0].astype(int) - arr[..., 1].astype(int)) > 45)
                & ((arr[..., 2].astype(int) - arr[..., 1].astype(int)) > 45)
            ).sum()
        )
        hidden = int(((alpha == 0) & ((arr[..., 0] != 0) | (arr[..., 1] != 0) | (arr[..., 2] != 0))).sum())
        corners = int(arr[0, 0, 3] + arr[0, -1, 3] + arr[-1, 0, 3] + arr[-1, -1, 3])
        bbox = bbox_from_alpha(img)
        bboxes.append(bbox)
        magenta_total += magenta
        hidden_total += hidden
        corner_total += corners
        details.append(
            {
                "frame": i,
                "size": [FRAME_W, FRAME_H],
                "bbox": bbox,
                "visible_magenta_pixels": magenta,
                "colored_transparent_pixels": hidden,
                "corner_alpha_sum": corners,
            }
        )

    centers = [(b[0] + b[2]) / 2 for b in bboxes if b]
    bottoms = [b[3] for b in bboxes if b]
    heights = [b[3] - b[1] for b in bboxes if b]
    widths = [b[2] - b[0] for b in bboxes if b]
    metric_pass = all(img.size == (FRAME_W, FRAME_H) for img in frames) and magenta_total == 0 and hidden_total == 0 and corner_total == 0
    if action in {"idle", "walk"} and bboxes:
        metric_pass = (
            metric_pass
            and max(bottoms) - min(bottoms) <= 6
            and max(centers) - min(centers) <= 10
            and (max(heights) - min(heights)) / max(heights) <= 0.08
        )
    return {
        "role": role,
        "action": action,
        "frame_count": len(frames),
        "all_200x250": all(img.size == (FRAME_W, FRAME_H) for img in frames),
        "visible_magenta_pixels_total": magenta_total,
        "colored_transparent_pixels_total": hidden_total,
        "corner_alpha_total": corner_total,
        "body_center_drift_px": round(max(centers) - min(centers), 2) if centers else None,
        "bottom_anchor_drift_px": int(max(bottoms) - min(bottoms)) if bottoms else None,
        "body_height_drift_ratio": round((max(heights) - min(heights)) / max(heights), 4) if heights and max(heights) else None,
        "body_width_drift_ratio": round((max(widths) - min(widths)) / max(widths), 4) if widths and max(widths) else None,
        "metric_pass": bool(metric_pass),
        "details": details,
        "extraction": meta,
        "contact_sheet": str(contact),
        "preview_gif": str(preview),
        "frame_paths": [str(p) for p in frame_paths],
    }


def save_combined_contact(role: str, actions: list[str], pet_dir: Path, out: Path) -> list[str]:
    font = ImageFont.load_default()
    rows = []
    missing = []
    for action in actions:
        frames = []
        for i in range(8):
            path = pet_dir / f"{role}_{action}_{i:02d}.png"
            if not path.exists():
                missing.append(action)
                frames = []
                break
            frames.append(Image.open(path).convert("RGBA"))
        if frames:
            rows.append((action, frames))

    pad = 16
    label_w = 92
    gap = 8
    sheet = Image.new("RGBA", (pad * 2 + label_w + FRAME_W * 8 + gap * 7, pad * 2 + len(rows) * (FRAME_H + gap)), (250, 250, 247, 255))
    draw = ImageDraw.Draw(sheet)
    for r, (action, frames) in enumerate(rows):
        y = pad + r * (FRAME_H + gap)
        draw.text((pad, y + 8), action, fill=(20, 20, 20), font=font)
        for i, frame in enumerate(frames):
            x = pad + label_w + i * (FRAME_W + gap)
            bg = checker()
            bg.alpha_composite(frame)
            sheet.alpha_composite(bg, (x, y))
            draw.rectangle([x, y, x + FRAME_W - 1, y + FRAME_H - 1], outline=(95, 95, 95, 255))
            draw.text((x + 4, y + 4), f"{i:02d}", fill=(0, 0, 0), font=font)
    sheet.convert("RGB").save(out)
    return sorted(set(missing))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--role", required=True)
    parser.add_argument("--batch", default="r16")
    parser.add_argument("--web-root", default=".")
    parser.add_argument("--helper", default=r"C:\Users\Lenovo\.codex\skills\.system\imagegen\scripts\remove_chroma_key.py")
    parser.add_argument("--source", action="append", required=True, help="action=absolute-png-path")
    args = parser.parse_args()

    root = Path(args.web_root).resolve()
    role = args.role
    batch = args.batch
    sources = parse_sources(args.source)
    actions = list(sources)
    source_dir = root / "assets" / "generated" / "source_only" / f"{batch}_{role}_template"
    pet_dir = root / "assets" / "pets" / role / batch
    preview_dir = root / "assets" / "generated" / f"{batch}_deskpet_previews"
    generated_dir = root / "assets" / "generated"
    for directory in (source_dir, pet_dir, preview_dir, generated_dir):
        directory.mkdir(parents=True, exist_ok=True)

    results = {}
    errors = {}
    for action, src in sources.items():
        try:
            copied = source_dir / f"{batch}_{role}_{action}_source_codex.png"
            alpha = source_dir / f"{batch}_{role}_{action}_alpha_strip.png"
            shutil.copy2(src, copied)
            run = subprocess.run(
                [
                    sys.executable,
                    str(args.helper),
                    "--input",
                    str(copied),
                    "--out",
                    str(alpha),
                    "--key-color",
                    "#ff00ff",
                    "--soft-matte",
                    "--transparent-threshold",
                    "14",
                    "--opaque-threshold",
                    "210",
                    "--edge-contract",
                    "1",
                    "--despill",
                    "--force",
                ],
                text=True,
                capture_output=True,
                cwd=str(root),
            )
            if run.returncode:
                raise RuntimeError(run.stderr or run.stdout)

            frames, meta = normalize_auto(Image.open(alpha).convert("RGBA"))
            frame_paths = []
            for i, frame in enumerate(frames):
                path = pet_dir / f"{role}_{action}_{i:02d}.png"
                frame.save(path)
                frame_paths.append(path)
            contact = generated_dir / f"{batch}_{role}_{action}_contact_sheet.png"
            preview = preview_dir / f"{role}_{action}.gif"
            save_action_contact(batch, role, action, frames, contact)
            frames[0].save(
                preview,
                save_all=True,
                append_images=frames[1:],
                duration=ACTION_DURATIONS.get(action, [180] * 8),
                loop=0,
                disposal=2,
                transparency=0,
            )
            metrics = frame_metrics(role, action, frames, meta, contact, preview, frame_paths)
            metrics.update({"source": str(copied), "alpha_strip": str(alpha), "generation_source": str(src)})
            (generated_dir / f"{batch}_{role}_{action}_metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
            results[action] = metrics
        except Exception as exc:  # noqa: BLE001 - tool records all action failures.
            errors[action] = repr(exc)

    combined = generated_dir / f"{batch}_{role}_deskpet_contact_sheet.png"
    missing = save_combined_contact(role, actions, pet_dir, combined)
    summary = {
        "batch": f"{batch}_{role}_deskpet_assets",
        "role": role,
        "actions_processed": sorted(results),
        "errors": errors,
        "per_action_metric_pass": {k: v.get("metric_pass") for k, v in results.items()},
        "strict_metric_failures": [k for k, v in results.items() if v.get("metric_pass") is False],
        "missing_actions": missing + [a for a in actions if a not in results],
        "combined_contact_sheet": str(combined),
    }
    (generated_dir / f"{batch}_{role}_deskpet_metrics.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not summary["missing_actions"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
