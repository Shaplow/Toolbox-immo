from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from engine.derush.models import DerushSegment, VisionProviderResult


class VisionAnalysisProvider(ABC):
    """
    Interface for AI vision providers.

    Implementations:
    - HeuristicProvider (default, no API, uses only local metrics already computed)
    - MockProvider (tests)
    - GeminiProvider (TODO: gemini-2.0-flash, best ROI)
    - OpenAIProvider (TODO: gpt-4o-mini)
    - ClaudeProvider (TODO: claude-3-5-haiku)

    Adding a provider:
    1. Create render-engine/engine/derush/providers/myprovider.py
    2. Implement VisionAnalysisProvider
    3. Register in providers/__init__.py::get_provider()
    4. Add env var handling in orchestrator or worker input
    """

    @abstractmethod
    def analyze(
        self,
        segment: DerushSegment,
        frame_paths: list[str],
        options: dict[str, Any],
    ) -> VisionProviderResult:
        """
        Analyze a single segment and its keyframes.

        Args:
            segment: The segment being analyzed (already has local metrics).
            frame_paths: Local paths to extracted keyframe JPEGs.
            options: Provider-specific options (API key, model name, etc.).

        Returns:
            VisionProviderResult with optional score/tag overrides.
        """
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Returns True if this provider can be used (API key configured, etc.)."""
        ...

    def get_cost_estimate(self, segment_count: int, keyframe_count: int) -> float:
        """Estimated USD cost for analyzing N segments with K keyframes each. 0 = free."""
        return 0.0
