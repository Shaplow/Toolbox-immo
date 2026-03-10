from __future__ import annotations

import re
import math
from pathlib import Path
from typing import Optional

from .layout import SubtitleBlock
from .models import RenderConfig, StyleConfig
from .probe import VideoInfo


def _ass_time(seconds: float) -> str:
    cs_total = int(round(seconds * 100))
    hours = cs_total // 360000
    minutes = (cs_total % 360000) // 6000
    secs = (cs_total % 6000) // 100
    centis = cs_total % 100
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def _to_cs_floor(seconds: float) -> int:
    return max(0, int(math.floor(seconds * 100 + 1e-6)))


def _to_cs_ceil(seconds: float) -> int:
    return max(0, int(math.ceil(seconds * 100 - 1e-6)))


def _ass_time_cs(cs_total: int) -> str:
    cs_total = max(0, int(cs_total))
    hours = cs_total // 360000
    minutes = (cs_total % 360000) // 6000
    secs = (cs_total % 6000) // 100
    centis = cs_total % 100
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def _hex_to_ass_color(hex_color: str) -> str:
    hex_color = hex_color.strip().lstrip("#")
    if len(hex_color) != 6:
        return "&H00FFFFFF"
    r = hex_color[0:2]
    g = hex_color[2:4]
    b = hex_color[4:6]
    return f"&H00{b}{g}{r}"


def _hex_to_ass_tag_color(hex_color: str) -> str:
    hex_color = hex_color.strip().lstrip("#")
    if len(hex_color) != 6:
        return "&HFFFFFF&"
    r = hex_color[0:2]
    g = hex_color[2:4]
    b = hex_color[4:6]
    return f"&H{b}{g}{r}&"


def _hex_to_bgr6(hex_color: str) -> str:
    hex_color = hex_color.strip().lstrip("#")
    if len(hex_color) != 6:
        return "FFFFFF"
    r = hex_color[0:2]
    g = hex_color[2:4]
    b = hex_color[4:6]
    return f"{b}{g}{r}"


def _alpha_to_ass(alpha: float) -> str:
    # ASS alpha: 0x00 = opaque, 0xFF = transparent — inverse of opacity.
    # We accept opacity (0=invisible, 1=fully visible), so invert before converting.
    a = max(0, min(255, int(round((1.0 - alpha) * 255))))
    return f"{a:02X}"


def _escape_ass_text(text: str) -> str:
    text = text.replace("\\", r"\\")
    text = text.replace("{", r"\{")
    text = text.replace("}", r"\}")
    return text


def _clean_keyword(word: str) -> str:
    return re.sub(r"[^\wÀ-ÿ]", "", word.lower())


def _should_highlight(word, config: RenderConfig) -> Optional[int]:
    """Returns highlight group (0-based) if word should be highlighted, else None."""
    if getattr(word, "highlight", False):
        return int(getattr(word, "highlight_group", 0))
    keywords = {_clean_keyword(item) for item in config.highlight.keywords if item.strip()}
    if _clean_keyword(word.word) in keywords:
        return 0
    return None


def _hl_style_for_group(group: int, config: RenderConfig) -> tuple[str, StyleConfig]:
    """Returns (ASS style name, StyleConfig) for the given highlight group."""
    if group >= 1 and config.highlight_style2 is not None:
        return "Highlight2", config.highlight_style2
    return "Highlight", config.highlight_style


def _hl_style_with_shadow(hl_style: StyleConfig, base_style: StyleConfig) -> StyleConfig:
    """Return hl_style, inheriting shadow settings from base_style when the
    highlight style has no shadow of its own (both shadow=0 and shadow_blur=0).
    This ensures diffuse/directional shadows configured on the base always
    appear on highlight words too, without the user needing to duplicate them."""
    if hl_style.shadow == 0 and hl_style.shadow_blur == 0:
        return hl_style.model_copy(update={
            "shadow":       base_style.shadow,
            "shadow_blur":  base_style.shadow_blur,
            "shadow_color": base_style.shadow_color,
            "shadow_alpha": base_style.shadow_alpha,
            "shadow_angle": base_style.shadow_angle,
        })
    return hl_style


