# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow==11.3.0"]
# ///
"""Cuts the demo video from the recorded footage and the narration, then measures it.

  build: uv run scripts/video/assemble.py build --src <footage> --voice <footage>/voice-af_heart --out demo.mp4
         Writes demo.mp4 and demo.srt (English subtitles, also burned into the picture), then runs `measure`.
  measure: uv run scripts/video/assemble.py measure demo.mp4
         Length, audio track, audio length against video length, mean and peak loudness, against the cut file's rules.

The scene list, label text, sizes and loudness targets live in scripts/video/demo-cut.json. Colours come from the
site's tokens and the text uses the site's fonts. Needs ffmpeg and ffprobe on PATH.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cut  # noqa: E402
from terminal import token  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CUT = Path(__file__).resolve().parent / "demo-cut.json"


def run(args: list[str]) -> str:
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"{args[0]} failed:\n{p.stderr[-1500:]}")
    return p.stderr


def rgb(name: str, alpha: int = 255) -> tuple[int, int, int, int]:
    h = token(name).lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def font(cfg: dict, kind: str, size: int, weight: int | None = None):
    from PIL import ImageFont

    f = ImageFont.truetype(str(ROOT / cfg["fonts"][kind]), size)
    if weight is not None:
        f.set_variation_by_axes([weight])
    return f


def chip(text: str, f, pad: tuple[int, int], radius: int, fill, ink, border=None):
    """A rounded box holding one line of text, sized to it."""
    from PIL import Image, ImageDraw

    l, t, r, b = f.getbbox(text)
    w, h = r - l + 2 * pad[0], (b - t) + 2 * pad[1]
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=fill, outline=border, width=2 if border else 0)
    d.text((pad[0] - l, pad[1] - t), text, font=f, fill=ink)
    return img


def phone_layers(cfg: dict, clip_w: int, work: Path) -> tuple[Path, Path, int]:
    """Paper background and a bezel with a rounded screen hole; returns their paths and the screen's left edge."""
    from PIL import Image, ImageDraw

    v, p = cfg["video"], cfg["phone"]
    x = (v["width"] - clip_w) // 2
    bg = Image.new("RGBA", (v["width"], v["height"]), rgb("paper"))
    bezel = Image.new("RGBA", (v["width"], v["height"]), (0, 0, 0, 0))
    d = ImageDraw.Draw(bezel)
    b, top, h = p["bezel"], p["top"], p["height"]
    d.rounded_rectangle([x - b, top - b, x + clip_w + b, top + h + b], radius=p["radius"], fill=rgb("ink"))
    d.rounded_rectangle([x, top, x + clip_w, top + h], radius=p["radius"] - b, fill=(0, 0, 0, 0))
    bg.save(work / "phone-bg.png")
    bezel.save(work / "phone-bezel.png")
    return work / "phone-bg.png", work / "phone-bezel.png", x


def program_card(cfg: dict, scene: dict, path: Path) -> None:
    """Still of the program's address on the cluster, from config/app.json."""
    from PIL import Image, ImageDraw

    app = json.loads((ROOT / "config/app.json").read_text(encoding="utf-8"))
    cl = app["clusters"][scene["cluster"]]
    address = cl["programId"]
    url = cl["explorerAddress"].replace("{address}", address).replace("https://", "")
    v = cfg["video"]
    img = Image.new("RGBA", (v["width"], v["height"]), rgb("paper"))
    d = ImageDraw.Draw(img)
    x, y = 160, 360
    d.text((x, y), scene["title"], font=font(cfg, "serif", 76, 500), fill=rgb("ink"))
    d.rectangle([x, y + 120, x + 120, y + 124], fill=rgb("copper"))
    d.text((x, y + 160), address, font=font(cfg, "mono", 44), fill=rgb("ink"))
    d.text((x, y + 240), url, font=font(cfg, "sans", 30, 400), fill=rgb("ink-soft"))
    img.save(path)


def clip_height(path: Path) -> tuple[int, int]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True).stdout
    w, h = out.strip().split(",")[:2]
    return int(w), int(h)


