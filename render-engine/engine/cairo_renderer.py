from __future__ import annotations

import math
import os
import shutil
import subprocess
from contextlib import contextmanager
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Callable
from xml.sax.saxutils import escape as xml_escape

from PIL import Image, ImageFilter, ImageFont
from engine.ass_writer import _apply_transform, _hl_style_for_group, _hl_style_with_shadow, _should_highlight
from engine.fonts import resolve_font_path
from engine.layout import SubtitleBlock, build_layout
from engine.models import RenderConfig, StyleConfig, WordTimestamp
from engine.probe import VideoInfo
from engine.render import burn_overlay_video, burn_png_overlays, encode_concat_overlay_video, render_overlay_preview_frame


class CairoRendererNotReadyError(RuntimeError):
    pass


APPEAR_FADE_SECONDS = 0.06
VISIBLE_ALPHA_THRESHOLD = 24
REFERENCE_PROBE_TEXTS = ("Hg", "Agjpqy", "Egjpqy")
_PANGO_WEIGHT_ORDER = (
    "THIN",
    "ULTRALIGHT",
    "LIGHT",
    "SEMILIGHT",
    "BOOK",
    "NORMAL",
    "MEDIUM",
    "SEMIBOLD",
    "BOLD",
    "ULTRABOLD",
    "HEAVY",
    "ULTRAHEAVY",
)
_PANGO_WEIGHT_RANK = {name: index for index, name in enumerate(_PANGO_WEIGHT_ORDER)}


@dataclass(slots=True)
class OverlayAsset:
    path: Path
    start: float
    end: float
    fade_in: float = 0.0


@dataclass(slots=True)
class PositionedWordSpec:
    spec: WordLayoutSpec
    draw_x: float
    baseline_y: float
    start: float
    end: float


@dataclass(slots=True)
class BlockLayoutSpec:
    block: SubtitleBlock
    words: list[PositionedWordSpec]


@dataclass(slots=True)
class WordLayoutSpec:
    layout: object
    text: str
    style: StyleConfig
    advance: float
    baseline: float
    ink_x: float
    ink_y: float
    ink_width: float
    ink_height: float
    paint_left: float
    paint_top: float
    paint_right: float
    paint_bottom: float
    effect_masks: dict[tuple[str, int, int, int, int], EffectMaskAsset] = field(default_factory=dict)

    @property
    def top_from_baseline(self) -> float:
        return self.ink_y - self.baseline

    @property
    def bottom_from_baseline(self) -> float:
        return self.ink_y + self.ink_height - self.baseline


@dataclass(slots=True)
class EffectMaskAsset:
    alpha_mask: Image.Image
    left: int
    top: int


def _not_ready_message(reason: str | None = None) -> str:
    base = "The Cairo captions engine is not ready for this render path yet."
    return f"{base} {reason}" if reason else base


def _ensure_supported(config: RenderConfig) -> None:
    if config.animation.preset not in {"none", "appear"}:
        raise CairoRendererNotReadyError(
            _not_ready_message("Only the captions presets 'none' and 'appear' are implemented on the Cairo path for now.")
        )


def _font_size_px(style: StyleConfig, video_info: VideoInfo) -> int:
    return max(10, int(video_info.height * style.size_ratio))


def _hex_to_rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = hex_color.strip().lstrip("#")
    if len(value) != 6:
        value = "FFFFFF"
    r = int(value[0:2], 16) / 255.0
    g = int(value[2:4], 16) / 255.0
    b = int(value[4:6], 16) / 255.0
    return r, g, b, max(0.0, min(1.0, alpha))