def _apply_transform(word: str, text_transform: str) -> str:
    if text_transform == 'upper': return word.upper()
    if text_transform == 'lower': return word.lower()
    if text_transform == 'title': return word.title()
    return word


def _base_words_text(words, config: RenderConfig, layer: int | None = None) -> str:
    """Build the inline ASS text for one line.
    \\r switches style only — never includes \\an as that is a line-level tag
    and repeating it inline causes libass to jump back to the anchor position.
    `layer` is None for single-layer mode, or 0/1 for two-layer rendering."""
    def _eff(style):
        s = _style_for_layer(style, layer) if layer is not None else style
        return _style_effect_tags(s)

    base_effects = _eff(config.base_style)
    parts = []
    for w in words:
        hl_group = _should_highlight(w, config)
        if hl_group is not None:
            style_name, hl_style = _hl_style_for_group(hl_group, config)
            hl_style = _hl_style_with_shadow(hl_style, config.base_style)
            hl_effects = _eff(hl_style)
            text = _apply_transform(w.word, hl_style.text_transform)
            parts.append(
                rf"{{\r{style_name}{hl_effects}}}" + _escape_ass_text(text)
                + rf"{{\r{base_effects}}}"
            )
        else:
            text = _apply_transform(w.word, config.base_style.text_transform)
            parts.append(_escape_ass_text(text))
    return " ".join(parts)


def _base_words_text_appear(words, visible_up_to: int, config: RenderConfig) -> str:
    """Like _base_words_text but future words are fully transparent.
    Invisible words keep their real style so the line-box height is stable on
    every frame — otherwise a highlight word (different font size) would make
    the line jump when it first becomes visible.
    No \\an inside \\r resets — see _base_words_text."""
    base_effects = _style_effect_tags(config.base_style)
    parts = []
    for i, w in enumerate(words):
        hl_group = _should_highlight(w, config)
        if i > visible_up_to:
            if hl_group is not None:
                style_name, hl_style = _hl_style_for_group(hl_group, config)
                hl_style = _hl_style_with_shadow(hl_style, config.base_style)
                hl_effects = _style_effect_tags(hl_style)
                text = _apply_transform(w.word, hl_style.text_transform)
                parts.append(
                    rf"{{\r{style_name}{hl_effects}\1a&HFF&\3a&HFF&\4a&HFF&}}" + _escape_ass_text(text)
                    + rf"{{\r{base_effects}}}"
                )
            else:
                text = _apply_transform(w.word, config.base_style.text_transform)
                parts.append(
                    r"{\1a&HFF&\3a&HFF&\4a&HFF&}" + _escape_ass_text(text)
                    + rf"{{\r{base_effects}}}"
                )
        else:
            if hl_group is not None:
                style_name, hl_style = _hl_style_for_group(hl_group, config)
                hl_style = _hl_style_with_shadow(hl_style, config.base_style)
                hl_effects = _style_effect_tags(hl_style)
                text = _apply_transform(w.word, hl_style.text_transform)
                parts.append(
                    rf"{{\r{style_name}{hl_effects}}}" + _escape_ass_text(text)
                    + rf"{{\r{base_effects}}}"
                )
            else:
                text = _apply_transform(w.word, config.base_style.text_transform)
                parts.append(_escape_ass_text(text))
    return " ".join(parts)


def _needs_two_layers(style) -> bool:
    """True when both glow and shadow_blur are active on the same style.
    Both effects compete for the single ASS border slot (\\bord/\\3c/\\blur),
    so they must be rendered on separate Layer-numbered Dialogue events."""
    has_blur = style.shadow_blur > 0
    return has_blur and (style.glow_intensity > 0 or style.outline > 0)


