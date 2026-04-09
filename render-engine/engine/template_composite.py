from __future__ import annotations

from pathlib import Path


def normalize_video_block(block: dict, canvas_w: int, canvas_h: int) -> dict[str, float | int | str]:
    x = int(block["x"])
    y = int(block["y"])
    w = int(block["w"])
    h = int(block["h"])

    canvas_w = canvas_w if canvas_w % 2 == 0 else canvas_w + 1
    canvas_h = canvas_h if canvas_h % 2 == 0 else canvas_h + 1

    x = max(0, x)
    y = max(0, y)
    w = max(2, min(w if w % 2 == 0 else w + 1, canvas_w - x))
    h = max(2, min(h if h % 2 == 0 else h + 1, canvas_h - y))

    return {
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "canvas_w": canvas_w,
        "canvas_h": canvas_h,
        "fit": block.get("fit", "cover"),
        "crop_x": float(block.get("crop_x", 0.5)),
        "crop_y": float(block.get("crop_y", 0.5)),
    }


def build_template_filter_complex(block: dict[str, float | int | str]) -> str:
    x = int(block["x"])
    y = int(block["y"])
    w = int(block["w"])
    h = int(block["h"])
    canvas_w = int(block["canvas_w"])
    canvas_h = int(block["canvas_h"])
    fit = str(block["fit"])
    crop_x = float(block["crop_x"])
    crop_y = float(block["crop_y"])

    if fit == "contain":
        scale_filter = f"scale={w}:{h}:force_original_aspect_ratio=decrease:sws_flags=lanczos,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black"
    else:
        scale_filter = (
            f"scale={w}:{h}:force_original_aspect_ratio=increase:sws_flags=lanczos,"
            f"crop={w}:{h}:(iw-{w})*{crop_x}:(ih-{h})*{crop_y}"
        )

    return (
        f"[0:v]{scale_filter},format=yuv420p,"
        f"pad={canvas_w}:{canvas_h}:{x}:{y}:black[base];"
        f"[base][1:v]overlay=0:0:format=auto,"
        f"scale=trunc(iw/2)*2:trunc(ih/2)*2[out]"
    )


def build_template_ffmpeg_cmd(
    video_path: str | Path,
    overlay_path: str | Path,
    out_path: str | Path,
    block: dict[str, float | int | str],
    video_codec: str,
    video_codec_args: list[str],
    audio_codec: str = "aac",
    audio_codec_args: list[str] | None = None,
) -> list[str]:
    audio_codec_args = audio_codec_args or ["-b:a", "192k"]
    filter_complex = build_template_filter_complex(block)

    return [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-i", str(overlay_path),
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-map", "0:a?",
        "-shortest",
        "-c:v", video_codec, *video_codec_args,
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        "-c:a", audio_codec, *audio_codec_args,
        str(out_path),
    ]