from __future__ import annotations

import hashlib
import logging
import math
import os
import tempfile
from typing import TYPE_CHECKING, Any

from engine.derush.models import (
    DerushJobInput,
    DerushPresetConfig,
    DerushSegment,
    LocalMetrics,
    SourceFileInfo,
    SubSegmentConfig,
    VisionProviderResult,
)
from engine.derush.pipeline_base import BasePipeline

if TYPE_CHECKING:
    from engine.derush.providers.base import VisionAnalysisProvider

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

# Skip this many seconds at the start of a shot before extracting first frame
_KEYFRAME_START_SKIP = 0.5

# Sharpness (Laplacian variance) scale factor → score 0-100
# Calibrated for compressed H.265/HEVC (iPhone): typical sharp frame variance 100-400.
# scale=250 → variance 37.5 → score 15 (min threshold), variance 250 → score 100.
_SHARPNESS_SCALE = 250.0

# Optical flow magnitude threshold → shake
_SHAKE_THRESHOLD = 8.0  # mean px/frame

# dHash hamming distance threshold for deduplication
_DHASH_THRESHOLD = 10

# Duration scoring: optimal range 2-20s
_DURATION_OPT_MIN = 2.0
_DURATION_OPT_MAX = 20.0


# ─── Pipeline ─────────────────────────────────────────────────────────────────

