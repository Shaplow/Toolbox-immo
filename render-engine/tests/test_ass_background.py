"""Tests for the caption background box (engine.ass_writer + engine.libass_metrics).

Pure .ass generation — no ffmpeg. Uses the fonts bundled in render-engine/fonts.

Run with: python3 -m pytest tests/test_ass_background.py -v
"""
from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path

from engine.ass_writer import _rounded_rect_drawing, write_ass_file
from engine.layout import build_layout
from engine.libass_metrics import font_vertical_metrics, load_libass_face
from engine.models import (
    AnimationConfig,
    BackgroundConfig,
    HighlightConfig,
    LayoutConfig,
    RenderConfig,
    StyleConfig,
    WordTimestamp,
)
from engine.probe import VideoInfo

FONTS_DIR = Path(__file__).resolve().parent.parent / "fonts"
TEXT = "Aujourd'hui je vous emmène à deux pas de la place du Trocadéro"
_BOX_RE = re.compile(r"^Dialogue: (\d+),([^,]+),([^,]+),CaptionBox,,0,0,0,,\{\\an7\\pos\((-?\d+),(-?\d+)\)([^}]*)\}(m [^{]+)\{\\p0\}$")


def _words(text: str = TEXT, duration: float = 3.0) -> list[WordTimestamp]:
    tokens = text.split()
    step = duration / len(tokens)
    return [
        WordTimestamp(word=w, start=i * step, end=(i + 1) * step, caption_index=1, highlight=(w == "place"))
        for i, w in enumerate(tokens)
    ]


def _config(preset: str = "none", background: bool = True, **bg) -> RenderConfig:
    style = dict(font="Playfair Display Bold", size_ratio=0.03, bold=True)
    return RenderConfig(
        layout=LayoutConfig(anchor="center", max_lines=2, max_width_ratio=1.0, vertical_offset=0.15),
        base_style=StyleConfig(**style),
        highlight_style=StyleConfig(**{**style, "font": "Bebas Neue Regular", "size_ratio": 0.04}),
        highlight=HighlightConfig(keywords=[]),
        animation=AnimationConfig(preset=preset),
        background=BackgroundConfig(enabled=background, **bg),
    )


def _write(config: RenderConfig, size: tuple[int, int] = (1080, 1920)) -> list[str]:
    video = VideoInfo(width=size[0], height=size[1], duration=10.0)
    blocks = build_layout(_words(), video_info=video, config=config, fonts_dir=FONTS_DIR)
    with tempfile.TemporaryDirectory() as tmp:
        path = write_ass_file(Path(tmp) / "out.ass", blocks, config, video, fonts_dir=FONTS_DIR)
        return path.read_text(encoding="utf-8").splitlines()


def _boxes(lines: list[str]) -> list[re.Match]:
    return [m for m in (_BOX_RE.match(line) for line in lines) if m]


class FontMetricsTest(unittest.TestCase):
    def test_reads_os2_win_metrics(self) -> None:
        upm, ascent, descent = font_vertical_metrics(str(FONTS_DIR / "PlayfairDisplay-Bold.ttf"))
        self.assertEqual((upm, ascent, descent), (1000, 1159, 251))

    def test_libass_em_is_size_over_win_height(self) -> None:
        face = load_libass_face("Playfair Display Bold", 141, FONTS_DIR)
        # 141 × 1000 / (1159 + 251) = 100 px of em ; ascent 141 × 1159 / 1410.
        self.assertAlmostEqual(face.scale * 1000, 100.0, places=3)
        self.assertAlmostEqual(face.ascent, 115.9, places=3)


class RoundedRectTest(unittest.TestCase):
    def test_bounding_box_is_exactly_the_rectangle(self) -> None:
        coords = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", _rounded_rect_drawing(300, 120, 36))]
        xs, ys = coords[0::2], coords[1::2]
        self.assertEqual((min(xs), max(xs), min(ys), max(ys)), (0, 300, 0, 120))

    def test_radius_is_clamped_to_half_the_height(self) -> None:
        drawing = _rounded_rect_drawing(300, 40, 100)
        self.assertTrue(drawing.startswith("m 20 0"))

    def test_zero_radius_is_a_plain_rectangle(self) -> None:
        self.assertEqual(_rounded_rect_drawing(10, 5, 0), "m 0 0 l 10 0 10 5 0 5")


