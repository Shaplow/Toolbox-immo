from __future__ import annotations

import base64
import json
import logging
from typing import Any

import httpx

from engine.derush.models import DerushSegment, VisionProviderResult
from engine.derush.providers.base import VisionAnalysisProvider

logger = logging.getLogger(__name__)

_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_MODEL = "gemini-2.0-flash"
_GEN_CONFIG = {"temperature": 0.1, "response_mime_type": "application/json"}

_VISION_PROMPT = """\
Analyse cette keyframe vidéo (immobilier ou autre).
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni explication :
{
  "room_type": "<cuisine|salon|chambre|salle_de_bain|exterieur|facade|piece_de_vie|bureau|terrasse|jardin|couloir|cave|garage|autre>",
  "ambiance": ["<lumineux|sombre|moderne|ancien|epure|chaleureux|a_renover|premium|standard>"],
  "shot_framing": "<plan_large|plan_moyen|plan_serre|detail|aerien>",
  "human_presence": false,
  "perceived_quality": "<premium|standard|a_renover>",
  "real_estate_tags": ["tags libres pertinents ex: parquet, vue_degagee, double_hauteur"]
}"""

_SPEECH_SYSTEM = """\
Tu es un assistant montage vidéo. Pour chaque segment de parole fourni, détermine :
1. s'il est exploitable pour un reel (phrase intelligible, complète ou quasi-complète)
2. ses formats potentiels parmi : hook, talking_head, qa_question, qa_answer, podcast_clip, context_statement, cta, vrai_faux, accroche, transition
3. la raison du rejet si non exploitable (truncated, incomprehensible, only_noise) ou null
Réponds UNIQUEMENT avec un objet JSON valide sans markdown."""