def _hex_to_rgb8(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.strip().lstrip("#")
    if len(value) != 6:
        value = "FFFFFF"
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def _style_for_word(word, config: RenderConfig) -> StyleConfig:
    hl_group = _should_highlight(word, config)
    if hl_group is not None:
        _, hl_style = _hl_style_for_group(hl_group, config)
        return _hl_style_with_shadow(hl_style, config.base_style)
    return config.base_style


def _transformed_word(word, config: RenderConfig) -> tuple[str, StyleConfig]:
    style = _style_for_word(word, config)
    return _apply_transform(word.word, style.text_transform), style


def _shadow_offset(style: StyleConfig) -> tuple[float, float]:
    radians = math.radians(style.shadow_angle)
    return style.shadow * math.cos(radians), style.shadow * math.sin(radians)


def _soft_offsets(radius: float) -> list[tuple[float, float, float]]:
    if radius <= 0.01:
        return [(0.0, 0.0, 1.0)]

    clamped = min(16.0, float(radius))
    rings = max(1, int(round(clamped)))
    samples: list[tuple[float, float, float]] = [(0.0, 0.0, 1.0)]
    for ring in range(1, rings + 1):
        ring_radius = clamped * ring / rings
        # Too many taps dilute alpha below the visible threshold on ARGB32
        # surfaces, which makes blur/glow disappear entirely after quantization.
        ring_samples = max(8, min(24, int(round(6 + ring_radius * 1.4))))
        ring_weight = max(0.12, 1.0 - (ring / (rings + 1)))
        for index in range(ring_samples):
            angle = 2.0 * math.pi * index / ring_samples
            samples.append((math.cos(angle) * ring_radius, math.sin(angle) * ring_radius, ring_weight))

    total = sum(weight for _, _, weight in samples) or 1.0
    return [(dx, dy, weight / total) for dx, dy, weight in samples]


def _effect_bounds(spec: WordLayoutSpec) -> tuple[float, float, float, float]:
    return spec.paint_left, spec.paint_top, spec.paint_right, spec.paint_bottom


def _approx_effect_bounds(spec: WordLayoutSpec) -> tuple[float, float, float, float]:
    fill_left = spec.ink_x
    fill_right = max(spec.advance, spec.ink_x + spec.ink_width)
    fill_top = spec.top_from_baseline
    fill_bottom = spec.bottom_from_baseline

    spread = max(spec.style.outline, spec.style.glow_intensity * 3.6)
    left = fill_left - spread
    right = fill_right + spread
    top = fill_top - spread
    bottom = fill_bottom + spread

    shadow_dx, shadow_dy = _shadow_offset(spec.style)
    shadow_spread = max(0.0, spec.style.shadow_blur * 3.4)
    if spec.style.shadow > 0 or shadow_spread > 0:
        left = min(left, fill_left + shadow_dx - shadow_spread)
        right = max(right, fill_right + shadow_dx + shadow_spread)
        top = min(top, fill_top + shadow_dy - shadow_spread)
        bottom = max(bottom, fill_bottom + shadow_dy + shadow_spread)

    return left, top, right, bottom


def _alpha_bounds(surface, threshold: int = VISIBLE_ALPHA_THRESHOLD) -> tuple[int, int, int, int] | None:
    surface.flush()
    width = surface.get_width()
    height = surface.get_height()
    stride = surface.get_stride()
    data = surface.get_data()

    min_x = width
    min_y = height
    max_x = -1
    max_y = -1

    for y in range(height):
        row = y * stride
        for x in range(width):
            alpha = data[row + x * 4 + 3]
            if not isinstance(alpha, int):
                alpha = alpha[0]
            if alpha < threshold:
                continue
            if x < min_x:
                min_x = x
            if y < min_y:
                min_y = y
            if x > max_x:
                max_x = x
            if y > max_y:
                max_y = y

    if max_x < min_x or max_y < min_y:
        return None
    return min_x, min_y, max_x + 1, max_y + 1


def _animation_frame_rate(video_info: VideoInfo) -> float:
    fps = float(video_info.fps or 25.0)
    if fps <= 0.0:
        fps = 25.0
    return max(12.0, min(30.0, fps))


def _parse_font_face_style(style_name: str) -> tuple[bool, str | None]:
    normalized = " ".join(style_name.replace("-", " ").replace("_", " ").strip().lower().split())
    if not normalized:
        return False, None

    italic = "italic" in normalized or "oblique" in normalized
    if "ultra heavy" in normalized or "ultraheavy" in normalized:
        return italic, "ULTRAHEAVY"
    if "extra bold" in normalized or "extrabold" in normalized or "ultra bold" in normalized or "ultrabold" in normalized:
        return italic, "ULTRABOLD"
    if "semi bold" in normalized or "semibold" in normalized:
        return italic, "SEMIBOLD"
    if "black" in normalized or "heavy" in normalized:
        return italic, "HEAVY"
    if "medium" in normalized:
        return italic, "MEDIUM"
    if "semi light" in normalized or "semilight" in normalized:
        return italic, "SEMILIGHT"
    if "ultra light" in normalized or "ultralight" in normalized:
        return italic, "ULTRALIGHT"
    if "light" in normalized:
        return italic, "LIGHT"
    if "book" in normalized:
        return italic, "BOOK"
    if "bold" in normalized:
        return italic, "BOLD"
    if "thin" in normalized:
        return italic, "THIN"
    if "regular" in normalized:
        return italic, "NORMAL"
    return italic, None


@lru_cache(maxsize=256)
def _resolved_font_metadata(font_name: str, fonts_dir: str) -> tuple[str, bool, str | None]:
    requested_name = font_name.strip() or "Sans"
    resolved_path = resolve_font_path(requested_name, Path(fonts_dir))
    if resolved_path is None:
        parsed_italic, parsed_weight = _parse_font_face_style(requested_name)
        return requested_name, parsed_italic, parsed_weight

    try:
        family, face_style = ImageFont.truetype(str(resolved_path), size=24).getname()
    except Exception:
        parsed_italic, parsed_weight = _parse_font_face_style(requested_name)
        fallback_family = resolved_path.stem.strip() or requested_name
        return fallback_family, parsed_italic, parsed_weight

    parsed_italic, parsed_weight = _parse_font_face_style(face_style or "")
    return family.strip() or requested_name, parsed_italic, parsed_weight


def _merged_pango_weight(style: StyleConfig, metadata_weight: str | None) -> str:
    requested_weight = "BOLD" if style.bold else "NORMAL"
    if metadata_weight is None:
        return requested_weight

    metadata_rank = _PANGO_WEIGHT_RANK.get(metadata_weight, _PANGO_WEIGHT_RANK["NORMAL"])
    requested_rank = _PANGO_WEIGHT_RANK.get(requested_weight, _PANGO_WEIGHT_RANK["NORMAL"])
    return metadata_weight if metadata_rank >= requested_rank else requested_weight


def _resolve_pango_font_request(style: StyleConfig, fonts_dir: str | Path) -> tuple[str, bool, str]:
    family, metadata_italic, metadata_weight = _resolved_font_metadata(style.font, str(Path(fonts_dir).resolve()))
    return family, style.italic or metadata_italic, _merged_pango_weight(style, metadata_weight)


def _append_frame_asset(frames: list[tuple[Path, float]], path: Path, duration: float) -> None:
    if duration <= 0.0:
        return
    if frames and frames[-1][0] == path:
        last_path, last_duration = frames[-1]
        frames[-1] = (last_path, last_duration + duration)
        return
    frames.append((path, duration))


def _measure_painted_bounds(spec: WordLayoutSpec, cairo, pangocairocffi) -> tuple[float, float, float, float]:
    left, top, right, bottom = _approx_effect_bounds(spec)
    shadow_dx, shadow_dy = _shadow_offset(spec.style)
    pad = max(
        8.0,
        spec.style.outline * 4.0,
        spec.style.glow_intensity * 8.0,
        abs(shadow_dx) + spec.style.shadow_blur * 5.0 + 6.0,
        abs(shadow_dy) + spec.style.shadow_blur * 5.0 + 6.0,
    )
    width = max(8, int(math.ceil((right - left) + pad * 2.0)))
    height = max(8, int(math.ceil((bottom - top) + pad * 2.0)))

    draw_x = pad - left
    baseline_y = pad - top

    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
    context = cairo.Context(surface)
    context.set_antialias(cairo.ANTIALIAS_BEST)
    _draw_word(context, spec, draw_x, baseline_y, cairo, pangocairocffi)

    measured = _alpha_bounds(surface)
    if measured is None:
        return left, top, right, bottom

    min_x, min_y, max_x, max_y = measured
    return min_x - draw_x, min_y - baseline_y, max_x - draw_x, max_y - baseline_y


@contextmanager
def _fontconfig_env(fonts_dir: str | Path):
    fonts_dir = Path(fonts_dir).resolve()
    cache_dir = fonts_dir / ".fontconfig-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    config_path = fonts_dir / ".fontconfig-cairo.conf"

    default_config = Path("/etc/fonts/fonts.conf")
    include_line = ""
    if default_config.exists():
        include_line = f'<include ignore_missing="yes">{xml_escape(str(default_config))}</include>'

    config_path.write_text(
        "\n".join(
            [
                '<?xml version="1.0"?>',
                '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
                '<fontconfig>',
                include_line,
                f'  <dir>{xml_escape(str(fonts_dir))}</dir>',
                f'  <cachedir>{xml_escape(str(cache_dir))}</cachedir>',
                '</fontconfig>',
            ]
        ),
        encoding="utf-8",
    )

    previous = {
        "FONTCONFIG_FILE": os.environ.get("FONTCONFIG_FILE"),
        "PANGOCAIRO_BACKEND": os.environ.get("PANGOCAIRO_BACKEND"),
    }
    os.environ["FONTCONFIG_FILE"] = str(config_path)
    os.environ.setdefault("PANGOCAIRO_BACKEND", "fc")

    fc_cache = shutil.which("fc-cache")
    if fc_cache:
        subprocess.run([fc_cache, "-f", str(fonts_dir)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _import_cairo_stack():
    try:
        import cairocffi as cairo  # type: ignore[import-not-found]
        import pangocffi  # type: ignore[import-not-found]
        import pangocairocffi  # type: ignore[import-not-found]
    except (ImportError, OSError) as exc:
        raise CairoRendererNotReadyError(
            _not_ready_message("Install cairocffi, pangocffi and pangocairocffi, plus the native cairo/pango/fontconfig libraries.")
        ) from exc
    return cairo, pangocffi, pangocairocffi


def _make_layout(
    context,
    text: str,
    style: StyleConfig,
    font_size: int,
    fonts_dir: str | Path,
    pangocffi,
    pangocairocffi,
) -> object:
    layout = pangocairocffi.create_layout(context)
    font_desc = pangocffi.FontDescription()
    family, italic, weight_name = _resolve_pango_font_request(style, fonts_dir)
    font_desc.family = family
    font_desc.style = pangocffi.Style.ITALIC if italic else pangocffi.Style.NORMAL
    font_desc.weight = getattr(
        pangocffi.Weight,
        weight_name,
        pangocffi.Weight.BOLD if style.bold else pangocffi.Weight.NORMAL,
    )
    font_desc.set_absolute_size(pangocffi.units_from_double(font_size))
    layout.font_description = font_desc
    layout.text = text
    return layout


def _measure_word(
    context,
    word: str,
    style: StyleConfig,
    video_info: VideoInfo,
    fonts_dir: str | Path,
    cache: dict[tuple[str, str, int, bool, bool], WordLayoutSpec],
    cairo,
    pangocffi,
    pangocairocffi,
) -> WordLayoutSpec:
    font_size = _font_size_px(style, video_info)
    key = (word, style.font, font_size, style.bold, style.italic)
    cached = cache.get(key)
    if cached is not None:
        return cached

    layout = _make_layout(context, word, style, font_size, fonts_dir, pangocffi, pangocairocffi)
    ink_rect, logical_rect = layout.get_extents()
    spec = WordLayoutSpec(
        layout=layout,
        text=word,
        style=style,
        advance=pangocffi.units_to_double(logical_rect.width),
        baseline=pangocffi.units_to_double(layout.get_baseline()),
        ink_x=pangocffi.units_to_double(ink_rect.x),
        ink_y=pangocffi.units_to_double(ink_rect.y),
        ink_width=pangocffi.units_to_double(ink_rect.width),
        ink_height=pangocffi.units_to_double(ink_rect.height),
        paint_left=0.0,
        paint_top=0.0,
        paint_right=0.0,
        paint_bottom=0.0,
    )
    spec.paint_left, spec.paint_top, spec.paint_right, spec.paint_bottom = _measure_painted_bounds(spec, cairo, pangocairocffi)
    cache[key] = spec
    return spec


def _draw_layout_fill(context, layout, x: float, y: float, rgba: tuple[float, float, float, float], pangocairocffi) -> None:
    context.save()
    pangocairocffi.update_layout(context, layout)
    context.set_source_rgba(*rgba)
    context.move_to(x, y)
    pangocairocffi.show_layout(context, layout)
    context.restore()


def _draw_layout_outline(
    context,
    layout,
    x: float,
    y: float,
    color: str,
    width: float,
    alpha: float,
    cairo,
    pangocairocffi,
) -> None:
    if width <= 0.0 or alpha <= 0.0:
        return
    context.save()
    pangocairocffi.update_layout(context, layout)
    context.new_path()
    context.move_to(x, y)
    pangocairocffi.layout_path(context, layout)
    context.set_line_join(cairo.LINE_JOIN_ROUND)
    context.set_line_cap(cairo.LINE_CAP_ROUND)
    context.set_line_width(max(0.5, width * 2.0))
    context.set_source_rgba(*_hex_to_rgba(color, alpha))
    context.stroke()
    context.restore()


def _draw_soft_layout(
    context,
    layout,
    x: float,
    y: float,
    color: str,
    alpha: float,
    radius: float,
    base_dx: float,
    base_dy: float,
    strength: float,
    pangocairocffi,
) -> None:
    rgba = _hex_to_rgba(color, alpha)
    for dx, dy, weight in _soft_offsets(radius):
        _draw_layout_fill(
            context,
            layout,
            x + base_dx + dx,
            y + base_dy + dy,
            (rgba[0], rgba[1], rgba[2], min(1.0, rgba[3] * weight * strength)),
            pangocairocffi,
        )


def _mask_cache_key(kind: str, radius: float, dx: float, dy: float, spread: float) -> tuple[str, int, int, int, int]:
    return (
        kind,
        int(round(radius * 10.0)),
        int(round(dx * 10.0)),
        int(round(dy * 10.0)),
        int(round(spread * 10.0)),
    )


def _surface_alpha_to_image(surface) -> Image.Image:
    width = surface.get_width()
    height = surface.get_height()
    stride = surface.get_stride()
    raw = bytes(surface.get_data())
    rgba = Image.frombytes("RGBA", (width, height), raw, "raw", "BGRA", stride, 1)
    return rgba.getchannel("A")


def _pil_rgba_to_cairo_surface(image: Image.Image, cairo) -> tuple[object, bytearray]:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    stride = width * 4
    src = rgba.tobytes()
    data = bytearray(len(src))

    for index in range(0, len(src), 4):
        red = src[index]
        green = src[index + 1]
        blue = src[index + 2]
        alpha = src[index + 3]
        data[index] = (blue * alpha + 127) // 255
        data[index + 1] = (green * alpha + 127) // 255
        data[index + 2] = (red * alpha + 127) // 255
        data[index + 3] = alpha

    surface = cairo.ImageSurface.create_for_data(data, cairo.FORMAT_ARGB32, width, height, stride)
    return surface, data


def _effect_fill_bounds(spec: WordLayoutSpec) -> tuple[float, float, float, float]:
    return (
        min(spec.ink_x, 0.0),
        min(spec.ink_y, 0.0),
        max(spec.advance, spec.ink_x + spec.ink_width),
        max(0.0, spec.ink_y + spec.ink_height),
    )


def _build_effect_mask(
    spec: WordLayoutSpec,
    kind: str,
    radius: float,
    dx: float,
    dy: float,
    spread: float,
    cairo,
    pangocairocffi,
) -> EffectMaskAsset:
    cache_key = _mask_cache_key(kind, radius, dx, dy, spread)
    cached = spec.effect_masks.get(cache_key)
    if cached is not None:
        return cached

    fill_left, fill_top, fill_right, fill_bottom = _effect_fill_bounds(spec)
    pad = max(4.0, radius * 3.2 + spread * 2.0 + 6.0)
    left = int(math.floor(fill_left + min(0.0, dx) - pad))
    top = int(math.floor(fill_top + min(0.0, dy) - pad))
    right = int(math.ceil(fill_right + max(0.0, dx) + pad))
    bottom = int(math.ceil(fill_bottom + max(0.0, dy) + pad))
    width = max(8, right - left)
    height = max(8, bottom - top)

    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
    context = cairo.Context(surface)
    context.set_antialias(cairo.ANTIALIAS_BEST)
    _draw_layout_fill(
        context,
        spec.layout,
        -left + dx,
        -top + dy,
        (1.0, 1.0, 1.0, 1.0),
        pangocairocffi,
    )

    alpha_mask = _surface_alpha_to_image(surface)
    if spread > 0.25:
        expand_size = max(3, int(round(spread * 2.0)) * 2 + 1)
        alpha_mask = alpha_mask.filter(ImageFilter.MaxFilter(expand_size))
    if radius > 0.01:
        alpha_mask = alpha_mask.filter(ImageFilter.GaussianBlur(radius=radius))

    asset = EffectMaskAsset(alpha_mask=alpha_mask, left=left, top=top)
    spec.effect_masks[cache_key] = asset
    return asset


def _draw_blurred_effect(
    context,
    spec: WordLayoutSpec,
    draw_x: float,
    top_left_y: float,
    color: str,
    alpha: float,
    radius: float,
    dx: float,
    dy: float,
    spread: float,
    kind: str,
    cairo,
    pangocairocffi,
) -> None:
    if alpha <= 0.0:
        return

    asset = _build_effect_mask(spec, kind, radius, dx, dy, spread, cairo, pangocairocffi)
    # The blurred mask has a peak well below 255 because Gaussian blur spreads energy.
    # Normalise the mask to a peak of 255 first, then scale by the user's alpha so that
    # shadow_alpha=0.5 really produces 50 % peak opacity instead of ~35 %.
    peak = asset.alpha_mask.getextrema()[1]
    if peak == 0:
        return
    norm = 255.0 * alpha / peak
    scaled_alpha = asset.alpha_mask.point(lambda value: min(255, int(round(value * norm))))
    if scaled_alpha.getbbox() is None:
        return

    red, green, blue = _hex_to_rgb8(color)
    rgba = Image.new("RGBA", asset.alpha_mask.size, (red, green, blue, 0))
    rgba.putalpha(scaled_alpha)
    surface, surface_data = _pil_rgba_to_cairo_surface(rgba, cairo)

    context.save()
    context.set_source_surface(surface, draw_x + asset.left, top_left_y + asset.top)
    context.paint()
    context.restore()

    del surface_data


def _draw_word(
    context,
    spec: WordLayoutSpec,
    draw_x: float,
    baseline_y: float,
    cairo,
    pangocairocffi,
    body_alpha: float = 1.0,
    shadow_alpha: float = 1.0,
) -> None:
    top_left_y = baseline_y - spec.baseline
    shadow_dx, shadow_dy = _shadow_offset(spec.style)
    centered_shadow_blur = abs(shadow_dx) < 0.01 and abs(shadow_dy) < 0.01

    if shadow_alpha > 0.0 and (spec.style.shadow > 0 or spec.style.shadow_blur > 0):
        blur_radius = spec.style.shadow_blur if spec.style.shadow_blur > 0 else 0.0
        if blur_radius > 0.0:
            _draw_blurred_effect(
                context,
                spec,
                draw_x,
                top_left_y,
                spec.style.shadow_color,
                min(1.0, spec.style.shadow_alpha * shadow_alpha * (1.12 if centered_shadow_blur else 1.0)),
                blur_radius * (1.12 if centered_shadow_blur else 1.0),
                shadow_dx,
                shadow_dy,
                0.0,
                "shadow",
                cairo,
                pangocairocffi,
            )
        else:
            _draw_layout_fill(
                context,
                spec.layout,
                draw_x + shadow_dx,
                top_left_y + shadow_dy,
                _hex_to_rgba(spec.style.shadow_color, spec.style.shadow_alpha * shadow_alpha),
                pangocairocffi,
            )

    if body_alpha > 0.0:
        if spec.style.glow_intensity > 0:
            glow_alpha = min(0.72, 0.18 + spec.style.glow_intensity * 0.11) * body_alpha
            _draw_blurred_effect(
                context,
                spec,
                draw_x,
                top_left_y,
                spec.style.glow_color,
                glow_alpha,
                max(1.25, spec.style.glow_intensity * 2.35),
                0.0,
                0.0,
                max(0.0, spec.style.glow_intensity * 0.9),
                "glow",
                cairo,
                pangocairocffi,
            )

        if spec.style.outline > 0:
            _draw_layout_outline(
                context,
                spec.layout,
                draw_x,
                top_left_y,
                spec.style.outline_color,
                spec.style.outline,
                body_alpha,
                cairo,
                pangocairocffi,
            )

        _draw_layout_fill(
            context,
            spec.layout,
            draw_x,
            top_left_y,
            _hex_to_rgba(spec.style.color, body_alpha),
            pangocairocffi,
        )


def _measure_reference_line_box(
    context,
    config: RenderConfig,
    video_info: VideoInfo,
    fonts_dir: str | Path,
    cache: dict[tuple[str, str, int, bool, bool], WordLayoutSpec],
    cairo,
    pangocffi,
    pangocairocffi,
) -> tuple[float, float]:
    reference_top = math.inf
    reference_bottom = -math.inf

    for style in (config.base_style, config.highlight_style, config.highlight_style2):
        if style is None:
            continue
        for probe_text in REFERENCE_PROBE_TEXTS:
            transformed = _apply_transform(probe_text, style.text_transform)
            spec = _measure_word(context, transformed, style, video_info, fonts_dir, cache, cairo, pangocffi, pangocairocffi)
            reference_top = min(reference_top, spec.paint_top)
            reference_bottom = max(reference_bottom, spec.paint_bottom)

    if not math.isfinite(reference_top) or not math.isfinite(reference_bottom) or reference_bottom <= reference_top:
        fallback = _measure_word(context, "Hg", config.base_style, video_info, fonts_dir, cache, cairo, pangocffi, pangocairocffi)
        return fallback.paint_top, fallback.paint_bottom

    return reference_top, reference_bottom


def _anchor_start_y(
    total_h: float,
    config: RenderConfig,
    video_info: VideoInfo,
    safe_top: int,
    safe_bottom: int,
) -> int:
    vertical_shift = int(video_info.height * config.layout.vertical_offset)

    if config.layout.anchor == "top":
        start_y = safe_top
    elif config.layout.anchor == "center":
        start_y = int((video_info.height - total_h) / 2)
        start_y = max(start_y, safe_top)
        start_y = min(start_y, video_info.height - safe_bottom - int(math.ceil(total_h)))
    else:
        start_y = video_info.height - safe_bottom - int(math.ceil(total_h))

    return start_y + vertical_shift


def _stack_painted_gap_lines(
    line_tops: list[float],
    line_bottoms: list[float],
    line_gap: int,
) -> tuple[list[float], float]:
    baselines: list[float] = []
    current_baseline = -line_tops[0]
    baselines.append(current_baseline)
    current_bottom = current_baseline + line_bottoms[0]

    for index in range(1, len(line_tops)):
        current_baseline = current_bottom + line_gap - line_tops[index]
        baselines.append(current_baseline)
        current_bottom = current_baseline + line_bottoms[index]

    return baselines, current_bottom


def _stack_fixed_box_lines(
    line_tops: list[float],
    line_bottoms: list[float],
    reference_top: float,
    reference_bottom: float,
    line_gap: int,
) -> tuple[list[float], float]:
    line_box_height = max(1.0, reference_bottom - reference_top)
    reference_mid = (reference_top + reference_bottom) / 2.0
    step = line_box_height + line_gap
    baselines: list[float] = []

    for index, (line_top, line_bottom) in enumerate(zip(line_tops, line_bottoms)):
        line_mid = (line_top + line_bottom) / 2.0
        box_top = index * step
        baselines.append(box_top + reference_mid - line_mid)

    total_h = len(line_tops) * line_box_height + max(0, len(line_tops) - 1) * line_gap
    return baselines, total_h


def _measure_block_layout(
    block: SubtitleBlock,
    video_info: VideoInfo,
    config: RenderConfig,
    fonts_dir: str | Path,
    context,
    cache: dict[tuple[str, str, int, bool, bool], WordLayoutSpec],
    cairo,
    pangocffi,
    pangocairocffi,
) -> BlockLayoutSpec:
    base_space = _measure_word(context, " ", config.base_style, video_info, fonts_dir, cache, cairo, pangocffi, pangocairocffi)

    safe_left = int(video_info.width * config.layout.safe_area.left)
    safe_right = int(video_info.width * config.layout.safe_area.right)
    safe_top = int(video_info.height * config.layout.safe_area.top)
    safe_bottom = int(video_info.height * config.layout.safe_area.bottom)
    usable_width = video_info.width - safe_left - safe_right

    line_specs: list[list[tuple[object, WordLayoutSpec]]] = []
    line_widths: list[float] = []
    line_tops: list[float] = []
    line_bottoms: list[float] = []

    for line in block.lines:
        words: list[tuple[object, WordLayoutSpec]] = []
        for word in line.words:
            transformed, style = _transformed_word(word, config)
            words.append((word, _measure_word(context, transformed, style, video_info, fonts_dir, cache, cairo, pangocffi, pangocairocffi)))
        if not words:
            continue

        line_specs.append(words)
        line_widths.append(sum(item.advance for _, item in words) + base_space.advance * max(0, len(words) - 1))
        line_tops.append(min(_effect_bounds(item)[1] for _, item in words))
        line_bottoms.append(max(_effect_bounds(item)[3] for _, item in words))

    if not line_specs:
        return BlockLayoutSpec(block=block, words=[])

    if config.layout.line_height_mode == "painted_gap":
        base_probe = _measure_word(context, "Hg", config.base_style, video_info, fonts_dir, cache, cairo, pangocffi, pangocairocffi)
        base_visible_height = max(1.0, base_probe.paint_bottom - base_probe.paint_top)
        line_gap = int(math.ceil(base_visible_height * config.layout.line_gap_ratio))
        baselines, total_h = _stack_painted_gap_lines(line_tops, line_bottoms, line_gap)
    else:
        reference_top, reference_bottom = _measure_reference_line_box(
            context,
            config,
            video_info,
            fonts_dir,
            cache,
            cairo,
            pangocffi,
            pangocairocffi,
        )
        reference_height = max(1.0, reference_bottom - reference_top)
        line_gap = int(math.ceil(reference_height * config.layout.line_gap_ratio))
        baselines, total_h = _stack_fixed_box_lines(
            line_tops,
            line_bottoms,
            reference_top,
            reference_bottom,
            line_gap,
        )

    start_y = _anchor_start_y(total_h, config, video_info, safe_top, safe_bottom)

    positioned_words: list[PositionedWordSpec] = []
    for line_index, words in enumerate(line_specs):
        line_x = safe_left + max(0.0, (usable_width - line_widths[line_index]) / 2.0)
        baseline_y = start_y + baselines[line_index]
        cursor_x = line_x
        for word, word_spec in words:
            positioned_words.append(
                PositionedWordSpec(
                    spec=word_spec,
                    draw_x=cursor_x,
                    baseline_y=baseline_y,
                    start=word.start,
                    end=word.end,
                )
            )
            cursor_x += word_spec.advance + base_space.advance

    return BlockLayoutSpec(block=block, words=positioned_words)


def _render_block_overlay(
    block_spec: BlockLayoutSpec,
    output_path: str | Path,
    video_info: VideoInfo,
    cairo,
    pangocairocffi,
    state_for_word: Callable[[int, PositionedWordSpec], tuple[float, float]],
) -> Path | None:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, video_info.width, video_info.height)
    context = cairo.Context(surface)
    context.set_antialias(cairo.ANTIALIAS_BEST)

    drew_anything = False
    for index, word in enumerate(block_spec.words):
        body_alpha, shadow_alpha = state_for_word(index, word)
        if body_alpha <= 0.0 and shadow_alpha <= 0.0:
            continue
        _draw_word(
            context,
            word.spec,
            word.draw_x,
            word.baseline_y,
            cairo,
            pangocairocffi,
            body_alpha=body_alpha,
            shadow_alpha=shadow_alpha,
        )
        drew_anything = True

    if not drew_anything:
        return None
    surface.write_to_png(str(output_path))
    return output_path


def _render_blank_overlay(output_path: str | Path, video_info: VideoInfo, cairo) -> Path:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, video_info.width, video_info.height)
    surface.write_to_png(str(output_path))
    return output_path


def _build_block_specs(
    words: list[WordTimestamp],
    config: RenderConfig,
    video_info: VideoInfo,
    fonts_dir: str | Path,
    cairo,
    pangocffi,
    pangocairocffi,
) -> list[BlockLayoutSpec]:
    blocks = build_layout(words, video_info=video_info, config=config, fonts_dir=fonts_dir)
    measure_surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, 1, 1)
    measure_context = cairo.Context(measure_surface)
    measure_context.set_antialias(cairo.ANTIALIAS_BEST)
    cache: dict[tuple[str, str, int, bool, bool], WordLayoutSpec] = {}
    return [
        _measure_block_layout(block, video_info, config, fonts_dir, measure_context, cache, cairo, pangocffi, pangocairocffi)
        for block in blocks
    ]


