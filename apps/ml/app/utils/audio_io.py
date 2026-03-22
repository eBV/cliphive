"""
AudioIO – Audio loading, resampling, normalization, and format conversion.

Handles:
- Loading audio/video files with librosa (with ffmpeg fallback for video)
- Resampling to target sample rate
- Peak normalization and RMS normalization
- Format conversion (mp3, m4a, aac → wav)
- RMS energy and spectral feature computation
- Silence detection
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import structlog

log = structlog.get_logger(__name__)

DEFAULT_SR = 22050
DEFAULT_HOP_LENGTH = 512


# ─── Class-based API ─────────────────────────────────────────────────────────


class AudioIO:
    """Static utility class for audio I/O operations."""

    @staticmethod
    def load(
        path: str,
        sample_rate: int = DEFAULT_SR,
        mono: bool = True,
        duration: float | None = None,
        offset: float = 0.0,
    ) -> tuple[np.ndarray, int]:
        """
        Load audio from file (audio or video) using librosa.
        Falls back to ffmpeg extraction for video files.

        Returns:
            (audio_array, sample_rate)
        """
        import librosa

        ext = Path(path).suffix.lower()
        video_exts = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".ts"}

        if ext in video_exts:
            return AudioIO.extract_from_video(path, sample_rate, mono)

        try:
            y, sr = librosa.load(
                path,
                sr=sample_rate,
                mono=mono,
                duration=duration,
                offset=offset,
            )
            return y, sr
        except Exception as e:
            log.warning("audio_io.librosa_failed_trying_ffmpeg", error=str(e))
            return AudioIO.extract_from_video(path, sample_rate, mono)

    @staticmethod
    def extract_from_video(
        video_path: str,
        sample_rate: int = DEFAULT_SR,
        mono: bool = True,
    ) -> tuple[np.ndarray, int]:
        """Extract audio track from video using ffmpeg."""
        import soundfile as sf

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            channels = "1" if mono else "2"
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-vn",
                "-ar", str(sample_rate),
                "-ac", channels,
                "-f", "wav",
                tmp_path,
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=300)
            if result.returncode != 0:
                raise RuntimeError(
                    f"ffmpeg failed: {result.stderr.decode()[-300:]}"
                )
            y, sr = sf.read(tmp_path, dtype="float32")
            if mono and y.ndim > 1:
                y = y.mean(axis=1)
            return y, sr
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    @staticmethod
    def resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio from orig_sr to target_sr."""
        import librosa

        if orig_sr == target_sr:
            return audio
        return librosa.resample(audio, orig_sr=orig_sr, target_sr=target_sr)

    @staticmethod
    def normalize_peak(audio: np.ndarray) -> np.ndarray:
        """Peak-normalize audio to [-1, 1]."""
        peak = np.abs(audio).max()
        if peak < 1e-8:
            return audio
        return audio / peak

    @staticmethod
    def normalize_rms(audio: np.ndarray, target_rms: float = 0.1) -> np.ndarray:
        """RMS-normalize audio to target RMS level."""
        rms = np.sqrt(np.mean(audio ** 2))
        if rms < 1e-8:
            return audio
        return audio * (target_rms / rms)

    @staticmethod
    def save(audio: np.ndarray, path: str, sample_rate: int = DEFAULT_SR) -> None:
        """Save audio array to WAV file."""
        import soundfile as sf

        sf.write(path, audio, sample_rate)

    @staticmethod
    def convert_format(input_path: str, output_path: str, sample_rate: int = DEFAULT_SR) -> str:
        """
        Convert audio file to WAV using ffmpeg.
        Supports: mp3, m4a, aac, ogg, flac → wav.

        Returns output_path.
        """
        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-ar", str(sample_rate),
            "-ac", "1",
            "-f", "wav",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=60)
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg conversion failed: {result.stderr.decode()[-300:]}"
            )
        return output_path

    @staticmethod
    def compute_rms_energy(
        audio: np.ndarray,
        frame_length: int = 2048,
        hop_length: int = DEFAULT_HOP_LENGTH,
    ) -> np.ndarray:
        """Compute RMS energy per frame. Returns array of shape (n_frames,)."""
        import librosa

        rms = librosa.feature.rms(y=audio, frame_length=frame_length, hop_length=hop_length)
        return rms[0]

    @staticmethod
    def compute_spectral_centroid(
        audio: np.ndarray,
        sr: int,
        hop_length: int = DEFAULT_HOP_LENGTH,
    ) -> np.ndarray:
        """Compute spectral centroid per frame."""
        import librosa

        return librosa.feature.spectral_centroid(y=audio, sr=sr, hop_length=hop_length)[0]

    @staticmethod
    def detect_silence(
        audio: np.ndarray,
        sr: int,
        threshold_db: float = -40.0,
        min_silence_duration: float = 1.5,
    ) -> list[dict[str, float]]:
        """
        Detect silence gaps longer than min_silence_duration seconds.

        Returns:
            List of {start, end, duration} dicts
        """
        import librosa

        intervals = librosa.effects.split(audio, top_db=-threshold_db)
        gaps: list[dict[str, float]] = []

        prev_end = 0
        for start, end in intervals:
            gap_start = prev_end / sr
            gap_end = start / sr
            gap_duration = gap_end - gap_start
            if gap_duration >= min_silence_duration:
                gaps.append({
                    "start": round(gap_start, 3),
                    "end": round(gap_end, 3),
                    "duration": round(gap_duration, 3),
                })
            prev_end = end

        return gaps

    @staticmethod
    def trim_silence(
        audio: np.ndarray,
        top_db: float = 40.0,
    ) -> tuple[np.ndarray, tuple[int, int]]:
        """
        Trim leading and trailing silence from audio.

        Returns:
            (trimmed_audio, (trim_start_samples, trim_end_samples))
        """
        import librosa

        trimmed, index = librosa.effects.trim(audio, top_db=top_db)
        return trimmed, tuple(index)

    @staticmethod
    def get_duration(audio: np.ndarray, sr: int) -> float:
        """Get audio duration in seconds."""
        return len(audio) / sr


