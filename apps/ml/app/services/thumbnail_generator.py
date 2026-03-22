"""
ThumbnailGenerator – Optimal frame extraction + optional SDXL enhancement.

Pipeline:
1. Download video from S3
2. Find highest-energy frame in clip window (or use specified timestamp)
3. Optionally run SDXL img2img for style enhancement
4. Resize to target dimensions
5. Upload to S3 thumbnails bucket
6. Return presigned URL
"""
from __future__ import annotations

import asyncio
import io
import tempfile
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import structlog

log = structlog.get_logger(__name__)


class ThumbnailGenerator:
    """Frame extraction and thumbnail generation service."""

    _instance: "ThumbnailGenerator | None" = None
    _sdxl_pipeline = None

    def __new__(cls) -> "ThumbnailGenerator":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._initialized = True
        self._load_sdxl()

    def _load_sdxl(self) -> None:
        """Load SDXL img2img pipeline if enabled."""
        from app.config import get_settings

        settings = get_settings()
        if not settings.SDXL_ENABLED:
            log.info("thumbnail_generator.sdxl_disabled")
            return

        try:
            import torch
            from diffusers import StableDiffusionXLImg2ImgPipeline

            self._sdxl_pipeline = StableDiffusionXLImg2ImgPipeline.from_pretrained(
                settings.SDXL_MODEL_ID,
                torch_dtype=torch.float16 if settings.DEVICE == "cuda" else torch.float32,
                variant="fp16" if settings.DEVICE == "cuda" else None,
                use_safetensors=True,
            )
            self._sdxl_pipeline.to(settings.DEVICE)
            self._sdxl_pipeline.enable_attention_slicing()
            log.info("thumbnail_generator.sdxl_loaded", model=settings.SDXL_MODEL_ID)
        except Exception as e:
            log.warning("thumbnail_generator.sdxl_unavailable", error=str(e))

    # ── Public API ────────────────────────────────────────────────────────────

    async def generate(
        self,
        clip_id: str,
        s3_key: str,
        timestamp: float | None = None,
        style: str = "natural",
        width: int = 1280,
        height: int = 720,
    ) -> dict[str, Any]:
        """
        Generate a thumbnail for a clip.

        Returns:
            {thumbnail_url, s3_key, timestamp_used, width, height, sdxl_enhanced}
        """
        from app.utils.video_io import VideoIO

        with tempfile.TemporaryDirectory(prefix="thumb_") as tmp_dir:
            # Download source video
            local_path = await asyncio.to_thread(VideoIO.download_from_s3, s3_key, tmp_dir)

            # Find or use specified timestamp
            if timestamp is None:
                timestamp = await asyncio.to_thread(
                    self._find_optimal_timestamp, local_path
                )

            # Extract frame
            frame = await asyncio.to_thread(
                self._extract_frame, local_path, timestamp
            )

            # Apply style enhancement
            enhanced = False
            if style != "natural" and self._sdxl_pipeline is not None:
                frame = await asyncio.to_thread(
                    self._enhance_with_sdxl, frame, style
                )
                enhanced = True
            elif style != "natural":
                frame = self._apply_simple_style(frame, style)

            # Resize to target dimensions
            frame = self._resize_frame(frame, width, height)

            # Encode to JPEG
            img_bytes = self._encode_frame(frame)

            # Upload to S3
            thumb_s3_key = f"thumbnails/{clip_id}/{uuid.uuid4().hex[:8]}.jpg"
            thumbnail_url = await asyncio.to_thread(
                self._upload_to_s3, img_bytes, thumb_s3_key
            )

        return {
            "thumbnail_url": thumbnail_url,
            "s3_key": thumb_s3_key,
            "timestamp_used": round(timestamp, 3),
            "width": width,
            "height": height,
            "sdxl_enhanced": enhanced,
        }

    # ── Internal Methods ──────────────────────────────────────────────────────

    @staticmethod
    def _find_optimal_timestamp(video_path: str) -> float:
        """Find the highest visual energy frame in the video."""
        import cv2

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps

        # Sample every 2 seconds
        best_score = -1.0
        best_time = duration * 0.25  # Default to 25% in
        step = max(1, int(2.0 * fps))

        for frame_idx in range(0, total_frames, step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                continue

            score = ThumbnailGenerator._frame_energy_score(frame)
            if score > best_score:
                best_score = score
                best_time = frame_idx / fps

        cap.release()
        return round(best_time, 3)

    @staticmethod
    def _frame_energy_score(frame) -> float:
        """Score a frame's visual interest (sharpness + color vibrancy)."""
        import cv2

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        # Sharpness via Laplacian variance
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        # Color vibrancy via saturation
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        vibrancy = float(np.mean(hsv[:, :, 1]))

        # Brightness (prefer well-lit frames, not over/under exposed)
        brightness = float(np.mean(gray))
        brightness_score = 1.0 - abs(brightness - 128.0) / 128.0

        return sharpness * 0.4 + vibrancy * 0.3 + brightness_score * 100 * 0.3

    @staticmethod
    def _extract_frame(video_path: str, timestamp: float):
        """Extract a single frame at the given timestamp."""
        import cv2

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(timestamp * fps))
        ret, frame = cap.read()
        cap.release()

        if not ret:
            raise ValueError(f"Could not extract frame at timestamp {timestamp}s")
        return frame

    def _enhance_with_sdxl(self, frame, style: str):
        """Apply SDXL img2img enhancement to the frame."""
        from PIL import Image

        style_prompts = {
            "enhanced": "professional photography, sharp focus, vibrant colors, cinematic",
            "dramatic": "dramatic lighting, high contrast, moody atmosphere, cinematic",
            "bright": "bright vivid colors, cheerful, high key lighting, sharp",
        }
        prompt = style_prompts.get(style, style_prompts["enhanced"])

        # Convert frame to PIL Image
        import cv2

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb).resize((1024, 576))

        result = self._sdxl_pipeline(
            prompt=prompt,
            image=pil_img,
            strength=0.4,
            guidance_scale=7.5,
            num_inference_steps=20,
        ).images[0]

        # Convert back to OpenCV format
        result_np = np.array(result)
        return cv2.cvtColor(result_np, cv2.COLOR_RGB2BGR)

    @staticmethod
    def _apply_simple_style(frame, style: str):
        """Apply simple OpenCV-based style enhancement without SDXL."""
        import cv2

        if style == "enhanced":
            # Sharpen + slight saturation boost
            kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
            frame = cv2.filter2D(frame, -1, kernel)
        elif style == "dramatic":
            # High contrast
            frame = cv2.convertScaleAbs(frame, alpha=1.4, beta=-20)
        elif style == "bright":
            # Brightness boost
            frame = cv2.convertScaleAbs(frame, alpha=1.2, beta=30)

        return frame

    @staticmethod
    def _resize_frame(frame, width: int, height: int):
        """Resize frame to target dimensions maintaining aspect ratio with padding."""
        import cv2

        h, w = frame.shape[:2]
        target_ratio = width / height
        current_ratio = w / h

        if current_ratio > target_ratio:
            # Crop width
            new_w = int(h * target_ratio)
            x_offset = (w - new_w) // 2
            frame = frame[:, x_offset : x_offset + new_w]
        else:
            # Crop height
            new_h = int(w / target_ratio)
            y_offset = (h - new_h) // 2
            frame = frame[y_offset : y_offset + new_h, :]

        return cv2.resize(frame, (width, height), interpolation=cv2.INTER_LANCZOS4)

    @staticmethod
    def _encode_frame(frame) -> bytes:
        """Encode frame to JPEG bytes."""
        import cv2

        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
        return buffer.tobytes()

    @staticmethod
    def _upload_to_s3(img_bytes: bytes, s3_key: str) -> str:
        """Upload thumbnail bytes to S3 and return presigned URL."""
        import boto3
        from app.config import get_settings

        settings = get_settings()
        s3 = boto3.client("s3", **settings.s3_kwargs)
        s3.put_object(
            Bucket=settings.S3_BUCKET_THUMBNAILS,
            Key=s3_key,
            Body=img_bytes,
            ContentType="image/jpeg",
            CacheControl="max-age=31536000",
        )
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.S3_BUCKET_THUMBNAILS, "Key": s3_key},
            ExpiresIn=settings.S3_PRESIGN_EXPIRY,
        )
        return url