def _style_for_layer(style, layer: int):
    """Return a style copy with only the border effect relevant to `layer`.
    layer=0 → shadow-blur halo layer (suppress glow and hard outline)
    layer=1 → glow/outline layer (suppress shadow_blur so \\bord is free)
    For styles that only have one of the two effects the returned copy is
    identical to the original, so single-effect styles are handled correctly
    in two-layer mode without any special-casing."""
    if layer == 0:
        return style.model_copy(update={"glow_intensity": 0.0, "outline": 0.0})
    return style.model_copy(update={"shadow_blur": 0.0})


def _style_3a(style) -> str:
    """Return the correct \\3a (outline/border alpha) value for this style.
    Used to restore \\3a after a hide-and-reveal animation — must match exactly
    what _style_effect_tags sets so the shadow looks identical before and after."""
    if style.glow_intensity > 0:
        return "&H00&"          # glow border is always fully opaque
    if style.shadow_blur > 0:
        return f"&H{_alpha_to_ass(style.shadow_alpha)}&"  # blur halo alpha
    if style.outline > 0:
        return "&H00&"          # hard outline is opaque
    return "&HFF&"              # no border at all — transparent (irrelevant)


def _style_effect_tags(style) -> str:
    tags = ""
    has_glow = style.glow_intensity > 0
    has_offset = style.shadow > 0
    has_blur = style.shadow_blur > 0

    # ── Border layer: glow > shadow-blur halo > outline > nothing ──
    # When blur>0 we always render a blurred coloured border as a soft ambient
    # halo — regardless of whether there is also a directional offset.  With
    # offset=0 this gives a pure diffuse shadow; with offset>0 the border halo
    # combines naturally with the directional \xshad/\yshad component below.
    if has_glow:
        # Blurred coloured border = glow halo
        tags += rf"\bord{style.glow_intensity:.2f}"
        tags += rf"\3c{_hex_to_ass_tag_color(style.glow_color)}"
        tags += r"\3a&H00&"  # glow fully opaque
        tags += rf"\blur{max(0.8, style.glow_intensity * 0.85):.2f}"
    elif has_blur:
        # Ambient shadow halo (works for distance=0 AND distance>0)
        tags += rf"\bord{style.shadow_blur:.2f}"
        tags += rf"\3c{_hex_to_ass_tag_color(style.shadow_color)}"
        tags += rf"\3a&H{_alpha_to_ass(style.shadow_alpha)}&"
        tags += rf"\blur{style.shadow_blur:.2f}"
    elif style.outline > 0:
        tags += rf"\bord{style.outline:.2f}"
        tags += rf"\3c{_hex_to_ass_tag_color(style.outline_color)}"
        tags += r"\3a&H00&"  # hard outline fully opaque
        tags += r"\blur0"
    else:
        tags += r"\bord0"

    # ── Shadow layer ──
    # When glow is active the border slot is already taken by the glow colour,
    # so a diffuse dark halo must come from the \4c shadow layer instead.
    # With \xshad0\yshad0 the shadow sits exactly behind the text; the glow's
    # own \blur diffuses it outward creating a dark depth halo behind the glow.
    # For a plain drop shadow (no glow) keep the classic \xshad\yshad approach.
    if has_glow and (has_blur or has_offset):
        if has_offset:
            radians = math.radians(style.shadow_angle)
            xshad = style.shadow * math.cos(radians)
            yshad = style.shadow * math.sin(radians)
            tags += rf"\xshad{xshad:.2f}\yshad{yshad:.2f}"
        else:
            tags += r"\xshad0\yshad0"
        tags += rf"\4c{_hex_to_ass_tag_color(style.shadow_color)}"
        tags += rf"\4a&H{_alpha_to_ass(style.shadow_alpha)}&"
    elif has_offset:
        radians = math.radians(style.shadow_angle)
        xshad = style.shadow * math.cos(radians)
        yshad = style.shadow * math.sin(radians)
        tags += rf"\xshad{xshad:.2f}\yshad{yshad:.2f}"
        tags += rf"\4c{_hex_to_ass_tag_color(style.shadow_color)}"
        tags += rf"\4a&H{_alpha_to_ass(style.shadow_alpha)}&"
        if has_blur:
            tags += rf"\be{style.shadow_blur:.2f}"
    else:
        tags += r"\xshad0\yshad0"

    return tags