def segment(cfg: dict, scene: dict, src: Path, work: Path, out: Path) -> None:
    v = cfg["video"]
    dur = float(scene["dur"])
    lab = cfg["label"]
    inputs: list[str] = []
    if scene["kind"] == "card":
        program_card(cfg, scene, work / f"{scene['id']}.png")
        inputs = ["-loop", "1", "-t", str(dur), "-i", str(work / f"{scene['id']}.png")]
        graph = f"[0:v]fps={v['fps']},format=yuv420p[out]"
    else:
        clip = src / scene["clip"]
        speed = float(scene.get("speed", 1))
        span = float(scene["out"]) - float(scene["in"])
        base = f"[0:v]setpts=(PTS-STARTPTS)/{speed},fps={v['fps']},"
        pad = f"tpad=stop_mode=clone:stop_duration={dur},trim=duration={dur},setpts=PTS-STARTPTS"
        inputs = ["-ss", str(scene["in"]), "-t", f"{span:.3f}", "-i", str(clip)]
        if scene["kind"] == "phone":
            ph = cfg["phone"]["height"]
            cw, chh = clip_height(clip)
            screen_w = int(cw * ph / chh) // 2 * 2
            bg, bezel, x = phone_layers(cfg, screen_w, work)
            inputs += ["-loop", "1", "-i", str(bg), "-loop", "1", "-i", str(bezel)]
            graph = (f"{base}scale={screen_w}:{ph}:flags=lanczos,{pad}[v];"
                     f"[1:v][v]overlay={x}:{cfg['phone']['top']}:shortest=1[a];[a][2:v]overlay=0:0[b]")
            label_at = "left"
        else:
            crop = scene.get("crop")
            c = f"crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]}," if crop else ""
            graph = f"{base}{c}scale={v['width']}:{v['height']}:flags=lanczos,{pad}[b]"
            label_at = "right"
        if scene.get("label"):
            img = chip(scene["label"], font(cfg, "sans", lab["size"], 500), (lab["padX"], lab["padY"]), 10,
                       rgb("paper-band", 240), rgb("ink"), rgb("ink"))
            img.save(work / f"{scene['id']}-label.png")
            lx = lab["margin"] if label_at == "left" else v["width"] - lab["margin"] - img.width
            n = inputs.count("-i")
            inputs += ["-i", str(work / f"{scene['id']}-label.png")]
            graph += f";[b][{n}:v]overlay={lx}:{lab['margin']},format=yuv420p[out]"
        else:
            graph += ";[b]format=yuv420p[out]"
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]", "-t", str(dur),
         "-r", str(v["fps"]), "-c:v", "libx264", "-preset", "medium", "-crf", str(v["crf"]), "-an", str(out)])


def loudness(path: Path, stream: str = "0:a:0") -> tuple[float, float]:
    err = run(["ffmpeg", "-v", "info", "-nostats", "-i", str(path), "-map", stream, "-af", "volumedetect", "-f", "null", "-"])
    mean = float(re.search(r"mean_volume: (-?[\d.]+) dB", err).group(1))
    peak = float(re.search(r"max_volume: (-?[\d.]+) dB", err).group(1))
    return mean, peak


def narration_track(cfg: dict, placed: list[cut.Placed], voice: Path, narration: dict, length: float, work: Path) -> Path:
    """All lines at their places on one track, then gain toward the target mean with a peak limiter."""
    files = {int(l["line"]): voice / l["file"] for l in narration["lines"]}
    a = cfg["audio"]
    inputs, chains = [], []
    for i, p in enumerate(placed):
        inputs += ["-i", str(files[p.line])]
        ms = int(round(p.start * 1000))
        chains.append(f"[{i}:a]aresample={a['sampleRate']},adelay={ms}:all=1[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(placed)))
    graph = ";".join(chains) + f";{mix}amix=inputs={len(placed)}:normalize=0:duration=longest,apad=whole_dur={length},atrim=0:{length}[m]"
    raw = work / "narration-raw.wav"
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[m]", "-c:a", "pcm_f32le", str(raw)])
    limit = 10 ** (a["limitDb"] / 20)
    gain = a["targetMeanDb"] - loudness(raw)[0]
    out = work / "narration.wav"
    for _ in range(4):
        run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af",
             f"volume={gain:.2f}dB,alimiter=limit={limit:.4f}:level=0:attack=5:release=60", "-c:a", "pcm_f32le", str(out)])
        mean, _ = loudness(out)
        if abs(mean - a["targetMeanDb"]) < 0.3:
            break
        gain += a["targetMeanDb"] - mean
    return out


def subtitle_inputs(cfg: dict, items: list[cut.Cue], work: Path) -> tuple[list[str], str]:
    s, v = cfg["subtitle"], cfg["video"]
    f = font(cfg, "sans", s["size"], 500)
    inputs, graph, last = [], [], "0:v"
    for i, c in enumerate(items):
        img = chip(c.text, f, (s["padX"], s["padY"]), s["radius"], rgb("ink", 235), rgb("paper"))
        p = work / f"cue-{i:03d}.png"
        img.save(p)
        inputs += ["-i", str(p)]
        x, y = (v["width"] - img.width) // 2, v["height"] - s["bottom"] - img.height
        graph.append(f"[{last}][{i + 2}:v]overlay={x}:{y}:enable='between(t,{c.start},{c.end})'[s{i}]")
        last = f"s{i}"
    graph.append(f"[{last}]format=yuv420p[out]")
    return inputs, ";".join(graph)


