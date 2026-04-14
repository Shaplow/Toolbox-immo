from __future__ import annotations

import logging
import os
import shutil
import subprocess

from engine.derush.export.base import ExportProvider
from engine.derush.export.manifest import ManifestExporter
from engine.derush.export.trimmed_clips import TrimmedClipExporter
from engine.derush.models import DerushExportInput, DerushSegment, ExportResult, SourceFileInfo

logger = logging.getLogger(__name__)


class StructuredFolderExporter(ExportProvider):
    """
    Exports a structured ZIP with clips, keyframes, manifest and optional rejected shots:

    derush_{export_id}/
      manifest.json
      clips/
        001_medium_87pts_00-00-05_00-00-12.mp4
        ...
      keyframes/
        seg_00_0001/
          frame_00.jpg
          ...
      rejected/              (if include_rejected=True)
        seg_00_0003.mp4
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

        folder_name = f"derush_{export_input.export_id}"
        folder_path = os.path.join(output_dir, folder_name)
        os.makedirs(os.path.join(folder_path, "clips"), exist_ok=True)
        os.makedirs(os.path.join(folder_path, "keyframes"), exist_ok=True)

        include_rejected = export_input.export_format == "structured_folder"  # always include for structured

        # Trim clips
        clip_exporter = TrimmedClipExporter()
        for seg in selected:
            seg.exported_filename = TrimmedClipExporter._make_filename(seg)
            src = source_map[seg.source_file_id]
            out_clip = os.path.join(folder_path, "clips", seg.exported_filename)
            clip_exporter._stream_copy(src.local_path, seg.source_in, seg.source_out, out_clip)
            logger.info("[structured_folder] ✓ %s", seg.exported_filename)

        # Copy keyframes
        for seg in segments:
            if seg.keyframe_r2_keys:
                kf_dir = os.path.join(folder_path, "keyframes", seg.id)
                os.makedirs(kf_dir, exist_ok=True)
                for idx, kf_path in enumerate(seg.keyframe_r2_keys):
                    if os.path.exists(kf_path):
                        shutil.copy(kf_path, os.path.join(kf_dir, f"frame_{idx:02d}.jpg"))

        # Manifest
        ManifestExporter.export(
            ManifestExporter(),
            export_input, segments, source_files,
            folder_path,
        )

        # ZIP
        zip_path = shutil.make_archive(
            os.path.join(output_dir, folder_name),
            "zip",
            root_dir=output_dir,
            base_dir=folder_name,
        )
        return ExportResult(
            export_format="structured_folder",
            output_key=f"{export_input.output_prefix}/{folder_name}.zip",
            exported_count=len(selected),
            encoding_mode="stream_copy",
        )