def _build_static_overlays(
    output_dir: str | Path,
    words: list[WordTimestamp],
    config: RenderConfig,
    video_info: VideoInfo,
    fonts_dir: str | Path,
) -> list[OverlayAsset]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with _fontconfig_env(fonts_dir):
        cairo, pangocffi, pangocairocffi = _import_cairo_stack()
        block_specs = _build_block_specs(words, config, video_info, fonts_dir, cairo, pangocffi, pangocairocffi)
        overlays: list[OverlayAsset] = []
        for index, block_spec in enumerate(block_specs):
            overlay_path = output_dir / f"block_{index:04d}.png"
            rendered_path = _render_block_overlay(
                block_spec,
                overlay_path,
                video_info,
                cairo,
                pangocairocffi,
                lambda _index, _word: (1.0, 1.0),
            )
            if rendered_path is not None:
                overlays.append(OverlayAsset(path=rendered_path, start=block_spec.block.start, end=block_spec.block.end))
        return overlays


def _build_appear_overlays(
    output_dir: str | Path,
    words: list[WordTimestamp],
    config: RenderConfig,
    video_info: VideoInfo,
    fonts_dir: str | Path,
) -> list[OverlayAsset]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with _fontconfig_env(fonts_dir):
        cairo, pangocffi, pangocairocffi = _import_cairo_stack()
        block_specs = _build_block_specs(words, config, video_info, fonts_dir, cairo, pangocffi, pangocairocffi)
        overlays: list[OverlayAsset] = []

        for block_index, block_spec in enumerate(block_specs):
            if not block_spec.words:
                continue

            for step_index, step_word in enumerate(block_spec.words):
                step_start = step_word.start
                if step_index + 1 < len(block_spec.words):
                    step_end = block_spec.words[step_index + 1].start
                else:
                    step_end = block_spec.block.end
                step_end = max(step_start, step_end)

                base_path = output_dir / f"block_{block_index:04d}_step_{step_index:04d}_base.png"
                rendered_base = _render_block_overlay(
                    block_spec,
                    base_path,
                    video_info,
                    cairo,
                    pangocairocffi,
                    lambda index, _word, current=step_index: (
                        (1.0, 1.0)
                        if index < current
                        else (0.0, 1.0)
                        if index == current
                        else (0.0, 0.0)
                    ),
                )
                if rendered_base is not None:
                    overlays.append(OverlayAsset(path=rendered_base, start=step_start, end=step_end))

                body_path = output_dir / f"block_{block_index:04d}_step_{step_index:04d}_body.png"
                rendered_body = _render_block_overlay(
                    block_spec,
                    body_path,
                    video_info,
                    cairo,
                    pangocairocffi,
                    lambda index, _word, current=step_index: (1.0, 0.0) if index == current else (0.0, 0.0),
                )
                if rendered_body is not None:
                    overlays.append(
                        OverlayAsset(
                            path=rendered_body,
                            start=step_start,
                            end=step_end,
                            fade_in=min(APPEAR_FADE_SECONDS, max(0.0, step_end - step_start)),
                        )
                    )

        return overlays


