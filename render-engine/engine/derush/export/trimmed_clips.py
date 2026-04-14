from __future__ import annotations

import logging
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from engine.derush.export.base import ExportProvider
from engine.derush.export.manifest import ManifestExporter
from engine.derush.models import DerushExportInput, DerushSegment, ExportResult, SourceFileInfo
from engine.encoding_profiles import build_derush_encoding_settings
from engine.probe import probe_video

logger = logging.getLogger(__name__)

# Max parallel FFmpeg processes — adaptatif selon les cores disponibles.
# Stream copy est quasi I/O bound : plus de workers = meilleur débit sur RunPod (8-32 cores).
_MAX_WORKERS = min(os.cpu_count() or 4, 16)


class TrimmedClipExporter(ExportProvider):
    """
    Exports each selected segment as an individual video file.

    Naming: {order:03d}_{shot_type}_{score}pts_{HH-MM-SS}_{HH-MM-SS}.mp4
    e.g.  : 001_medium_87pts_00-05-12_00-05-22.mp4

    Two modes:
    - accurate_trim=False (default MVP/CapCut):
        ffmpeg -ss {in} -to {out} -i src -c copy → lossless, instant, 0 re-encode
    - accurate_trim=True (pro timeline):
        ffmpeg re-encode at source resolution/fps, capped at 20 Mb/s
    """

    def export(
        self,
        export_input: DerushExportInput,
        segments: list[DerushSegment],
        source_files: list[SourceFileInfo],
        output_dir: str,
    ) -> ExportResult:
        selected = self._selected(segments, export_input.segment_ids)
        source_map = self._source_map(source_files)

        if not selected:
            raise ValueError("No selected segments to export")

        clips_dir = os.path.join(output_dir, "clips")
        os.makedirs(clips_dir, exist_ok=True)

        # Detect GPU
        use_nvenc = self._detect_nvenc()

        # Assign exported filenames
        for seg in selected:
            seg.exported_filename = self._make_filename(seg)

        # Export clips in parallel
        errors: list[str] = []
        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
            futures = {
                executor.submit(
                    self._export_clip,
                    seg,
                    source_map[seg.source_file_id],
                    clips_dir,
                    export_input.accurate_trim,
                    use_nvenc,
                ): seg
                for seg in selected
            }
            for future in as_completed(futures):
                seg = futures[future]
                try:
                    future.result()
                    logger.info("[trimmed_clips] ✓ %s", seg.exported_filename)
                except Exception as exc:
                    logger.error("[trimmed_clips] ✗ %s: %s", seg.id, exc)
                    errors.append(f"{seg.id}: {exc}")

        if errors:
            logger.warning("[trimmed_clips] %d errors during export", len(errors))

        # Generate manifest
        ManifestExporter().export(export_input, segments, source_files, output_dir)

        # ZIP everything
        zip_path = self._zip_output(output_dir, export_input)

        return ExportResult(
            export_format="clips_trimmed",
            output_key=f"{export_input.output_prefix}/clips_{export_input.export_id}.zip",
            exported_count=len(selected) - len(errors),
            encoding_mode="re_encode" if export_input.accurate_trim else "stream_copy",
            error="; ".join(errors) if errors else None,
        )

    # ── Clip export ────────────────────────────────────────────────────────────

    def _export_clip(
        self,
        seg: DerushSegment,
        source: SourceFileInfo,
        clips_dir: str,
        accurate: bool,
        use_nvenc: bool,
    ) -> None:
        # Safety guard: skip degenerate clips that slipped through the pipeline filter.
        # FFmpeg silently produces corrupt/empty files for sub-0.5s ranges.
        duration = seg.source_out - seg.source_in
        if duration < 0.5:
            raise ValueError(
                f"Segment trop court ({duration:.3f}s) — ignoré pour éviter un fichier vide"
            )

        out_path = os.path.join(clips_dir, seg.exported_filename or f"{seg.id}.mp4")

        if not accurate:
            self._stream_copy(source.local_path, seg.source_in, seg.source_out, out_path)
        else:
            self._re_encode(source, seg, out_path, use_nvenc)

    def _stream_copy(
        self,
        src_path: str,
        start: float,
        end: float,
        out_path: str,
    ) -> None:
        """
        Stream copy: lossless, preserves all metadata.
        -ss is placed AFTER -i so FFmpeg decodes from the preceding keyframe
        but only outputs frames from `start` onward — no audio/video bleed.
        Slightly slower than pre-input seek (~50-200 ms/clip) but cut-point accurate.
        """
        cmd = [
            "ffmpeg", "-y",
            "-i", src_path,
            "-ss", str(start),
            "-to", str(end),
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            "-map_metadata", "0",
            out_path,
        ]
        self._run_ffmpeg(cmd)

    def _re_encode(
        self,
        source: SourceFileInfo,
        seg: DerushSegment,
        out_path: str,
        use_nvenc: bool,
    ) -> None:
        """
        Re-encode: frame-accurate cuts, preserves source resolution/fps.
        Bitrate capped at 20 Mb/s (Instagram/social safe).
        """
        video_codec, video_args, audio_codec, audio_args = build_derush_encoding_settings(
            source_bitrate=source.video_bitrate,
            source_fps=source.fps,
            source_width=source.width,
            source_height=source.height,
            use_nvenc=use_nvenc,
        )
        cmd = [
            "ffmpeg", "-y",
            "-i", source.local_path,
            "-ss", str(seg.source_in),
            "-to", str(seg.source_out),
            "-c:v", video_codec,
            *video_args,
            "-c:a", audio_codec,
            *audio_args,
            out_path,
        ]
        self._run_ffmpeg(cmd)

    @staticmethod
    def _run_ffmpeg(cmd: list[str]) -> None:
        # Per-clip timeout: 120 s is plenty for a local file stream-copy of any length.
        # (300 s was the old value when we passed remote URLs; that code path is now gone.)
        # On timeout we raise so the ThreadPoolExecutor catches it, logs it as a soft error,
        # and the job still delivers a ZIP with the remaining clips.
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"FFmpeg timeout après 120 s — clip ignoré") from exc
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg error: {result.stderr[-500:]}")

    # ── Filename ───────────────────────────────────────────────────────────────

    @staticmethod
    def _make_filename(seg: DerushSegment) -> str:
        """
        {order:03d}_{shot_type}_{score}pts_{HH-MM-SS}_{HH-MM-SS}.mp4
        Dashes instead of colons for cross-OS (Windows/CapCut) compatibility.
        """
        def tc(secs: float) -> str:
            s = int(secs)
            hh, rem = divmod(s, 3600)
            mm, ss = divmod(rem, 60)
            return f"{hh:02d}-{mm:02d}-{ss:02d}"

        score_int = int(round(seg.score))
        shot = seg.shot_type or "unknown"
        return f"{seg.order:03d}_{shot}_{score_int}pts_{tc(seg.source_in)}_{tc(seg.source_out)}.mp4"

    # ── Helpers ────────────────────────────────────────────────────────────────

    @staticmethod
    def _detect_nvenc() -> bool:
        try:
            result = subprocess.run(
                ["ffmpeg", "-encoders"],
                capture_output=True, text=True, timeout=10,
            )
            return "hevc_nvenc" in result.stdout or "h264_nvenc" in result.stdout
        except Exception:
            return False

    @staticmethod
    def _zip_output(output_dir: str, export_input: DerushExportInput) -> str:
        import zipfile
        zip_path = os.path.join(output_dir, f"clips_{export_input.export_id}.zip")
        clips_dir = os.path.join(output_dir, "clips")
        # ZIP_STORED: video files are already compressed — deflate adds CPU overhead with 0 gain.
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
            for fname in sorted(os.listdir(clips_dir)):
                zf.write(os.path.join(clips_dir, fname), arcname=os.path.join("clips", fname))
        return zip_path
