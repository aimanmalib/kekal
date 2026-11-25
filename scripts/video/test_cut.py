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


class DemoCutFileTest(unittest.TestCase):
    """The committed cut file is well formed (the narration itself is not in the repository)."""

    def test_scenes_are_complete(self):
        cfg = cut.load(Path(__file__).resolve().parent / "demo-cut.json")
        self.assertLessEqual(cut.total(cfg["scenes"]), cfg["rules"]["maxSecs"])
        ids = [s["id"] for s in cfg["scenes"]]
        self.assertEqual(len(ids), len(set(ids)))
        for s in cfg["scenes"]:
            self.assertIn(s["kind"], {"phone", "wide", "card"})
            if s["kind"] != "card":
                self.assertLess(s["in"], s["out"])
                self.assertGreater(float(s.get("speed", 1)), 0)
                if float(s.get("speed", 1)) > 1:
                    self.assertIn("sped up", s["label"])
        json.dumps(cfg)


if __name__ == "__main__":
    unittest.main()