class BackgroundBoxTest(unittest.TestCase):
    def test_disabled_emits_no_box_and_keeps_text_on_layer_zero(self) -> None:
        lines = _write(_config(background=False))
        self.assertFalse(any("CaptionBox" in line for line in lines))
        dialogues = [line for line in lines if line.startswith("Dialogue:")]
        self.assertTrue(dialogues)
        self.assertTrue(all(line.startswith("Dialogue: 0,") for line in dialogues))

    def test_one_box_per_block_below_the_text(self) -> None:
        lines = _write(_config(color="#2B2B2B", opacity=0.8))
        boxes = _boxes(lines)
        text_events = [line for line in lines if line.startswith("Dialogue:") and "CaptionBox" not in line]
        self.assertEqual(len(boxes), 1)  # one block of two lines → one box
        self.assertEqual(boxes[0].group(1), "0")
        self.assertTrue(all(not line.startswith("Dialogue: 0,") for line in text_events))
        tags = boxes[0].group(6)
        self.assertIn(r"\bord0\shad0", tags)
        self.assertIn(r"\1c&H2B2B2B&", tags)
        self.assertIn(r"\1a&H33&", tags)  # 80 % opacity
        self.assertIn(r"\p1", tags)

    def test_box_wraps_every_line_with_the_margins(self) -> None:
        config = _config(padding_x=30, padding_y=20, radius=36)
        lines = _write(config)
        box = _boxes(lines)[0]
        x0, y0 = int(box.group(4)), int(box.group(5))
        coords = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", box.group(7))]
        width, height = max(coords[0::2]), max(coords[1::2])
        text_pos = [tuple(map(int, m.groups())) for m in (re.search(r"\\pos\((\d+),(\d+)\)", line) for line in lines if line.startswith("Dialogue: 1,")) if m]
        self.assertEqual(len(text_pos), 2)
        # Centred on the text, starts above the first line, ends below the second.
        self.assertAlmostEqual(x0 + width / 2, text_pos[0][0], delta=2)
        self.assertLess(y0, text_pos[0][1] + 20)
        self.assertGreater(y0 + height, text_pos[1][1] + 30)

    def test_margins_scale_with_video_height(self) -> None:
        # Margins are px of a 1080×1920 video: twice as many px in 4K. Compared
        # as (box with margins − box without) since the font size itself is an
        # int (57 px in 1080p, 115 px — not 114 — in 4K).
        def box_size(size, pad_x, pad_y):
            box = _boxes(_write(_config(padding_x=pad_x, padding_y=pad_y, radius=0), size))[0]
            coords = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", box.group(7))]
            return max(coords[0::2]), max(coords[1::2])
        for size, factor in (((1080, 1920), 1), ((2160, 3840), 2)):
            w_pad, h_pad = box_size(size, 30, 20)
            w_bare, h_bare = box_size(size, 0, 0)
            self.assertAlmostEqual(w_pad - w_bare, 60 * factor, delta=1)
            self.assertAlmostEqual(h_pad - h_bare, 40 * factor, delta=1)

    def test_box_is_identical_for_every_animation(self) -> None:
        def box(preset):
            boxes = _boxes(_write(_config(preset=preset)))
            self.assertEqual(len(boxes), 1, preset)
            return boxes[0].group(2, 3, 5, 7)
        reference = box("none")
        for preset in ("appear", "word_pop", "reveal"):
            # reveal centres on the frame instead of line.center_x: x may move by 1 px.
            self.assertEqual(box(preset), reference, preset)

    def test_two_layer_text_moves_to_layers_one_and_two(self) -> None:
        config = _config()
        config = config.model_copy(update={
            "base_style": config.base_style.model_copy(update={"shadow_blur": 3.0, "glow_intensity": 2.0}),
        })
        layers = {line.split(",")[0] for line in _write(config) if line.startswith("Dialogue:")}
        self.assertEqual(layers, {"Dialogue: 0", "Dialogue: 1", "Dialogue: 2"})


if __name__ == "__main__":
    unittest.main()