def _build_appear_overlay_video(
    output_dir: str | Path,
    words: list[WordTimestamp],
    config: RenderConfig,
    video_info: VideoInfo,
    fonts_dir: str | Path,
    output_video: str | Path,
) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_video = Path(output_video)

    with _fontconfig_env(fonts_dir):
        cairo, pangocffi, pangocairocffi = _import_cairo_stack()
        block_specs = _build_block_specs(words, config, video_info, fonts_dir, cairo, pangocffi, pangocairocffi)
        blank_path = _render_blank_overlay(output_dir / "blank.png", video_info, cairo)
        frames: list[tuple[Path, float]] = []
        current_time = 0.0
        fps = _animation_frame_rate(video_info)

        for block_index, block_spec in enumerate(block_specs):
            if not block_spec.words:
                continue

            if block_spec.block.start > current_time:
                _append_frame_asset(frames, blank_path, block_spec.block.start - current_time)
                current_time = block_spec.block.start

            for step_index, step_word in enumerate(block_spec.words):
                step_start = max(current_time, step_word.start)
                step_end = block_spec.words[step_index + 1].start if step_index + 1 < len(block_spec.words) else block_spec.block.end
                step_end = max(step_start, step_end)
                step_duration = step_end - step_start
                fade_duration = min(APPEAR_FADE_SECONDS, step_duration)
                fade_frames = max(1, int(round(fade_duration * fps))) if fade_duration > 0.0 else 0

                final_frame_path: Path | None = None

                if fade_frames > 0:
                    frame_duration = fade_duration / fade_frames
                    for frame_index in range(1, fade_frames + 1):
                        alpha = frame_index / fade_frames
                        frame_path = output_dir / f"block_{block_index:04d}_step_{step_index:04d}_fade_{frame_index:02d}.png"
                        rendered_path = _render_block_overlay(
                            block_spec,
                            frame_path,
                            video_info,
                            cairo,
                            pangocairocffi,
                            lambda index, _word, current=step_index, progress=alpha: (
                                (1.0, 1.0)
                                if index < current
                                else (progress, 1.0)
                                if index == current
                                else (0.0, 0.0)
                            ),
                        )
                        if rendered_path is not None:
                            final_frame_path = rendered_path
                            _append_frame_asset(frames, rendered_path, frame_duration)

                if final_frame_path is None:
                    frame_path = output_dir / f"block_{block_index:04d}_step_{step_index:04d}_full.png"
                    rendered_path = _render_block_overlay(
                        block_spec,
                        frame_path,
                        video_info,
                        cairo,
                        pangocairocffi,
                        lambda index, _word, current=step_index: (1.0, 1.0) if index <= current else (0.0, 0.0),
                    )
                    if rendered_path is not None:
                        final_frame_path = rendered_path

                hold_duration = step_duration - fade_duration
                if final_frame_path is not None and hold_duration > 0.0:
                    _append_frame_asset(frames, final_frame_path, hold_duration)

                current_time = step_end

        if current_time < video_info.duration:
            _append_frame_asset(frames, blank_path, video_info.duration - current_time)

    return encode_concat_overlay_video(frames, output_video)


