# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow==11.3.0"]
# ///
"""Cuts the demo video from the recorded footage and the narration, then measures it.

  build: uv run scripts/video/assemble.py build --src <footage> --voice <footage>/voice-af_heart --out demo.mp4
         Writes demo.mp4 and demo.srt (English subtitles, also burned into the picture), then runs `measure`.
  preview: uv run scripts/video/assemble.py preview --src <footage> --out <folder> [--at 0.9] [--only <scene id> ...]
         One still per scene, to check crops, labels and side sentences before the long build.
  measure: uv run scripts/video/assemble.py measure demo.mp4
         Length, audio track, audio length against video length, mean and peak loudness, silences (silencedetect) and
         frozen pictures (freezedetect), against the cut file's rules.

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


def wrap(text: str, f, width: int) -> list[str]:
    """Greedy word wrap to a pixel width."""
    lines: list[str] = []
    for word in text.split():
        trial = f"{lines[-1]} {word}" if lines else word
        if lines and f.getlength(trial) <= width:
            lines[-1] = trial
        else:
            lines.append(word)
    return lines


def panel_layout(cfg: dict, scene: dict) -> tuple[int, int, int, int, int]:
    """Panel width, height, x, y, and the left edge of the text column."""
    z, v = cfg["zoom"], cfg["video"]
    w, h = cut.panel_size(scene["crop"], z)
    y = z["top"] + (z["maxHeight"] - h) // 2
    if scene.get("panel", "left") == "left":
        x = z["margin"]
        text_x = x + w + z["margin"]
    else:
        x = v["width"] - z["margin"] - w
        text_x = z["margin"]
    return w, h, x, y, text_x


def panel_overlay(cfg: dict, scene: dict, path: Path) -> tuple[int, int, int, int]:
    """Frame around the panel, the side sentence and the label, on a transparent layer; returns the panel box."""
    from PIL import Image, ImageDraw

    z, v, lab = cfg["zoom"], cfg["video"], cfg["label"]
    w, h, x, y, text_x = panel_layout(cfg, scene)
    img = Image.new("RGBA", (v["width"], v["height"]), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    b, r = z["border"], z["radius"]
    d.rounded_rectangle([x - b, y - b, x + w + b, y + h + b], radius=r + b, fill=rgb("ink"))
    d.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=(0, 0, 0, 0))
    col_w = v["width"] - z["margin"] - text_x if scene.get("panel", "left") == "left" else x - 2 * z["margin"]
    top = z["top"]
    if scene.get("label"):
        chip_img = chip(scene["label"], font(cfg, "sans", lab["size"], 500), (lab["padX"], lab["padY"]), 10,
                        rgb("paper-band", 240), rgb("ink"), rgb("ink"))
        if chip_img.width > col_w:
            raise SystemExit(f"{scene['id']}: label is {chip_img.width}px, the text column is {col_w}px")
        img.alpha_composite(chip_img, (text_x, top))
    if scene.get("side"):
        f = font(cfg, "serif", z["sideSize"], 500)
        lines = wrap(scene["side"], f, col_w)
        step = int(z["sideSize"] * z["sideLineGap"])
        ty = y + (h - step * len(lines)) // 2
        d.rectangle([text_x, ty - 40, text_x + 96, ty - 36], fill=rgb("copper"))
        for i, line in enumerate(lines):
            d.text((text_x, ty + i * step), line, font=f, fill=rgb("ink"))
    img.save(path)
    return w, h, x, y


def closing_card(cfg: dict, path: Path) -> None:
    """Closing still: name, tagline, the demo and source links from config/app.json, and the honest note."""
    from PIL import Image, ImageDraw

    app = json.loads((ROOT / "config/app.json").read_text(encoding="utf-8"))
    c, v = cfg["closing"], cfg["video"]
    links = [app["web"]["site"]["url"] + c["demoPath"], app["web"]["home"]["repoUrl"]]
    img = Image.new("RGBA", (v["width"], v["height"]), rgb("paper"))
    d = ImageDraw.Draw(img)
    x, y = 220, 250
    d.text((x, y), c["title"], font=font(cfg, "serif", 150, 500), fill=rgb("ink"))
    d.text((x, y + 200), c["tagline"], font=font(cfg, "serif", 64, 400), fill=rgb("ink"))
    d.rectangle([x, y + 310, x + 140, y + 315], fill=rgb("copper"))
    for i, link in enumerate(links):
        d.text((x, y + 360 + i * 64), link.replace("https://", ""), font=font(cfg, "mono", 44), fill=rgb("ink"))
    d.text((x, y + 520), c["note"], font=font(cfg, "sans", 36, 500), fill=rgb("ink-soft"))
    img.save(path)


def clip_height(path: Path) -> tuple[int, int]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True).stdout
    w, h = out.strip().split(",")[:2]
    return int(w), int(h)


ZOOM_OVERSAMPLE = 2


def oversample(src: Path, crop: list | None, size: tuple[int, int], out: Path) -> Path:
    """The still cropped and enlarged once, so the slow zoom has sub-pixel room without rescaling every frame."""
    from PIL import Image

    img = Image.open(src).convert("RGB")
    if crop:
        cw, ch, cx, cy = crop
        img = img.crop((cx, cy, cx + cw, cy + ch))
    img.resize((size[0] * ZOOM_OVERSAMPLE, size[1] * ZOOM_OVERSAMPLE), Image.LANCZOS).save(out)
    return out


def slow_zoom(size: tuple[int, int], frames: int, zoom_to: float, focus: list, fps: int) -> str:
    """zoompan from 1 to zoom_to over the scene, centred on focus, from an oversampled still."""
    fx, fy = focus
    z = f"1+{zoom_to - 1:.4f}*on/{max(frames - 1, 1)}"
    return f"zoompan=z='{z}':x='(iw-iw/zoom)*{fx}':y='(ih-ih/zoom)*{fy}':d=1:s={size[0]}x{size[1]}:fps={fps}"


def segment(cfg: dict, scene: dict, src: Path, work: Path, out: Path) -> None:
    v = cfg["video"]
    dur = float(scene["dur"])
    fps = v["fps"]
    frames = int(round(dur * fps))
    lab = cfg["label"]
    sid = scene["id"]
    if scene["kind"] == "title":
        closing_card(cfg, work / f"{sid}.png")
        size = (v["width"], v["height"])
        big = oversample(work / f"{sid}.png", None, size, work / f"{sid}-big.png")
        inputs = ["-framerate", str(fps), "-loop", "1", "-t", str(dur), "-i", str(big)]
        graph = f"[0:v]{slow_zoom(size, frames, cfg['closing']['zoomTo'], [0.3, 0.5], fps)},format=yuv420p[out]"
    elif scene["kind"] in ("zoom", "still"):
        w, h, x, y = panel_overlay(cfg, scene, work / f"{sid}-overlay.png")
        cw, ch, cx, cy = scene["crop"]
        if scene["kind"] == "still":
            big = oversample(src / scene["image"], scene["crop"], (w, h), work / f"{sid}-big.png")
            inputs = ["-framerate", str(fps), "-loop", "1", "-t", str(dur), "-i", str(big)]
            zoom = slow_zoom((w, h), frames, float(scene["zoomTo"]), scene.get("focus", [0.5, 0.5]), fps)
            body = f"[0:v]{zoom},setpts=PTS-STARTPTS[v]"
        else:
            speed = float(scene.get("speed", 1))
            span = float(scene["out"]) - float(scene["in"])
            inputs = ["-ss", str(scene["in"]), "-t", f"{span:.3f}", "-i", str(src / scene["clip"])]
            body = (f"[0:v]setpts=(PTS-STARTPTS)/{speed},fps={fps},crop={cw}:{ch}:{cx}:{cy},scale={w}:{h}:flags=lanczos,"
                    f"tpad=stop_mode=clone:stop_duration={dur},trim=duration={dur},setpts=PTS-STARTPTS[v]")
        inputs += ["-f", "lavfi", "-t", str(dur), "-i", f"color=c={token('paper')}:s={v['width']}x{v['height']}:r={fps}",
                   "-loop", "1", "-t", str(dur), "-i", str(work / f"{sid}-overlay.png")]
        graph = f"{body};[1:v][v]overlay={x}:{y}:shortest=1[a];[a][2:v]overlay=0:0,format=yuv420p[out]"
    else:
        clip = src / scene["clip"]
        speed = float(scene.get("speed", 1))
        span = float(scene["out"]) - float(scene["in"])
        pad = f"tpad=stop_mode=clone:stop_duration={dur},trim=duration={dur},setpts=PTS-STARTPTS"
        inputs = ["-ss", str(scene["in"]), "-t", f"{span:.3f}", "-i", str(clip)]
        crop = scene["crop"]
        graph = (f"[0:v]setpts=(PTS-STARTPTS)/{speed},fps={fps},crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]},"
                 f"scale={v['width']}:{v['height']}:flags=lanczos,{pad}[b]")
        if scene.get("label"):
            img = chip(scene["label"], font(cfg, "sans", lab["size"], 500), (lab["padX"], lab["padY"]), 10,
                       rgb("paper-band", 240), rgb("ink"), rgb("ink"))
            img.save(work / f"{sid}-label.png")
            lx = v["width"] - lab["margin"] - img.width
            inputs += ["-i", str(work / f"{sid}-label.png")]
            graph += f";[b][1:v]overlay={lx}:{lab['margin']},format=yuv420p[out]"
        else:
            graph += ";[b]format=yuv420p[out]"
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]", "-t", str(dur),
         "-r", str(fps), "-c:v", "libx264", "-preset", "medium", "-crf", str(v["crf"]), "-an", str(out)])


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


def voice_problems(cfg: dict, narration: dict) -> list[str]:
    """The voice folder must be the narration the cut was timed against."""
    want = cfg["narration"]["seconds"]
    got = {str(l["line"]): float(l["duration"]) for l in narration["lines"]}
    tol = float(cfg["narration"]["toleranceSecs"])
    if set(want) != set(got):
        return [f"voice has lines {sorted(got)}, the cut was timed for {sorted(want)}"]
    return [f"line {k} is {got[k]}s in the voice, {want[k]}s in the cut" for k in want if abs(got[k] - float(want[k])) > tol]


def preview(a: argparse.Namespace) -> None:
    """One still per scene (its middle), for checking crops and text before the long build."""
    cfg = cut.load(a.cut)
    a.out.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="kekal-preview-"))
    try:
        for scene in cfg["scenes"]:
            if a.only and scene["id"] not in a.only:
                continue
            s = dict(scene)
            if "clip" in s:
                span = (float(s["out"]) - float(s["in"])) * a.at
                s["in"] = float(s["in"]) + span
                s["out"] = s["in"] + 0.5
                s["speed"] = 1
                s["dur"] = 0.5
            part = work / f"{s['id']}.mp4"
            segment(cfg, s, a.src, work, part)
            run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.1", "-i", str(part), "-frames:v", "1", str(a.out / f"{s['id']}.png")])
            print(a.out / f"{s['id']}.png", flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def build(a: argparse.Namespace) -> None:
    cfg = cut.load(a.cut)
    narration = json.loads((a.voice / "narration.json").read_text(encoding="utf-8"))
    errs = cut.problems(cfg["scenes"], narration, cfg["rules"]) + cut.look_problems(cfg) + voice_problems(cfg, narration)
    errs += cut.silence_problems(cfg["scenes"], narration, cfg["rules"]["silence"])
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


def silence_spans(log: str, what: str, length: float) -> list[tuple[float, float]]:
    """(start, end) pairs from ffmpeg silencedetect / freezedetect output; an open span ends at the file's end."""
    starts = [float(x) for x in re.findall(rf"{what}_start: ?(-?[\d.]+)", log)]
    ends = [float(x) for x in re.findall(rf"{what}_end: ?(-?[\d.]+)", log)]
    ends += [length] * (len(starts) - len(ends))
    return [(round(a, 2), round(b, 2)) for a, b in zip(starts, ends)]


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
    sil, fr = rules["silence"], rules["freeze"]
    err = run(["ffmpeg", "-v", "info", "-nostats", "-i", str(path), "-map", "0:a:0", "-af",
               f"silencedetect=noise={sil['noiseDb']}dB:d={sil['minSecs']}", "-f", "null", "-"])
    gaps = silence_spans(err, "silence", video_len)
    share = sum(b - a for a, b in gaps) / video_len
    report.update(silences=[[a, b] for a, b in gaps], silenceShare=round(share, 3))
    fails += [f"silence {a}s to {b}s is over {sil['maxGapSecs']}s" for a, b in gaps if b - a > sil["maxGapSecs"]]
    if share > sil["maxShare"]:
        fails.append(f"silence is {share:.0%} of the video, over {sil['maxShare']:.0%}")
    err = run(["ffmpeg", "-v", "info", "-nostats", "-i", str(path), "-map", "0:v:0", "-vf",
               f"freezedetect=n={fr['noiseDb']}dB:d={fr['minSecs']}", "-f", "null", "-"])
    frozen = silence_spans(err, "freeze", video_len)
    report["frozen"] = [[a, b] for a, b in frozen]
    fails += [f"picture frozen from {a}s to {b}s" for a, b in frozen]
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
    v = sub.add_parser("preview")
    v.add_argument("--src", type=Path, required=True)
    v.add_argument("--out", type=Path, required=True, help="folder for one still per scene")
    v.add_argument("--cut", type=Path, default=DEFAULT_CUT)
    v.add_argument("--at", type=float, default=0.5, help="where in each clip, 0..1")
    v.add_argument("--only", nargs="*", help="scene ids")
    m = sub.add_parser("measure")
    m.add_argument("file", type=Path)
    m.add_argument("--cut", type=Path, default=DEFAULT_CUT)
    m.add_argument("--frames", type=Path)
    a = p.parse_args()
    if a.cmd == "build":
        build(a)
    elif a.cmd == "preview":
        preview(a)
    else:
        sys.exit(measure(a.file, cut.load(a.cut), a.frames))


if __name__ == "__main__":
    main()
