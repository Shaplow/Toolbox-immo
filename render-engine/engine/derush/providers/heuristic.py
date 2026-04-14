from __future__ import annotations

from typing import Any

from engine.derush.models import DerushSegment, VisionProviderResult
from engine.derush.providers.base import VisionAnalysisProvider


class HeuristicProvider(VisionAnalysisProvider):
    """
    Default MVP provider — pure local heuristics, no API.

    Extracts shot_type estimate from frame aspect ratio and edge density.
    Returns no score override (scoring_engine already handles it).
    """

    def is_available(self) -> bool:
        return True

    def get_cost_estimate(self, segment_count: int, keyframe_count: int) -> float:
        return 0.0

    def analyze(
        self,
        segment: DerushSegment,
        frame_paths: list[str],
        options: dict[str, Any],
    ) -> VisionProviderResult:
        shot_type = self._estimate_shot_type(frame_paths)
        return VisionProviderResult(
            provider="heuristic",
            shot_type_override=shot_type,
        )

    def _estimate_shot_type(self, frame_paths: list[str]) -> str:
        """
        Rough shot type estimation based on face detection or edge density.
        Uses OpenCV cascade if available, otherwise edge-based heuristic.
        """
        if not frame_paths:
            return "unknown"
        try:
            return self._face_based_shot_type(frame_paths[0])
        except Exception:
            return "unknown"

    def _face_based_shot_type(self, frame_path: str) -> str:
        import cv2

        img = cv2.imread(frame_path)
        if img is None:
            return "unknown"

        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Use Haar cascade for face detection
        try:
            face_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            )
            faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
        except Exception:
            faces = []

        if len(faces) == 0:
            # No face: classify by edge density
            edges = cv2.Canny(gray, 50, 150)
            density = float(edges.sum()) / (edges.size * 255.0)
            if density < 0.03:
                return "wide"
            elif density > 0.12:
                return "insert"
            return "medium"

        # Classify by face-to-frame ratio
        largest_face = max(faces, key=lambda f: f[2] * f[3])
        fx, fy, fw, fh = largest_face
        face_ratio = (fw * fh) / (w * h)

        if face_ratio > 0.20:
            return "close"
        elif face_ratio > 0.05:
            return "medium"
        else:
            return "wide"
