from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from engine.derush.models import DerushExportInput, DerushSegment, ExportResult, SourceFileInfo


class ExportProvider(ABC):
    """Interface for all export formats."""

    @abstractmethod
    def export(
        self,
        export_input: DerushExportInput,
        segments: list[DerushSegment],
        source_files: list[SourceFileInfo],
        output_dir: str,
    ) -> ExportResult:
        """
        Run the export.

        Args:
            export_input: Job parameters (format, workflow, accurate_trim, etc.)
            segments: Full segment list (filtered to selected only internally)
            source_files: Source file metadata (local paths filled)
            output_dir: Temp directory for generated files

        Returns:
            ExportResult with output_key pointing to the uploaded R2 file.
        """
        ...

    def _selected(self, segments: list[DerushSegment], segment_ids: list[str] | None) -> list[DerushSegment]:
        """Return segments that are not rejected, optionally filtered by segment_ids."""
        selected = [s for s in segments if not s.is_rejected]
        if segment_ids:
            id_set = set(segment_ids)
            selected = [s for s in selected if s.id in id_set]
        return sorted(selected, key=lambda s: s.order)

    def _source_map(self, source_files: list[SourceFileInfo]) -> dict[str, SourceFileInfo]:
        return {src.id: src for src in source_files}
