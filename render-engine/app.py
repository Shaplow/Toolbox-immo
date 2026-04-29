from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import re
from typing import Any

# Gradio n'est utilisé que pour l'UI locale — optionnel dans le worker RunPod
try:
    import gradio as gr
    _GRADIO_AVAILABLE = True
except ImportError:  # pragma: no cover
    gr = None  # type: ignore[assignment]
    _GRADIO_AVAILABLE = False

from pydantic import ValidationError

from engine.ass_writer import write_ass_file
from engine.fonts import list_font_names
from engine.layout import build_layout
from engine.models import RenderConfig, WordTimestamp, default_premium_config
from engine.probe import VideoInfo, probe_video
from engine.render import burn_subtitles, render_preview_frame

BASE_DIR = Path(__file__).parent
FONTS_DIR = BASE_DIR / "fonts"
OUTPUTS_DIR = BASE_DIR / "outputs"
PRESETS_PATH = BASE_DIR / "projects" / "presets.json"

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger("subtitle_app")


def _resolve_captions_engine(engine: str | None = None) -> str:
    return "ass"


def _list_font_choices() -> list[str]:
    return list_font_names(FONTS_DIR)


def _pick_font_default(choices: list[str], preferred: list[str], fallback: str) -> str:
    lowered = {item.lower(): item for item in choices}
    for candidate in preferred:
        if candidate.lower() in lowered:
            return lowered[candidate.lower()]
    return choices[0] if choices else fallback