class VisionPipeline(BasePipeline):
    """
    Full vision pipeline:
    1. Shot detection (PySceneDetect)
    2. Keyframe extraction (OpenCV)
    3. Local metrics (OpenCV + NumPy)
    4. Cross-file deduplication (dHash)
    5. Optional AI provider analysis
    """

    def __init__(self, provider: "VisionAnalysisProvider | None" = None) -> None:
        self.provider = provider
        self._cuda = False
        try:
            import cv2
            if cv2.cuda.getCudaEnabledDeviceCount() > 0:
                self._cuda = True
                logger.info("[vision] CUDA enabled (%d device(s))", cv2.cuda.getCudaEnabledDeviceCount())
        except Exception:
            pass

    def analyze(
        self,
        source_files: list[SourceFileInfo],
        job_input: DerushJobInput,
    ) -> list[DerushSegment]:
        all_segments: list[DerushSegment] = []
        all_metrics: list[LocalMetrics] = []

        for file_idx, src in enumerate(source_files):
            logger.info("[vision] processing file %d/%d: %s", file_idx + 1, len(source_files), src.filename)
            shots = self._detect_shots(src.local_path, src.duration)
            logger.info("[vision] detected %d shots in %s", len(shots), src.filename)

            for shot_idx, (shot_start, shot_end) in enumerate(shots):
                duration = shot_end - shot_start
                seg_id = self._make_segment_id(file_idx, shot_idx)

                keyframe_paths = self._extract_keyframes(src.local_path, shot_start, shot_end)
                metrics = self._compute_local_metrics(
                    src.local_path, shot_start, shot_end, keyframe_paths
                )

                seg = DerushSegment(
                    id=seg_id,
                    source_file_id=src.id,
                    source_in=shot_start,
                    source_out=shot_end,
                    duration=duration,
                    analysis_mode="vision",
                )
                seg._local_metrics = metrics
                all_segments.append(seg)
                all_metrics.append(metrics)

        # Cross-file deduplication
        self._mark_duplicates(all_segments, all_metrics)

        # Optional AI provider
        if self.provider and self.provider.is_available():
            logger.info("[vision] running AI provider: %s", self.provider.__class__.__name__)
            for seg in all_segments:
                if seg.is_rejected:
                    continue
                keyframe_paths = seg.keyframe_r2_keys  # local paths stored here temporarily
                try:
                    result: VisionProviderResult = self.provider.analyze(
                        seg, keyframe_paths, job_input.vision_provider_config
                    )
                    self._apply_provider_result(seg, result)
                except Exception as exc:
                    logger.warning("[vision] provider failed for %s: %s", seg.id, exc)

        return all_segments

    # ── Sub-segment fragmentation ─────────────────────────────────────────────

    def _fragment_rejected_shots(
        self,
        segments: list[DerushSegment],
        source_files: list[SourceFileInfo],
        preset: DerushPresetConfig,
    ) -> list[DerushSegment]:
        """
        For each rejected shot (blurry/shake/overexposed/underexposed) that is
        long enough, slide a window over [source_in, source_out] and re-score
        each window independently.  Fragments that pass all hard-reject checks
        are returned as new DerushSegment objects with is_sub_segment=True.
        """
        cfg: SubSegmentConfig = preset.sub_segment
        if not cfg.enabled:
            return []

        # Reject-reasons that make fragmentation worth attempting
        _FRAGMENTABLE: set[str] = {"blurry", "shake", "overexposed", "underexposed"}

        # Build source-file lookup
        src_by_id: dict[str, SourceFileInfo] = {s.id: s for s in source_files}

        fragments: list[DerushSegment] = []
        frag_counter: dict[str, int] = {}  # parent_id → fragment index

        for seg in segments:
            if not seg.is_rejected:
                continue
            if seg.reject_reason not in _FRAGMENTABLE:  # type: ignore[operator]
                continue
            if seg.duration < cfg.min_parent_duration:
                continue

            src = src_by_id.get(seg.source_file_id)
            if src is None:
                continue

            logger.info(
                "[vision] fragmenting rejected shot %s (%.1fs, reason=%s)",
                seg.id, seg.duration, seg.reject_reason,
            )

            # Load all frames for this shot ONCE at 2fps — avoids reopening the file per window
            preloaded = self._preload_shot_frames(src.local_path, seg.source_in, seg.source_out, fps=2.0)
            if not preloaded:
                continue

            # Try multiple window sizes from largest to smallest
            window_sizes = sorted(
                set(round(w, 2) for w in [cfg.max_window, (cfg.min_window + cfg.max_window) / 2, cfg.min_window]
                    if w >= cfg.min_window),
                reverse=True,
            )

            # Collect all candidate fragments
            candidates: list[tuple[float, float, float, LocalMetrics]] = []  # (start, end, sharpness, metrics)

            thresholds = preset.reject_thresholds
            # Relaxed thresholds for fragments: we're looking for the least-bad window,
            # not a perfect shot. iPhone stabilisation still produces some shake on the
            # global shot, but sub-windows can be stable.
            frag_min_sharpness = max(8.0, thresholds.min_sharpness * 0.5)
            frag_min_stability = max(0.0, 100.0 - thresholds.max_shake * 12.0)

            for win_size in window_sizes:
                t = seg.source_in
                while t + cfg.min_window <= seg.source_out:
                    w_start = t
                    w_end = min(t + win_size, seg.source_out)
                    if (w_end - w_start) < cfg.min_window:
                        break

                    # Filter pre-loaded frames that fall inside this window
                    win_frames = [f for ts, f in preloaded if w_start <= ts <= w_end]
                    if not win_frames:
                        t += cfg.stride
                        continue

                    metrics = self._metrics_from_frames_fast(win_frames, w_end - w_start)

                    # Hard-reject checks — cheapest first
                    if metrics.sharpness_score < frag_min_sharpness:
                        t += cfg.stride
                        continue
                    if metrics.exposure_score < 10.0:
                        t += cfg.stride
                        continue
                    if metrics.exposure_score > 98.0 and metrics.sharpness_score < 20.0:
                        t += cfg.stride
                        continue
                    if metrics.stability_score < frag_min_stability:
                        t += cfg.stride
                        continue

                    candidates.append((w_start, w_end, metrics.sharpness_score, metrics))
                    t += cfg.stride

            if not candidates:
                continue

            # NMS: suppress windows with >50% IoU if lower sharpness
            candidates.sort(key=lambda c: c[2], reverse=True)
            kept: list[tuple[float, float, float, LocalMetrics]] = []
            for cand in candidates:
                c_start, c_end, _, c_metrics = cand
                overlapping = False
                for k_start, k_end, _, _ in kept:
                    overlap = max(0.0, min(c_end, k_end) - max(c_start, k_start))
                    union = max(c_end, k_end) - min(c_start, k_start)
                    if union > 0 and overlap / union > 0.5:
                        overlapping = True
                        break
                if not overlapping:
                    kept.append(cand)

            # Sort by timeline order
            kept.sort(key=lambda c: c[0])

            frag_counter.setdefault(seg.id, 0)
            for frag_start, frag_end, _, frag_metrics in kept:
                frag_counter[seg.id] += 1
                frag_id = f"{seg.id}_f{frag_counter[seg.id]:02d}"

                frag = DerushSegment(
                    id=frag_id,
                    source_file_id=seg.source_file_id,
                    source_in=frag_start,
                    source_out=frag_end,
                    duration=frag_end - frag_start,
                    analysis_mode="vision",
                    parent_id=seg.id,
                    is_sub_segment=True,
                )
                frag._local_metrics = frag_metrics
                frag.tags.append("fragment")
                fragments.append(frag)

        logger.info("[vision] sub-segmentation produced %d fragments from rejected shots", len(fragments))
        return fragments

    # ── Preload frames for sub-segmentation ───────────────────────────────────

    def _preload_shot_frames(
        self,
        video_path: str,
        start: float,
        end: float,
        fps: float = 2.0,
    ) -> list[tuple[float, "Any"]]:
        """
        Open the video file ONCE and return a list of (timestamp, bgr_frame) sampled
        at `fps` frames per second across [start, end].  Frames are resized to max
        640px wide to save RAM and speed up downstream numpy operations.
        """
        import cv2

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return []

        step = 1.0 / fps
        result: list[tuple[float, Any]] = []
        t = start
        while t <= end + 1e-6:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ret, frame = cap.read()
            if ret and frame is not None:
                h, w = frame.shape[:2]
                if w > 640:
                    scale = 640.0 / w
                    frame = cv2.resize(frame, (640, int(h * scale)), interpolation=cv2.INTER_AREA)
                result.append((t, frame))
            t += step
        cap.release()
        return result

    def _metrics_from_frames_fast(
        self,
        frames: list["Any"],
        duration: float,
    ) -> LocalMetrics:
        """
        Compute LocalMetrics entirely from in-memory BGR numpy frames.
        No disk I/O — used by the sub-segmentation sliding window.
        """
        import cv2
        import numpy as np

        metrics = LocalMetrics()
        if not frames:
            return metrics

        # ── Sharpness: Laplacian variance on each frame, keep best ───────────
        best_sharpness = 0.0
        best_frame = None
        for frame in frames:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            if lap_var > best_sharpness:
                best_sharpness = lap_var
                best_frame = frame
        metrics.sharpness_raw = best_sharpness
        metrics.sharpness_score = min(100.0, (best_sharpness / _SHARPNESS_SCALE) * 100.0)

        if best_frame is None:
            return metrics

        # ── Exposure (HSV V-channel) ─────────────────────────────────────────
        hsv = cv2.cvtColor(best_frame, cv2.COLOR_BGR2HSV)
        v_channel = hsv[:, :, 2]
        mean_v = float(v_channel.mean())
        std_v = float(v_channel.std())
        exposure_base = 100.0 - abs(mean_v - 140.0) / 1.4
        exposure_variability = min(30.0, std_v) / 30.0 * 20.0
        metrics.exposure_score = max(0.0, min(100.0, exposure_base + exposure_variability))

        # ── Composition (edge density + rule-of-thirds) ──────────────────────
        gray_best = cv2.cvtColor(best_frame, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray_best, 50, 150)
        edge_density = float(edges.sum()) / (edges.size * 255.0)
        comp_edge = 100.0 - abs(edge_density * 100.0 - 9.0) * 8.0
        h, w = gray_best.shape
        third_h, third_w = h // 3, w // 3
        roi_edges = (
            edges[third_h:2 * third_h, third_w:2 * third_w].sum() /
            max(1, edges[third_h:2 * third_h, third_w:2 * third_w].size)
        )
        comp_thirds = float(roi_edges) / 255.0 * 100.0
        metrics.composition_score = max(0.0, min(100.0, comp_edge * 0.7 + comp_thirds * 0.3))

        # ── Stability: optical flow between first and last frame ─────────────
        if len(frames) >= 2:
            f1 = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY)
            f2 = cv2.cvtColor(frames[-1], cv2.COLOR_BGR2GRAY)
            # Both already resized to ≤640px; resize to 320px for flow speed
            scale = 320.0 / f1.shape[1]
            new_size = (320, int(f1.shape[0] * scale))
            f1s = cv2.resize(f1, new_size)
            f2s = cv2.resize(f2, new_size)
            try:
                flow = cv2.calcOpticalFlowFarneback(
                    f1s, f2s, None,
                    pyr_scale=0.5, levels=3, winsize=15,
                    iterations=3, poly_n=5, poly_sigma=1.2, flags=0,
                )
                mag, ang = cv2.cartToPolar(flow[..., 0], flow[..., 1])
                mean_mag = float(mag.mean())
                ang_std = float(ang.std())
                if mean_mag < 1.0:
                    metrics.stability_score = 100.0
                    metrics.motion_type = "static"
                elif mean_mag < _SHAKE_THRESHOLD and ang_std < 1.0:
                    mean_ang = float(ang.mean())
                    metrics.motion_type = "pan" if abs(math.cos(mean_ang)) > abs(math.sin(mean_ang)) else "tilt"
                    metrics.stability_score = max(50.0, 100.0 - mean_mag * 5.0)
                elif mean_mag >= _SHAKE_THRESHOLD or ang_std > 2.0:
                    metrics.motion_type = "shake"
                    metrics.stability_score = max(0.0, 100.0 - mean_mag * 8.0)
                else:
                    metrics.motion_type = "complex"
                    metrics.stability_score = max(20.0, 80.0 - mean_mag * 4.0)
            except Exception:
                metrics.stability_score = 50.0
                metrics.motion_type = "unknown"
        else:
            metrics.stability_score = 50.0
            metrics.motion_type = "unknown"

        # ── Duration score ────────────────────────────────────────────────────
        if _DURATION_OPT_MIN <= duration <= _DURATION_OPT_MAX:
            metrics.duration_score = 100.0
        elif duration < _DURATION_OPT_MIN:
            metrics.duration_score = (duration / _DURATION_OPT_MIN) * 80.0
        else:
            metrics.duration_score = max(40.0, 100.0 - (duration - _DURATION_OPT_MAX) * 2.0)

        return metrics

    # ── Shot detection ────────────────────────────────────────────────────────

    def _detect_shots(self, video_path: str, duration: float) -> list[tuple[float, float]]:
        try:
            return self._scenedetect_shots(video_path, duration)
        except Exception as exc:
            logger.warning("[vision] scenedetect failed (%s), falling back to fixed window", exc)
            return self._fixed_window_shots(duration)

    def _scenedetect_shots(self, video_path: str, duration: float) -> list[tuple[float, float]]:
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import ContentDetector

        video = open_video(video_path)
        scene_manager = SceneManager()
        scene_manager.add_detector(ContentDetector(threshold=27.0, min_scene_len=15))
        scene_manager.detect_scenes(video, show_progress=False)
        scenes = scene_manager.get_scene_list()

        shots: list[tuple[float, float]] = []
        for start_tc, end_tc in scenes:
            shots.append((start_tc.get_seconds(), end_tc.get_seconds()))

        # If no cuts detected, treat entire file as single shot
        if not shots:
            shots = [(0.0, duration)]
        return shots

    def _fixed_window_shots(self, duration: float, window: float = 5.0) -> list[tuple[float, float]]:
        """Fallback: fixed-size windows when scenedetect unavailable."""
        shots: list[tuple[float, float]] = []
        t = 0.0
        while t < duration - 0.5:
            shots.append((t, min(t + window, duration)))
            t += window
        return shots or [(0.0, duration)]

    # ── Keyframe extraction ────────────────────────────────────────────────────

    def _extract_keyframes(
        self,
        video_path: str,
        shot_start: float,
        shot_end: float,
    ) -> list[str]:
        """Extract up to 3 representative frames: first useful, middle, sharpest."""
        import cv2

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        duration = shot_end - shot_start
        paths: list[str] = []

        candidate_times = [
            min(shot_start + _KEYFRAME_START_SKIP, shot_start + duration * 0.1),
            shot_start + duration * 0.5,
        ]

        # For shots > 3s, also sample at 75% to find sharpest
        if duration > 3.0:
            candidate_times.append(shot_start + duration * 0.75)

        best_sharpness = -1.0
        best_frame_path: str | None = None

        for t in candidate_times:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ret, frame = cap.read()
            if not ret:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            cv2.imwrite(tmp.name, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            paths.append(tmp.name)
            if sharpness > best_sharpness:
                best_sharpness = sharpness
                best_frame_path = tmp.name

        cap.release()

        # Reorder: best frame first if found and not already first
        if best_frame_path and paths and paths[0] != best_frame_path:
            paths.remove(best_frame_path)
            paths.insert(0, best_frame_path)

        return paths[:3]

    # ── Local metrics ──────────────────────────────────────────────────────────

    def _compute_local_metrics(
        self,
        video_path: str,
        shot_start: float,
        shot_end: float,
        keyframe_paths: list[str],
    ) -> LocalMetrics:
        import cv2
        import numpy as np

        duration = shot_end - shot_start
        metrics = LocalMetrics()

        if not keyframe_paths:
            logger.warning("[vision] no keyframes extracted for shot %.2f-%.2f in %s — sharpness=0",
                           shot_start, shot_end, video_path)
            return metrics

        # ── Sharpness (Laplacian variance on best frame) ──────────────────────
        best_sharpness = 0.0
        best_frame = None
        for kp in keyframe_paths:
            img = cv2.imread(kp)
            if img is None:
                continue
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            if self._cuda:
                try:
                    gpu_gray = cv2.cuda_GpuMat()
                    gpu_gray.upload(gray)
                    gpu_lap = cv2.cuda.createLaplacianFilter(cv2.CV_8U, cv2.CV_32F)
                    gpu_result = gpu_lap.apply(gpu_gray)
                    lap_var = float(gpu_result.download().var())
                except Exception:
                    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            else:
                lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            if lap_var > best_sharpness:
                best_sharpness = lap_var
                best_frame = img
        metrics.sharpness_raw = best_sharpness
        metrics.sharpness_score = min(100.0, (best_sharpness / _SHARPNESS_SCALE) * 100.0)
        logger.debug("[vision] sharpness raw_lap_var=%.1f → score=%.1f (scale=%.0f)",
                     best_sharpness, metrics.sharpness_score, _SHARPNESS_SCALE)

        # ── Exposure (HSV V-channel histogram) ───────────────────────────────
        if best_frame is not None:
            hsv = cv2.cvtColor(best_frame, cv2.COLOR_BGR2HSV)
            v_channel = hsv[:, :, 2]
            mean_v = float(v_channel.mean())
            std_v = float(v_channel.std())
            # Optimal: mean 100-180 (not over/under exposed), std > 30 (not flat)
            exposure_base = 100.0 - abs(mean_v - 140.0) / 1.4  # 0-100
            exposure_variability = min(30.0, std_v) / 30.0 * 20.0  # 0-20 bonus
            metrics.exposure_score = max(0.0, min(100.0, exposure_base + exposure_variability))

            # ── Composition (edge density + rule-of-thirds) ────────────────
            gray = cv2.cvtColor(best_frame, cv2.COLOR_BGR2GRAY)
            if self._cuda:
                try:
                    gpu_gray = cv2.cuda_GpuMat()
                    gpu_gray.upload(gray)
                    gpu_canny = cv2.cuda.createCannyEdgeDetector(50, 150)
                    edges = gpu_canny.detect(gpu_gray).download()
                except Exception:
                    edges = cv2.Canny(gray, 50, 150)
            else:
                edges = cv2.Canny(gray, 50, 150)
            edge_density = float(edges.sum()) / (edges.size * 255.0)
            # Optimal edge density 3-15%
            comp_edge = 100.0 - abs(edge_density * 100.0 - 9.0) * 8.0
            h, w = gray.shape
            # Rule of thirds: check if edges concentrate near thirds intersections
            third_h, third_w = h // 3, w // 3
            roi_edges = (
                edges[third_h:2*third_h, third_w:2*third_w].sum() /
                max(1, edges[third_h:2*third_h, third_w:2*third_w].size)
            )
            comp_thirds = float(roi_edges) / 255.0 * 100.0
            metrics.composition_score = max(0.0, min(100.0, comp_edge * 0.7 + comp_thirds * 0.3))

        # ── Stability (optical flow between 2 frames in the shot) ────────────
        metrics.stability_score, metrics.motion_type = self._compute_stability(
            video_path, shot_start, shot_end
        )

        # ── Duration score ────────────────────────────────────────────────────
        if _DURATION_OPT_MIN <= duration <= _DURATION_OPT_MAX:
            metrics.duration_score = 100.0
        elif duration < _DURATION_OPT_MIN:
            metrics.duration_score = (duration / _DURATION_OPT_MIN) * 80.0
        else:
            # Diminishing returns above 20s
            metrics.duration_score = max(40.0, 100.0 - (duration - _DURATION_OPT_MAX) * 2.0)

        # ── Perceptual hash (for deduplication) ───────────────────────────────
        if keyframe_paths:
            metrics.dhash = self._dhash(keyframe_paths[0])

        return metrics

    def _compute_stability(
        self,
        video_path: str,
        shot_start: float,
        shot_end: float,
    ) -> tuple[float, str]:
        """Returns (stability_score 0-100, motion_type)."""
        import cv2
        import numpy as np

        cap = cv2.VideoCapture(video_path)
        duration = shot_end - shot_start

        # Sample 2 frames: 20% and 80% through the shot
        t1 = shot_start + duration * 0.2
        t2 = shot_start + duration * 0.8

        frames = []
        for t in [t1, t2]:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ret, frame = cap.read()
            if ret:
                frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        cap.release()

        if len(frames) < 2:
            return 70.0, "unknown"

        f1, f2 = frames
        # Resize to 320px wide for speed
        scale = 320.0 / f1.shape[1]
        new_size = (320, int(f1.shape[0] * scale))
        f1_small = cv2.resize(f1, new_size)
        f2_small = cv2.resize(f2, new_size)

        try:
            if self._cuda:
                try:
                    gpu_f1 = cv2.cuda_GpuMat(); gpu_f1.upload(f1_small)
                    gpu_f2 = cv2.cuda_GpuMat(); gpu_f2.upload(f2_small)
                    farneback = cv2.cuda.FarnebackOpticalFlow.create(
                        numLevels=3, pyrScale=0.5, fastPyramids=False,
                        winSize=15, numIters=3, polyN=5, polySigma=1.2, flags=0
                    )
                    gpu_flow = farneback.calc(gpu_f1, gpu_f2, None)
                    flow = gpu_flow.download()
                except Exception:
                    flow = cv2.calcOpticalFlowFarneback(
                        f1_small, f2_small, None,
                        pyr_scale=0.5, levels=3, winsize=15,
                        iterations=3, poly_n=5, poly_sigma=1.2, flags=0
                    )
            else:
                flow = cv2.calcOpticalFlowFarneback(
                    f1_small, f2_small, None,
                    pyr_scale=0.5, levels=3, winsize=15,
                    iterations=3, poly_n=5, poly_sigma=1.2, flags=0
                )
            mag, ang = cv2.cartToPolar(flow[..., 0], flow[..., 1])
            mean_mag = float(mag.mean())
            max_mag = float(mag.max())

            # Detect motion type from flow direction variance
            ang_std = float(ang.std())
            if mean_mag < 1.0:
                motion_type = "static"
                stability_score = 100.0
            elif mean_mag < _SHAKE_THRESHOLD and ang_std < 1.0:
                # Consistent direction = pan or tilt
                mean_ang = float(ang.mean())
                motion_type = "pan" if abs(math.cos(mean_ang)) > abs(math.sin(mean_ang)) else "tilt"
                stability_score = max(50.0, 100.0 - mean_mag * 5.0)
            elif mean_mag >= _SHAKE_THRESHOLD or ang_std > 2.0:
                motion_type = "shake"
                stability_score = max(0.0, 100.0 - mean_mag * 8.0)
            else:
                motion_type = "complex"
                stability_score = max(20.0, 80.0 - mean_mag * 4.0)

            return min(100.0, stability_score), motion_type

        except Exception:
            return 70.0, "unknown"

    def _dhash(self, image_path: str, hash_size: int = 8) -> str | None:
        """Difference hash for perceptual deduplication."""
        import cv2
        import numpy as np

        img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return None
        resized = cv2.resize(img, (hash_size + 1, hash_size))
        diff = resized[:, 1:] > resized[:, :-1]
        hash_int = 0
        for bit in diff.flatten():
            hash_int = (hash_int << 1) | int(bit)
        return f"{hash_int:0{hash_size * hash_size}b}"

    def _hamming_distance(self, h1: str, h2: str) -> int:
        return sum(c1 != c2 for c1, c2 in zip(h1, h2))

    # ── Deduplication ─────────────────────────────────────────────────────────

    def _mark_duplicates(
        self,
        segments: list[DerushSegment],
        metrics: list[LocalMetrics],
    ) -> None:
        """Mark near-duplicate shots (high perceptual similarity)."""
        seen: list[tuple[str, int]] = []  # (dhash, seg_index)
        for idx, (seg, m) in enumerate(zip(segments, metrics)):
            if not m.dhash or seg.is_rejected:
                continue
            is_dup = False
            for seen_hash, seen_idx in seen:
                dist = self._hamming_distance(m.dhash, seen_hash)
                if dist <= _DHASH_THRESHOLD:
                    is_dup = True
                    break
            if is_dup:
                seg.is_rejected = True
                seg.reject_reason = "duplicate"
                if "duplicate" not in seg.tags:
                    seg.tags.append("duplicate")
            else:
                seen.append((m.dhash, idx))

    # ── Provider result application ───────────────────────────────────────────

    def _apply_provider_result(
        self,
        seg: DerushSegment,
        result: VisionProviderResult,
    ) -> None:
        if result.shot_type_override:
            seg.shot_type = result.shot_type_override
        if result.extra_tags:
            for tag in result.extra_tags:
                if tag not in seg.tags:
                    seg.tags.append(tag)
        if result.visual_tags is not None:
            seg.visual_tags = result.visual_tags
        # score_override is applied later in scoring_engine after normalization
        if result.score_override is not None and seg.score_breakdown:
            seg.score_breakdown.visual_interest = result.score_override