def build(a: argparse.Namespace) -> None:
    cfg = cut.load(a.cut)
    narration = json.loads((a.voice / "narration.json").read_text(encoding="utf-8"))
    errs = cut.problems(cfg["scenes"], narration, cfg["rules"])
    if errs:
        raise SystemExit("cut problems:\n- " + "\n- ".join(errs))
    placed = cut.place(cfg["scenes"], narration)
    items = cut.cues(placed, int(cfg["rules"]["maxCueChars"]))
    length = cut.total(cfg["scenes"])
    work = Path(tempfile.mkdtemp(prefix="kekal-cut-"))
    try:
        parts = []
        for i, scene in enumerate(cfg["scenes"]):
            part = work / f"part-{i:02d}.mp4"
            segment(cfg, scene, a.src, work, part)
            parts.append(part)
            print(f"scene {scene['id']}: {scene['dur']}s", flush=True)
        (work / "parts.txt").write_text("".join(f"file '{p}'\n" for p in parts), encoding="utf-8")
        joined = work / "joined.mp4"
        run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(work / "parts.txt"), "-c", "copy", str(joined)])
        audio = narration_track(cfg, placed, a.voice, narration, length, work)
        sub_in, graph = subtitle_inputs(cfg, items, work)
        v, au = cfg["video"], cfg["audio"]
        a.out.parent.mkdir(parents=True, exist_ok=True)
        run(["ffmpeg", "-v", "error", "-y", "-i", str(joined), "-i", str(audio), *sub_in, "-filter_complex", graph,
             "-map", "[out]", "-map", "1:a", "-t", str(length), "-r", str(v["fps"]), "-c:v", "libx264", "-preset", "medium",
             "-crf", str(v["crf"]), "-c:a", "aac", "-b:a", au["bitrate"], "-ar", str(au["sampleRate"]),
             "-movflags", "+faststart", str(a.out)])
        a.out.with_suffix(".srt").write_text(cut.srt(items), encoding="utf-8")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    sys.exit(measure(a.out, cfg, a.frames))


def probe(path: Path, entries: str, stream: str | None = None) -> str:
    args = ["ffprobe", "-v", "error"] + (["-select_streams", stream] if stream else []) + ["-show_entries", entries, "-of", "csv=p=0", str(path)]
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout.strip()


def measure(path: Path, cfg: dict, frames: Path | None = None) -> int:
    rules = cfg["rules"]
    video_len = float(probe(path, "format=duration"))
    audio = probe(path, "stream=duration", "a:0")
    report: dict = {"file": path.name, "seconds": round(video_len, 3), "audioTrack": bool(audio)}
    fails = []
    if video_len >= rules["maxSecs"]:
        fails.append(f"length {video_len:.2f}s is not under {rules['maxSecs']}s")
    if not audio:
        fails.append("no audio track")
    else:
        alen = float(audio)
        vlen = float(probe(path, "stream=duration", "v:0"))
        mean, peak = loudness(path)
        report.update(audioSeconds=round(alen, 3), videoStreamSeconds=round(vlen, 3), meanDb=mean, peakDb=peak)
        if abs(alen - vlen) > rules["audioVideoSlackSecs"]:
            fails.append(f"audio {alen:.2f}s against video {vlen:.2f}s")
        lo, hi = rules["meanDbRange"]
        if not lo <= mean <= hi:
            fails.append(f"mean {mean} dB outside {lo}..{hi}")
        if peak > rules["maxPeakDb"]:
            fails.append(f"peak {peak} dB above {rules['maxPeakDb']}")
    if frames:
        frames.mkdir(parents=True, exist_ok=True)
        for name, t in (("frame-0", 0.0), ("frame-mid", video_len / 2), ("frame-end", max(video_len - 1, 0))):
            run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1", str(frames / f"{name}.png")])
        report["frames"] = sorted(p.name for p in frames.glob("frame-*.png"))
    report["ok"] = not fails
    report["problems"] = fails
    print(json.dumps(report, indent=2))
    return 0 if not fails else 1


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--src", type=Path, required=True, help="footage folder (clips/, term/)")
    b.add_argument("--voice", type=Path, required=True, help="folder with narration.json and the line files")
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--cut", type=Path, default=DEFAULT_CUT)
    b.add_argument("--frames", type=Path, help="also save three still frames here")
    m = sub.add_parser("measure")
    m.add_argument("file", type=Path)
    m.add_argument("--cut", type=Path, default=DEFAULT_CUT)
    m.add_argument("--frames", type=Path)
    a = p.parse_args()
    if a.cmd == "build":
        build(a)
    else:
        sys.exit(measure(a.file, cut.load(a.cut), a.frames))


if __name__ == "__main__":
    main()
