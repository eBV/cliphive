"""
POST /retrain
Accepts feedback data and triggers async fine-tuning of the virality
scorer model.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

import structlog
from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()

# In-memory job registry (replace with Redis/DB in production)
_job_registry: dict[str, dict] = {}


# ─── Request / Response Schemas ───────────────────────────────────────────────


class FeedbackSample(BaseModel):
    feature_vector: list[float] = Field(..., description="512-dim feature vector")
    predicted_score: float = Field(..., ge=0.0, le=1.0)
    actual_views: int = Field(..., ge=0, description="Actual view count after publishing")
    actual_engagement: float = Field(
        ..., ge=0.0, description="Engagement rate (likes+comments+shares / views)"
    )
    platform: str | None = None
    clip_duration: float | None = None


class RetrainRequest(BaseModel):
    feedback_data: list[FeedbackSample] = Field(
        ...,
        min_length=10,
        description="Minimum 10 samples required to trigger retraining",
    )
    model_version: str | None = Field(
        default=None,
        description="Specific model version to fine-tune. Defaults to current production model.",
    )
    epochs: int = Field(default=5, ge=1, le=50)
    learning_rate: float = Field(default=1e-4, gt=0.0)

    model_config = {
        "json_schema_extra": {
            "example": {
                "feedback_data": [
                    {
                        "feature_vector": [0.1] * 512,
                        "predicted_score": 0.7,
                        "actual_views": 150000,
                        "actual_engagement": 0.08,
                    }
                ],
                "epochs": 5,
                "learning_rate": 1e-4,
            }
        }
    }


class RetrainResponse(BaseModel):
    job_id: str
    status: str
    message: str
    sample_count: int
    estimated_duration_minutes: float


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: float | None = None
    metrics: dict[str, Any] = {}
    error: str | None = None
    created_at: str | None = None
    completed_at: str | None = None


# ─── Background Task ──────────────────────────────────────────────────────────


async def _run_retraining(job_id: str, request: RetrainRequest) -> None:
    """Background coroutine that runs the training loop."""
    from app.services.training.train import run_training

    _job_registry[job_id]["status"] = "running"
    log.info("retrain.job_started", job_id=job_id, sample_count=len(request.feedback_data))

    try:
        metrics = await asyncio.to_thread(
            run_training,
            feedback_data=[s.model_dump() for s in request.feedback_data],
            job_id=job_id,
            epochs=request.epochs,
            learning_rate=request.learning_rate,
            model_version=request.model_version,
        )
        _job_registry[job_id].update(
            {
                "status": "completed",
                "progress": 1.0,
                "metrics": metrics,
                "completed_at": __import__("datetime").datetime.utcnow().isoformat(),
            }
        )
        log.info("retrain.job_completed", job_id=job_id, metrics=metrics)
    except Exception as exc:
        _job_registry[job_id].update(
            {
                "status": "failed",
                "error": str(exc),
                "completed_at": __import__("datetime").datetime.utcnow().isoformat(),
            }
        )
        log.exception("retrain.job_failed", job_id=job_id, error=str(exc))


# ─── Routes ───────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=RetrainResponse,
    summary="Trigger async virality model fine-tuning",
    status_code=status.HTTP_202_ACCEPTED,
)
async def retrain(
    payload: RetrainRequest,
    background_tasks: BackgroundTasks,
) -> RetrainResponse:
    """
    Accepts feedback data (feature vectors + actual engagement metrics)
    and enqueues an async fine-tuning job for the virality scorer model.
    """
    import datetime

    job_id = f"retrain_{uuid.uuid4().hex[:12]}"
    sample_count = len(payload.feedback_data)

    # Estimate duration: ~1 min per 100 samples per epoch
    estimated_minutes = (sample_count / 100) * payload.epochs * 1.0

    _job_registry[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0.0,
        "metrics": {},
        "error": None,
        "created_at": datetime.datetime.utcnow().isoformat(),
        "completed_at": None,
        "sample_count": sample_count,
    }

    background_tasks.add_task(_run_retraining, job_id, payload)

    log.info("retrain.job_queued", job_id=job_id, sample_count=sample_count)

    return RetrainResponse(
        job_id=job_id,
        status="queued",
        message=f"Retraining job queued with {sample_count} samples",
        sample_count=sample_count,
        estimated_duration_minutes=round(estimated_minutes, 1),
    )


@router.get(
    "/{job_id}",
    response_model=JobStatusResponse,
    summary="Get retraining job status",
    status_code=status.HTTP_200_OK,
)
async def get_retrain_status(job_id: str) -> JobStatusResponse:
    """Retrieve the status and metrics for a retraining job."""
    if job_id not in _job_registry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found",
        )

    job = _job_registry[job_id]
    return JobStatusResponse(
        job_id=job["job_id"],
        status=job["status"],
        progress=job.get("progress"),
        metrics=job.get("metrics", {}),
        error=job.get("error"),
        created_at=job.get("created_at"),
        completed_at=job.get("completed_at"),
    )
