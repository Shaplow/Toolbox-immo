from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from PIL import ImageFont


@dataclass(frozen=True, slots=True)
class FontEntry:
    name: str
    path: Path


def normalize_font_name(value: str) -> str:
    cleaned = value.strip().lower()
    cleaned = cleaned.replace("_", " ").replace("-", " ")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def _font_display_name(path: Path) -> str:
    try:
        font = ImageFont.truetype(str(path), size=24)
        family, style = font.getname()
        style = (style or "").strip()
        if style and style.lower() != "regular":
            return f"{family} {style}".strip()
        return family.strip()
    except Exception:
        stem = path.stem.replace("_", " ").replace("-", " ")
        stem = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", stem)
        return re.sub(r"\s+", " ", stem).strip()


def scan_fonts(fonts_dir: str | Path) -> list[FontEntry]:
    fonts_dir = Path(fonts_dir)
    if not fonts_dir.exists():
        return []

    entries: dict[str, FontEntry] = {}
    for pattern in ("*.ttf", "*.otf"):
        for path in sorted(fonts_dir.glob(pattern)):
            name = _font_display_name(path)
            key = normalize_font_name(name)
            entries.setdefault(key, FontEntry(name=name, path=path))
    return sorted(entries.values(), key=lambda item: item.name.lower())


def list_font_names(fonts_dir: str | Path) -> list[str]:
    return [entry.name for entry in scan_fonts(fonts_dir)]


def resolve_font_path(font_name: str, fonts_dir: str | Path) -> Path | None:
    entries = scan_fonts(fonts_dir)
    if not entries:
        return None

    target = normalize_font_name(font_name)

    # Exact match on discovered display names.
    for entry in entries:
        if normalize_font_name(entry.name) == target:
            return entry.path

    # Fallback: compare against file stems.
    for entry in entries:
        stem = normalize_font_name(entry.path.stem)
        if stem == target:
            return entry.path

    # Loose fallback for partial inputs.
    for entry in entries:
        name = normalize_font_name(entry.name)
        if target in name or name in target:
            return entry.path

    return None
