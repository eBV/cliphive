"""
POST /score
Accepts a clip definition and returns a full ViralityScoreBreakdown.
"""
from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ─── Request / Response Schemas ───────────────────────────────────────────────


class ScoreRequest(BaseModel):
    clip_id: str
    start_time: float
    end_time: float
    s3_key: str
    transcript_snippet: str = ""
    scene_data: dict[str, Any] = Field(default_factory=dict)
    platform: str | None = None  # "tiktok", "instagram", "youtube"

    model_config = {
        "json_schema_extra": {
            "example": {
                "clip_id": "clip_abc",
                "start_time": 12.5,
                "end_time": 42.0,
                "s3_key": "uploads/video.mp4",
                "transcript_snippet": "This is the most insane thing you've ever seen",
                "platform": "tiktok",
            }
        }
    }


class ViralityScoreBreakdown(BaseModel):
    overall: float = Field(..., ge=0.0, le=1.0, description="Composite virality score [0–1]")
    hook_score: float = Field(..., ge=0.0, le=1.0)
    emotion_score: float = Field(..., ge=0.0, le=1.0)
    audio_energy_score: float = Field(..., ge=0.0, le=1.0)
    transcript_quality_score: float = Field(..., ge=0.0, le=1.0)
    face_presence_score: float = Field(..., ge=0.0, le=1.0)
    motion_score: float = Field(..., ge=0.0, le=1.0)
    loop_score: float = Field(..., ge=0.0, le=1.0)
    pacing_score: float = Field(..., ge=0.0, le=1.0)
    duration_fit_score: float = Field(..., ge=0.0, le=1.0)
    platform_fit_score: float = Field(..., ge=0.0, le=1.0)


class ScoreResponse(BaseModel):
    clip_id: str
    score: ViralityScoreBreakdown
    dominant_emotion: str | None
    processing_time_s: float
    feature_vector_dim: int


# ─── Route ────────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=ScoreResponse,
    summary="Score a clip's virality with full breakdown",
    status_code=status.HTTP_200_OK,
)
async def score_virality(payload: ScoreRequest) -> ScoreResponse:
    """
    Compute full virality score breakdown for a specified clip window.
    Extracts features from the video segment and runs the virality model.
    """
    import time
    from app.main import get_model

    t0 = time.perf_counter()
    clip_ranker = get_model("clip_ranker")

    log.info("score_virality.start", clip_id=payload.clip_id)

    try:
        result = await clip_ranker.score_clip(
            s3_key=payload.s3_key,
            start_time=payload.start_time,
            end_time=payload.end_time,
            transcript_snippet=payload.transcript_snippet,
            scene_data=payload.scene_data,
            platform=payload.platform,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("score_virality.error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Scoring failed: {exc}",
        ) from exc

    elapsed = time.perf_counter() - t0
    log.info(
        "score_virality.done",
        clip_id=payload.clip_id,
        overall=result["overall"],
        elapsed_s=round(elapsed, 2),
    )

    return ScoreResponse(
        clip_id=payload.clip_id,
        score=ViralityScoreBreakdown(
            overall=result["overall"],
            hook_score=result.get("hook_score", 0.0),
            emotion_score=result.get("emotion_score", 0.0),
            audio_energy_score=result.get("audio_energy_score", 0.0),
            transcript_quality_score=result.get("transcript_quality_score", 0.0),
            face_presence_score=result.get("face_presence_score", 0.0),
            motion_score=result.get("motion_score", 0.0),
            loop_score=result.get("loop_score", 0.0),
            pacing_score=result.get("pacing_score", 0.0),
            duration_fit_score=result.get("duration_fit_score", 0.0),
            platform_fit_score=result.get("platform_fit_score", 0.0),
        ),
        dominant_emotion=result.get("dominant_emotion"),
        processing_time_s=round(elapsed, 2),
        feature_vector_dim=result.get("feature_vector_dim", 512),
    )
