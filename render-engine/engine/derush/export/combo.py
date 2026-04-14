from __future__ import annotations

import logging
import os
import shutil

from engine.derush.export.base import ExportProvider
from engine.derush.models import DerushExportInput, DerushSegment, ExportResult, SourceFileInfo

logger = logging.getLogger(__name__)

# Formats that can be combined (exclude combo_export itself to avoid recursion)
_COMBINABLE = frozenset({
    "clips_trimmed",
    "xml_timeline",
    "stringout_video",
    "structured_folder",
    "manifest_only",
})


class ComboExporter(ExportProvider):
    """
    Runs multiple exporters and zips all outputs together.

    combo_formats determines which exporters run.
    e.g. ["clips_trimmed", "manifest_only"] → clips + manifest in one ZIP.
    """

    def export(
        self,
        export_input: DerushExportInput,
        segments: list[DerushSegment],
        source_files: list[SourceFileInfo],
        output_dir: str,
    ) -> ExportResult:
        formats = [f for f in export_input.combo_formats if f in _COMBINABLE]
        if not formats:
            raise ValueError(f"combo_formats must contain at least one of {sorted(_COMBINABLE)}")

        combo_dir = os.path.join(output_dir, "combo")
        os.makedirs(combo_dir, exist_ok=True)

        total_exported = 0
        errors: list[str] = []

        for fmt in formats:
            sub_dir = os.path.join(combo_dir, fmt)
            os.makedirs(sub_dir, exist_ok=True)
            from engine.derush.export import get_exporter  # local import avoids circular dependency
            exporter = get_exporter(fmt)
            # Override output_prefix to sub-directory
            sub_input = _override_format(export_input, fmt)
            try:
                result = exporter.export(sub_input, segments, source_files, sub_dir)
                total_exported += result.exported_count
                logger.info("[combo] ✓ %s (%d)", fmt, result.exported_count)
            except Exception as exc:
                logger.error("[combo] ✗ %s: %s", fmt, exc)
                errors.append(f"{fmt}: {exc}")

        # Zip all sub-directories
        zip_name = f"combo_{export_input.export_id}"
        zip_path = shutil.make_archive(
            os.path.join(output_dir, zip_name),
            "zip",
            root_dir=output_dir,
            base_dir="combo",
        )

        return ExportResult(
            export_format="combo_export",
            output_key=f"{export_input.output_prefix}/{zip_name}.zip",
            exported_count=total_exported,
            encoding_mode="re_encode" if export_input.accurate_trim else "stream_copy",
            error="; ".join(errors) if errors else None,
        )


def _override_format(base: DerushExportInput, fmt: str) -> DerushExportInput:
    """Return a copy of DerushExportInput with export_format overridden."""
    import dataclasses
    return dataclasses.replace(base, export_format=fmt)
