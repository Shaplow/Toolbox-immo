from __future__ import annotations

import datetime
import json
import os

from engine.derush.export.base import ExportProvider
from engine.derush.models import DerushExportInput, DerushSegment, ExportResult, SourceFileInfo


class ManifestExporter(ExportProvider):
    """Generates manifest.json only — no video compute, usable server-side."""

    def export(
        self,
        export_input: DerushExportInput,
        segments: list[DerushSegment],
        source_files: list[SourceFileInfo],
        output_dir: str,
    ) -> ExportResult:
        selected = self._selected(segments, export_input.segment_ids)
        source_map = self._source_map(source_files)

        manifest = self._build_manifest(export_input, segments, selected, source_files)
        out_path = os.path.join(output_dir, f"manifest_{export_input.export_id}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

        return ExportResult(
            export_format="manifest_only",
            output_key=f"{export_input.output_prefix}/manifest_{export_input.export_id}.json",
            exported_count=len(selected),
            encoding_mode="stream_copy",
        )

    @staticmethod
    def _build_manifest(
        export_input: DerushExportInput,
        all_segments: list[DerushSegment],
        selected: list[DerushSegment],
        source_files: list[SourceFileInfo],
    ) -> dict:
        rejected = [s for s in all_segments if s.is_rejected]
        source_list = [
            {
                "id": src.id,
                "filename": src.filename,
                "r2_key": src.r2_key,
                "r2_public_url": src.r2_public_url,
                "duration": src.duration,
                "width": src.width,
                "height": src.height,
                "fps": src.fps,
            }
            for src in source_files
        ]
        return {
            "version": "1.0",
            "project_id": export_input.job_id,
            "export_id": export_input.export_id,
            "exported_at": datetime.datetime.utcnow().isoformat() + "Z",
            "source_files": source_list,
            "analysis_mode": all_segments[0].analysis_mode if all_segments else "unknown",
            "export_format": export_input.export_format,
            "workflow": export_input.workflow,
            "encoding_mode": "re_encode" if export_input.accurate_trim else "stream_copy",
            "stats": {
                "total_segments": len(all_segments),
                "selected_segments": len(selected),
                "rejected_segments": len(rejected),
                "total_selected_duration": round(sum(s.duration for s in selected), 2),
            },
            "segments": [s.to_dict() for s in all_segments],
        }
