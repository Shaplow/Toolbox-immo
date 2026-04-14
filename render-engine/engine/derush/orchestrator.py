from __future__ import annotations

import json
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import httpx

from engine.derush.models import (
    DerushJobInput,
    DerushPresetConfig,
    DerushSegment,
    SourceFileInfo,
)
from engine.derush.providers import get_provider
from engine.derush.pipeline_transcription import TranscriptionPipeline
from engine.derush.pipeline_vision import VisionPipeline
from engine.derush import scoring_engine
from engine.probe import probe_video

logger = logging.getLogger(__name__)


class DerushOrchestrator:
    """
    Dispatches to the correct pipeline, runs scoring, returns DerushSegment list.
    """

    def run(self, job_input: DerushJobInput) -> dict[str, Any]:
        """
        Full analysis run. Returns:
        {
            "segments": [DerushSegment.to_dict(), ...],
            "source_files": [SourceFileInfo dict, ...],
            "segment_count": int,
            "selected_count": int,
            "total_duration": float,
            "analysis_mode": str,
        }
        """
        with tempfile.TemporaryDirectory() as tmp_dir:
            source_files = self._download_sources(job_input, tmp_dir)
            segments = self._run_pipeline(source_files, job_input)
            scored = scoring_engine.score_and_rank(segments, job_input.preset_config)

            # Sub-segmentation: attempt to recover fragments from rejected shots (vision only)
            if job_input.analysis_mode == "vision":
                provider = get_provider(job_input.vision_provider, job_input.vision_provider_config)
                vision_pipeline = VisionPipeline(provider=None)  # no AI provider for fragments
                preset = job_input.preset_config or DerushPresetConfig()
                fragments = vision_pipeline._fragment_rejected_shots(scored, source_files, preset)
                if fragments:
                    scored_fragments = scoring_engine.score_and_rank(fragments, preset)
                    # Merge: append fragments after regular segments (scored has rejected inline)
                    scored = scored + scored_fragments

        selected = [s for s in scored if not s.is_rejected]

        # Re-rank globally (fragments may have scored higher than some accepted shots)
        accepted_all = [s for s in scored if not s.is_rejected]
        accepted_all.sort(key=lambda s: s.score, reverse=True)
        for rank, seg in enumerate(accepted_all, start=1):
            seg.order = rank

        total_duration = sum(
            src.duration for src in source_files if src.duration
        )

        return {
            "segments": [s.to_dict() for s in scored],
            "source_files": [self._source_to_dict(src) for src in source_files],
            "segment_count": len(scored),
            "selected_count": len(selected),
            "total_duration": total_duration,
            "analysis_mode": job_input.analysis_mode,
        }

    def _download_sources(
        self,
        job_input: DerushJobInput,
        tmp_dir: str,
    ) -> list[SourceFileInfo]:
        """
        Télécharge toutes les vidéos source en parallèle pour minimiser l'idle GPU.
        Les futures sont mappées à leur index pour garantir l'ordre de sortie.
        """
        sources_meta = list(zip(
            job_input.video_urls,
            job_input.video_r2_keys,
            job_input.video_filenames,
        ))

        def _download_one(idx: int, url: str, r2_key: str, filename: str) -> SourceFileInfo:
            ext = Path(filename).suffix or ".mp4"
            local_path = os.path.join(tmp_dir, f"src_{idx:02d}{ext}")
            logger.info("[orchestrator] downloading %s → %s", filename, local_path)
            with httpx.stream("GET", url, timeout=300) as resp:
                resp.raise_for_status()
                with open(local_path, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                        f.write(chunk)
            info = probe_video(local_path)
            return SourceFileInfo(
                id=f"src_{idx:02d}",
                filename=filename,
                local_path=local_path,
                r2_key=r2_key,
                r2_public_url=url,
                duration=info.duration,
                width=info.width,
                height=info.height,
                fps=info.fps or 25.0,
                video_bitrate=info.video_bitrate,
            )

        n = len(sources_meta)
        if n == 1:
            # Pas de surcharge ThreadPoolExecutor pour le cas simple
            idx, (url, r2_key, filename) = 0, sources_meta[0]
            return [_download_one(idx, url, r2_key, filename)]

        results: dict[int, SourceFileInfo] = {}
        with ThreadPoolExecutor(max_workers=n) as executor:
            futures = {
                executor.submit(_download_one, idx, url, r2_key, filename): idx
                for idx, (url, r2_key, filename) in enumerate(sources_meta)
            }
            for future in as_completed(futures):
                idx = futures[future]
                results[idx] = future.result()  # propagate exceptions

        return [results[i] for i in range(n)]

    def _run_pipeline(
        self,
        source_files: list[SourceFileInfo],
        job_input: DerushJobInput,
    ) -> list[DerushSegment]:
        mode = job_input.analysis_mode

        if mode == "transcription":
            pipeline = TranscriptionPipeline()
        elif mode == "vision":
            provider = get_provider(
                job_input.vision_provider,
                job_input.vision_provider_config,
            )
            pipeline = VisionPipeline(provider=provider)
        else:
            raise ValueError(f"Unknown analysis_mode: {mode!r}")

        return pipeline.analyze(source_files, job_input)

    def _source_to_dict(self, src: SourceFileInfo) -> dict[str, Any]:
        return {
            "id": src.id,
            "filename": src.filename,
            "r2_key": src.r2_key,
            "r2_public_url": src.r2_public_url,
            "duration": src.duration,
            "width": src.width,
            "height": src.height,
            "fps": src.fps,
        }
