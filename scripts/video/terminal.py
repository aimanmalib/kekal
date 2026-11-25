# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow==11.3.0"]
# ///
"""Films a real command's terminal output for the demo video, in two steps.

  record: runs a command and writes every output line with the second it appeared (JSON lines).
      uv run scripts/video/terminal.py record --out tests.jsonl -- cargo test -p kekal
  render: draws those lines as a terminal window, line by line at their recorded times (optionally sped up), into an MP4.
      uv run scripts/video/terminal.py render tests.jsonl tests.mp4 --speed 8 --prompt "cargo test -p kekal"

The output is the command's own text; only the pace changes, and the video marks a sped-up clip as such.
Needs ffmpeg on PATH for render.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
TOKENS = Path(__file__).resolve().parents[2] / "apps/web/src/app/globals.css"


def token(name: str) -> str:
    """A colour from the web app's design tokens, so the terminal shot matches the site."""
    m = re.search(rf"--{name}:\s*(#[0-9a-fA-F]{{6}})\s*;", TOKENS.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(f"{TOKENS}: no colour token --{name}")
    return m.group(1)


def record(out: Path, cmd: list[str]) -> int:
    start = time.monotonic()
    with out.open("w", encoding="utf-8") as f, subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    ) as proc:
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = ANSI.sub("", raw.rstrip("\n"))
            f.write(json.dumps({"t": round(time.monotonic() - start, 3), "line": line}) + "\n")
            sys.stdout.write(raw)
        rc = proc.wait()
        f.write(json.dumps({"t": round(time.monotonic() - start, 3), "exit": rc}) + "\n")
    return rc


def colour(line: str, ink: str, soft: str, bad: str) -> str:
    low = line.lower().strip()
    if re.search(r"\b(failed|panicked|error)\b", low) and not re.search(r"\b0 failed\b", low):
        return bad
    if low.startswith(("compiling", "finished", "running", "warning")):
        return soft
    return ink


def summary(lines: list[str]) -> str | None:
    passed = failed = 0
    found = False
    for line in lines:
        m = re.search(r"test result: \w+\. (\d+) passed; (\d+) failed", line)
        if m:
            found = True
            passed += int(m.group(1))
            failed += int(m.group(2))
    return f"total: {passed} passed; {failed} failed" if found else None


def render(src: Path, out: Path, speed: float, prompt: str, fps: int, size: tuple[int, int], hold: float, font: str) -> None:
    from PIL import Image, ImageDraw, ImageFont

    paper, ink, soft, bad = token("paper"), token("ink"), token("ink-soft"), token("copper")
    events = [json.loads(x) for x in src.read_text(encoding="utf-8").splitlines() if x.strip()]
    lines = [(e["t"] / speed, e["line"]) for e in events if "line" in e]
    end = (events[-1]["t"] / speed if events else 0) + hold
    totals = summary([l for _, l in lines])
    if totals:
        # The last screen sums the runner's own "N passed; M failed" lines, so the count on screen is the real one.
        lines += [(end - hold, ""), (end - hold, totals)]
    w, h = size
    face = ImageFont.truetype(font, 26)
    bold = ImageFont.truetype(font, 30)
    line_h, margin, top = 36, 56, 120
    rows = (h - top - margin) // line_h
    frames = Path(out.parent / (out.stem + "-frames"))
    if frames.exists():
        shutil.rmtree(frames)
    frames.mkdir(parents=True)
    total = int(end * fps) + 1
    for n in range(total):
        now = n / fps
        shown = [(colour(l, ink, soft, bad), l) for t, l in lines if t <= now]
        img = Image.new("RGB", (w, h), paper)
        d = ImageDraw.Draw(img)
        d.rectangle([margin // 2, margin // 2, w - margin // 2, h - margin // 2], outline=ink, width=3)
        d.text((margin, 50), f"$ {prompt}", font=bold, fill=ink)
        if speed != 1:
            label = f"sped up {speed:g}x"
            d.text((w - margin - d.textlength(label, font=face), 54), label, font=face, fill=soft)
        for i, (fill, text) in enumerate(shown[-rows:]):
            d.text((margin, top + i * line_h), text[:110], font=face, fill=fill)
        img.save(frames / f"{n:05d}.png")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", str(frames / "%05d.png"),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(out)],
        check=True,
    )
    shutil.rmtree(frames)
    print(f"{out}: {end:.1f} s, {len(lines)} lines, speed {speed:g}x")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("command", nargs=argparse.REMAINDER)
    v = sub.add_parser("render")
    v.add_argument("src", type=Path)
    v.add_argument("out", type=Path)
    v.add_argument("--speed", type=float, default=1.0)
    v.add_argument("--prompt", required=True)
    v.add_argument("--fps", type=int, default=30)
    v.add_argument("--width", type=int, default=1920)
    v.add_argument("--height", type=int, default=1080)
    v.add_argument("--hold", type=float, default=3.0, help="seconds to keep the last screen")
    v.add_argument("--font", default="/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")
    a = ap.parse_args()
    if a.cmd == "record":
        command = a.command[1:] if a.command[:1] == ["--"] else a.command
        if not command:
            ap.error("record needs a command after --")
        sys.exit(record(a.out, command))
    render(a.src, a.out, a.speed, a.prompt, a.fps, (a.width, a.height), a.hold, a.font)


if __name__ == "__main__":
    main()