# ─── Legacy module-level functions (backward compatibility) ──────────────────


def load_audio(
    path: str,
    sample_rate: int = DEFAULT_SR,
    mono: bool = True,
    duration: float | None = None,
    offset: float = 0.0,
) -> tuple[np.ndarray, int]:
    """Legacy: load audio file using librosa."""
    return AudioIO.load(path, sample_rate, mono, duration, offset)


def resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """Legacy: resample audio."""
    return AudioIO.resample(audio, orig_sr, target_sr)


def normalize(audio: np.ndarray) -> np.ndarray:
    """Legacy: peak-normalize audio to [-1, 1]."""
    return AudioIO.normalize_peak(audio)


def save_audio(audio: np.ndarray, path: str, sample_rate: int = DEFAULT_SR) -> None:
    """Legacy: save audio to WAV."""
    AudioIO.save(audio, path, sample_rate)


def compute_rms_energy(
    audio: np.ndarray,
    frame_length: int = 2048,
    hop_length: int = DEFAULT_HOP_LENGTH,
) -> np.ndarray:
    """Legacy: compute RMS energy per frame."""
    return AudioIO.compute_rms_energy(audio, frame_length, hop_length)


def compute_spectral_centroid(
    audio: np.ndarray,
    sr: int,
    hop_length: int = DEFAULT_HOP_LENGTH,
) -> np.ndarray:
    """Legacy: compute spectral centroid per frame."""
    return AudioIO.compute_spectral_centroid(audio, sr, hop_length)


def detect_silence(
    audio: np.ndarray,
    sr: int,
    threshold_db: float = -40.0,
    min_silence_duration: float = 1.5,
) -> list[tuple[float, float]]:
    """Legacy: detect silence gaps. Returns list of (start, end) tuples."""
    gaps = AudioIO.detect_silence(audio, sr, threshold_db, min_silence_duration)
    return [(g["start"], g["end"]) for g in gaps]