def _build_overlays(
    output_dir: str | Path,
    words: list[WordTimestamp],
    config: RenderConfig,
    video_info: VideoInfo,
    fonts_dir: str | Path,
) -> list[OverlayAsset]:
    if config.animation.preset == "appear":
        return _build_appear_overlays(output_dir, words, config, video_info, fonts_dir)
    return _build_static_overlays(output_dir, words, config, video_info, fonts_dir)


def _render_preview_overlay(
    words: list[WordTimestamp],
    config: RenderConfig,
    video_info: VideoInfo,
    fonts_dir: str | Path,
    output_path: str | Path,
    at_seconds: float,
) -> Path | None:
    with _fontconfig_env(fonts_dir):
        cairo, pangocffi, pangocairocffi = _import_cairo_stack()
        block_specs = _build_block_specs(words, config, video_info, fonts_dir, cairo, pangocffi, pangocairocffi)
        active_block = next((block for block in block_specs if block.block.start <= at_seconds <= block.block.end), None)
        if active_block is None:
            return None

        if config.animation.preset == "appear":
            current_index = 0
            for index, word in enumerate(active_block.words):
                if word.start <= at_seconds:
                    current_index = index
                else:
                    break

            fade_progress = 1.0
            current_word = active_block.words[current_index]
            if APPEAR_FADE_SECONDS > 0:
                fade_progress = max(0.0, min(1.0, (at_seconds - current_word.start) / APPEAR_FADE_SECONDS))

            return _render_block_overlay(
                active_block,
                output_path,
                video_info,
                cairo,
                pangocairocffi,
                lambda index, _word, current=current_index, progress=fade_progress: (
                    (1.0, 1.0)
                    if index < current
                    else (progress, 1.0)
                    if index == current
                    else (0.0, 0.0)
                ),
            )

        return _render_block_overlay(
            active_block,
            output_path,
            video_info,
            cairo,
            pangocairocffi,
            lambda _index, _word: (1.0, 1.0),
        )


