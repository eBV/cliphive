"""
VideoIO – Video download, frame extraction, and metadata utilities.

Provides both a class-based interface (VideoIO.*) and legacy module-level
functions for backward compatibility.

Handles:
- S3 download with tenacity retry logic
- Direct URL download
- Frame extraction via OpenCV
- Audio track extraction via ffmpeg
- Video metadata (duration, fps, resolution, codec)
"""
from __future__ import annotations

import contextlib
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Generator

import numpy as np
import structlog
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

log = structlog.get_logger(__name__)


# ─── Class-based API (used by services) ──────────────────────────────────────


class VideoIO:
    """Static utility class for video I/O operations."""

    # ── S3 Operations ─────────────────────────────────────────────────────────

    @staticmethod
    @retry(
        retry=retry_if_exception_type(Exception),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    def download_from_s3(s3_key: str, dest_dir: str) -> str:
        """
        Download a file from S3 to a local directory.

        Args:
            s3_key: The S3 object key
            dest_dir: Local directory to save the file

        Returns:
            Local file path
        """
        import boto3
        from app.config import get_settings

        settings = get_settings()
        s3_client = boto3.client("s3", **settings.s3_kwargs)

        filename = Path(s3_key).name or "media.mp4"
        local_path = os.path.join(dest_dir, filename)

        log.info("video_io.s3_download_start", s3_key=s3_key, dest=local_path)

        s3_client.download_file(
            Bucket=settings.S3_BUCKET_MEDIA,
            Key=s3_key,
            Filename=local_path,
        )

        file_size_mb = os.path.getsize(local_path) / (1024 * 1024)
        log.info(
            "video_io.s3_download_complete",
            s3_key=s3_key,
            size_mb=round(file_size_mb, 2),
        )

        return local_path

    @staticmethod
    @retry(
        retry=retry_if_exception_type(Exception),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=20),
    )
    def download_from_url(url: str, dest_dir: str) -> str:
        """
        Download a media file from a direct HTTPS URL.

        Returns:
            Local file path
        """
        import httpx

        url_path = url.split("?")[0].rstrip("/")
        filename = url_path.split("/")[-1] or "media.mp4"
        if "." not in filename:
            filename += ".mp4"
        local_path = os.path.join(dest_dir, filename)

        log.info("video_io.url_download_start", url=url)

        with httpx.stream("GET", url, follow_redirects=True, timeout=120.0) as r:
            r.raise_for_status()
            with open(local_path, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=8192):
                    f.write(chunk)

        file_size_mb = os.path.getsize(local_path) / (1024 * 1024)
        log.info("video_io.url_download_complete", size_mb=round(file_size_mb, 2))
        return local_path

    # ── Metadata ──────────────────────────────────────────────────────────────

    @staticmethod
    def get_metadata(video_path: str) -> dict[str, Any]:
        """Get comprehensive video metadata via ffprobe + OpenCV."""
        import cv2

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        codec_int = int(cap.get(cv2.CAP_PROP_FOURCC))
        codec = "".join([chr((codec_int >> 8 * i) & 0xFF) for i in range(4)])
        cap.release()

        duration = total_frames / fps if fps > 0 else 0.0
        file_size_mb = os.path.getsize(video_path) / (1024 * 1024)
        has_audio = VideoIO._check_has_audio(video_path)

        return {
            "duration": round(duration, 3),
            "fps": round(fps, 2),
            "width": width,
            "height": height,
            "total_frames": total_frames,
            "codec": codec.strip(),
            "has_audio": has_audio,
            "file_size_mb": round(file_size_mb, 2),
            "aspect_ratio": round(width / max(height, 1), 4),
        }

    @staticmethod
    def get_duration(video_path: str) -> float:
        """Get video duration in seconds."""
        import cv2

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        return round(total_frames / fps, 3)

    # ── Frame Extraction ──────────────────────────────────────────────────────

    @staticmethod
    def extract_frames(
        video_path: str,
        timestamps: list[float],
        resize: tuple[int, int] | None = None,
    ) -> list[Any]:
        """Extract frames at specified timestamps. Returns list of BGR numpy arrays."""
        import cv2

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frames = []

        for t in timestamps:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
            ret, frame = cap.read()
            if ret:
                if resize:
                    frame = cv2.resize(frame, resize, interpolation=cv2.INTER_LANCZOS4)
                frames.append(frame)

        cap.release()
        return frames

    @staticmethod
    def extract_frames_uniform(
        video_path: str,
        n_frames: int,
        start_time: float = 0.0,
        end_time: float | None = None,
        resize: tuple[int, int] | None = None,
    ) -> list[tuple[float, Any]]:
        """
        Extract n_frames uniformly sampled between start_time and end_time.
        Returns list of (timestamp, frame) tuples.
        """
        import cv2

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps

        end_time = end_time or duration
        timestamps = np.linspace(start_time, end_time, n_frames)

        result = []
        for t in timestamps:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
            ret, frame = cap.read()
            if ret:
                if resize:
                    frame = cv2.resize(frame, resize, interpolation=cv2.INTER_LANCZOS4)
                result.append((round(float(t), 3), frame))

        cap.release()
        return result

    # ── Audio Extraction ──────────────────────────────────────────────────────

    @staticmethod
    def extract_audio(
        video_path: str,
        output_path: str,
        sample_rate: int = 22050,
        mono: bool = True,
    ) -> str:
        """Extract audio track from video file using ffmpeg. Returns output_path."""
        channels = "1" if mono else "2"
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",
            "-ar", str(sample_rate),
            "-ac", channels,
            "-f", "wav",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg audio extraction failed: {result.stderr.decode()[-500:]}"
            )
        return output_path

    @staticmethod
    def _check_has_audio(video_path: str) -> bool:
        """Check if video file has an audio stream via ffprobe."""
        try:
            result = subprocess.run(
                [
                    "ffprobe", "-v", "quiet",
                    "-select_streams", "a:0",
                    "-show_entries", "stream=codec_type",
                    "-of", "csv=p=0",
                    video_path,
                ],
                capture_output=True,
                timeout=10,
            )
            return b"audio" in result.stdout
        except Exception:
            return True

    # ── Upload ────────────────────────────────────────────────────────────────

    @staticmethod
    @retry(
        retry=retry_if_exception_type(Exception),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    def upload_to_s3(
        local_path: str,
        s3_key: str,
        bucket: str | None = None,
        content_type: str = "video/mp4",
    ) -> str:
        """Upload a local file to S3. Returns presigned URL."""
        import boto3
        from app.config import get_settings

        settings = get_settings()
        bucket = bucket or settings.S3_BUCKET_CLIPS
        s3_client = boto3.client("s3", **settings.s3_kwargs)

        s3_client.upload_file(
            Filename=local_path,
            Bucket=bucket,
            Key=s3_key,
            ExtraArgs={"ContentType": content_type},
        )

        url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": s3_key},
            ExpiresIn=settings.S3_PRESIGN_EXPIRY,
        )

        log.info("video_io.upload_complete", s3_key=s3_key, bucket=bucket)
        return url

    # ── Context Manager ───────────────────────────────────────────────────────

    @staticmethod
    @contextlib.contextmanager
    def temp_download(s3_key: str):
        """Context manager: downloads video to temp file, yields path, cleans up."""
        suffix = Path(s3_key).suffix or ".mp4"
        with tempfile.TemporaryDirectory(prefix="video_io_") as tmp_dir:
            local_path = VideoIO.download_from_s3(s3_key, tmp_dir)
            yield local_path