def _animation_tag(preset: str, x: int, y: int, style, align: int = 8) -> str:
    effect_tags = _style_effect_tags(style)
    # Only 'none' remains in the static branch — word_pop/appear/reveal use animated paths
    return rf"\an{align}\pos({x},{y}){effect_tags}"


def _animated_line_text(
    line_words,
    block_start: float,
    config: RenderConfig,
    preset: str,
    layer: int | None = None,
) -> str:
    """Build inline ASS text for one line in animated (appear / reveal) mode.

    appear   — word-by-word with 60 ms fade-in
    reveal   — letter-by-letter instant typewriter

    Every hidden element starts with \\1a&HFF&\\3a&HFF&\\4a&HFF& so fill,
    outline AND shadow are all invisible before their scheduled time.
    \\t() transitions restore each channel independently."""

    letter_by_letter = (preset == "reveal")
    fade_dur_ms = 60 if preset == "appear" else 1

    def _eff(style):
        """Return (filtered_style, effect_tags_str)."""
        s = _style_for_layer(style, layer) if layer is not None else style
        return s, _style_effect_tags(s)

    eff_base_s, base_effects = _eff(config.base_style)

    def _alpha_tag(delay_ms: int, eff_s, fade: int) -> str:
        """Return the hide-then-reveal alpha tags for a future element.
        Hides fill (\\1a), outline (\\3a) and shadow (\\4a) to prevent
        any border/glow artefact from appearing before the word is due."""
        if delay_ms <= 0:
            return ""
        a3 = _style_3a(eff_s)
        return (
            rf"\1a&HFF&\3a&HFF&\4a&HFF&"
            rf"\t({delay_ms},{delay_ms + fade},\1a&H00&\3a{a3}\4a&H00&)"
        )

    out: list[str] = []

    for wi, word in enumerate(line_words):
        word_delay_ms = max(0, int(round((word.start - block_start) * 1000)))
        hl_group = _should_highlight(word, config)

        if hl_group is not None:
            style_name, hl_style = _hl_style_for_group(hl_group, config)
            hl_style = _hl_style_with_shadow(hl_style, config.base_style)
            eff_hl_s, hl_effect_tags = _eff(hl_style)
        else:
            style_name = None
            eff_hl_s, hl_effect_tags = None, None

        # ── Space between words — appears with the first char/word that follows ─
        if wi > 0:
            space_alpha = _alpha_tag(word_delay_ms, eff_base_s, 1)
            out.append(rf"{{{base_effects}{space_alpha}}} ")

        if letter_by_letter:
            # ── Letter-by-letter typewriter (reveal) ─────────────────────────
            text_raw = _apply_transform(
                word.word,
                hl_style.text_transform if hl_group is not None else config.base_style.text_transform,
            )
            chars = list(text_raw)
            n = len(chars)
            word_dur = word.end - word.start

            for ci, char in enumerate(chars):
                t = word.start + word_dur * ci / max(n, 1)
                delay_ms = max(0, int(round((t - block_start) * 1000)))
                char_escaped = _escape_ass_text(char)

                if hl_group is not None:
                    alpha = _alpha_tag(delay_ms, eff_hl_s, 1)
                    seg = rf"{{\r{style_name}{hl_effect_tags}{alpha}}}{char_escaped}"
                    if ci == n - 1:
                        seg += rf"{{\r{base_effects}}}"
                    out.append(seg)
                else:
                    alpha = _alpha_tag(delay_ms, eff_base_s, 1)
                    out.append(rf"{{{base_effects}{alpha}}}{char_escaped}")
        else:
            # ── Word-by-word fade (appear) ────────────────────────────────────
            if hl_group is not None:
                alpha = _alpha_tag(word_delay_ms, eff_hl_s, fade_dur_ms)
                word_text = _escape_ass_text(_apply_transform(word.word, hl_style.text_transform))
                out.append(
                    rf"{{\r{style_name}{hl_effect_tags}{alpha}}}{word_text}"
                    rf"{{\r{base_effects}}}"
                )
            else:
                alpha = _alpha_tag(word_delay_ms, eff_base_s, fade_dur_ms)
                word_text = _escape_ass_text(_apply_transform(word.word, config.base_style.text_transform))
                out.append(rf"{{{base_effects}{alpha}}}{word_text}")

    return "".join(out)


