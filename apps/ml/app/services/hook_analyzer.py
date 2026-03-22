"""
HookAnalyzer – Analyzes first-3-second quality of a clip.

Scores:
- Face close-up presence in first frame
- Motion in first 0.5s (vs static opening)
- Strong opening word (power words list)
- Audio energy in first 3s
- Text-on-screen in first frame

Returns hook_score 0–1 composite.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import structlog

log = structlog.get_logger(__name__)

# Power words that signal strong hooks
HOOK_POWER_WORDS = frozenset(
    [
        # Question starters
        "what", "why", "how", "who", "when", "where",
        # Shock/urgency words
        "stop", "wait", "listen", "look", "watch",
        "never", "always", "every", "all", "none",
        # Superlatives
        "best", "worst", "most", "least", "first", "last", "only",
        # Emotional triggers
        "insane", "crazy", "unbelievable", "shocking", "incredible",
        "honest", "truth", "real", "secret", "exposed",
        # Social proof
        "everyone", "nobody", "viral", "trending",
    ]
)

HOOK_DURATION = 3.0  # seconds to analyze for hook quality


class HookAnalyzer:
    """Analyze the hooking power of a clip's opening seconds."""

    _instance: "HookAnalyzer | None" = None

    def __new__(cls) -> "HookAnalyzer":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._initialized = True

    # ── Public API ────────────────────────────────────────────────────────────

    def analyze_hook(
        self,
        video_path: str,
        start_time: float,
        transcript_segments: list[dict],
        audio_features: dict,
    ) -> dict[str, Any]:
        """
        Analyze the hook quality of the first 3 seconds of a clip.

        Returns:
            {
                hook_score: float [0-1],
                face_close_up: bool,
                has_motion: bool,
                strong_opening_word: str | None,
                audio_energy_score: float,
                component_scores: dict
            }
        """
        hook_end = start_time + HOOK_DURATION

        # ── Component 1: Face close-up in first frame ─────────────────────
        face_score, face_close_up = self._score_face_closeup(video_path, start_time)

        # ── Component 2: Motion in first 0.5s ─────────────────────────────
        motion_score, has_motion = self._score_opening_motion(video_path, start_time)

        # ── Component 3: Strong opening word ──────────────────────────────
        opening_word, word_score = self._score_opening_word(
            transcript_segments, start_time, hook_end
        )

        # ── Component 4: Audio energy in first 3s ─────────────────────────
        audio_energy_score = self._score_audio_energy(
            audio_features, start_time, hook_end
        )

        # ── Composite Hook Score ──────────────────────────────────────────
        hook_score = (
            0.30 * face_score
            + 0.20 * motion_score
            + 0.25 * word_score
            + 0.25 * audio_energy_score
        )
        hook_score = round(min(max(hook_score, 0.0), 1.0), 4)

        return {
            "hook_score": hook_score,
            "face_close_up": face_close_up,
            "has_motion": has_motion,
            "strong_opening_word": opening_word,
            "audio_energy_score": round(audio_energy_score, 4),
            "component_scores": {
                "face": round(face_score, 4),
                "motion": round(motion_score, 4),
                "word": round(word_score, 4),
                "audio": round(audio_energy_score, 4),
            },
        }

    # ── Internal Methods ──────────────────────────────────────────────────────

    @staticmethod
    def _score_face_closeup(
        video_path: str,
        start_time: float,
    ) -> tuple[float, bool]:
        """
        Score face close-up quality at the opening frame.
        Returns (score, is_close_up).
        """
        try:
            import cv2
            import mediapipe as mp

            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(start_time * fps))
            ret, frame = cap.read()
            cap.release()

            if not ret:
                return 0.0, False

            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            fd = mp.solutions.face_detection.FaceDetection(
                model_selection=1, min_detection_confidence=0.5
            )
            results = fd.process(rgb)
            fd.close()

            if not results.detections:
                return 0.0, False

            # Score based on face size relative to frame
            best = max(results.detections, key=lambda d: d.score[0] if d.score else 0.0)
            bbox = best.location_data.relative_bounding_box
            face_area = bbox.width * bbox.height

            # Face area > 10% of frame = close-up
            is_close_up = face_area > 0.10
            score = min(face_area / 0.25, 1.0)  # Full score at 25% face area
            return round(float(score), 4), is_close_up

        except Exception:
            return 0.0, False

    @staticmethod
    def _score_opening_motion(
        video_path: str,
        start_time: float,
        window: float = 0.5,
    ) -> tuple[float, bool]:
        """
        Score motion intensity in the first 0.5 seconds.
        Returns (score, has_motion).
        """
        try:
            import cv2

            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            n_frames = max(3, int(window * fps))
            start_frame = int(start_time * fps)

            gray_frames = []
            for i in range(n_frames):
                cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame + i)
                ret, frame = cap.read()
                if ret:
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    gray_frames.append(gray)
            cap.release()

            if len(gray_frames) < 2:
                return 0.0, False

            motion_vals = []
            for i in range(1, len(gray_frames)):
                flow = cv2.calcOpticalFlowFarneback(
                    gray_frames[i - 1], gray_frames[i], None,
                    0.5, 3, 15, 3, 5, 1.2, 0
                )
                mag = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
                motion_vals.append(float(np.mean(mag)))

            avg_motion = float(np.mean(motion_vals))
            # Threshold: 2px/frame = noticeable motion
            has_motion = avg_motion > 1.0
            score = min(avg_motion / 10.0, 1.0)
            return round(score, 4), has_motion

        except Exception:
            return 0.0, False

    @staticmethod
    def _score_opening_word(
        transcript_segments: list[dict],
        start_time: float,
        end_time: float,
    ) -> tuple[str | None, float]:
        """
        Find and score the first spoken word.
        Returns (first_word, score).
        """
        for seg in sorted(transcript_segments, key=lambda s: s["start"]):
            if seg["start"] > end_time:
                break
            if seg["end"] < start_time:
                continue

            words = seg.get("words", [])
            if not words:
                # Fall back to first word of text
                text_words = seg["text"].strip().lower().split()
                if text_words:
                    first_word = text_words[0].strip(".,!?")
                    score = 0.8 if first_word in HOOK_POWER_WORDS else 0.2
                    return first_word, score
                continue

            for w in words:
                w_start = w.get("start", seg["start"])
                if w_start >= start_time:
                    word = w.get("word", "").lower().strip(".,!? ")
                    if word:
                        score = 0.9 if word in HOOK_POWER_WORDS else 0.2
                        return word, score

        return None, 0.0

    @staticmethod
    def _score_audio_energy(
        audio_features: dict,
        start_time: float,
        end_time: float,
    ) -> float:
        """Score audio energy level in the first N seconds."""
        rms = audio_features.get("rms_energy", [])
        if not rms:
            return 0.5

        sr = audio_features.get("sample_rate", 22050)
        hop = audio_features.get("hop_length", 512)

        start_frame = int(start_time * sr / hop)
        end_frame = int(end_time * sr / hop)
        window_rms = np.array(rms)[max(0, start_frame) : min(len(rms), end_frame)]

        if len(window_rms) == 0:
            return 0.5

        # Score relative to overall video energy
        overall_mean = float(np.mean(np.array(rms)))
        window_mean = float(np.mean(window_rms))

        if overall_mean < 1e-8:
            return 0.5

        ratio = window_mean / overall_mean
        return round(min(ratio, 1.0), 4)