def _load_presets() -> dict[str, dict[str, Any]]:
    if not PRESETS_PATH.exists():
        return {}
    try:
        return json.loads(PRESETS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_presets(presets: dict[str, dict[str, Any]]):
    PRESETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    PRESETS_PATH.write_text(json.dumps(presets, indent=2), encoding="utf-8")


def _words_to_df(words: list[WordTimestamp]) -> list[list[Any]]:
    return [[w.word, w.start, w.end, bool(getattr(w, "highlight", False))] for w in words]


def _rows_to_list(rows: Any) -> list[list[Any]]:
    if rows is None:
        return []
    if isinstance(rows, list) and rows and isinstance(rows[0], WordTimestamp):
        return _words_to_df(rows)  # already structured
    if hasattr(rows, "values"):
        try:
            return rows.values.tolist()
        except Exception:
            return []
    if isinstance(rows, list):
        return rows
    return []


def _df_to_words(rows: Any) -> list[WordTimestamp]:
    rows_list = _rows_to_list(rows)

    cleaned: list[WordTimestamp] = []
    for row in rows_list or []:
        if not isinstance(row, (list, tuple)) or len(row) < 3:
            continue
        word = str(row[0]).strip()
        if not word:
            continue
        try:
            start = float(row[1])
            end = float(row[2])
        except (TypeError, ValueError):
            continue
        highlight = bool(row[3]) if len(row) > 3 else False
        try:
            cleaned.append(WordTimestamp(word=word, start=start, end=end, highlight=highlight))
        except ValidationError:
            continue
    return cleaned


def _parse_timestamp(ts: str) -> float:
    # format: HH:MM:SS,mmm
    h, m, rest = ts.split(":")
    s, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


# Matches {HL}word{/HL} (legacy, group 0) or {HL:N}word{/HL:N} (group N)
_HL_RE = re.compile(r'^\{HL(?::(\d+))?\}(.*)\{/HL(?::\d+)?\}$')

def _parse_srt_content(text: str) -> list[WordTimestamp]:
    entries: list[WordTimestamp] = []
    blocks = re.split(r"\r?\n\s*\r?\n", text.strip())
    for caption_idx, block in enumerate(blocks, start=1):
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if len(lines) < 2:
            continue
        timing_line = lines[1] if "-->" in lines[1] else lines[0]
        match = re.search(r"(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})", timing_line)
        if not match:
            continue
        start = _parse_timestamp(match.group(1))
        end = _parse_timestamp(match.group(2))
        text_lines = lines[2:] if "-->" in lines[1] else lines[1:]
        full_text = " ".join(text_lines).strip()
        if not full_text:
            continue
        words = full_text.split()
        if not words:
            continue
        duration = max(0.001, end - start)
        step = duration / len(words)
        cursor = start
        for w in words:
            hl_m = _HL_RE.match(w)
            if hl_m:
                group = int(hl_m.group(1)) if hl_m.group(1) is not None else 0
                entries.append(WordTimestamp(word=hl_m.group(2), start=cursor, end=cursor + step,
                                             highlight=True, highlight_group=group,
                                             caption_index=caption_idx))
            else:
                entries.append(WordTimestamp(word=w, start=cursor, end=cursor + step,
                                             caption_index=caption_idx))
            cursor += step
    return entries


def _parse_json_file(file_obj) -> list[WordTimestamp]:
    if file_obj is None:
        return []
    data = json.loads(Path(file_obj).read_text(encoding="utf-8"))
    return _parse_json_data(data)


def _parse_text_auto(text: str | None) -> list[WordTimestamp]:
    if not text:
        return []
    if "-->" in text:
        return _parse_srt_content(text)
    data = json.loads(text)
    return _parse_json_data(data)


def _parse_json_str(text: str | None) -> list[WordTimestamp]:
    if not text:
        return []
    data = json.loads(text)
    return _parse_json_data(data)


def _parse_json_data(data: Any) -> list[WordTimestamp]:
    words: list[WordTimestamp] = []
    if not isinstance(data, list):
        return words
    for item in data:
        try:
            words.append(WordTimestamp(**item))
        except ValidationError:
            continue
    return words


def _default_config_dict() -> dict[str, Any]:
    return default_premium_config().model_dump()


def _load_preset(name: str, presets: dict[str, dict[str, Any]]):
    if not name:
        return _default_config_dict()
    return presets.get(name, _default_config_dict())


def _save_preset_action(name: str, cfg: dict[str, Any]):
    if not name:
        return gr.update(), "Nom de preset requis"
    presets = _load_presets()
    presets[name] = cfg
    _save_presets(presets)
    return gr.update(choices=sorted(presets.keys()), value=name), f"Preset '{name}' sauvegarde"


def _build_config_from_values(
    base_font, base_size, base_bold, base_italic, base_color, base_outline, base_shadow, base_blur,
    hl_font, hl_size, hl_bold, hl_italic, hl_color, hl_outline, hl_shadow, hl_blur,
    anchor, max_lines, line_gap, safe_left, safe_right, safe_top, safe_bottom,
    highlight_keywords, animation, pause_th, max_dur,
    shadow_distance, shadow_blur, shadow_angle, shadow_alpha, shadow_color,
    glow_color, glow_intensity,
    highlight_enabled, animation_enabled, shadow_enabled, glow_enabled,
) -> RenderConfig:
    keywords = [k.strip() for k in (highlight_keywords or "").split(",") if k.strip()]

    if not highlight_enabled:
        keywords = []

    if not animation_enabled:
        animation = "none"

    def _style_with_effects(values: dict[str, Any]) -> dict[str, Any]:
        result = dict(values)
        if not shadow_enabled:
            result["shadow"] = 0.0
            result["shadow_blur"] = 0.0
        if not glow_enabled:
            result["glow_intensity"] = 0.0
        return result

    cfg_dict = {
        "layout": {
            "anchor": anchor,
            "max_lines": int(max_lines),
            "safe_area": {
                "left": float(safe_left),
                "right": float(safe_right),
                "top": float(safe_top),
                "bottom": float(safe_bottom),
            },
            "line_gap_ratio": float(line_gap),
        },
        "base_style": _style_with_effects(
            {
                "font": base_font,
                "size_ratio": float(base_size),
                "bold": bool(base_bold),
                "italic": bool(base_italic),
                "color": base_color,
                "outline": 0,
                "shadow": float(shadow_distance),
                "blur": 0.0,
                "shadow_color": shadow_color,
                "shadow_alpha": float(shadow_alpha),
                "shadow_angle": float(shadow_angle),
                "shadow_blur": float(shadow_blur),
                "glow_color": glow_color,
                "glow_intensity": float(glow_intensity),
            }
        ),
        "highlight_style": _style_with_effects(
            {
                "font": hl_font,
                "size_ratio": float(hl_size),
                "bold": bool(hl_bold),
                "italic": bool(hl_italic),
                "color": hl_color,
                "outline": 0,
                "shadow": float(shadow_distance),
                "blur": 0.0,
                "shadow_color": shadow_color,
                "shadow_alpha": float(shadow_alpha),
                "shadow_angle": float(shadow_angle),
                "shadow_blur": float(shadow_blur),
                "glow_color": glow_color,
                "glow_intensity": float(glow_intensity),
            }
        ),
        "highlight": {
            "mode": "keywords",
            "keywords": keywords,
        },
        "animation": {"preset": animation},
        "block_rules": {
            "pause_threshold": float(pause_th),
            "max_duration": float(max_dur),
        },
        "engine": _resolve_captions_engine(),
    }
    return RenderConfig(**cfg_dict)


def _auto_safe_area(cfg: RenderConfig, video_info) -> RenderConfig:
    aspect = video_info.height / max(1, video_info.width)
    portrait = aspect >= 1.3
    if portrait:
        safe = {"left": 0.10, "right": 0.10, "top": 0.08, "bottom": 0.24}
    else:
        safe = {"left": 0.08, "right": 0.08, "top": 0.06, "bottom": 0.18}
    layout = cfg.layout.model_copy(update={"safe_area": cfg.layout.safe_area.model_copy(update=safe)})
    return cfg.model_copy(update={"layout": layout})


def _prepare_captions_context(
    video_path: str | Path,
    cfg: RenderConfig,
    auto_safe_area: bool,
    fonts_dir: str | Path | None = None,
) -> tuple[VideoInfo, RenderConfig, Path]:
    video_info = probe_video(video_path)
    effective_cfg = _auto_safe_area(cfg, video_info) if auto_safe_area else cfg
    effective_cfg = effective_cfg.model_copy(update={"engine": _resolve_captions_engine(effective_cfg.engine)})
    effective_fonts_dir = Path(fonts_dir) if fonts_dir is not None else FONTS_DIR
    return video_info, effective_cfg, effective_fonts_dir


def _render_ass_from_context(
    words: list[WordTimestamp],
    cfg: RenderConfig,
    video_info: VideoInfo,
    fonts_dir: Path,
) -> Path:
    blocks = build_layout(words, video_info=video_info, config=cfg, fonts_dir=fonts_dir)
    ass_path = OUTPUTS_DIR / "temp" / "captions.ass"
    write_ass_file(output_path=ass_path, blocks=blocks, config=cfg, video_info=video_info)
    return ass_path


def _render_ass(
    words: list[WordTimestamp],
    video_path: str | Path,
    cfg: RenderConfig,
    auto_safe_area: bool,
    fonts_dir: str | Path | None = None,
) -> Path:
    video_info, effective_cfg, effective_fonts_dir = _prepare_captions_context(
        video_path,
        cfg,
        auto_safe_area=auto_safe_area,
        fonts_dir=fonts_dir,
    )
    return _render_ass_from_context(words, effective_cfg, video_info, effective_fonts_dir)


def _render_captions_preview(
    words: list[WordTimestamp],
    video_path: str | Path,
    cfg: RenderConfig,
    output_image: str | Path,
    at_seconds: float,
    auto_safe_area: bool,
    fonts_dir: str | Path | None = None,
) -> Path | None:
    video_info, effective_cfg, effective_fonts_dir = _prepare_captions_context(
        video_path,
        cfg,
        auto_safe_area=auto_safe_area,
        fonts_dir=fonts_dir,
    )
    ass_path = _render_ass_from_context(words, effective_cfg, video_info, effective_fonts_dir)
    render_preview_frame(
        input_video=video_path,
        ass_file=ass_path,
        output_image=output_image,
        fonts_dir=effective_fonts_dir,
        at_seconds=at_seconds,
    )
    return ass_path


def _render_captions_video(
    words: list[WordTimestamp],
    video_path: str | Path,
    cfg: RenderConfig,
    output_video: str | Path,
    auto_safe_area: bool,
    fonts_dir: str | Path | None = None,
    preview: bool = False,
    preview_seconds: int = 10,
    quality_profile: str = "balanced",
    progress_path: str | Path | None = None,
    video_codec: str | None = None,
    video_codec_args: list[str] | None = None,
    audio_codec: str | None = None,
    audio_codec_args: list[str] | None = None,
) -> Path | None:
    video_info, effective_cfg, effective_fonts_dir = _prepare_captions_context(
        video_path,
        cfg,
        auto_safe_area=auto_safe_area,
        fonts_dir=fonts_dir,
    )
    ass_path = _render_ass_from_context(words, effective_cfg, video_info, effective_fonts_dir)
    burn_subtitles(
        input_video=video_path,
        ass_file=ass_path,
        output_video=output_video,
        fonts_dir=effective_fonts_dir,
        preview=preview,
        preview_seconds=preview_seconds,
        quality_profile=quality_profile,
        progress_path=progress_path,
        video_codec=video_codec,
        video_codec_args=video_codec_args,
        audio_codec=audio_codec,
        audio_codec_args=audio_codec_args,
    )
    return ass_path


def action_load_subs(json_file):
    if json_file is None:
        return gr.update(), [], [], "Aucun fichier"
    path = Path(json_file)
    text = path.read_text(encoding="utf-8")
    try:
        if path.suffix.lower() == ".srt" or "-->" in text:
            words = _parse_srt_content(text)
            fmt = "SRT"
        else:
            words = _parse_json_str(text)
            fmt = "JSON"
    except Exception as exc:  # pragma: no cover
        return gr.update(), [], [], f"Erreur lecture: {exc}"
    vocab = sorted({w.word for w in words})
    logger.info("Load subs file=%s fmt=%s words=%d", path.name, fmt, len(words))
    return _words_to_df(words), words, gr.update(choices=vocab, value=[]), f"{fmt} charge"


def action_load_subs_text(text):
    try:
        words = _parse_text_auto(text)
    except Exception as exc:
        return gr.update(), [], [], f"Texte invalide: {exc}"
    vocab = sorted({w.word for w in words})
    logger.info("Load subs text words=%d", len(words))
    return _words_to_df(words), words, gr.update(choices=vocab, value=[]), "Texte charge"


def action_apply_edits(df_rows, selected_words):
    words = _df_to_words(df_rows)
    vocab = sorted({w.word for w in words})
    selected = [w for w in (selected_words or []) if w in vocab]
    logger.info("Apply edits rows=%d vocab=%d selected=%d", len(df_rows or []), len(vocab), len(selected))
    return words, gr.update(choices=vocab, value=selected), "Transcription mise a jour"


def action_mark_highlight(df_rows, selected_words):
    rows = _rows_to_list(df_rows)
    selected = set(selected_words or [])
    for row in rows:
        if len(row) < 4:
            continue
        row[3] = row[0] in selected
    vocab = sorted({str(row[0]) for row in rows if row})
    words = _df_to_words(rows)
    logger.info("Mark highlight rows=%d selected=%d", len(rows), len(selected))
    return rows, gr.update(choices=vocab, value=list(selected)), words


def action_preview_frame(video_file, df_rows, time_seconds, auto_safe_area, *cfg_vals):
    if video_file is None:
        return None, "Video manquante"
    *style_vals, highlight_enabled, animation_enabled, shadow_enabled, glow_enabled = cfg_vals
    words = _df_to_words(df_rows)
    if not highlight_enabled:
        for w in words:
            w.highlight = False
    if not words:
        return None, "Sous-titres vides"
    preview_time = time_seconds if time_seconds not in (None, "") else None
    if (preview_time is None or float(preview_time) <= 0.0) and words:
        preview_time = max(0.0, words[0].start + 0.05)
    cfg = _build_config_from_values(*style_vals, highlight_enabled, animation_enabled, shadow_enabled, glow_enabled)
    frame_path = OUTPUTS_DIR / "temp" / "preview.png"
    logger.info(
        "Preview frame: words=%d engine=%s highlight=%s anim=%s t=%.2f",
        len(words),
        cfg.engine,
        highlight_enabled,
        cfg.animation.preset,
        float(preview_time or 0.0),
    )
    try:
        _render_captions_preview(
            words,
            video_file,
            cfg,
            output_image=frame_path,
            at_seconds=max(0.0, float(preview_time or 0.0)),
            auto_safe_area=bool(auto_safe_area),
            fonts_dir=FONTS_DIR,
        )
    except CairoRendererNotReadyError as exc:
        logger.error("Preview engine unavailable: %s", exc)
        return None, str(exc)
    if not frame_path.exists():
        logger.error("Preview frame missing at %s", frame_path)
        return None, "Preview manquante"
    return str(frame_path), "Preview image ok"


def action_render_video(video_file, df_rows, preview_mode, auto_safe_area, *cfg_vals):
    if video_file is None:
        return None, "Video manquante"
    *style_vals, highlight_enabled, animation_enabled, shadow_enabled, glow_enabled = cfg_vals
    words = _df_to_words(df_rows)
    if not highlight_enabled:
        for w in words:
            w.highlight = False
    if not words:
        return None, "Sous-titres vides"
    cfg = _build_config_from_values(*style_vals, highlight_enabled, animation_enabled, shadow_enabled, glow_enabled)
    out_dir = OUTPUTS_DIR / ("preview" if preview_mode else "full")
    out_path = out_dir / (Path(video_file).stem + ("_preview.mp4" if preview_mode else "_styled.mp4"))
    try:
        _render_captions_video(
            words,
            video_file,
            cfg,
            output_video=out_path,
            auto_safe_area=bool(auto_safe_area),
            fonts_dir=FONTS_DIR,
            preview=bool(preview_mode),
            preview_seconds=6,
        )
    except CairoRendererNotReadyError as exc:
        logger.error("Render engine unavailable: %s", exc)
        return None, str(exc)
    return str(out_path), "Render termine"


def _toggle_interactive(enabled: bool):
    return gr.update(interactive=bool(enabled))


def build_ui():
    presets = _load_presets()
    font_choices = _list_font_choices()
    base_font_default = _pick_font_default(
        font_choices,
        preferred=["Playfair Display SemiBold", "Playfair Display"],
        fallback="Playfair Display SemiBold",
    )
    highlight_font_default = _pick_font_default(
        font_choices,
        preferred=["Didot", "Didot Italic"],
        fallback="Didot",
    )

    with gr.Blocks(title="Subtitle Engine Local") as demo:
        gr.Markdown("## Subtitle Engine — Render + Edition + Presets")

        words_state = gr.State(value=[])
        vocab_state = gr.State(value=[])

        with gr.Tab("Render"):
            with gr.Row():
                video_input = gr.File(label="Video", file_count="single", type="filepath")

            status = gr.Markdown()

            with gr.Accordion("Configuration styles et layout", open=False):
                gr.Markdown("### Typo Base")
                with gr.Row():
                    base_font = gr.Dropdown(
                        choices=font_choices,
                        value=base_font_default,
                        label="Font base",
                        allow_custom_value=True,
                    )
                    base_size = gr.Slider(0.02, 0.14, value=0.062, step=0.001, label="Taille base (%)")
                    base_bold = gr.Checkbox(value=True, label="Gras")
                    base_italic = gr.Checkbox(value=False, label="Italique")
                    base_color = gr.ColorPicker(value="#FFFFFF", label="Base color")
                    base_outline = gr.State(0)
                    base_shadow = gr.State(0)
                    base_blur = gr.State(0.0)

                gr.Markdown("### Typo Highlight")
                with gr.Row():
                    hl_font = gr.Dropdown(
                        choices=font_choices,
                        value=highlight_font_default,
                        label="Font highlight",
                        allow_custom_value=True,
                    )
                    hl_size = gr.Slider(0.02, 0.16, value=0.068, step=0.001, label="Taille highlight (%)")
                    hl_bold = gr.Checkbox(value=False, label="Gras")
                    hl_italic = gr.Checkbox(value=True, label="Italique")
                    hl_color = gr.ColorPicker(value="#C88B3A", label="Highlight color")
                    hl_outline = gr.State(0)
                    hl_shadow = gr.State(0)
                    hl_blur = gr.State(0.0)

                gr.Markdown("### Position")
                with gr.Row():
                    anchor = gr.Dropdown(["bottom", "center", "top"], value="center", label="Anchor")
                    max_lines = gr.Slider(1, 4, value=2, step=1, label="Max lines")
                    line_gap = gr.Slider(0.0, 0.5, value=0.22, step=0.01, label="Line gap ratio")
                    safe_left = gr.Slider(0.0, 0.3, value=0.06, step=0.01, label="Safe left")
                    safe_right = gr.Slider(0.0, 0.3, value=0.06, step=0.01, label="Safe right")
                    safe_top = gr.Slider(0.0, 0.3, value=0.08, step=0.01, label="Safe top")
                    safe_bottom = gr.Slider(0.0, 0.4, value=0.18, step=0.01, label="Safe bottom")
                    auto_safe_area = gr.Checkbox(value=True, label="Auto safe area (portrait/paysage)")

                gr.Markdown("**Highlight** — Active seulement les mots cochés (ou présents dans la liste Keywords). Si rien n'est coché, on reste en typo de base.")
                with gr.Row():
                    highlight_keywords = gr.Textbox(label="Keywords (comma)")
                    highlight_enabled = gr.Checkbox(value=False, label="Activer highlight")
                    animation = gr.Dropdown(["none", "fade_pop", "slide_in", "reveal"], value="reveal", label="Animation")
                    animation_enabled = gr.Checkbox(value=True, label="Activer animation")

                gr.Markdown("### Effets")
                with gr.Row():
                    shadow_enabled = gr.Checkbox(value=False, label="Activer ombre")
                    shadow_distance = gr.Slider(0.0, 20.0, value=0.0, step=0.1, label="Distance", interactive=False)
                    shadow_blur = gr.Slider(0.0, 8.0, value=0.0, step=0.1, label="Flou", interactive=False)
                    shadow_angle = gr.Slider(-180.0, 180.0, value=90.0, step=1.0, label="Angle", interactive=False)
                    shadow_alpha = gr.Slider(0.0, 1.0, value=0.45, step=0.01, label="Transparence", interactive=False)
                    shadow_color = gr.ColorPicker(value="#000000", label="Couleur", interactive=False)

                with gr.Row():
                    glow_enabled = gr.Checkbox(value=False, label="Activer lueur")
                    glow_color = gr.ColorPicker(value="#FFFFFF", label="Couleur", interactive=False)
                    glow_intensity = gr.Slider(0.0, 8.0, value=0.0, step=0.1, label="Intensité", interactive=False)

                pause_th = gr.State(0.5)
                max_dur = gr.State(4.5)

                with gr.Row():
                    preset_name = gr.Textbox(label="Nom du preset")
                    preset_select = gr.Dropdown(choices=sorted(presets.keys()), label="Charger preset")
                    save_preset_btn = gr.Button("Sauver preset")
                    status_preset = gr.Markdown(visible=True)

            gr.Markdown("### Actions")
            with gr.Row():
                t_preview = gr.Number(value=0.0, label="Preview a t= (s)")
                preview_btn = gr.Button("Preview image instant")
                render_prev_btn = gr.Button("Render preview video (6s)")
                render_full_btn = gr.Button("Render full video")

            preview_image = gr.Image(label="Frame preview", type="filepath", height=480)
            video_out = gr.Video(label="Resultat video", height=480)

        cfg_components = [
            base_font, base_size, base_bold, base_italic, base_color, base_outline, base_shadow, base_blur,
            hl_font, hl_size, hl_bold, hl_italic, hl_color, hl_outline, hl_shadow, hl_blur,
            anchor, max_lines, line_gap, safe_left, safe_right, safe_top, safe_bottom,
            highlight_keywords, animation, pause_th, max_dur,
            shadow_distance, shadow_blur, shadow_angle, shadow_alpha, shadow_color,
            glow_color, glow_intensity,
            highlight_enabled, animation_enabled, shadow_enabled, glow_enabled,
        ]

        shadow_enabled.change(
            fn=lambda enabled: [_toggle_interactive(enabled)] * 5,
            inputs=shadow_enabled,
            outputs=[shadow_distance, shadow_blur, shadow_angle, shadow_alpha, shadow_color],
        )

        glow_enabled.change(
            fn=lambda enabled: [_toggle_interactive(enabled)] * 2,
            inputs=glow_enabled,
            outputs=[glow_color, glow_intensity],
        )

        preview_btn.click(
            fn=action_preview_frame,
            inputs=[video_input, words_state, t_preview, auto_safe_area, *cfg_components],
            outputs=[preview_image, status],
        )

        render_prev_btn.click(
            fn=action_render_video,
            inputs=[video_input, words_state, gr.State(True), auto_safe_area, *cfg_components],
            outputs=[video_out, status],
        )

        render_full_btn.click(
            fn=action_render_video,
            inputs=[video_input, words_state, gr.State(False), auto_safe_area, *cfg_components],
            outputs=[video_out, status],
        )

        def update_cfg_from_preset(name):
            cfg = _load_preset(name, _load_presets())
            base = cfg.get("base_style", {})
            highlight = cfg.get("highlight_style", {})
            layout = cfg.get("layout", {})
            safe = layout.get("safe_area", {})
            return (
                base.get("font", "Playfair Display SemiBold"), base.get("size_ratio", 0.062), base.get("bold", True), base.get("italic", False), base.get("color", "#FFFFFF"), 0, 0, 0.0,
                highlight.get("font", "Didot"), highlight.get("size_ratio", 0.068), highlight.get("bold", False), highlight.get("italic", True), highlight.get("color", "#C88B3A"), 0, 0, 0.0,
                layout.get("anchor", "bottom"), layout.get("max_lines", 2), layout.get("line_gap_ratio", 0.22),
                safe.get("left", 0.06), safe.get("right", 0.06), safe.get("top", 0.08), safe.get("bottom", 0.18),
                ",".join(cfg.get("highlight", {}).get("keywords", [])), cfg.get("animation", {}).get("preset", "reveal"),
                base.get("shadow", 0.0),
                base.get("shadow_blur", 0.0),
                base.get("shadow_angle", 90.0),
                base.get("shadow_alpha", 0.45),
                base.get("shadow_color", "#000000"),
                base.get("glow_color", "#FFFFFF"),
                base.get("glow_intensity", 0.0),
                True,
                True,
                base.get("shadow", 0.0) > 0.0,
                base.get("glow_intensity", 0.0) > 0.0,
            )

        preset_select.change(
            fn=update_cfg_from_preset,
            inputs=preset_select,
            outputs=[
                base_font, base_size, base_bold, base_italic, base_color, base_outline, base_shadow, base_blur,
                hl_font, hl_size, hl_bold, hl_italic, hl_color, hl_outline, hl_shadow, hl_blur,
                anchor, max_lines, line_gap, safe_left, safe_right, safe_top, safe_bottom,
                highlight_keywords, animation,
                shadow_distance, shadow_blur, shadow_angle, shadow_alpha, shadow_color,
                glow_color, glow_intensity,
                highlight_enabled, animation_enabled, shadow_enabled, glow_enabled,
            ],
        )

        save_preset_btn.click(
            fn=lambda name, *vals: _save_preset_action(name, _build_config_from_values(*vals).model_dump()),
            inputs=[preset_name, *cfg_components],
            outputs=[preset_select, status_preset],
        )

        with gr.Tab("Edition texte/timing"):
            gr.Markdown("Charger/editer les sous-titres ici. La table alimente Render.")
            with gr.Row():
                subs_input = gr.File(label="Sous-titres (JSON ou SRT)", file_count="single", type="filepath")
                load_btn = gr.Button("Charger fichier")
            with gr.Row():
                subs_text = gr.Textbox(label="Coller JSON ou SRT", lines=6, placeholder='SRT ou JSON de mots')
                load_text_btn = gr.Button("Charger depuis texte")

            df = gr.Dataframe(
                headers=["word", "start", "end", "highlight"],
                datatype=["str", "number", "number", "bool"],
                row_count=(1, "dynamic"),
                column_count=(4, "fixed"),
                interactive=True,
                label="Edition mots / timings / highlight",
            )

            with gr.Row():
                vocab_multi = gr.CheckboxGroup(choices=[], label="Highlight rapide (par mot)")
                mark_btn = gr.Button("Appliquer highlight selection")

            apply_btn = gr.Button("Appliquer les editions de la table")

            load_btn.click(fn=action_load_subs, inputs=subs_input, outputs=[df, words_state, vocab_multi, status])
            load_text_btn.click(fn=action_load_subs_text, inputs=subs_text, outputs=[df, words_state, vocab_multi, status])
            mark_btn.click(fn=action_mark_highlight, inputs=[df, vocab_multi], outputs=[df, vocab_multi, words_state])
            apply_btn.click(fn=action_apply_edits, inputs=[df, vocab_multi], outputs=[words_state, vocab_multi, status])

    return demo


if __name__ == "__main__":
    app = build_ui()
    app.launch()
