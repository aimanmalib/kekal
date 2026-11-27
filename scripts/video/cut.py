"""Timing for the demo video cut: where each narration line plays, how its subtitles split, and the .srt text.

Standard library only, so the tests run without the media tools. `assemble.py` draws and encodes from this plan.

A cut file (`demo-cut.json`) lists scenes in order. Each scene has a length and the narration lines that start in it,
with an offset from the scene start. Line lengths come from the narration timings that `narrate.py` writes.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Placed:
    line: int
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def scene_starts(scenes: list[dict]) -> list[float]:
    """Start time of each scene, each one following the last."""
    starts, t = [], 0.0
    for s in scenes:
        starts.append(round(t, 3))
        t += float(s["dur"])
    return starts


def total(scenes: list[dict]) -> float:
    return round(sum(float(s["dur"]) for s in scenes), 3)


def place(scenes: list[dict], narration: dict) -> list[Placed]:
    """Absolute start and end of every narration line named in the scenes, in play order."""
    by_line = {int(l["line"]): l for l in narration["lines"]}
    out = []
    for start, scene in zip(scene_starts(scenes), scenes):
        for num, offset in scene.get("lines", []):
            src = by_line[int(num)]
            t0 = round(start + float(offset), 3)
            out.append(Placed(int(num), src["text"], t0, round(t0 + float(src["duration"]), 3)))
    return sorted(out, key=lambda p: p.start)


def problems(scenes: list[dict], narration: dict, rules: dict) -> list[str]:
    """Everything that would make the cut wrong: overlapping lines, a missing or repeated line, too long a video."""
    errs = []
    placed = place(scenes, narration)
    nums = [p.line for p in placed]
    wanted = sorted(int(l["line"]) for l in narration["lines"])
    if sorted(nums) != wanted:
        errs.append(f"lines placed {sorted(nums)} but the narration has {wanted}")
    gap = float(rules["minGapSecs"])
    for a, b in zip(placed, placed[1:]):
        if b.start < a.end + gap:
            errs.append(f"line {b.line} starts at {b.start}s, before line {a.line} ends at {a.end}s + {gap}s")
    end = total(scenes)
    if placed and placed[-1].end > end:
        errs.append(f"line {placed[-1].line} ends at {placed[-1].end}s, after the video ends at {end}s")
    if end > float(rules["maxSecs"]):
        errs.append(f"video is {end}s, over the {rules['maxSecs']}s limit")
    for c in cues(placed, int(rules["maxCueChars"])):
        if len(c.text) > int(rules["maxCueChars"]):
            errs.append(f"subtitle over {rules['maxCueChars']} characters: {c.text!r}")
    return errs


def split_text(text: str, max_chars: int) -> list[str]:
    """Sentences first; a sentence still too long splits at commas, then at the word nearest its middle."""
    parts = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]
    out: list[str] = []
    for p in parts:
        out.extend(_fit(p, max_chars))
    # Join short neighbours back together so a cue is not a two-word flash.
    merged: list[str] = []
    for p in out:
        if merged and len(merged[-1]) + 1 + len(p) <= max_chars and (len(p) < max_chars // 3 or len(merged[-1]) < max_chars // 3):
            merged[-1] = f"{merged[-1]} {p}"
        else:
            merged.append(p)
    return merged


def _fit(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    commas = [m.end() for m in re.finditer(r",\s", text)]
    if commas:
        cut = min(commas, key=lambda i: abs(i - len(text) / 2))
    else:
        spaces = [m.start() for m in re.finditer(r"\s", text)]
        if not spaces:
            return [text]
        cut = min(spaces, key=lambda i: abs(i - len(text) / 2))
    return _fit(text[:cut].strip(), max_chars) + _fit(text[cut:].strip(), max_chars)


def cues(placed: list[Placed], max_chars: int) -> list[Cue]:
    """Subtitle cues: each line's time shared between its pieces by their length."""
    out = []
    for p in placed:
        pieces = split_text(p.text, max_chars)
        weight = sum(len(x) for x in pieces)
        t = p.start
        for i, piece in enumerate(pieces):
            end = p.end if i == len(pieces) - 1 else round(t + (p.end - p.start) * len(piece) / weight, 3)
            out.append(Cue(round(t, 3), end, piece))
            t = end
    return out