def _write_word_pop_events(
    content: list[str],
    block: SubtitleBlock,
    config: RenderConfig,
    use_two_layers: bool,
    layers_to_emit: list[int],
) -> None:
    """Word-pop: exactly ONE word visible at any given time, no fade.
    Each word gets its own Dialogue event that lasts until the next word starts.
    All words across all lines are treated as a flat chronological sequence."""
    all_words = [
        (li, word)
        for li, line in enumerate(block.lines)
        for word in line.words
    ]
    if not all_words:
        return

    for step, (li, word) in enumerate(all_words):
        start_cs = _to_cs_floor(word.start)
        if step + 1 < len(all_words):
            end_cs = _to_cs_floor(all_words[step + 1][1].start) - 1
        else:
            end_cs = _to_cs_ceil(block.end)
        end_cs = max(start_cs, end_cs)
        ev_start = _ass_time_cs(start_cs)
        ev_end   = _ass_time_cs(end_cs)

        line = block.lines[li]
        hl_group = _should_highlight(word, config)

        for lyr in layers_to_emit:
            lyr_key = lyr if use_two_layers else None

            if hl_group is not None:
                sname, hl_style = _hl_style_for_group(hl_group, config)
                hl_style = _hl_style_with_shadow(hl_style, config.base_style)
                eff_s = _style_for_layer(hl_style, lyr) if use_two_layers else hl_style
                etags = _style_effect_tags(eff_s)
                wtext = _escape_ass_text(_apply_transform(word.word, hl_style.text_transform))
                tag = rf"\an8\pos({line.center_x},{line.y}){etags}"
                content.append(f"Dialogue: {lyr},{ev_start},{ev_end},{sname},,0,0,0,,{{{tag}}}{wtext}")
            else:
                eff_base = _style_for_layer(config.base_style, lyr) if use_two_layers else config.base_style
                etags = _style_effect_tags(eff_base)
                wtext = _escape_ass_text(_apply_transform(word.word, config.base_style.text_transform))
                tag = rf"\an8\pos({line.center_x},{line.y}){etags}"
                content.append(f"Dialogue: {lyr},{ev_start},{ev_end},Base,,0,0,0,,{{{tag}}}{wtext}")


def _write_reveal_base_events(content: list[str], block: SubtitleBlock, config: RenderConfig, block_end: str):
    """Typewriter reveal — one Dialogue event per LINE per word step.
    All lines are emitted on every step (future lines as invisible placeholders)
    so the overall block height is stable and never jumps."""
    if not block.lines:
        return
    all_words = [
        (li, wi, word)
        for li, line in enumerate(block.lines)
        for wi, word in enumerate(line.words)
    ]
    for step, (cur_li, cur_wi, _cur_word) in enumerate(all_words):
        start_cs = _to_cs_floor(all_words[step][2].start)
        if step + 1 < len(all_words):
            end_cs = _to_cs_floor(all_words[step + 1][2].start) - 1
        else:
            end_cs = _to_cs_ceil(block.end)
        end_cs = max(start_cs, end_cs)
        ev_start = _ass_time_cs(start_cs)
        ev_end = _ass_time_cs(end_cs)
        for li, line in enumerate(block.lines):
            if not line.words:
                continue
            if li < cur_li:
                text = _base_words_text(line.words, config)
            elif li == cur_li:
                text = _base_words_text_appear(line.words, cur_wi, config)
            else:
                text = _base_words_text_appear(line.words, -1, config)
            tag = _animation_tag("none", line.center_x, line.y, config.base_style, align=8)
            content.append(f"Dialogue: 0,{ev_start},{ev_end},Base,,0,0,0,,{{{tag}}}{text}")


