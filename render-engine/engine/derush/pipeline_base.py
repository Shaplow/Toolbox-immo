from __future__ import annotations

import logging
from abc import ABC, abstractmethod

from engine.derush.models import DerushJobInput, DerushSegment, SourceFileInfo

logger = logging.getLogger(__name__)


class BasePipeline(ABC):
    """Common interface for all analysis pipelines."""

    @abstractmethod
    def analyze(
        self,
        source_files: list[SourceFileInfo],
        job_input: DerushJobInput,
    ) -> list[DerushSegment]:
        """
        Run analysis on all source files and return unsorted, unscored segments.
        Scoring and ranking are applied by the orchestrator.
        """
        ...

    def _make_segment_id(self, file_index: int, segment_index: int) -> str:
        return f"seg_{file_index:02d}_{segment_index:04d}"
