from __future__ import annotations

from typing import Any

from engine.derush.models import DerushSegment, VisionProviderResult
from engine.derush.providers.base import VisionAnalysisProvider


class MockProvider(VisionAnalysisProvider):
    """Test provider — returns deterministic fixed results without any API call."""

    def __init__(self, score_override: float | None = None) -> None:
        self._score_override = score_override

    def is_available(self) -> bool:
        return True

    def analyze(
        self,
        segment: DerushSegment,
        frame_paths: list[str],
        options: dict[str, Any],
    ) -> VisionProviderResult:
        return VisionProviderResult(
            provider="mock",
            score_override=self._score_override,
            shot_type_override="medium",
            description="Mock analysis — test only",
            extra_tags=["mock"],
        )
