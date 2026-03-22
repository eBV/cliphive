"""
Modal.com serverless GPU deployment for ClipHive ML microservice.
Deploys the FastAPI app on A10G GPU with auto-scaling.

Deploy with:
    modal deploy modal_deploy.py

Serve locally:
    modal serve modal_deploy.py
"""
from __future__ import annotations

import os
import sys

import modal

# ─── Image Definition ────────────────────────────────────────────────────────

CUDA_VERSION = "12.1.0"
FLAVOR = "cudnn8-devel"
OS = "ubuntu22.04"
BASE_IMAGE = f"nvidia/cuda:{CUDA_VERSION}-{FLAVOR}-{OS}"

# Build the container image with all ML dependencies
ml_image = (
    modal.Image.from_registry(BASE_IMAGE, add_python="3.12")
    .apt_install(
        "ffmpeg",
        "libsndfile1",
        "libsndfile1-dev",
        "libportaudio2",
        "libportaudiocpp0",
        "portaudio19-dev",
        "libgl1-mesa-glx",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
        "libxrender-dev",
        "libgomp1",
        "libjpeg-dev",
        "libpng-dev",
        "libtiff-dev",
        "build-essential",
        "cmake",
        "git",
        "curl",
        "wget",
    )
    .pip_install(
        # PyTorch with CUDA 12.1
        "torch==2.3.0",
        "torchvision==0.18.0",
        "torchaudio==2.3.0",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        # Core framework
        "fastapi==0.111.0",
        "uvicorn[standard]==0.29.0",
        "python-multipart==0.0.9",
        "pydantic==2.7.1",
        "pydantic-settings==2.2.1",
        # OpenAI
        "openai==1.30.1",
        "openai-whisper==20231117",
        # CV & Scene
        "scenedetect[opencv]==0.6.4",
        "mediapipe==0.10.14",
        "opencv-python==4.9.0.80",
        "Pillow==10.3.0",
        "ultralytics==8.2.18",
        # Audio
        "librosa==0.10.2",
        "soundfile==0.12.1",
        # Diffusers
        "diffusers==0.27.2",
        "transformers==4.41.0",
        "accelerate==0.30.1",
        "safetensors==0.4.3",
        # AWS
        "boto3==1.34.110",
        # HTTP & Utils
        "httpx==0.27.0",
        "aiohttp==3.9.5",
        "aiofiles==23.2.1",
        "tenacity==8.3.0",
        "structlog==24.1.0",
        "prometheus-fastapi-instrumentator==7.0.0",
        "prometheus-client==0.20.0",
        "numpy==1.26.4",
        "scipy==1.13.0",
        "ftfy==6.2.0",
        "regex==2024.5.15",
        "imageio==2.34.1",
        "imageio-ffmpeg==0.5.1",
        "moviepy==1.0.3",
        "tqdm==4.66.4",
        "rich==13.7.1",
        "python-dotenv==1.0.1",
        "wandb==0.17.0",
    )
    # Pre-download Whisper large-v3 model into the image layer
    .run_commands(
        "python3 -c \"import whisper; whisper.load_model('large-v3')\" || true",
    )
)

# ─── Modal App ───────────────────────────────────────────────────────────────

app = modal.App("cliphive-ml", image=ml_image)

# Persistent volume for model weights
model_volume = modal.Volume.from_name("cliphive-ml-models", create_if_missing=True)

# Secrets
ml_secrets = modal.Secret.from_name("cliphive-ml-secrets")

# ─── ASGI Web Endpoint ────────────────────────────────────────────────────────


@app.function(
    gpu="A10G",
    cpu=4,
    memory=32768,  # 32GB RAM
    timeout=600,
    container_idle_timeout=300,
    allow_concurrent_inputs=10,
    volumes={"/models": model_volume},
    secrets=[ml_secrets],
    mounts=[
        modal.Mount.from_local_dir(
            "./app",
            remote_path="/root/app",
        )
    ],
)
@modal.asgi_app()
def fastapi_app():
    """Return the FastAPI app for Modal's ASGI handler."""
    import sys

    sys.path.insert(0, "/root")

    # Set environment variables before importing app
    os.environ.setdefault("MODEL_DIR", "/models")
    os.environ.setdefault("DEVICE", "cuda")

    from app.main import app as fastapi_application

    return fastapi_application


# ─── Standalone Functions for Batch Processing ────────────────────────────────


@app.function(
    gpu="A10G",
    cpu=4,
    memory=32768,
    timeout=1800,
    volumes={"/models": model_volume},
    secrets=[ml_secrets],
)
def transcribe_batch(s3_keys: list[str]) -> list[dict]:
    """Batch transcription for multiple media files."""
    import sys

    sys.path.insert(0, "/root")
    os.environ.setdefault("MODEL_DIR", "/models")
    os.environ.setdefault("DEVICE", "cuda")

    from app.services.whisper_service import WhisperService

    service = WhisperService()
    results = []
    for s3_key in s3_keys:
        try:
            result = service.transcribe_s3_key(s3_key)
            results.append({"s3_key": s3_key, "success": True, "result": result})
        except Exception as e:
            results.append({"s3_key": s3_key, "success": False, "error": str(e)})
    return results


@app.function(
    gpu="A10G",
    cpu=4,
    memory=32768,
    timeout=1800,
    volumes={"/models": model_volume},
    secrets=[ml_secrets],
)
def detect_clips_batch(jobs: list[dict]) -> list[dict]:
    """Batch clip detection for multiple source media."""
    import sys

    sys.path.insert(0, "/root")
    os.environ.setdefault("MODEL_DIR", "/models")
    os.environ.setdefault("DEVICE", "cuda")

    from app.services.clip_ranker import ClipRanker

    ranker = ClipRanker()
    results = []
    for job in jobs:
        try:
            clips = ranker.detect_viral_clips(
                s3_key=job["s3_key"],
                transcript_segments=job.get("transcript_segments", []),
                scene_graph=job.get("scene_graph", {}),
                config=job.get("config", {}),
            )
            results.append(
                {
                    "source_media_id": job["source_media_id"],
                    "success": True,
                    "clips": [c.model_dump() for c in clips],
                }
            )
        except Exception as e:
            results.append(
                {
                    "source_media_id": job["source_media_id"],
                    "success": False,
                    "error": str(e),
                }
            )
    return results


# ─── CLI Entry Point ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Local dev: modal serve modal_deploy.py
    pass
