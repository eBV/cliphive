"""
ClipHive ML Microservice – FastAPI entrypoint.

Startup sequence:
1. Configure structured logging
2. Load ML models into memory (Whisper, YOLO, CLIP, etc.)
3. Register all routers
4. Add API-key auth middleware
5. Add Prometheus instrumentation
6. Expose /health endpoint
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

import structlog
from fastapi import FastAPI, Request, Response, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator

from app.config import get_settings
from app.routers import (
    transcribe,
    detect_scenes,
    detect_clips,
    score_virality,
    generate_captions,
    generate_hashtags,
    generate_thumbnail,
    retrain,
)

settings = get_settings()

# ─── Logging Setup ────────────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer() if settings.LOG_JSON
        else structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        __import__("logging").getLevelName(settings.LOG_LEVEL)
    ),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)

log = structlog.get_logger(__name__)

# ─── Model Registry (lazy singletons) ────────────────────────────────────────

_model_registry: dict = {}


async def load_models() -> None:
    """Load all ML models into memory on startup."""
    from app.services.whisper_service import WhisperService
    from app.services.scene_service import SceneService
    from app.services.clip_ranker import ClipRanker
    from app.services.audio_analyzer import AudioAnalyzer
    from app.services.face_tracker import FaceTracker
    from app.services.emotion_classifier import EmotionClassifier
    from app.services.hook_analyzer import HookAnalyzer
    from app.services.caption_generator import CaptionGenerator
    from app.services.hashtag_optimizer import HashtagOptimizer
    from app.services.thumbnail_generator import ThumbnailGenerator

    log.info("Loading ML models…", device=settings.DEVICE)
    t0 = time.perf_counter()

    _model_registry["whisper"] = WhisperService()
    _model_registry["scene"] = SceneService()
    _model_registry["clip_ranker"] = ClipRanker()
    _model_registry["audio_analyzer"] = AudioAnalyzer()
    _model_registry["face_tracker"] = FaceTracker()
    _model_registry["emotion_classifier"] = EmotionClassifier()
    _model_registry["hook_analyzer"] = HookAnalyzer()
    _model_registry["caption_generator"] = CaptionGenerator()
    _model_registry["hashtag_optimizer"] = HashtagOptimizer()
    _model_registry["thumbnail_generator"] = ThumbnailGenerator()

    elapsed = time.perf_counter() - t0
    log.info("All models loaded", elapsed_s=round(elapsed, 2))


def get_model(name: str):
    """Retrieve a loaded model from registry."""
    if name not in _model_registry:
        raise RuntimeError(f"Model '{name}' not loaded. Was startup successful?")
    return _model_registry[name]


# ─── Lifespan ─────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: load models on startup, clean up on shutdown."""
    await load_models()
    yield
    log.info("ML service shutting down")
    _model_registry.clear()


# ─── App Factory ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="ClipHive ML Service",
    description="AI/ML processing microservice for viral clip detection, transcription, and content analysis.",
    version=settings.SERVICE_VERSION,
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
    lifespan=lifespan,
)

# ─── CORS ─────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── API Key Middleware ────────────────────────────────────────────────────────

EXEMPT_PATHS = {"/health", "/metrics", "/docs", "/redoc", "/openapi.json"}


@app.middleware("http")
async def api_key_middleware(request: Request, call_next) -> Response:
    """Validate ML_SERVICE_API_KEY on all non-exempt routes."""
    if request.url.path in EXEMPT_PATHS:
        return await call_next(request)

    api_key = request.headers.get("X-API-Key") or request.headers.get("Authorization", "").removeprefix("Bearer ")
    if not api_key or api_key != settings.ML_SERVICE_API_KEY:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Invalid or missing API key"},
        )
    return await call_next(request)


# ─── Request Logging Middleware ────────────────────────────────────────────────


@app.middleware("http")
async def logging_middleware(request: Request, call_next) -> Response:
    """Log request/response metadata."""
    t0 = time.perf_counter()
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        method=request.method,
        path=request.url.path,
        client=request.client.host if request.client else "unknown",
    )
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    log.info(
        "request",
        status_code=response.status_code,
        elapsed_ms=elapsed_ms,
    )
    return response


# ─── Prometheus ───────────────────────────────────────────────────────────────

Instrumentator(
    should_group_status_codes=False,
    excluded_handlers=["/health", "/metrics"],
).instrument(app).expose(app, endpoint="/metrics")

# ─── Routers ─────────────────────────────────────────────────────────────────

app.include_router(transcribe.router, prefix="/transcribe", tags=["Transcription"])
app.include_router(detect_scenes.router, prefix="/detect-scenes", tags=["Scene Detection"])
app.include_router(detect_clips.router, prefix="/detect-clips", tags=["Clip Detection"])
app.include_router(score_virality.router, prefix="/score", tags=["Virality Scoring"])
app.include_router(generate_captions.router, prefix="/captions", tags=["Caption Generation"])
app.include_router(generate_hashtags.router, prefix="/hashtags", tags=["Hashtag Generation"])
app.include_router(generate_thumbnail.router, prefix="/thumbnail", tags=["Thumbnail Generation"])
app.include_router(retrain.router, prefix="/retrain", tags=["Model Training"])

# ─── Health Check ─────────────────────────────────────────────────────────────


@app.get("/health", tags=["Meta"])
async def health_check() -> dict:
    """Liveness + readiness probe."""
    import torch

    return {
        "status": "ok",
        "service": settings.SERVICE_NAME,
        "version": settings.SERVICE_VERSION,
        "environment": settings.ENVIRONMENT,
        "device": settings.DEVICE,
        "cuda_available": torch.cuda.is_available(),
        "models_loaded": list(_model_registry.keys()),
    }


# ─── Global Exception Handler ─────────────────────────────────────────────────


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled_exception", path=request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__},
    )
