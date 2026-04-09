from __future__ import annotations

import mimetypes
import shutil
from pathlib import Path

import httpx


SUPPORTED_CAPTION_FONT_EXTENSIONS = {".ttf", ".otf"}
CONTENT_TYPE_EXTENSION_MAP = {
    "font/ttf": ".ttf",
    "font/otf": ".otf",
    "application/x-font-ttf": ".ttf",
    "application/x-font-opentype": ".otf",
}


def _infer_extension(url: str, original_name: str | None) -> str:
    for candidate in (original_name or "", url.split("?")[0]):
        suffix = Path(candidate).suffix.lower()
        if suffix in SUPPORTED_CAPTION_FONT_EXTENSIONS:
          return suffix
    guessed, _ = mimetypes.guess_type(original_name or url)
    return CONTENT_TYPE_EXTENSION_MAP.get((guessed or "").lower(), "")


def prepare_runtime_fonts(
    base_fonts_dir: str | Path,
    work_dir: str | Path,
    font_assets: list[dict] | None,
) -> Path:
    base_fonts_dir = Path(base_fonts_dir)
    runtime_fonts_dir = Path(work_dir) / "runtime_fonts"
    runtime_fonts_dir.mkdir(parents=True, exist_ok=True)

    for pattern in ("*.ttf", "*.otf"):
        for source in base_fonts_dir.glob(pattern):
            target = runtime_fonts_dir / source.name
            if not target.exists():
                shutil.copy2(source, target)

    if not font_assets:
        return runtime_fonts_dir

    for asset in font_assets:
        if not isinstance(asset, dict):
            continue
        url = str(asset.get("url") or "").strip()
        family = str(asset.get("family") or "").strip() or "font"
        original_name = asset.get("originalName")
        if not url:
            continue

        suffix = _infer_extension(url, str(original_name) if original_name else None)
        if suffix not in SUPPORTED_CAPTION_FONT_EXTENSIONS:
            continue

        safe_family = "".join(char if char.isalnum() else "_" for char in family).strip("_") or "font"
        target = runtime_fonts_dir / f"{safe_family}{suffix}"
        if target.exists():
            continue

        with httpx.stream("GET", url, follow_redirects=True, timeout=60) as response:
            response.raise_for_status()
            with open(target, "wb") as output:
                for chunk in response.iter_bytes(chunk_size=65536):
                    output.write(chunk)

    return runtime_fonts_dir