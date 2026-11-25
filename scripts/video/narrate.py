# /// script
# requires-python = ">=3.10"
# dependencies = ["kokoro-onnx==0.6.1", "soundfile==0.14.0"]
# ///
"""Reads a narration script aloud with a stock text-to-speech voice, one audio file per line.

The voice is a stock Kokoro voice (open weights, Apache-2.0), run on this machine; it is synthetic and the video says so.
Input: a text file, one narration line per line (blank lines and lines starting with '#' are skipped).
Output, in --out: line-NN.wav (24 kHz mono), narration.wav (all lines with --gap seconds between them) and
narration.json (voice, speed, and each line's text, file, start and duration in seconds), which the editing step reads to
place each line under its scene and to write the subtitles.

  uv run scripts/video/narrate.py --model <kokoro-v1.0.onnx> --voices <voices-v1.0.bin> \\
      --text <narration.txt> --out <dir> [--voice af_heart] [--speed 1.0] [--gap 0.6]

Model files: https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def read_lines(path: Path) -> list[str]:
    lines = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            lines.append(line)
    if not lines:
        raise SystemExit(f"{path}: no narration lines")
    return lines


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--voices", type=Path, required=True)
    ap.add_argument("--text", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--gap", type=float, default=0.6, help="seconds of silence between lines in narration.wav")
    ap.add_argument("--lang", default="en-us")
    args = ap.parse_args()

    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(str(args.model), str(args.voices))
    if args.voice not in kokoro.get_voices():
        raise SystemExit(f"unknown voice {args.voice}; choose one of {', '.join(sorted(kokoro.get_voices()))}")
    args.out.mkdir(parents=True, exist_ok=True)

    rate = None
    parts: list[np.ndarray] = []
    entries = []
    t = 0.0
    for i, line in enumerate(read_lines(args.text), start=1):
        samples, sr = kokoro.create(line, voice=args.voice, speed=args.speed, lang=args.lang)
        rate = rate or sr
        if sr != rate:
            raise SystemExit(f"line {i}: sample rate {sr} differs from {rate}")
        name = f"line-{i:02d}.wav"
        sf.write(args.out / name, samples, sr)
        duration = len(samples) / sr
        entries.append({"line": i, "text": line, "file": name, "start": round(t, 3), "duration": round(duration, 3)})
        parts.append(samples)
        parts.append(np.zeros(int(args.gap * sr), dtype=samples.dtype))
        t += duration + args.gap
        print(f"{i:2d}  {duration:5.2f} s  {line[:70]}")

    sf.write(args.out / "narration.wav", np.concatenate(parts[:-1]), rate)
    total = sum(e["duration"] for e in entries) + args.gap * (len(entries) - 1)
    meta = {
        "engine": "kokoro-onnx",
        "voice": args.voice,
        "speed": args.speed,
        "gap": args.gap,
        "sampleRate": rate,
        "total": round(total, 3),
        "lines": entries,
    }
    (args.out / "narration.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"total {total:.2f} s, {len(entries)} lines, voice {args.voice}")


if __name__ == "__main__":
    main()
