from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import ImageFont

from .fonts import resolve_font_path
from .models import RenderConfig, WordTimestamp
from .probe import VideoInfo


@dataclass(slots=True)
class PositionedWord:
    word: str
    start: float
    end: float
    x: int
    center_x: int
    y: int
    highlight: bool
    highlight_group: int = 0


@dataclass(slots=True)
class PositionedLine:
    text: str
    x: int
    center_x: int
    y: int
    words: list[PositionedWord]


@dataclass(slots=True)
class SubtitleBlock:
    start: float
    end: float
    lines: list[PositionedLine]


_ENDING_PUNCTUATION = re.compile(r"[.!?;:]$")


def _load_font(font_name: str, font_size: int, fonts_dir: Path):
    font_path = resolve_font_path(font_name, fonts_dir)
    if font_path is not None:
        return ImageFont.truetype(str(font_path), size=font_size)
    return ImageFont.load_default()


def _text_width(font, text: str) -> int:
    left, _, right, _ = font.getbbox(text)
    return max(0, right - left)


def _text_advance(font, text: str) -> int:
    """Advance width — how far the cursor moves after rendering `text`.
    libass uses advance width internally, so all cursor / line-width
    calculations must use this to avoid per-word drift."""
    return max(0, int(round(font.getlength(text))))


def _line_height_ink(font) -> int:
    """Tight visual (ink) height — used for the PITCH between consecutive lines.
    This matches the visual gap the user sees between rendered glyphs."""
    _, top, _, bottom = font.getbbox("Hg")
    return max(1, bottom - top)


def _line_height_design(font) -> int:
    """Full font design-space height (ascent + descent) — used to compute the
    TOTAL BLOCK HEIGHT for safe-area positioning.
    libass anchors \\an8 at the top of the design ascent, so the block occupies
    design_height per line; using ink height underestimates this and pushes the
    last line outside the safe area for 3+ line blocks."""
    ascent, descent = font.getmetrics()
    return max(1, ascent + descent)


def _should_split_block(prev_word: WordTimestamp, next_word: WordTimestamp, max_duration: float, pause_threshold: float, current_start: float) -> bool:
    # Always split on SRT caption boundaries (caption_index > 0 means it was set by the parser)
    if next_word.caption_index > 0 and next_word.caption_index != prev_word.caption_index:
        return True
    gap = next_word.start - prev_word.end
    duration = next_word.end - current_start
    return (
        gap > pause_threshold
        or _ENDING_PUNCTUATION.search(prev_word.word) is not None
        or duration > max_duration
    )


def _split_blocks(words: list[WordTimestamp], config: RenderConfig) -> list[list[WordTimestamp]]:
    if not words:
        return []

    blocks: list[list[WordTimestamp]] = []
    current_block: list[WordTimestamp] = [words[0]]
    current_start = words[0].start

    for word in words[1:]:
        prev = current_block[-1]
        if _should_split_block(
            prev_word=prev,
            next_word=word,
            max_duration=config.block_rules.max_duration,
            pause_threshold=config.block_rules.pause_threshold,
            current_start=current_start,
        ):
            blocks.append(current_block)
            current_block = [word]
            current_start = word.start
            continue
        current_block.append(word)

    if current_block:
        blocks.append(current_block)
    return blocks


def _wrap_segment(
    segment: list[WordTimestamp],
    max_text_width: int,
    max_lines: int,
    measure_line_width,
) -> tuple[list[list[WordTimestamp]], int]:
    lines: list[list[WordTimestamp]] = []
    current: list[WordTimestamp] = []
    consumed = 0

    for index, word in enumerate(segment):
        probe_words = current + [word]
        if current and measure_line_width(probe_words) > max_text_width:
            lines.append(current)
            if len(lines) >= max_lines:
                break
            current = [word]
            consumed = index + 1
            continue

        current = probe_words
        consumed = index + 1

    if current and len(lines) < max_lines:
        lines.append(current)

    return lines, consumed


def _wrap_into_blocks(
    block_words: list[WordTimestamp],
    max_text_width: int,
    max_lines: int,
    measure_line_width,
) -> list[list[list[WordTimestamp]]]:
    chunks: list[list[list[WordTimestamp]]] = []
    cursor = 0
    total = len(block_words)
    while cursor < total:
        lines, consumed = _wrap_segment(
            segment=block_words[cursor:],
            max_text_width=max_text_width,
            max_lines=max_lines,
            measure_line_width=measure_line_width,
        )
        if consumed == 0:
            consumed = 1
            lines = [[block_words[cursor]]]
        chunks.append(lines)
        cursor += consumed
    return chunks