class GeminiProvider(VisionAnalysisProvider):
    """
    Gemini Flash provider — keyframe visual tagging + speech format detection.

    Vision:  analyze() — one keyframe per segment, returns structured visual_tags
    Speech:  analyze_speech_batch() — up to 10 text segments per API call
    """

    def __init__(self, api_key: str, model: str = _MODEL) -> None:
        self._api_key = api_key
        self._model = model

    def is_available(self) -> bool:
        return bool(self._api_key)

    def get_cost_estimate(self, segment_count: int, keyframe_count: int) -> float:
        # Gemini 2.0 Flash: ~$0.0001/image, ~$0.0001 per segment (rough estimate)
        return keyframe_count * 0.0001 + segment_count * 0.0001

    # ── Vision: keyframe analysis ─────────────────────────────────────────────

    def analyze(
        self,
        segment: DerushSegment,
        frame_paths: list[str],
        options: dict[str, Any],
    ) -> VisionProviderResult:
        if not frame_paths:
            return VisionProviderResult(provider="gemini")
        try:
            raw = self._call_vision(frame_paths[0])
            return self._parse_vision_result(raw)
        except Exception as exc:
            logger.warning("[gemini] vision analysis failed for %s: %s", segment.id, exc)
            return VisionProviderResult(provider="gemini")

    def _call_vision(self, frame_path: str) -> dict[str, Any]:
        with open(frame_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()
        payload = {
            "contents": [{
                "parts": [
                    {"inline_data": {"mime_type": "image/jpeg", "data": img_b64}},
                    {"text": _VISION_PROMPT},
                ],
            }],
            "generationConfig": _GEN_CONFIG,
        }
        return self._post(payload)

    def _parse_vision_result(self, raw: dict[str, Any]) -> VisionProviderResult:
        text = self._extract_text(raw)
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("[gemini] invalid JSON in vision response: %.200s", text)
            return VisionProviderResult(provider="gemini")

        # Map shot_framing → ShotType
        shot_type = None
        framing = data.get("shot_framing", "")
        if framing == "plan_serre":
            shot_type = "close"
        elif framing == "plan_moyen":
            shot_type = "medium"
        elif framing in ("plan_large", "aerien"):
            shot_type = "wide"
        elif framing == "detail":
            shot_type = "insert"

        # Build extra_tags for quick filtering in the UI
        extra_tags: list[str] = []
        room = data.get("room_type")
        if room:
            extra_tags.append(f"room:{room}")
        quality = data.get("perceived_quality")
        if quality:
            extra_tags.append(f"quality:{quality}")
        for amb in data.get("ambiance", []):
            extra_tags.append(f"ambiance:{amb}")
        if data.get("human_presence"):
            extra_tags.append("has_person")

        return VisionProviderResult(
            provider="gemini",
            shot_type_override=shot_type,
            extra_tags=extra_tags,
            visual_tags=data,
            raw_response=raw,
        )

    # ── Speech: batch format detection ───────────────────────────────────────

    def analyze_speech_batch(
        self,
        segments_data: list[dict[str, Any]],
        format_hint: str | None = None,
    ) -> dict[str, dict[str, Any]]:
        """
        Analyze speech segments in batches of 10.

        Args:
            segments_data: list of {"id": str, "text": str, "duration": float}
            format_hint:   optional context ("podcast", "qa", "immobilier"…)

        Returns:
            dict mapping segment_id → {"usable": bool, "format_hints": list, "reject_reason": str|None}
        """
        if not segments_data:
            return {}

        results: dict[str, dict[str, Any]] = {}
        for i in range(0, len(segments_data), 10):
            batch = segments_data[i: i + 10]
            try:
                results.update(self._call_speech_batch(batch, format_hint))
            except Exception as exc:
                logger.warning("[gemini] speech batch %d failed: %s", i // 10, exc)
                # Fail open: treat all as usable to avoid false rejections
                for seg in batch:
                    results[seg["id"]] = {"usable": True, "format_hints": [], "reject_reason": None}
        return results

    def _call_speech_batch(
        self,
        batch: list[dict[str, Any]],
        format_hint: str | None,
    ) -> dict[str, dict[str, Any]]:
        hint_line = f"Contexte du tournage : {format_hint}." if format_hint else ""
        segments_json = json.dumps(batch, ensure_ascii=False, indent=2)
        prompt = (
            f"{_SPEECH_SYSTEM}\n"
            f"{hint_line}\n\n"
            f"Segments à analyser :\n{segments_json}\n\n"
            'Réponds avec ce JSON exact :\n'
            '{"segments": [{"id": "...", "usable": true, "format_hints": ["hook"], "reject_reason": null}]}'
        )
        raw = self._post({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": _GEN_CONFIG})
        text = self._extract_text(raw)
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("[gemini] invalid JSON in speech response: %.300s", text)
            return {seg["id"]: {"usable": True, "format_hints": [], "reject_reason": None} for seg in batch}

        results: dict[str, dict[str, Any]] = {}
        for item in data.get("segments", []):
            seg_id = item.get("id", "")
            if seg_id:
                results[seg_id] = {
                    "usable": bool(item.get("usable", True)),
                    "format_hints": list(item.get("format_hints", [])),
                    "reject_reason": item.get("reject_reason"),
                }

        # Fill any segments Gemini omitted (fail open)
        for seg in batch:
            if seg["id"] not in results:
                results[seg["id"]] = {"usable": True, "format_hints": [], "reject_reason": None}

        return results

    # ── Transcription correction ──────────────────────────────────────────────

    def correct_transcription(
        self,
        segments_data: list[dict[str, Any]],
        context_prompt: str = "",
    ) -> dict[str, str]:
        """
        Correct transcription errors using global context.

        Args:
            segments_data: list of {"id": str, "text": str}
            context_prompt: format-specific guidance (from DerushFormat.contextPrompt)

        Returns:
            dict mapping segment_id → corrected_text (only segments that were changed)
        """
        if not segments_data:
            return {}

        system = (
            "Tu es un assistant de correction de transcription vidéo. "
            "Tu reçois une liste de segments de parole transcrits automatiquement. "
            "Corrige UNIQUEMENT les erreurs de transcription manifestes : "
            "noms propres (villes, quartiers, rues), termes techniques immobiliers "
            "(DPE, PTZ, loi Carrez, VEFA, BBC…), sigles, chiffres mal transcrits. "
            "NE reformule PAS les phrases. NE change PAS le style oral. "
            "Si un segment est déjà correct, renvoie son texte inchangé.\n"
        )
        if context_prompt.strip():
            system += f"\nContexte du tournage :\n{context_prompt.strip()}\n"

        segments_json = json.dumps(
            [{"id": s["id"], "text": s["text"]} for s in segments_data],
            ensure_ascii=False,
            indent=2,
        )
        prompt = (
            f"{system}\n"
            f"Segments à corriger :\n{segments_json}\n\n"
            'Réponds UNIQUEMENT avec ce JSON exact (sans markdown) :\n'
            '{"segments": [{"id": "...", "text": "texte corrigé"}]}'
        )

        try:
            raw = self._post({
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": _GEN_CONFIG,
            })
            text = self._extract_text(raw)
            data = json.loads(text)
        except Exception as exc:
            logger.warning("[gemini] correct_transcription failed: %s", exc)
            return {}

        corrections: dict[str, str] = {}
        original = {s["id"]: s["text"] for s in segments_data}
        for item in data.get("segments", []):
            seg_id = item.get("id", "")
            corrected = item.get("text", "")
            if seg_id and corrected and corrected != original.get(seg_id, ""):
                corrections[seg_id] = corrected
        return corrections

    # ── HTTP ──────────────────────────────────────────────────────────────────

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{_GEMINI_BASE}/{self._model}:generateContent"
        resp = httpx.post(url, params={"key": self._api_key}, json=payload, timeout=60.0)
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    def _extract_text(raw: dict[str, Any]) -> str:
        try:
            return raw["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            return ""
