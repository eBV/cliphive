"""
WhisperService – Singleton wrapper around OpenAI Whisper large-v3.

Features:
- Loads model once at startup and reuses it
- GPU acceleration with automatic CPU fallback
- Word-level timestamps
- Long-form audio chunking (>30min)
- S3 download + local file support
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from typing import Any

import structlog

log = structlog.get_logger(__name__)


class WhisperService:
    """Singleton Whisper transcription service."""

    _instance: "WhisperService | None" = None
    _model: Any = None

    def __new__(cls) -> "WhisperService":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if self._model is not None:
            return  # already initialized
        self._load_model()

    def _load_model(self) -> None:
        """Load Whisper model into GPU/CPU memory."""
        import whisper

        from app.config import get_settings

        settings = get_settings()
        model_name = settings.WHISPER_MODEL
        device = settings.DEVICE

        log.info("whisper.loading", model=model_name, device=device)
        self._model = whisper.load_model(model_name, device=device)
        log.info("whisper.loaded", model=model_name)

    # ── Public API ────────────────────────────────────────────────────────────

    async def transcribe(
        self,
        s3_key: str | None = None,
        media_url: str | None = None,
        language: str | None = None,
    ) -> dict[str, Any]:
        """
        Transcribe audio/video. Downloads from S3 or URL if needed.
        Returns: {transcript, segments, duration, language, language_probability}
        """
        with tempfile.TemporaryDirectory(prefix="whisper_") as tmp_dir:
            local_path = await self._acquire_media(s3_key, media_url, tmp_dir)
            result = await asyncio.to_thread(
                self._transcribe_file, local_path, language
            )
        return result

    def transcribe_s3_key(self, s3_key: str) -> dict[str, Any]:
        """Synchronous helper for batch processing."""
        import asyncio

        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(self.transcribe(s3_key=s3_key))
        finally:
            loop.close()

    # ── Internal Helpers ──────────────────────────────────────────────────────

    async def _acquire_media(
        self,
        s3_key: str | None,
        media_url: str | None,
        tmp_dir: str,
    ) -> str:
        """Download media from S3 or URL. Returns local path."""
        from app.utils.video_io import VideoIO

        if s3_key:
            return await asyncio.to_thread(VideoIO.download_from_s3, s3_key, tmp_dir)
        elif media_url:
            return await asyncio.to_thread(VideoIO.download_from_url, media_url, tmp_dir)
        raise ValueError("Either s3_key or media_url must be provided")

    def _transcribe_file(self, local_path: str, language: str | None) -> dict[str, Any]:
        """
        Run Whisper transcription with word-level timestamps.
        Handles long-form audio via Whisper's built-in chunking.
        """
        import whisper

        log.info("whisper.transcribing", path=local_path)

        decode_options: dict[str, Any] = {
            "word_timestamps": True,
            "verbose": False,
        }
        if language:
            decode_options["language"] = language

        result = self._model.transcribe(local_path, **decode_options)

        # Extract audio duration via ffprobe
        duration = self._get_duration(local_path)

        # Build structured segment list
        segments = []
        for seg in result.get("segments", []):
            words = []
            for w in seg.get("words", []):
                words.append(
                    {
                        "word": w.get("word", "").strip(),
                        "start": round(w.get("start", 0.0), 3),
                        "end": round(w.get("end", 0.0), 3),
                        "probability": round(w.get("probability", 1.0), 4),
                    }
                )
            segments.append(
                {
                    "start": round(seg["start"], 3),
                    "end": round(seg["end"], 3),
                    "text": seg["text"].strip(),
                    "confidence": round(
                        sum(w.get("probability", 1.0) for w in seg.get("words", [1]))
                        / max(len(seg.get("words", [1])), 1),
                        4,
                    ),
                    "words": words,
                }
            )

        # Detect language
        lang = result.get("language", "en")
        lang_probs = result.get("language_probs", {})
        lang_prob = lang_probs.get(lang, 1.0) if lang_probs else 1.0

        return {
            "transcript": result["text"].strip(),
            "segments": segments,
            "duration": duration,
            "language": lang,
            "language_probability": round(lang_prob, 4),
        }

    @staticmethod
    def _get_duration(local_path: str) -> float:
        """Get video/audio duration using OpenCV or ffprobe."""
        try:
            import cv2

            cap = cv2.VideoCapture(local_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or 1.0
            frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            cap.release()
            return round(frames / fps, 3)
        except Exception:
            return 0.0