def stamp(secs: float) -> str:
    ms = int(round(secs * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def srt(items: list[Cue]) -> str:
    blocks = [f"{i}\n{stamp(c.start)} --> {stamp(c.end)}\n{c.text}\n" for i, c in enumerate(items, 1)]
    return "\n".join(blocks)


# --- v3 look rules: how big the product is in the frame, held frames, and silence between narration lines ---

UI_KINDS = {"zoom", "still", "wide", "phone"}


def even(x: float) -> int:
    return int(x) // 2 * 2


def panel_size(crop: list, zoom: dict) -> tuple[int, int]:
    """Size of a zoomed panel: the crop box scaled to fit inside zoom.maxWidth x zoom.maxHeight."""
    s = min(float(zoom["maxWidth"]) / crop[0], float(zoom["maxHeight"]) / crop[1])
    return even(crop[0] * s), even(crop[1] * s)


def ui_share(scene: dict, cfg: dict) -> float | None:
    """Share of the frame width the product's screen fills, or None when the scene declares no crop box."""
    crop = scene.get("crop")
    if not crop:
        return None
    if scene["kind"] == "wide":
        return 1.0
    return panel_size(crop, cfg["zoom"])[0] / float(cfg["video"]["width"])


def look_problems(cfg: dict) -> list[str]:
    """Scenes that show the product too small, without a crop box, stretched, or frozen on a held last frame."""
    errs = []
    rules, v = cfg["rules"], cfg["video"]
    for s in cfg["scenes"]:
        if s["kind"] in UI_KINDS:
            share = ui_share(s, cfg)
            if share is None:
                errs.append(f"{s['id']}: shows the product but declares no crop box")
            elif share < float(rules["minUiShare"]):
                errs.append(f"{s['id']}: product fills {share:.0%} of the frame width, under {rules['minUiShare']:.0%}")
            if s["kind"] == "wide" and s.get("crop"):
                aspect, frame = s["crop"][0] / s["crop"][1], v["width"] / v["height"]
                if abs(aspect / frame - 1) > 0.02:
                    errs.append(f"{s['id']}: crop {s['crop'][:2]} would be stretched to the {v['width']}x{v['height']} frame")
        if "clip" in s:
            shown = (float(s["out"]) - float(s["in"])) / float(s.get("speed", 1))
            if float(s["dur"]) - shown > float(rules["maxHoldSecs"]):
                errs.append(f"{s['id']}: holds its last frame for {float(s['dur']) - shown:.1f}s")
    return errs


def narration_from_secs(seconds: dict) -> dict:
    """A narration dict (as narrate.py writes) from the line lengths recorded in the cut file."""
    return {"lines": [{"line": int(k), "text": "", "duration": float(v)} for k, v in seconds.items()]}


def silences(scenes: list[dict], narration: dict, min_secs: float) -> list[tuple[float, float]]:
    """Stretches of at least min_secs with no narration line playing, the lead-in and the tail included."""
    placed = place(scenes, narration)
    out, t = [], 0.0
    for p in placed:
        if p.start - t >= min_secs:
            out.append((round(t, 3), p.start))
        t = max(t, p.end)
    end = total(scenes)
    if end - t >= min_secs:
        out.append((round(t, 3), end))
    return out


def silence_problems(scenes: list[dict], narration: dict, rule: dict) -> list[str]:
    gaps = silences(scenes, narration, float(rule["minSecs"]))
    errs = [f"no narration from {a}s to {b}s ({b - a:.1f}s, over {rule['maxGapSecs']}s)" for a, b in gaps
            if b - a > float(rule["maxGapSecs"])]
    share = sum(b - a for a, b in gaps) / max(total(scenes), 0.001)
    if share > float(rule["maxShare"]):
        errs.append(f"silence is {share:.0%} of the video, over {rule['maxShare']:.0%}")
    return errs
