"""Tests for resolve_overlay_segments (end-anchored timed visibility).

Run with: python3 -m unittest discover -s tests -v
"""
from __future__ import annotations

import unittest

from engine.template_composite import OverlaySegment, resolve_overlay_segments


def seg(index: int, start: float, end: float | None) -> OverlaySegment:
    return {"index": index, "start": start, "end": end}


class ResolveOverlaySegmentsTest(unittest.TestCase):
    def test_identity_without_negative_bounds(self) -> None:
        segments = [seg(0, 0, 6.0), seg(1, 6.0, None)]
        result = resolve_overlay_segments(segments, clip_duration=None)
        self.assertIs(result, segments)

    def test_simple_end_anchor(self) -> None:
        # Block appears 3 s before the end: [{0, 0, fin-3}, {1, fin-3, None}]
        result = resolve_overlay_segments(
            [seg(0, 0, -3.0), seg(1, -3.0, None)], clip_duration=10.0
        )
        self.assertEqual(result, [seg(0, 0.0, 7.0), seg(1, 7.0, None)])

    def test_end_anchor_with_max_duration_cap(self) -> None:
        # Clip probes at 20 s but -t caps output at 10 s → anchors resolve against 10.
        result = resolve_overlay_segments(
            [seg(0, 0, -3.0), seg(1, -3.0, None)], clip_duration=20.0, max_duration=10.0
        )
        self.assertEqual(result, [seg(0, 0.0, 7.0), seg(1, 7.0, None)])

    def test_max_duration_longer_than_clip(self) -> None:
        result = resolve_overlay_segments(
            [seg(0, 0, -3.0), seg(1, -3.0, None)], clip_duration=8.0, max_duration=15.0
        )
        self.assertEqual(result, [seg(0, 0.0, 5.0), seg(1, 5.0, None)])

    def test_short_clip_clamps_and_drops_degenerate(self) -> None:
        # Web assumed "long clip": A visible 0→5, B 5→fin-3, C fin-3→fin.
        # Actual clip = 2 s → middle window collapses, open-ended segment survives.
        result = resolve_overlay_segments(
            [seg(0, 0, 5.0), seg(1, 5.0, -3.0), seg(2, -3.0, None)], clip_duration=2.0
        )
        self.assertEqual(result, [seg(0, 0.0, 2.0), seg(2, 2.0, None)])

    def test_monotonicity_forced_on_short_clip(self) -> None:
        # fin-3 resolves to 1 with D=4, before the start-anchored 2 → clamped to 2.
        result = resolve_overlay_segments(
            [seg(0, 0, 2.0), seg(1, 2.0, -3.0), seg(2, -3.0, None)], clip_duration=4.0
        )
        self.assertEqual(result, [seg(0, 0.0, 2.0), seg(2, 2.0, None)])

    def test_merge_adjacent_same_index(self) -> None:
        # Middle segment dropped → neighbours with the same index become adjacent.
        result = resolve_overlay_segments(
            [seg(0, 0, 3.0), seg(1, 3.0, -8.0), seg(0, -8.0, -2.0), seg(1, -2.0, None)],
            clip_duration=10.0,
        )
        # fin-8 = 2 < 3 → clamped to 3, seg1 dropped, seg0 windows merge 0→3 and 3→8.
        self.assertEqual(result, [seg(0, 0.0, 8.0), seg(1, 8.0, None)])

    def test_raises_without_duration_when_negative(self) -> None:
        with self.assertRaises(ValueError):
            resolve_overlay_segments([seg(0, -3.0, None)], clip_duration=None)
        with self.assertRaises(ValueError):
            resolve_overlay_segments([seg(0, -3.0, None)], clip_duration=0.0)

    def test_negative_resolved_in_enable_expression(self) -> None:
        # End-to-end sanity: resolved bounds feed a valid enable expression.
        from engine.template_composite import build_template_filter_complex_timed

        resolved = resolve_overlay_segments(
            [seg(0, 0, -3.0), seg(1, -3.0, None)], clip_duration=10.0
        )
        block = {
            "x": 0, "y": 0, "w": 1080, "h": 1920,
            "canvas_w": 1080, "canvas_h": 1920,
            "fit": "cover", "crop_x": 0.5, "crop_y": 0.5,
        }
        graph = build_template_filter_complex_timed(block, resolved)
        self.assertIn("between(t,0,7.0)", graph)
        self.assertIn("gte(t,7.0)", graph)
        self.assertNotIn("-3", graph)


if __name__ == "__main__":
    unittest.main()