# ─── Legacy module-level functions (backward compatibility) ──────────────────


def download_from_s3(s3_key: str, local_path: str) -> str:
    """Legacy: download from S3 to a specific file path."""
    import boto3
    from app.config import get_settings

    settings = get_settings()
    s3_client = boto3.client("s3", **settings.s3_kwargs)
    log.info("downloading_from_s3", s3_key=s3_key, local_path=local_path)
    s3_client.download_file(settings.S3_BUCKET_MEDIA, s3_key, local_path)
    return local_path


def upload_to_s3(local_path: str, s3_key: str, bucket: str | None = None) -> str:
    """Legacy: upload local file to S3. Returns the S3 key."""
    from app.config import get_settings
    import boto3

    settings = get_settings()
    target_bucket = bucket or settings.S3_BUCKET_CLIPS
    s3_client = boto3.client("s3", **settings.s3_kwargs)
    s3_client.upload_file(local_path, target_bucket, s3_key)
    return s3_key


def extract_frames(
    video_path: str,
    fps: float = 1.0,
    max_frames: int = 300,
) -> Generator[tuple[float, np.ndarray], None, None]:
    """Legacy: extract frames as generator of (timestamp, frame) tuples."""
    import cv2

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_interval = max(1, int(video_fps / fps))
    frame_idx = 0
    yielded = 0

    try:
        while yielded < max_frames:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx % frame_interval == 0:
                timestamp = frame_idx / video_fps
                yield timestamp, frame
                yielded += 1
            frame_idx += 1
    finally:
        cap.release()


def extract_frame_at(video_path: str, timestamp: float) -> np.ndarray:
    """Legacy: extract a single frame at a specific timestamp."""
    import cv2

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(timestamp * fps))
    ret, frame = cap.read()
    cap.release()
    if not ret:
        raise RuntimeError(f"Could not extract frame at {timestamp}s from {video_path}")
    return frame


def extract_audio(video_path: str, output_path: str, sample_rate: int = 16000) -> str:
    """Legacy: extract audio track from video as WAV."""
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vn",
        "-c:a", "pcm_s16le",
        "-ar", str(sample_rate),
        "-ac", "1",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg audio extraction failed: {result.stderr[-500:]}")
    return output_path


def get_video_metadata(video_path: str) -> dict:
    """Legacy: get video metadata using ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")

    data = json.loads(result.stdout)
    video_stream = next(
        (s for s in data.get("streams", []) if s["codec_type"] == "video"), None
    )
    audio_stream = next(
        (s for s in data.get("streams", []) if s["codec_type"] == "audio"), None
    )

    fps_str = video_stream.get("r_frame_rate", "30/1") if video_stream else "30/1"
    fps_num, fps_den = fps_str.split("/")
    fps = int(fps_num) / int(fps_den) if fps_den and int(fps_den) > 0 else 30.0

    return {
        "duration": float(data.get("format", {}).get("duration", 0)),
        "width": video_stream.get("width") if video_stream else 0,
        "height": video_stream.get("height") if video_stream else 0,
        "fps": fps,
        "codec": video_stream.get("codec_name") if video_stream else "unknown",
        "file_size_bytes": int(data.get("format", {}).get("size", 0)),
        "has_audio": audio_stream is not None,
    }


@contextlib.contextmanager
def with_temp_video(s3_key: str):
    """Legacy context manager: downloads video, yields path, cleans up."""
    suffix = Path(s3_key).suffix or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        tmp_path = f.name
    try:
        download_from_s3(s3_key, tmp_path)
        yield tmp_path
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