def build_layout(
    words: list[WordTimestamp],
    video_info: VideoInfo,
    config: RenderConfig,
    fonts_dir: str | Path,
) -> list[SubtitleBlock]:
    fonts_dir = Path(fonts_dir)
    sorted_words = sorted(words, key=lambda item: item.start)

    base_font_size = max(10, int(video_info.height * config.base_style.size_ratio))
    base_font = _load_font(config.base_style.font, base_font_size, fonts_dir)

    safe_left = int(video_info.width * config.layout.safe_area.left)
    safe_right = int(video_info.width * config.layout.safe_area.right)
    safe_top = int(video_info.height * config.layout.safe_area.top)
    safe_bottom = int(video_info.height * config.layout.safe_area.bottom)
    usable_width = video_info.width - safe_left - safe_right
    max_text_width = max(120, min(usable_width, int(video_info.width * config.layout.max_width_ratio)))

    # ── Font metrics ──────────────────────────────────────────────────────────
    _, bbox_top, _, bbox_bottom = base_font.getbbox("Hg")
    ink_height = bbox_bottom - bbox_top       # visible height of one base line
    line_gap   = int(math.ceil(ink_height * config.layout.line_gap_ratio))
    line_height = ink_height

    # Case transform for accurate width measurement
    def _make_transform(tt: str):
        if tt == 'upper':  return str.upper
        if tt == 'lower':  return str.lower
        if tt == 'title':  return str.title
        return lambda s: s  # noqa: E731
    base_transform = _make_transform(config.base_style.text_transform)
    hl_transform = _make_transform(config.highlight_style.text_transform)
    hl2_transform = _make_transform(config.highlight_style2.text_transform) if config.highlight_style2 else base_transform

    hl_font = _load_font(
        config.highlight_style.font,
        max(10, int(video_info.height * config.highlight_style.size_ratio)),
        fonts_dir,
    )
    hl2_font = None
    if config.highlight_style2 is not None:
        hl2_font = _load_font(
            config.highlight_style2.font,
            max(10, int(video_info.height * config.highlight_style2.size_ratio)),
            fonts_dir,
        )

    # Baseline correction: \an7 anchors TOP of design space at Y.
    # Different font sizes have different ascents — align all baselines to base.
    base_ascent, base_descent = base_font.getmetrics()
    hl_ascent,   hl_descent   = hl_font.getmetrics()
    hl2_ascent   = hl2_font.getmetrics()[0] if hl2_font is not None else base_ascent
    hl2_descent  = hl2_font.getmetrics()[1] if hl2_font is not None else base_descent

    # y_offset for each font: how many pixels to ADD to line_y so the baseline aligns.
    hl_y_offset  = base_ascent - hl_ascent
    hl2_y_offset = base_ascent - hl2_ascent

    # Ink descent below the shared baseline (baseline = line_y + base_ascent).
    # ink_descent = getbbox("Hg")[3] − ascent  (tight, no internal leading).
    # Using design-space `getmetrics()` descent would bake in font internal leading
    # as a fixed invisible floor, making line_gap_ratio have no visual effect at 0.
    base_ink_descent = base_font.getbbox("Hg")[3] - base_ascent
    hl_ink_descent   = hl_font.getbbox("Hg")[3] - hl_ascent
    hl2_ink_descent  = (hl2_font.getbbox("Hg")[3] - hl2_ascent) if hl2_font is not None else base_ink_descent

    # (kept for reference — no longer used for per-line spacing)
    max_bottom = base_ascent + base_descent
    pitch = max_bottom + line_gap

    keywords = {re.sub(r"[^\wÀ-ÿ]", "", item.lower()) for item in config.highlight.keywords if item.strip()}

    def _highlight_group(word: WordTimestamp) -> int | None:
        if getattr(word, 'highlight', False):
            return int(getattr(word, 'highlight_group', 0))
        cleaned = re.sub(r"[^\wÀ-ÿ]", "", word.word.lower())
        if cleaned in keywords:
            return 0
        return None

    def _word_render_info(word: WordTimestamp):
        group = _highlight_group(word)
        if group is not None:
            if group >= 1 and hl2_font is not None:
                return hl2_font, hl2_transform, group
            return hl_font, hl_transform, group
        return base_font, base_transform, None

    space_w = _text_advance(base_font, " ")

    # Baseline correction for per-word \an7 positioning.
    # \an7 anchors the TOP of the font's design space at Y. Fonts of different
    # sizes have different ascents, so without correction a highlight word (larger
    # font, smaller ascent ratio) would appear with its baseline higher than base.
    # Adding (base_ascent - font_ascent) to each word's Y aligns all baselines.

    def _word_y_offset(word: WordTimestamp) -> int:
        group = _highlight_group(word)
        if group is not None:
            return hl2_y_offset if (group >= 1 and hl2_font is not None) else hl_y_offset
        return 0

    def _measure_line_width(words_on_line: list[WordTimestamp]) -> int:
        """Measure line width using base font advance width for all words.
        Using the actual per-word highlight font here causes highlight words
        (larger font) to trigger earlier line-breaks, leaving orphan words.
        Base-font measurement restores the previous stable wrapping behaviour."""
        if not words_on_line:
            return 0
        total = 0
        for idx, item in enumerate(words_on_line):
            total += _text_advance(base_font, base_transform(item.word))
            if idx + 1 < len(words_on_line):
                total += space_w
        return total

    blocks: list[SubtitleBlock] = []

    for raw_block in _split_blocks(sorted_words, config=config):
        wrapped_chunks = _wrap_into_blocks(
            block_words=raw_block,
            max_text_width=max_text_width,
            max_lines=config.layout.max_lines,
            measure_line_width=_measure_line_width,
        )
        for line_word_groups in wrapped_chunks:
            line_texts = [" ".join(_word_render_info(item)[1](item.word) for item in line_words) for line_words in line_word_groups]
            n = len(line_word_groups)

            # Per-line max ink descent below the shared baseline.
            # All fonts align to baseline = line_y + base_ascent (via _word_y_offset).
            # Visual bottom of a line = line_y + base_ascent + max_ink_desc.
            # y_cursor += base_ascent + max_ink_desc + line_gap
            # → visual gap (ink bottom ↔ next ink top) = line_gap exactly, always.
            line_max_ink_desc: list[int] = []
            for _lw in line_word_groups:
                mid = base_ink_descent
                for _w in _lw:
                    _g = _highlight_group(_w)
                    if _g is not None:
                        if _g >= 1 and hl2_font is not None:
                            mid = max(mid, hl2_ink_descent)
                        else:
                            mid = max(mid, hl_ink_descent)
                line_max_ink_desc.append(mid)

            total_h = n * base_ascent + sum(line_max_ink_desc) + max(0, n - 1) * line_gap
            vertical_shift = int(video_info.height * config.layout.vertical_offset)

            if config.layout.anchor == "top":
                start_y = safe_top
            elif config.layout.anchor == "center":
                start_y = int((video_info.height - total_h) / 2)
                start_y = max(start_y, safe_top)
                start_y = min(start_y, video_info.height - safe_bottom - total_h)
            else:  # bottom
                start_y = video_info.height - safe_bottom - total_h
            start_y += vertical_shift

            line_objects: list[PositionedLine] = []
            y_cursor = start_y

            for line_index, (line_words, max_ink_desc) in enumerate(zip(line_word_groups, line_max_ink_desc)):
                line_text = line_texts[line_index]
                line_y = y_cursor
                y_cursor += base_ascent + max_ink_desc + line_gap

                # Line width uses actual per-word advance widths (same as libass).
                actual_line_width = (
                    sum(_text_advance(_word_render_info(w)[0], _word_render_info(w)[1](w.word)) for w in line_words)
                    + space_w * max(0, len(line_words) - 1)
                )
                line_x = safe_left + int((usable_width - actual_line_width) / 2)

                cursor_x = line_x
                word_positions: list[PositionedWord] = []
                for word in line_words:
                    font_obj, transform_fn, _ = _word_render_info(word)
                    word_adv = _text_advance(font_obj, transform_fn(word.word))
                    word_positions.append(
                        PositionedWord(
                            word=word.word,
                            start=word.start,
                            end=word.end,
                            x=cursor_x,
                            center_x=cursor_x + word_adv // 2,
                            y=line_y + _word_y_offset(word),
                            highlight=word.highlight,
                            highlight_group=getattr(word, 'highlight_group', 0),
                        )
                    )
                    cursor_x += word_adv + space_w

                line_objects.append(
                    PositionedLine(
                        text=line_text,
                        x=line_x,
                        center_x=line_x + int(actual_line_width / 2),
                        y=line_y,
                        words=word_positions,
                    )
                )

            block_start = min(line.words[0].start for line in line_objects if line.words)
            block_end = max(line.words[-1].end for line in line_objects if line.words)
            blocks.append(SubtitleBlock(start=block_start, end=block_end, lines=line_objects))

    return blocks
