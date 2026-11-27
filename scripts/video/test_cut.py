"""Tests for scripts/video/cut.py (standard library only): python3 -m unittest discover -s scripts/video"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import cut

NARRATION = {
    "lines": [
        {"line": 1, "text": "The shop went quiet. The buyer was paid.", "duration": 3.0},
        {"line": 2, "text": "One, two, three, four, five, six, seven, eight, nine, ten, eleven, twelve.", "duration": 6.0},
    ]
}
RULES = {"maxSecs": 170, "minGapSecs": 0.2, "maxCueChars": 40}


def scenes(first_dur=5.0, second_offset=0.5, extra=None):
    out = [
        {"id": "a", "dur": first_dur, "lines": [[1, 0.5]]},
        {"id": "b", "dur": 8.0, "lines": [[2, second_offset]]},
    ]
    return out + (extra or [])


class PlaceTest(unittest.TestCase):
    def test_lines_start_from_their_scene(self):
        placed = cut.place(scenes(), NARRATION)
        self.assertEqual([(p.line, p.start, p.end) for p in placed], [(1, 0.5, 3.5), (2, 5.5, 11.5)])
        self.assertEqual(cut.total(scenes()), 13.0)

    def test_good_cut_has_no_problems(self):
        self.assertEqual(cut.problems(scenes(), NARRATION, RULES), [])

    def test_overlap_is_a_problem(self):
        errs = cut.problems(scenes(first_dur=2.0, second_offset=0.0), NARRATION, RULES)
        self.assertTrue(any("before line 1 ends" in e for e in errs), errs)

    def test_missing_and_repeated_lines_are_problems(self):
        s = scenes()
        s[1]["lines"] = [[1, 4.0]]
        self.assertTrue(any("lines placed" in e for e in cut.problems(s, NARRATION, RULES)))

    def test_too_long_and_line_past_the_end(self):
        s = scenes()
        s[1]["dur"] = 2.0
        errs = cut.problems(s, NARRATION, {**RULES, "maxSecs": 5})
        self.assertTrue(any("after the video ends" in e for e in errs), errs)
        self.assertTrue(any("over the 5s limit" in e for e in errs), errs)


class SubtitleTest(unittest.TestCase):
    def test_pieces_fit_and_keep_every_word(self):
        text = NARRATION["lines"][1]["text"]
        pieces = cut.split_text(text, 40)
        self.assertTrue(all(len(p) <= 40 for p in pieces), pieces)
        self.assertEqual(" ".join(pieces).split(), text.split())

    def test_short_sentences_join(self):
        self.assertEqual(cut.split_text("Time is up. Anyone can press this button.", 60), ["Time is up. Anyone can press this button."])

    def test_cues_cover_the_line_in_order(self):
        items = cut.cues(cut.place(scenes(), NARRATION), 40)
        line2 = [c for c in items if c.start >= 5.5]
        self.assertEqual(line2[0].start, 5.5)
        self.assertEqual(line2[-1].end, 11.5)
        for a, b in zip(line2, line2[1:]):
            self.assertEqual(a.end, b.start)

    def test_srt_format(self):
        text = cut.srt([cut.Cue(0.3, 61.25, "Hello."), cut.Cue(3661.0, 3662.5, "Again.")])
        self.assertEqual(text, "1\n00:00:00,300 --> 00:01:01,250\nHello.\n\n2\n01:01:01,000 --> 01:01:02,500\nAgain.\n")


ZOOM = {"maxWidth": 1100, "maxHeight": 880}
LOOK = {"video": {"width": 1920, "height": 1080}, "zoom": ZOOM, "rules": {"minUiShare": 0.45, "maxHoldSecs": 0.5}}


def look(*scenes_):
    return {**LOOK, "scenes": list(scenes_)}


class LookTest(unittest.TestCase):
    """The product must fill enough of the frame to be read on a small player, and no scene may sit on a held frame."""

    def test_panel_fits_the_box(self):
        self.assertEqual(cut.panel_size([780, 700, 0, 0], ZOOM), (980, 880))
        self.assertEqual(cut.panel_size([2000, 500, 0, 0], ZOOM), (1100, 274))

    def test_zoomed_phone_is_big_enough(self):
        ok = {"id": "a", "kind": "zoom", "clip": "x", "in": 0, "out": 4, "dur": 4, "crop": [780, 700, 0, 0]}
        self.assertEqual(cut.look_problems(look(ok)), [])

    def test_whole_phone_screen_is_too_small(self):
        tall = {"id": "a", "kind": "zoom", "clip": "x", "in": 0, "out": 4, "dur": 4, "crop": [780, 1328, 0, 0]}
        self.assertIn("under 45%", cut.look_problems(look(tall))[0])

    def test_scene_without_crop_is_a_problem(self):
        phone = {"id": "a", "kind": "phone", "clip": "x", "in": 0, "out": 4, "dur": 4}
        self.assertIn("no crop box", cut.look_problems(look(phone))[0])

    def test_title_needs_no_crop(self):
        self.assertEqual(cut.look_problems(look({"id": "t", "kind": "title", "dur": 9})), [])

    def test_stretched_wide_crop(self):
        wide = {"id": "w", "kind": "wide", "clip": "x", "in": 0, "out": 4, "dur": 4, "crop": [853, 380, 0, 0]}
        self.assertIn("stretched", cut.look_problems(look(wide))[0])

    def test_short_clip_held_long_is_frozen(self):
        held = {"id": "h", "kind": "wide", "clip": "x", "in": 105.6, "out": 106.8, "dur": 10.2, "crop": [1280, 720, 0, 0]}
        self.assertIn("holds its last frame", cut.look_problems(look(held))[0])
        fast = {**held, "out": 130.0, "speed": 2.4}
        self.assertEqual(cut.look_problems(look(fast)), [])


class SilenceTest(unittest.TestCase):
    RULE = {"minSecs": 1.5, "maxGapSecs": 3.0, "maxShare": 0.2}

    def test_gaps_counted_from_the_plan(self):
        gaps = cut.silences(scenes(), NARRATION, 1.5)
        self.assertEqual(gaps, [(3.5, 5.5), (11.5, 13.0)])

    def test_long_gap_and_share(self):
        s = scenes(extra=[{"id": "c", "dur": 6.0, "lines": []}])
        errs = cut.silence_problems(s, NARRATION, self.RULE)
        self.assertTrue(any("over 3.0s" in e for e in errs), errs)
        self.assertTrue(any("of the video" in e for e in errs), errs)

    def test_narration_from_cut_file_seconds(self):
        n = cut.narration_from_secs({"1": 3.0, "2": 6.0})
        self.assertEqual([(p.line, p.end) for p in cut.place(scenes(), n)], [(1, 3.5), (2, 11.5)])


class DemoCutFileTest(unittest.TestCase):
    """The committed cut file is well formed (the narration itself is not in the repository)."""

    def test_scenes_are_complete(self):
        cfg = cut.load(Path(__file__).resolve().parent / "demo-cut.json")
        self.assertLessEqual(cut.total(cfg["scenes"]), cfg["rules"]["maxSecs"])
        ids = [s["id"] for s in cfg["scenes"]]
        self.assertEqual(len(ids), len(set(ids)))
        for s in cfg["scenes"]:
            self.assertIn(s["kind"], {"zoom", "still", "wide", "title"})
            if "clip" in s:
                self.assertLess(s["in"], s["out"])
                self.assertGreater(float(s.get("speed", 1)), 0)
                if float(s.get("speed", 1)) > 1:
                    self.assertIn("sped up", s["label"])
        json.dumps(cfg)

    def test_explorer_scenes_have_shots(self):
        """Every explorer scene comes from a shot in explorerFootage, and every shot names a step or address in the examples."""
        root = Path(__file__).resolve().parents[2]
        cfg = cut.load(Path(__file__).resolve().parent / "demo-cut.json")
        examples = json.loads((root / "config" / "examples.json").read_text(encoding="utf-8"))
        shots = {s["id"]: s for s in cfg["explorerFootage"]["shots"]}
        live = {s["id"] for s in cfg["explorerFootage"]["liveShots"]}
        used = {Path(s["clip"]).stem.removeprefix("chromium-") for s in cfg["scenes"] if "explorer-" in s.get("clip", "")}
        self.assertTrue(used)
        self.assertLessEqual(used, set(shots) | live)
        for shot in cfg["explorerFootage"]["liveShots"]:
            self.assertIn(shot["like"], shots)
        for shot in shots.values():
            if "tx" in shot:
                path, step = shot["tx"]
                self.assertIn(step, [s["step"] for s in examples["paths"][path]])
            else:
                self.assertIsInstance(examples[shot["address"]], str)
            for stop in shot["stops"]:
                self.assertGreater(stop["hold"], 0)
                self.assertLessEqual(len({"heading", "text"} & set(stop)), 1)

    def test_cut_file_meets_the_look_and_silence_rules(self):
        """The committed cut: product at least minUiShare of the width, no held frames, no long silence in the plan."""
        cfg = cut.load(Path(__file__).resolve().parent / "demo-cut.json")
        self.assertEqual(cut.look_problems(cfg), [])
        narration = cut.narration_from_secs(cfg["narration"]["seconds"])
        self.assertEqual(cut.problems(cfg["scenes"], narration, cfg["rules"]), [])
        self.assertEqual(cut.silence_problems(cfg["scenes"], narration, cfg["rules"]["silence"]), [])


if __name__ == "__main__":
    unittest.main()