def _write_appear_base_events(content: list[str], block: SubtitleBlock, config: RenderConfig, block_end: str):
    """Word-pop appear — same multi-line structure as reveal mode."""
    if not block.lines:
        return
    all_words = [
        (li, wi, word)
        for li, line in enumerate(block.lines)
        for wi, word in enumerate(line.words)
    ]
    for step, (cur_li, cur_wi, _cur_word) in enumerate(all_words):
        start_cs = _to_cs_floor(all_words[step][2].start)
        if step + 1 < len(all_words):
            end_cs = _to_cs_floor(all_words[step + 1][2].start) - 1
        else:
            end_cs = _to_cs_ceil(block.end)
        end_cs = max(start_cs, end_cs)
        ev_start = _ass_time_cs(start_cs)
        ev_end = _ass_time_cs(end_cs)
        for li, line in enumerate(block.lines):
            if not line.words:
                continue
            if li < cur_li:
                text = _base_words_text(line.words, config)
            elif li == cur_li:
                text = _base_words_text_appear(line.words, cur_wi, config)
            else:
                text = _base_words_text_appear(line.words, -1, config)
            tag = _animation_tag("appear", line.center_x, line.y, config.base_style, align=8)
            content.append(f"Dialogue: 0,{ev_start},{ev_end},Base,,0,0,0,,{{{tag}}}{text}")


def _style_line(
    name: str,
    font: str,
    size: int,
    color: str,
    outline_color: str,
    back_color: str,
    outline: float,
    shadow: int,
    bold: bool,
    italic: bool,
    spacing: float = 0.0,
) -> str:
    bold_value = -1 if bold else 0
    italic_value = -1 if italic else 0
    return (
        f"Style: {name},{font},{size},{color},&H00000000,{outline_color},{back_color},"
        f"{bold_value},{italic_value},0,0,100,100,{spacing:.1f},0,1,{outline:.1f},{shadow},8,10,10,10,1"
    )


