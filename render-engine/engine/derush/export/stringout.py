from __future__ import annotations

import logging
import os
import subprocess
import tempfile

from engine.derush.export.base import ExportProvider
from engine.derush.models import DerushExportInput, DerushSegment, ExportResult, SourceFileInfo

logger = logging.getLogger(__name__)


class StringoutExporter(ExportProvider):
    """
    Concatenates selected segments into a single preview video (stringout).
    Uses FFmpeg concat demuxer — fast, no re-encode.
    Output: stringout_{export_id}.mp4
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
            raise ValueError("No segments selected for stringout")

        out_filename = f"stringout_{export_input.export_id}.mp4"
        out_path = os.path.join(output_dir, out_filename)

        # First trim each segment to a temp clip (stream copy), then concat
        with tempfile.TemporaryDirectory() as tmp_dir:
            # Write individual clips to tmp
            clip_paths: list[str] = []
            for idx, seg in enumerate(selected):
                src = source_map[seg.source_file_id]
                clip_path = os.path.join(tmp_dir, f"clip_{idx:04d}.mp4")
                self._stream_copy_clip(src.local_path, seg.source_in, seg.source_out, clip_path)
                clip_paths.append(clip_path)

            # Build concat list file
            concat_file = os.path.join(tmp_dir, "concat.txt")
            with open(concat_file, "w") as f:
                for cp in clip_paths:
                    f.write(f"file '{cp}'\n")

            # Concat
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_file,
                "-c", "copy",
                out_path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if result.returncode != 0:
                raise RuntimeError(f"FFmpeg stringout error: {result.stderr[-500:]}")

        logger.info("[stringout] created %s (%d segments)", out_filename, len(selected))
        return ExportResult(
            export_format="stringout_video",
            output_key=f"{export_input.output_prefix}/{out_filename}",
            exported_count=len(selected),
            encoding_mode="stream_copy",
        )

    @staticmethod
    def _stream_copy_clip(src: str, start: float, end: float, out: str) -> None:
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start),
            "-to", str(end),
            "-i", src,
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            out,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(f"Clip trim error: {result.stderr[-300:]}")
