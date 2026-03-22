"""
Application configuration via Pydantic Settings.
All values are read from environment variables (or a .env file).
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for the ClipHive ML service."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Service Identity ──────────────────────────────────────────────────────
    SERVICE_NAME: str = "cliphive-ml"
    SERVICE_VERSION: str = "1.0.0"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False

    # ── Auth ──────────────────────────────────────────────────────────────────
    ML_SERVICE_API_KEY: str = Field(
        default="dev-insecure-key",
        description="Shared secret for inter-service authentication",
    )

    # ── OpenRouter ────────────────────────────────────────────────────────────
    OPENROUTERAI_API_KEY: str = Field(default="", description="OpenRouter API key")
    OPENROUTER_MODEL_CAPTION: str = "meta-llama/llama-3.1-8b-instruct:free"
    OPENROUTER_MODEL_HASHTAG: str = "meta-llama/llama-3.1-8b-instruct:free"
    OPENROUTER_TIMEOUT: float = 60.0

    # ── AWS / S3 ──────────────────────────────────────────────────────────────
    AWS_ACCESS_KEY_ID: str = Field(default="", description="AWS access key ID")
    AWS_SECRET_ACCESS_KEY: str = Field(default="", description="AWS secret access key")
    AWS_REGION: str = "us-east-1"
    S3_BUCKET_MEDIA: str = Field(
        default="cliphive-media", description="S3 bucket for source media"
    )
    S3_BUCKET_CLIPS: str = Field(
        default="cliphive-clips", description="S3 bucket for processed clips"
    )
    S3_BUCKET_THUMBNAILS: str = Field(
        default="cliphive-thumbnails", description="S3 bucket for thumbnails"
    )
    S3_ENDPOINT_URL: str | None = Field(
        default=None, description="Custom S3 endpoint (e.g. MinIO)"
    )
    S3_PRESIGN_EXPIRY: int = 3600  # seconds

    # ── Model / Device ────────────────────────────────────────────────────────
    DEVICE: Literal["cuda", "cpu", "mps"] = Field(
        default="cpu",
        description="PyTorch device. Set to 'cuda' when GPU is available.",
    )
    MODEL_DIR: str = Field(
        default="/models",
        description="Directory for cached model weights",
    )
    WHISPER_MODEL: str = Field(
        default="large-v3",
        description="Whisper model variant",
    )

    # ── Virality Engine ───────────────────────────────────────────────────────
    CLIP_MIN_DURATION: float = 5.0   # seconds
    CLIP_MAX_DURATION: float = 60.0  # seconds
    CLIP_STRIDE: float = 0.5         # sliding window stride in seconds
    CLIP_TOP_K: int = 10             # max clips returned per source
    NMS_IOU_THRESHOLD: float = 0.3   # IoU threshold for non-max suppression

    # ── Scene Detection ───────────────────────────────────────────────────────
    SCENE_THRESHOLD: float = 27.0    # ContentDetector threshold
    SCENE_MIN_LENGTH: int = 15       # frames

    # ── Thumbnail / SDXL ─────────────────────────────────────────────────────
    SDXL_ENABLED: bool = False
    SDXL_MODEL_ID: str = "stabilityai/stable-diffusion-xl-base-1.0"
    THUMBNAIL_WIDTH: int = 1280
    THUMBNAIL_HEIGHT: int = 720

    # ── Workers / Concurrency ─────────────────────────────────────────────────
    WORKER_CONCURRENCY: int = 4
    MAX_VIDEO_SIZE_MB: int = 2048

    # ── Logging ───────────────────────────────────────────────────────────────
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = True

    # ── Training ─────────────────────────────────────────────────────────────
    TRAINING_DATA_DIR: str = "/tmp/training_data"
    MODEL_CHECKPOINT_DIR: str = "/models/checkpoints"
    WANDB_PROJECT: str = "cliphive-virality"
    WANDB_API_KEY: str = ""
    WANDB_ENABLED: bool = False

    # ── CORS ─────────────────────────────────────────────────────────────────
    CORS_ORIGINS: list[str] = ["*"]

    @field_validator("DEVICE")
    @classmethod
    def validate_device(cls, v: str) -> str:
        """Fall back to CPU if CUDA not available."""
        if v == "cuda":
            try:
                import torch
                if not torch.cuda.is_available():
                    return "cpu"
            except ImportError:
                return "cpu"
        return v

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def s3_kwargs(self) -> dict:
        """Kwargs for boto3 S3 client creation."""
        kwargs: dict = {
            "region_name": self.AWS_REGION,
        }
        if self.AWS_ACCESS_KEY_ID:
            kwargs["aws_access_key_id"] = self.AWS_ACCESS_KEY_ID
        if self.AWS_SECRET_ACCESS_KEY:
            kwargs["aws_secret_access_key"] = self.AWS_SECRET_ACCESS_KEY
        if self.S3_ENDPOINT_URL:
            kwargs["endpoint_url"] = self.S3_ENDPOINT_URL
        return kwargs


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings singleton."""
    return Settings()
