"""
ClipRanker – The core virality engine.

7-Stage Pipeline:
1. Sliding window extraction (5s–60s windows, 0.5s stride)
2. Feature vector computation (512-dim) from transcript + audio + visual
3. ViralityScorerModel inference
4. Non-Maximum Suppression (IoU-based)
5. Hook optimization (best start frame within ±2s)
6. Exit optimization (punchline / natural pause / laugh peak)
7. Loop score computation + ranking
"""
from __future__ import annotations

import asyncio
import math
import tempfile
import uuid
from typing import Any

import numpy as np
import structlog

log = structlog.get_logger(__name__)

# Power words that signal high virality potential
POWER_WORDS = frozenset(
    [
        "insane", "crazy", "unbelievable", "shocking", "incredible", "amazing",
        "never", "always", "secret", "revealed", "truth", "exposed", "banned",
        "can't", "won't", "don't", "stop", "wait", "watch", "look", "listen",
        "first", "last", "only", "best", "worst", "most", "least",
        "died", "fired", "arrested", "sued", "destroyed", "broke",
        "free", "money", "win", "lost", "found",
    ]
)

# Platform-specific duration targets
PLATFORM_DURATION_TARGETS = {
    "tiktok": (15.0, 60.0),
    "instagram": (15.0, 90.0),
    "youtube": (30.0, 180.0),
    "twitter": (15.0, 140.0),
}


