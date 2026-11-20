"""Font metrics as libass actually renders them.

libass (like VSFilter) treats the ASS font size as the height
usWinAscent + usWinDescent from the OS/2 table, NOT as the em. A font is
therefore drawn with an em of ``size × unitsPerEm / (winAscent + winDescent)``
pixels — e.g. ÷1.23 for Libre Caslon Text, ÷1.30 for Bebas Neue, ÷1.41 for
Playfair Display. PIL takes the size as the em.

layout.py measures at the PIL scale: it is historical and kept as is so that
line breaks of existing presets do not move. This module is for calculations
that must match the real render (the block background box).

With ``\\an8\\pos(x, y)``, libass places the top of the line box at ``y`` and
the baseline at ``y + ascent``, where ``ascent`` is the largest line ascender
among the fonts of the line (winAscent scaled to the same size).
"""
from __future__ import annotations

import logging
import struct
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from PIL import ImageFont

from .fonts import resolve_font_path

logger = logging.getLogger(__name__)

# Measure at a large size then scale linearly: libass does not hint glyphs, so
# a large measurement scaled down follows its proportions better than
# a measurement at small size (rounded per glyph).
_MEASURE_PX = 1000

# Reference glyphs for the vertical extent of a line: tallest ascenders and
# lowest descenders. Using the font rather than the text keeps the box
# the same height from one block to the next (with or without descenders).
_INK_REFERENCE = "Hdbfhklgjpqy"
# All caps: cap height to baseline. Accents on capitals (É, À) and the tails
# of Q/J go into the margin, so the box stays centred on the caps.
_INK_REFERENCE_UPPER = "H"

# Fallback when the font cannot be read (missing file, unknown table).
_FALLBACK_HEIGHT_PER_EM = 1.25
_FALLBACK_ASCENT_SHARE = 0.8


@lru_cache(maxsize=128)
def font_vertical_metrics(font_path: str) -> tuple[int, int, int] | None:
    """(unitsPerEm, ascent, descent) in font units, by libass's rule
    (``set_font_metrics``): OS/2 usWinAscent/usWinDescent when their sum is
    non-zero, otherwise hhea. ``None`` if the file cannot be read."""
    try:
        data = Path(font_path).read_bytes()
        base = 0
        if data[:4] == b"ttcf":  # collection: first font, as PIL does by default
            base = struct.unpack(">I", data[12:16])[0]
        num_tables = struct.unpack(">H", data[base + 4:base + 6])[0]
        tables: dict[bytes, int] = {}
        for i in range(num_tables):
            rec = base + 12 + 16 * i
            tag, _checksum, offset, _length = struct.unpack(">4sIII", data[rec:rec + 16])
            tables[tag] = offset

        head = tables[b"head"]
        upm = struct.unpack(">H", data[head + 18:head + 20])[0]
        if upm <= 0:
            return None

        os2 = tables.get(b"OS/2")
        if os2 is not None:
            # Read as signed shorts, like libass ((short) cast).
            win_ascent, win_descent = struct.unpack(">hh", data[os2 + 74:os2 + 78])
            if win_ascent + win_descent != 0:
                return upm, win_ascent, win_descent

        hhea = tables.get(b"hhea")
        if hhea is not None:
            ascender, descender = struct.unpack(">hh", data[hhea + 4:hhea + 8])
            if ascender - descender != 0:
                return upm, ascender, -descender
    except (OSError, KeyError, struct.error, IndexError) as exc:
        logger.warning("[libass_metrics] unreadable font metrics %s: %s", font_path, exc)
    return None


@lru_cache(maxsize=32)
def _measure_font(font_path: str):
    return ImageFont.truetype(font_path, size=_MEASURE_PX)


@dataclass(frozen=True)
class LibassFace:
    """One ASS style (font + size + spacing) measured at libass's scale.
    All values are in video pixels (PlayRes = video resolution)."""

    font: object          # PIL font loaded at _MEASURE_PX
    scale: float          # video px per measured px
    ascent: float         # libass line ascender: baseline = pos_y + ascent
    spacing: float        # ASS letter spacing (px added after each glyph)
    text_transform: str   # 'none' | 'upper' | 'lower' | 'title'

    def advance(self, text: str) -> float:
        """Advance width of ``text`` — what libass centres with \\an8."""
        if not text:
            return 0.0
        return self.font.getlength(text) * self.scale + self.spacing * len(text)

    def ink_extent(self) -> tuple[float, float]:
        """(top, bottom) of the reference ink relative to the baseline
        (top < 0 above the baseline, bottom > 0 below)."""
        reference = _INK_REFERENCE_UPPER if self.text_transform == "upper" else _INK_REFERENCE
        try:
            _, top, _, bottom = self.font.getbbox(reference, anchor="ls")
        except (TypeError, ValueError):
            # Non-TrueType fallback font (no anchor support): rough estimate.
            em = self.scale * _MEASURE_PX
            return -0.75 * em, 0.25 * em
        return top * self.scale, bottom * self.scale


def load_libass_face(
    font_name: str,
    ass_size: int,
    fonts_dir: str | Path,
    spacing: float = 0.0,
    text_transform: str = "none",
) -> LibassFace:
    """Measure ``font_name`` at ASS size ``ass_size`` as libass will draw it."""
    font_path = resolve_font_path(font_name, fonts_dir)
    metrics = font_vertical_metrics(str(font_path)) if font_path is not None else None

    if font_path is not None:
        font = _measure_font(str(font_path))
    else:
        # libass will fall back to a font we do not know: approximate measurement.
        logger.warning("[libass_metrics] font not found for measurement: %s", font_name)
        try:
            font = ImageFont.load_default(size=_MEASURE_PX)
        except TypeError:  # Pillow < 10.1
            font = ImageFont.load_default()

    if metrics is not None:
        upm, ascent_units, descent_units = metrics
        height_units = ascent_units + descent_units
        em_px = ass_size * upm / height_units
        ascent_px = ass_size * ascent_units / height_units
    else:
        em_px = ass_size / _FALLBACK_HEIGHT_PER_EM
        ascent_px = ass_size * _FALLBACK_ASCENT_SHARE

    return LibassFace(
        font=font,
        scale=em_px / _MEASURE_PX,
        ascent=ascent_px,
        spacing=spacing,
        text_transform=text_transform,
    )