def write_ass_file(
    output_path: str | Path,
    blocks: list[SubtitleBlock],
    config: RenderConfig,
    video_info: VideoInfo,
) -> Path:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    base_style = config.base_style
    base_size = int(video_info.height * base_style.size_ratio)
    highlight_size = int(video_info.height * config.highlight_style.size_ratio)

    content: list[str] = []
    content.append("[Script Info]")
    content.append("ScriptType: v4.00+")
    content.append("WrapStyle: 2")
    content.append("ScaledBorderAndShadow: yes")
    content.append(f"PlayResX: {video_info.width}")
    content.append(f"PlayResY: {video_info.height}")
    content.append("")
    content.append("[V4+ Styles]")
    content.append(
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,"
        "StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding"
    )
    content.append(
        _style_line(
            name="Base",
            font=base_style.font,
            size=base_size,
            color=_hex_to_ass_color(base_style.color),
            outline_color=_hex_to_ass_color(base_style.glow_color),
            back_color=f"&H{_alpha_to_ass(base_style.shadow_alpha)}{_hex_to_bgr6(base_style.shadow_color)}",
            outline=0,
            shadow=0,
            bold=base_style.bold,
            italic=base_style.italic,
            spacing=base_style.spacing,
        )
    )
    content.append(
        _style_line(
            name="Highlight",
            font=config.highlight_style.font,
            size=highlight_size,
            color=_hex_to_ass_color(config.highlight_style.color),
            outline_color=_hex_to_ass_color(config.highlight_style.glow_color),
            back_color=f"&H{_alpha_to_ass(config.highlight_style.shadow_alpha)}{_hex_to_bgr6(config.highlight_style.shadow_color)}",
            outline=0,
            shadow=0,
            bold=config.highlight_style.bold,
            italic=config.highlight_style.italic,
            spacing=config.highlight_style.spacing,
        )
    )
    if config.highlight_style2 is not None:
        hl2 = config.highlight_style2
        hl2_size = int(video_info.height * hl2.size_ratio)
        content.append(
            _style_line(
                name="Highlight2",
                font=hl2.font,
                size=hl2_size,
                color=_hex_to_ass_color(hl2.color),
                outline_color=_hex_to_ass_color(hl2.glow_color),
                back_color=f"&H{_alpha_to_ass(hl2.shadow_alpha)}{_hex_to_bgr6(hl2.shadow_color)}",
                outline=0,
                shadow=0,
                bold=hl2.bold,
                italic=hl2.italic,
                spacing=hl2.spacing,
            )
        )
    content.append("")
    content.append("[Events]")
    content.append("Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text")

    preset = config.animation.preset
    animated = preset in ("reveal", "appear")
    word_pop = preset == "word_pop"

    # Two-layer rendering: when a style has both glow AND shadow_blur active,
    # they both compete for the single ASS border slot.  We resolve this by
    # emitting two Dialogue events per line — Layer 0 carries the shadow-blur
    # border and Layer 1 carries the glow border.  libass composites them in
    # order so the glow sits on top of the shadow halo, exactly as intended.
    _styles_in_use = [config.base_style, config.highlight_style]
    if config.highlight_style2 is not None:
        _styles_in_use.append(config.highlight_style2)
    use_two_layers = any(_needs_two_layers(s) for s in _styles_in_use)
    layers_to_emit = [0, 1] if use_two_layers else [0]

    for index, block in enumerate(blocks):
        block_start_cs = _to_cs_floor(block.start)
        block_end_cs = _to_cs_ceil(block.end)
        if index + 1 < len(blocks):
            block_end_cs = min(block_end_cs, _to_cs_floor(blocks[index + 1].start) - 1)
        block_end_cs = max(block_start_cs, block_end_cs)
        block_start = _ass_time_cs(block_start_cs)
        block_end = _ass_time_cs(block_end_cs)
        effective_end = block_end_cs / 100.0
        effective_block = SubtitleBlock(start=block.start, end=effective_end, lines=block.lines)

        if word_pop:
            # ── Word-pop: one word visible at a time, instant switch ──────────
            _write_word_pop_events(content, effective_block, config, use_two_layers, layers_to_emit)
        elif animated:
            # ── One Dialogue event per LINE, words animate in via \t() alpha ──
            # \an8\pos(center_x, line_y) lets libass center the line and align
            # baselines internally — no per-word x measurement required.
            # Each word starts invisible (\alpha&HFF&) and fades/pops in at its
            # own timestamp via \t().  Because the event itself never ends early,
            # there is zero flicker.
            center_x = video_info.width // 2
            for lyr in layers_to_emit:
                lyr_key = lyr if use_two_layers else None
                eff_base = _style_for_layer(config.base_style, lyr) if use_two_layers else config.base_style
                for line in effective_block.lines:
                    if not line.words:
                        continue
                    effect_tags = _style_effect_tags(eff_base)
                    tag = rf"\an8\pos({center_x},{line.y}){effect_tags}"
                    text = _animated_line_text(line.words, block.start, config, preset, layer=lyr_key)
                    content.append(f"Dialogue: {lyr},{block_start},{block_end},Base,,0,0,0,,{{{tag}}}{text}")
        else:
            # ── Static (none) — one event per line ───────────────────────────
            for lyr in layers_to_emit:
                lyr_key = lyr if use_two_layers else None
                eff_base = _style_for_layer(config.base_style, lyr) if use_two_layers else config.base_style
                for line in effective_block.lines:
                    text = _base_words_text(line.words, config, layer=lyr_key)
                    tag = _animation_tag(preset, line.center_x, line.y, eff_base, align=8)
                    content.append(f"Dialogue: {lyr},{block_start},{block_end},Base,,0,0,0,,{{{tag}}}{text}")

    output_path.write_text("\n".join(content), encoding="utf-8")
    return output_path