class ClipRanker:
    """Core virality detection and clip ranking engine."""

    _instance: "ClipRanker | None" = None
    _virality_model = None

    def __new__(cls) -> "ClipRanker":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._initialized = True
        self._load_virality_model()

    def _load_virality_model(self) -> None:
        """Load trained ViralityScorerModel if checkpoint exists."""
        from app.config import get_settings

        settings = get_settings()
        checkpoint_path = f"{settings.MODEL_CHECKPOINT_DIR}/virality_scorer_latest.pt"

        try:
            import torch
            from app.services.training.model import ViralityScorerModel

            model = ViralityScorerModel(input_dim=512)
            model.load_state_dict(
                torch.load(checkpoint_path, map_location=settings.DEVICE)
            )
            model.eval()
            model.to(settings.DEVICE)
            self._virality_model = model
            log.info("clip_ranker.virality_model_loaded", path=checkpoint_path)
        except FileNotFoundError:
            log.info("clip_ranker.virality_model_not_found_using_heuristic")
        except Exception as e:
            log.warning("clip_ranker.virality_model_load_error", error=str(e))

    # ── Public API ────────────────────────────────────────────────────────────

    async def detect_viral_clips(
        self,
        source_media_id: str,
        s3_key: str,
        transcript_segments: list[dict],
        scene_graph: dict,
        config: dict,
    ) -> tuple[list[dict], int]:
        """
        Main entry point: run full 7-stage pipeline.
        Returns (clip_candidates, total_windows_evaluated).
        """
        from app.utils.video_io import VideoIO
        from app.services.audio_analyzer import AudioAnalyzer
        from app.services.hook_analyzer import HookAnalyzer
        from app.services.face_tracker import FaceTracker

        min_dur = config.get("min_duration", 5.0)
        max_dur = config.get("max_duration", 60.0)
        stride = config.get("window_stride", 0.5)
        top_k = config.get("top_k", 10)
        nms_iou = config.get("nms_iou_threshold", 0.3)

        with tempfile.TemporaryDirectory(prefix="ranker_") as tmp_dir:
            local_path = await asyncio.to_thread(VideoIO.download_from_s3, s3_key, tmp_dir)
            duration = VideoIO.get_duration(local_path)

            if duration < min_dur:
                return [], 0

            # Extract audio features for full video
            audio_analyzer = AudioAnalyzer()
            audio_features = await asyncio.to_thread(
                audio_analyzer.analyze, local_path
            )

            # Stage 1: Generate sliding windows
            windows = self._generate_windows(duration, min_dur, max_dur, stride)
            log.info("clip_ranker.windows_generated", count=len(windows))

            # Stage 2+3: Score each window
            scored_windows = await asyncio.to_thread(
                self._score_windows,
                windows,
                transcript_segments,
                scene_graph,
                audio_features,
                duration,
                config,
                local_path,
            )

            total_evaluated = len(scored_windows)

            # Stage 4: Non-Maximum Suppression
            nms_windows = self._non_max_suppression(scored_windows, iou_threshold=nms_iou)

            # Sort by score
            nms_windows.sort(key=lambda x: x["virality_score"], reverse=True)
            top_windows = nms_windows[:top_k]

            # Stage 5+6+7: Refine hooks, exits, loop scores
            hook_analyzer = HookAnalyzer()
            face_tracker = FaceTracker()

            candidates = []
            for win in top_windows:
                refined = await asyncio.to_thread(
                    self._refine_clip,
                    win,
                    local_path,
                    transcript_segments,
                    audio_features,
                    hook_analyzer,
                    face_tracker,
                    source_media_id,
                )
                candidates.append(refined)

        candidates.sort(key=lambda x: x["virality_score"], reverse=True)
        return candidates, total_evaluated

    async def score_clip(
        self,
        s3_key: str,
        start_time: float,
        end_time: float,
        transcript_snippet: str,
        scene_data: dict,
        platform: str | None = None,
    ) -> dict[str, Any]:
        """Score a specific clip window."""
        from app.utils.video_io import VideoIO
        from app.services.audio_analyzer import AudioAnalyzer

        with tempfile.TemporaryDirectory(prefix="score_") as tmp_dir:
            local_path = await asyncio.to_thread(VideoIO.download_from_s3, s3_key, tmp_dir)
            audio_analyzer = AudioAnalyzer()
            audio_features = await asyncio.to_thread(audio_analyzer.analyze, local_path)

            feature_vec = self._compute_feature_vector(
                start_time=start_time,
                end_time=end_time,
                transcript_segments=[],
                scene_graph={},
                audio_features=audio_features,
            )
            score_breakdown = self._run_virality_model(feature_vec, transcript_snippet)

        duration = end_time - start_time
        duration_fit = self._score_duration_fit(duration, platform)
        platform_fit = self._score_platform_fit(transcript_snippet, platform)

        score_breakdown["duration_fit_score"] = duration_fit
        score_breakdown["platform_fit_score"] = platform_fit
        score_breakdown["feature_vector_dim"] = len(feature_vec)
        score_breakdown["dominant_emotion"] = scene_data.get("dominant_emotion")

        return score_breakdown

    # ── Stage 1: Sliding Windows ──────────────────────────────────────────────

    def _generate_windows(
        self,
        duration: float,
        min_dur: float,
        max_dur: float,
        stride: float,
    ) -> list[dict]:
        """Generate all sliding window candidates."""
        windows = []
        # Use multiple window sizes (short, medium, long)
        window_sizes = []
        current = min_dur
        while current <= max_dur:
            window_sizes.append(current)
            current += (max_dur - min_dur) / 4 if max_dur > min_dur else max_dur

        for win_size in set(window_sizes):
            start = 0.0
            while start + win_size <= duration:
                windows.append({"start_time": round(start, 2), "end_time": round(start + win_size, 2)})
                start += stride

        return windows

    # ── Stage 2+3: Feature Vectors + Scoring ─────────────────────────────────

    def _score_windows(
        self,
        windows: list[dict],
        transcript_segments: list[dict],
        scene_graph: dict,
        audio_features: dict,
        duration: float,
        config: dict,
        local_path: str,
    ) -> list[dict]:
        """Compute feature vectors and virality scores for all windows."""
        scored = []
        for win in windows:
            start = win["start_time"]
            end = win["end_time"]

            # Get transcript snippet for window
            snippet = self._get_transcript_snippet(transcript_segments, start, end)

            # Compute 512-dim feature vector
            feature_vec = self._compute_feature_vector(
                start_time=start,
                end_time=end,
                transcript_segments=transcript_segments,
                scene_graph=scene_graph,
                audio_features=audio_features,
            )

            # Run virality model (or heuristic)
            score_breakdown = self._run_virality_model(feature_vec, snippet)

            scored.append(
                {
                    "start_time": start,
                    "end_time": end,
                    "virality_score": score_breakdown["overall"],
                    "score_breakdown": score_breakdown,
                    "transcript_snippet": snippet,
                    "feature_vector": feature_vec,
                }
            )
        return scored

    def _compute_feature_vector(
        self,
        start_time: float,
        end_time: float,
        transcript_segments: list[dict],
        scene_graph: dict,
        audio_features: dict,
    ) -> list[float]:
        """
        Compute 512-dimensional feature vector from multimodal signals.
        Dimensions:
         0–127:   Transcript features (TF-IDF-like power word scores, word count, etc.)
         128–255: Audio features (RMS energy, spectral centroid, tempo, etc.)
         256–383: Visual features (from scene graph: motion, vibrancy, face count, etc.)
         384–511: Temporal features (position in video, duration ratio, etc.)
        """
        duration = end_time - start_time

        # ── Transcript features (128 dims) ────────────────────────────────
        transcript_feats = self._compute_transcript_features(
            transcript_segments, start_time, end_time
        )

        # ── Audio features (128 dims) ─────────────────────────────────────
        audio_feats = self._compute_audio_features_for_window(
            audio_features, start_time, end_time
        )

        # ── Visual features (128 dims) ────────────────────────────────────
        visual_feats = self._compute_visual_features_for_window(
            scene_graph, start_time, end_time
        )

        # ── Temporal features (128 dims) ──────────────────────────────────
        video_duration = audio_features.get("total_duration", end_time + 1)
        temporal_feats = self._compute_temporal_features(
            start_time, end_time, duration, video_duration
        )

        feature_vec = transcript_feats + audio_feats + visual_feats + temporal_feats
        assert len(feature_vec) == 512, f"Expected 512 dims, got {len(feature_vec)}"
        return feature_vec

    def _compute_transcript_features(
        self,
        segments: list[dict],
        start_time: float,
        end_time: float,
    ) -> list[float]:
        """128-dim transcript feature vector."""
        feats = [0.0] * 128

        window_segments = [
            s for s in segments if s["start"] < end_time and s["end"] > start_time
        ]
        if not window_segments:
            return feats

        all_words = []
        for seg in window_segments:
            all_words.extend(seg.get("words", [{"word": w} for w in seg["text"].split()]))

        word_texts = [w.get("word", "").lower().strip(".,!?") for w in all_words]
        word_count = len(word_texts)

        if word_count == 0:
            return feats

        # f0: word count normalized
        feats[0] = min(word_count / 150.0, 1.0)

        # f1: words per second (pace)
        duration = max(end_time - start_time, 0.1)
        feats[1] = min((word_count / duration) / 5.0, 1.0)  # 5 wps = max pace

        # f2: power word density
        power_count = sum(1 for w in word_texts if w in POWER_WORDS)
        feats[2] = min(power_count / max(word_count, 1) * 10, 1.0)

        # f3: average word confidence
        confidences = [w.get("probability", 1.0) for w in all_words if "probability" in w]
        feats[3] = float(np.mean(confidences)) if confidences else 1.0

        # f4: unique word ratio (vocabulary diversity)
        feats[4] = len(set(word_texts)) / max(word_count, 1)

        # f5–f9: per-power-word presence indicators
        key_words = ["insane", "amazing", "secret", "never", "watch"]
        for i, kw in enumerate(key_words):
            feats[5 + i] = 1.0 if kw in word_texts else 0.0

        # f10–f127: pad with zeros (reserved for embeddings)
        return feats

    def _compute_audio_features_for_window(
        self,
        audio_features: dict,
        start_time: float,
        end_time: float,
    ) -> list[float]:
        """128-dim audio feature vector for a specific window."""
        feats = [0.0] * 128

        if not audio_features:
            return feats

        sr = audio_features.get("sample_rate", 22050)
        hop = audio_features.get("hop_length", 512)

        def _slice_feature(arr: list[float] | None, n: int = 32) -> list[float]:
            """Slice and aggregate a time-series feature into n dimensions."""
            if not arr:
                return [0.0] * n
            arr = np.array(arr, dtype=float)
            # Find frame indices
            start_frame = int(start_time * sr / hop)
            end_frame = int(end_time * sr / hop)
            sliced = arr[max(0, start_frame) : min(len(arr), end_frame + 1)]
            if len(sliced) == 0:
                return [0.0] * n
            # Reduce to n values via percentiles + moments
            percentiles = np.percentile(sliced, np.linspace(0, 100, n - 4)).tolist()
            moments = [
                float(np.mean(sliced)),
                float(np.std(sliced)),
                float(np.min(sliced)),
                float(np.max(sliced)),
            ]
            return [min(max(v, -10.0), 10.0) for v in percentiles + moments]

        rms = _slice_feature(audio_features.get("rms_energy"), 32)
        spectral = _slice_feature(audio_features.get("spectral_centroid"), 32)
        onset = _slice_feature(audio_features.get("onset_strength"), 32)

        # Global features (last 32 dims)
        tempo = audio_features.get("tempo", 120.0)
        global_feats = [
            min(tempo / 200.0, 1.0),
            audio_features.get("silence_ratio", 0.0),
            audio_features.get("beat_regularity", 0.5),
        ] + [0.0] * 29

        feats = rms + spectral + onset + global_feats
        return feats[:128]

    def _compute_visual_features_for_window(
        self,
        scene_graph: dict,
        start_time: float,
        end_time: float,
    ) -> list[float]:
        """128-dim visual feature vector for a specific window."""
        feats = [0.0] * 128

        scenes = scene_graph.get("scenes", [])
        if not scenes:
            return feats

        # Find scenes overlapping with window
        overlapping = [
            s for s in scenes
            if s.get("start_time", 0) < end_time and s.get("end_time", 0) > start_time
        ]
        if not overlapping:
            return feats

        def avg(key: str, default: float = 0.0) -> float:
            vals = [s["features"].get(key, default) for s in overlapping if "features" in s]
            return float(np.mean(vals)) if vals else default

        feats[0] = min(avg("face_count") / 3.0, 1.0)
        feats[1] = avg("motion_magnitude")
        feats[2] = avg("color_vibrancy")
        feats[3] = avg("attention_score")
        feats[4] = avg("average_brightness") / 255.0
        feats[5] = avg("speaker_present")
        feats[6] = 1.0 if any(s["features"].get("has_text") for s in overlapping if "features" in s) else 0.0

        return feats

    def _compute_temporal_features(
        self,
        start_time: float,
        end_time: float,
        duration: float,
        video_duration: float,
    ) -> list[float]:
        """128-dim temporal feature vector."""
        feats = [0.0] * 128
        if video_duration <= 0:
            return feats

        feats[0] = start_time / video_duration        # relative start
        feats[1] = end_time / video_duration          # relative end
        feats[2] = duration / video_duration          # relative duration
        feats[3] = min(duration / 60.0, 1.0)          # abs duration norm
        feats[4] = 1.0 if start_time < 30.0 else 0.0  # is_intro_segment
        feats[5] = 1.0 if end_time > video_duration - 30.0 else 0.0  # is_outro_segment

        return feats

    # ── Stage 3: Virality Model Inference ────────────────────────────────────

    def _run_virality_model(
        self, feature_vec: list[float], transcript_snippet: str
    ) -> dict[str, float]:
        """
        Run ViralityScorerModel or fall back to heuristic scoring.
        Returns score breakdown dict.
        """
        if self._virality_model is not None:
            return self._model_inference(feature_vec)
        return self._heuristic_score(feature_vec, transcript_snippet)

    def _model_inference(self, feature_vec: list[float]) -> dict[str, float]:
        """Run trained transformer model."""
        import torch
        from app.config import get_settings

        settings = get_settings()
        x = torch.tensor(feature_vec, dtype=torch.float32).unsqueeze(0).to(settings.DEVICE)
        with torch.no_grad():
            output = self._virality_model(x)
        overall = float(output.squeeze().cpu().item())

        return {
            "overall": round(min(max(overall, 0.0), 1.0), 4),
            "hook_score": 0.0,
            "emotion_score": 0.0,
            "audio_energy_score": 0.0,
            "transcript_quality_score": 0.0,
            "face_presence_score": 0.0,
            "motion_score": 0.0,
            "loop_score": 0.0,
            "pacing_score": 0.0,
        }

    def _heuristic_score(
        self, feature_vec: list[float], transcript_snippet: str
    ) -> dict[str, float]:
        """Heuristic virality scoring when model is not loaded."""
        fv = np.array(feature_vec)

        # Transcript quality
        transcript_score = fv[2]  # power word density
        pacing_score = fv[1]      # words per second

        # Audio energy
        audio_feats = fv[128:256]
        audio_energy = float(np.mean(np.abs(audio_feats[:32])))
        audio_energy = min(audio_energy / 5.0, 1.0)

        # Visual features
        face_score = float(fv[256])    # face count norm
        motion_score = float(fv[257])  # motion magnitude
        vibrancy = float(fv[258])
        attention = float(fv[259])

        # Hook (first 3s boost = temporal features)
        is_intro = float(fv[388])  # feats[4] for temporal

        hook_score = min(
            0.4 * face_score
            + 0.3 * motion_score
            + 0.3 * transcript_score
            + 0.2 * is_intro,
            1.0,
        )

        # Composite
        overall = (
            0.25 * hook_score
            + 0.20 * audio_energy
            + 0.15 * transcript_score
            + 0.15 * face_score
            + 0.10 * motion_score
            + 0.10 * attention
            + 0.05 * pacing_score
        )
        overall = min(max(overall, 0.0), 1.0)

        return {
            "overall": round(overall, 4),
            "hook_score": round(hook_score, 4),
            "emotion_score": round(attention, 4),
            "audio_energy_score": round(audio_energy, 4),
            "transcript_quality_score": round(transcript_score, 4),
            "face_presence_score": round(face_score, 4),
            "motion_score": round(motion_score, 4),
            "loop_score": 0.0,
            "pacing_score": round(pacing_score, 4),
        }

    # ── Stage 4: Non-Maximum Suppression ─────────────────────────────────────

    def _non_max_suppression(
        self, windows: list[dict], iou_threshold: float
    ) -> list[dict]:
        """IoU-based NMS to remove overlapping windows."""
        if not windows:
            return []

        windows.sort(key=lambda x: x["virality_score"], reverse=True)
        kept = []

        for w in windows:
            overlaps = False
            for k in kept:
                if self._iou(w["start_time"], w["end_time"], k["start_time"], k["end_time"]) > iou_threshold:
                    overlaps = True
                    break
            if not overlaps:
                kept.append(w)

        return kept

    @staticmethod
    def _iou(s1: float, e1: float, s2: float, e2: float) -> float:
        """1D IoU between two time intervals."""
        intersection = max(0.0, min(e1, e2) - max(s1, s2))
        union = max(e1, e2) - min(s1, s2)
        return intersection / union if union > 0 else 0.0

    # ── Stages 5–7: Clip Refinement ──────────────────────────────────────────

    def _refine_clip(
        self,
        window: dict,
        local_path: str,
        transcript_segments: list[dict],
        audio_features: dict,
        hook_analyzer,
        face_tracker,
        source_media_id: str,
    ) -> dict:
        """Optimize hook, exit, and compute loop score for a clip."""
        start = window["start_time"]
        end = window["end_time"]

        # Stage 5: Hook optimization (±2s search)
        optimized_start = self._optimize_hook(
            local_path, start, transcript_segments, audio_features, search_range=2.0
        )

        # Stage 6: Exit optimization
        optimized_end = self._optimize_exit(
            transcript_segments, audio_features, end, search_range=3.0
        )

        # Re-score with optimized boundaries
        adjusted_snippet = self._get_transcript_snippet(
            transcript_segments, optimized_start, optimized_end
        )

        # Stage 7: Loop score
        loop_score = self._compute_loop_score(
            local_path, optimized_start, optimized_end, audio_features
        )

        score_breakdown = window["score_breakdown"].copy()
        score_breakdown["loop_score"] = loop_score

        # Recompute overall with loop bonus
        overall = score_breakdown["overall"] * 0.9 + loop_score * 0.1
        score_breakdown["overall"] = round(min(overall, 1.0), 4)

        # Face tracking for crop coordinates
        face_track = face_tracker.track_faces_in_segment(
            local_path, optimized_start, optimized_end
        )

        clip_id = f"clip_{uuid.uuid4().hex[:12]}"

        return {
            "clip_id": clip_id,
            "source_media_id": source_media_id,
            "start_time": optimized_start,
            "end_time": optimized_end,
            "virality_score": score_breakdown["overall"],
            "score_breakdown": score_breakdown,
            "transcript_snippet": adjusted_snippet,
            "hook_text": self._extract_hook_text(adjusted_snippet),
            "suggested_caption": None,
            "dominant_emotion": None,
            "face_track": face_track,
            "feature_vector": window.get("feature_vector", []),
        }

    def _optimize_hook(
        self,
        local_path: str,
        start_time: float,
        transcript_segments: list[dict],
        audio_features: dict,
        search_range: float = 2.0,
    ) -> float:
        """Find optimal start time: look for high-energy audio or power word onset."""
        rms = audio_features.get("rms_energy", [])
        if not rms:
            return start_time

        sr = audio_features.get("sample_rate", 22050)
        hop = audio_features.get("hop_length", 512)

        search_start = max(0, start_time - search_range)
        search_end = start_time + search_range

        start_frame = int(search_start * sr / hop)
        end_frame = int(search_end * sr / hop)

        rms_arr = np.array(rms)
        window_rms = rms_arr[max(0, start_frame) : min(len(rms_arr), end_frame)]

        if len(window_rms) == 0:
            return start_time

        # Find peak energy in search window
        peak_idx = int(np.argmax(window_rms))
        peak_time = search_start + peak_idx * hop / sr

        # Also check for power word positions
        for seg in transcript_segments:
            for word in seg.get("words", []):
                w = word.get("word", "").lower().strip(".,!?")
                if w in POWER_WORDS:
                    word_start = word.get("start", seg["start"])
                    if search_start <= word_start <= search_end:
                        # Prefer starting 0.5s before power word
                        return max(word_start - 0.5, 0.0)

        # Return peak energy time, snapped to nearest 0.1s
        return round(peak_time, 1)

    def _optimize_exit(
        self,
        transcript_segments: list[dict],
        audio_features: dict,
        end_time: float,
        search_range: float = 3.0,
    ) -> float:
        """Find optimal end time: prefer sentence end, low energy moment, or laugh peak."""
        search_start = end_time - search_range
        search_end = end_time + search_range

        # Look for sentence endings in transcript
        best_end = end_time
        for seg in transcript_segments:
            seg_end = seg["end"]
            if search_start <= seg_end <= search_end:
                text = seg["text"].strip()
                if text and text[-1] in ".!?":
                    # Prefer sentence-ending segment closest to target
                    if abs(seg_end - end_time) < abs(best_end - end_time):
                        best_end = seg_end + 0.3  # brief pause after sentence

        # Check for energy dip (silence/pause)
        rms = audio_features.get("rms_energy", [])
        if rms:
            sr = audio_features.get("sample_rate", 22050)
            hop = audio_features.get("hop_length", 512)
            start_frame = int(max(0, search_start) * sr / hop)
            end_frame = int(search_end * sr / hop)
            window_rms = np.array(rms)[max(0, start_frame) : min(len(rms), end_frame)]

            if len(window_rms) > 0:
                # Find lowest energy point (natural pause)
                min_idx = int(np.argmin(window_rms))
                min_time = search_start + min_idx * hop / sr
                # Use if it's closer to target
                if abs(min_time - end_time) < abs(best_end - end_time) * 1.5:
                    best_end = min_time + 0.1

        return round(max(best_end, search_start), 2)

    def _compute_loop_score(
        self,
        local_path: str,
        start_time: float,
        end_time: float,
        audio_features: dict,
    ) -> float:
        """
        Compute loop-ability score: similarity between start and end of clip.
        High loop score = seamless loop for TikTok engagement.
        """
        rms = audio_features.get("rms_energy", [])
        if not rms:
            return 0.5

        sr = audio_features.get("sample_rate", 22050)
        hop = audio_features.get("hop_length", 512)

        # Compare energy at start and end of clip (first/last 0.5s)
        def get_energy_slice(t: float, window: float = 0.5) -> np.ndarray:
            f_start = int(t * sr / hop)
            f_end = int((t + window) * sr / hop)
            arr = np.array(rms)[max(0, f_start) : min(len(rms), f_end)]
            return arr if len(arr) > 0 else np.array([0.0])

        start_energy = get_energy_slice(start_time)
        end_energy = get_energy_slice(end_time - 0.5)

        # Loop score: higher if end energy ≈ start energy
        energy_diff = abs(float(np.mean(start_energy)) - float(np.mean(end_energy)))
        max_energy = max(float(np.max(np.abs(np.array(rms)))), 1e-6)
        similarity = 1.0 - min(energy_diff / max_energy, 1.0)

        return round(similarity, 4)

    # ── Utilities ─────────────────────────────────────────────────────────────

    @staticmethod
    def _get_transcript_snippet(
        segments: list[dict], start_time: float, end_time: float
    ) -> str:
        """Extract transcript text overlapping with a time window."""
        words = []
        for seg in segments:
            if seg["start"] < end_time and seg["end"] > start_time:
                for w in seg.get("words", [{"word": t} for t in seg["text"].split()]):
                    w_start = w.get("start", seg["start"])
                    w_end = w.get("end", seg["end"])
                    if w_start < end_time and w_end > start_time:
                        words.append(w.get("word", ""))
        return " ".join(words).strip()

    @staticmethod
    def _extract_hook_text(transcript_snippet: str, max_words: int = 8) -> str | None:
        """Extract the first compelling sentence as hook text."""
        if not transcript_snippet:
            return None
        words = transcript_snippet.split()
        if not words:
            return None
        return " ".join(words[:max_words])

    @staticmethod
    def _score_duration_fit(duration: float, platform: str | None) -> float:
        """Score how well the clip duration fits the platform's optimal range."""
        if platform and platform in PLATFORM_DURATION_TARGETS:
            min_d, max_d = PLATFORM_DURATION_TARGETS[platform]
        else:
            min_d, max_d = 15.0, 60.0

        if min_d <= duration <= max_d:
            return 1.0
        elif duration < min_d:
            return duration / min_d
        else:
            return max_d / duration

    @staticmethod
    def _score_platform_fit(transcript: str, platform: str | None) -> float:
        """Score transcript style fit for platform."""
        if not transcript:
            return 0.5
        word_count = len(transcript.split())
        if platform == "tiktok":
            # Short punchy content
            return min(word_count / 50.0, 1.0) if word_count < 100 else 0.5
        elif platform == "youtube":
            # More detailed content OK
            return min(word_count / 200.0, 1.0)
        return 0.7
