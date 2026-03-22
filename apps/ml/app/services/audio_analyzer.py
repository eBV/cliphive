"""
AudioAnalyzer – librosa-based audio feature extraction.

Extracts:
- RMS energy time-series (10Hz)
- Spectral centroid
- Tempo + beat positions
- Onset strength envelope
- Silence detection (gaps > 1.5s)
- Spectral rolloff, zero-crossing rate
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import structlog

log = structlog.get_logger(__name__)

# Sample rate for analysis (16kHz is sufficient for prosody analysis)
ANALYSIS_SR = 22050
HOP_LENGTH = 512  # ~23ms per frame at 22050Hz


class AudioAnalyzer:
    """librosa-based audio feature extraction service."""

    _instance: "AudioAnalyzer | None" = None

    def __new__(cls) -> "AudioAnalyzer":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._initialized = True

    # ── Public API ────────────────────────────────────────────────────────────

    def analyze(self, media_path: str) -> dict[str, Any]:
        """
        Extract full audio feature set from a media file.

        Returns dict with:
        - sample_rate, hop_length, total_duration
        - rms_energy, spectral_centroid, onset_strength (all time-series)
        - tempo, beat_frames, beat_times
        - silence_segments, silence_ratio
        - beat_regularity
        """
        import librosa

        log.info("audio_analyzer.analyzing", path=media_path)

        # Load audio, extracting audio track from video if needed
        try:
            y, sr = librosa.load(media_path, sr=ANALYSIS_SR, mono=True)
        except Exception as e:
            log.warning("audio_analyzer.load_failed_trying_ffmpeg", error=str(e))
            y, sr = self._load_via_ffmpeg(media_path)

        total_duration = len(y) / sr

        # ── RMS Energy ───────────────────────────────────────────────────────
        rms = librosa.feature.rms(y=y, hop_length=HOP_LENGTH)[0]
        rms_db = librosa.amplitude_to_db(rms, ref=np.max if np.max(rms) > 0 else 1.0)

        # ── Spectral Features ────────────────────────────────────────────────
        spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=HOP_LENGTH)[0]
        spectral_rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, hop_length=HOP_LENGTH)[0]
        zcr = librosa.feature.zero_crossing_rate(y, hop_length=HOP_LENGTH)[0]

        # ── Onset Strength ───────────────────────────────────────────────────
        onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)

        # ── Tempo + Beats ────────────────────────────────────────────────────
        tempo, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset_env, sr=sr, hop_length=HOP_LENGTH
        )
        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP_LENGTH)

        # ── Beat Regularity ──────────────────────────────────────────────────
        beat_regularity = self._compute_beat_regularity(beat_times)

        # ── Silence Detection ────────────────────────────────────────────────
        silence_segments = self._detect_silence(rms, sr, HOP_LENGTH, threshold_db=-40.0, min_gap=1.5)
        silence_ratio = sum(s["duration"] for s in silence_segments) / max(total_duration, 1.0)

        return {
            "sample_rate": sr,
            "hop_length": HOP_LENGTH,
            "total_duration": round(total_duration, 3),
            "rms_energy": rms.tolist(),
            "rms_db": rms_db.tolist(),
            "spectral_centroid": spectral_centroid.tolist(),
            "spectral_rolloff": spectral_rolloff.tolist(),
            "zero_crossing_rate": zcr.tolist(),
            "onset_strength": onset_env.tolist(),
            "tempo": round(float(tempo), 2),
            "beat_frames": beat_frames.tolist(),
            "beat_times": beat_times.tolist(),
            "beat_regularity": round(beat_regularity, 4),
            "silence_segments": silence_segments,
            "silence_ratio": round(float(silence_ratio), 4),
        }

    # ── Internal Helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _load_via_ffmpeg(media_path: str) -> tuple[np.ndarray, int]:
        """Extract audio from video using ffmpeg via subprocess."""
        import subprocess
        import soundfile as sf

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-i", media_path,
                    "-ar", str(ANALYSIS_SR),
                    "-ac", "1",
                    "-vn",
                    tmp_path,
                ],
                capture_output=True,
                check=True,
            )
            y, sr = sf.read(tmp_path, dtype="float32")
            return y, sr
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    @staticmethod
    def _detect_silence(
        rms: np.ndarray,
        sr: int,
        hop_length: int,
        threshold_db: float = -40.0,
        min_gap: float = 1.5,
    ) -> list[dict[str, float]]:
        """Detect silence segments (energy below threshold for >= min_gap seconds)."""
        import librosa

        rms_db = librosa.amplitude_to_db(rms, ref=1.0)
        is_silent = rms_db < threshold_db
        min_frames = int(min_gap * sr / hop_length)

        segments = []
        in_silence = False
        silence_start = 0

        for i, silent in enumerate(is_silent):
            if silent and not in_silence:
                in_silence = True
                silence_start = i
            elif not silent and in_silence:
                in_silence = False
                gap_frames = i - silence_start
                if gap_frames >= min_frames:
                    start_s = librosa.frames_to_time(silence_start, sr=sr, hop_length=hop_length)
                    end_s = librosa.frames_to_time(i, sr=sr, hop_length=hop_length)
                    segments.append(
                        {
                            "start": round(float(start_s), 3),
                            "end": round(float(end_s), 3),
                            "duration": round(float(end_s - start_s), 3),
                        }
                    )

        return segments

    @staticmethod
    def _compute_beat_regularity(beat_times: np.ndarray) -> float:
        """
        Compute how regular the beat intervals are (0=irregular, 1=perfectly regular).
        """
        if len(beat_times) < 3:
            return 0.5
        intervals = np.diff(beat_times)
        mean_interval = np.mean(intervals)
        if mean_interval < 1e-6:
            return 0.0
        cv = np.std(intervals) / mean_interval  # coefficient of variation
        return float(np.exp(-cv))  # 1 when perfectly regular, 0 when chaotic