def render_preview_frame_cairo(
    input_video: str | Path,
    output_image: str | Path,
    words: list[WordTimestamp],
    config: RenderConfig,
    video_info: VideoInfo,
    fonts_dir: str | Path,
    at_seconds: float = 1.0,
) -> Path:
    _ensure_supported(config)

    output_image = Path(output_image)
    overlay_path = output_image.with_name(f"{output_image.stem}.cairo-overlay.png")
    active_overlay = _render_preview_overlay(words, config, video_info, fonts_dir, overlay_path, at_seconds)
    return render_overlay_preview_frame(
        input_video=input_video,
        output_image=output_image,
        at_seconds=at_seconds,
        overlay_image=active_overlay,
    )


def burn_subtitles_cairo(
    input_video: str | Path,
    output_video: str | Path,
    words: list[WordTimestamp],
    config: RenderConfig,
    video_info: VideoInfo,
    fonts_dir: str | Path,
    preview: bool = False,
    preview_seconds: int = 10,
    quality_profile: str = "balanced",
    progress_path: str | Path | None = None,
    video_codec: str | None = None,
    video_codec_args: list[str] | None = None,
    audio_codec: str | None = None,
    audio_codec_args: list[str] | None = None,
) -> Path:
    _ensure_supported(config)

    output_video = Path(output_video)

    if config.animation.preset == "appear":
        overlays_dir = output_video.parent / f"{output_video.stem}.cairo-overlays"
        overlay_video = output_video.parent / f"{output_video.stem}.cairo-appear.mov"
        overlay_asset = _build_appear_overlay_video(
            output_dir=overlays_dir,
            words=words,
            config=config,
            video_info=video_info,
            fonts_dir=fonts_dir,
            output_video=overlay_video,
        )
        return burn_overlay_video(
            input_video=input_video,
            overlay_video=overlay_asset,
            output_video=output_video,
            output_duration=min(video_info.duration, float(preview_seconds)) if preview else video_info.duration,
            preview=preview,
            preview_seconds=preview_seconds,
            quality_profile=quality_profile,
            progress_path=progress_path,
            video_codec=video_codec,
            video_codec_args=video_codec_args,
            audio_codec=audio_codec,
            audio_codec_args=audio_codec_args,
        )

    overlays_dir = output_video.parent / f"{output_video.stem}.cairo-overlays"
    overlays = _build_overlays(
        output_dir=overlays_dir,
        words=words,
        config=config,
        video_info=video_info,
        fonts_dir=fonts_dir,
    )
    overlay_specs = [(item.path, item.start, item.end, item.fade_in) for item in overlays]

    return burn_png_overlays(
        input_video=input_video,
        overlays=overlay_specs,
        output_video=output_video,
        output_duration=min(video_info.duration, float(preview_seconds)) if preview else video_info.duration,
        preview=preview,
        preview_seconds=preview_seconds,
        quality_profile=quality_profile,
        progress_path=progress_path,
        video_codec=video_codec,
        video_codec_args=video_codec_args,
        audio_codec=audio_codec,
        audio_codec_args=audio_codec_args,
    )