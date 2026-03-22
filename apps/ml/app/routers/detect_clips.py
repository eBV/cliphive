"""
POST /detect-clips
Full 7-stage virality engine pipeline. Accepts source media metadata and
returns top-K ClipCandidates sorted by virality score.
"""
from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ─── Request / Response Schemas ───────────────────────────────────────────────


class TranscriptWord(BaseModel):
    word: str
    start: float
    end: float
    probability: float = 1.0


class TranscriptSegmentIn(BaseModel):
    id: int
    start: float
    end: float
    text: str
    confidence: float = 1.0
    words: list[TranscriptWord] = []


class ClipDetectionConfig(BaseModel):
    min_duration: float = 5.0
    max_duration: float = 60.0
    top_k: int = 10
    nms_iou_threshold: float = 0.3
    window_stride: float = 0.5
    target_platforms: list[str] = ["tiktok", "instagram", "youtube"]
    content_type: str | None = None  # "comedy", "education", "news", etc.


class ViralityScoreBreakdown(BaseModel):
    overall: float
    hook_score: float
    emotion_score: float
    audio_energy_score: float
    transcript_quality_score: float
    face_presence_score: float
    motion_score: float
    loop_score: float
    pacing_score: float


class FaceTrackPoint(BaseModel):
    time: float
    x: float
    y: float
    width: float
    height: float
    emotion: str | None = None


class ClipCandidate(BaseModel):
    clip_id: str
    source_media_id: str
    start_time: float
    end_time: float
    duration: float
    virality_score: float
    score_breakdown: ViralityScoreBreakdown
    transcript_snippet: str
    hook_text: str | None = None
    suggested_caption: str | None = None
    dominant_emotion: str | None = None
    face_track: list[FaceTrackPoint] = []
    feature_vector: list[float] = Field(default=[], exclude=True)
    rank: int


class DetectClipsRequest(BaseModel):
    source_media_id: str
    s3_key: str
    transcript_segments: list[TranscriptSegmentIn] = []
    scene_graph: dict[str, Any] = Field(default_factory=dict)
    config: ClipDetectionConfig = Field(default_factory=ClipDetectionConfig)

    model_config = {
        "json_schema_extra": {
            "example": {
                "source_media_id": "media_abc123",
                "s3_key": "uploads/video.mp4",
                "transcript_segments": [],
                "config": {"top_k": 5, "min_duration": 15.0, "max_duration": 60.0},
            }
        }
    }


class DetectClipsResponse(BaseModel):
    source_media_id: str
    clips: list[ClipCandidate]
    total_candidates_evaluated: int
    processing_time_s: float


# ─── Route ────────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=DetectClipsResponse,
    summary="Run the 7-stage virality engine and return top-K clip candidates",
    status_code=status.HTTP_200_OK,
)
async def detect_clips(payload: DetectClipsRequest) -> DetectClipsResponse:
    """
    Runs the full virality engine pipeline:
    1. Sliding window extraction
    2. Feature vector computation (512-dim)
    3. Virality model scoring
    4. Non-Maximum Suppression
    5. Hook optimization (best start frame ±2s)
    6. Exit optimization (punchline / natural pause)
    7. Loop score computation

    Returns top-K ClipCandidates sorted by virality score.
    """
    import time
    from app.main import get_model

    t0 = time.perf_counter()
    clip_ranker = get_model("clip_ranker")

    log.info(
        "detect_clips.start",
        source_media_id=payload.source_media_id,
        s3_key=payload.s3_key,
    )

    try:
        raw_candidates, total_evaluated = await clip_ranker.detect_viral_clips(
            source_media_id=payload.source_media_id,
            s3_key=payload.s3_key,
            transcript_segments=[s.model_dump() for s in payload.transcript_segments],
            scene_graph=payload.scene_graph,
            config=payload.config.model_dump(),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("detect_clips.error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Clip detection failed: {exc}",
        ) from exc

    elapsed = time.perf_counter() - t0
    log.info(
        "detect_clips.done",
        clips_returned=len(raw_candidates),
        total_evaluated=total_evaluated,
        elapsed_s=round(elapsed, 2),
    )

    clips = []
    for rank, c in enumerate(raw_candidates, start=1):
        breakdown = c.get("score_breakdown", {})
        clips.append(
            ClipCandidate(
                clip_id=c["clip_id"],
                source_media_id=payload.source_media_id,
                start_time=c["start_time"],
                end_time=c["end_time"],
                duration=c["end_time"] - c["start_time"],
                virality_score=c["virality_score"],
                score_breakdown=ViralityScoreBreakdown(
                    overall=c["virality_score"],
                    hook_score=breakdown.get("hook_score", 0.0),
                    emotion_score=breakdown.get("emotion_score", 0.0),
                    audio_energy_score=breakdown.get("audio_energy_score", 0.0),
                    transcript_quality_score=breakdown.get("transcript_quality_score", 0.0),
                    face_presence_score=breakdown.get("face_presence_score", 0.0),
                    motion_score=breakdown.get("motion_score", 0.0),
                    loop_score=breakdown.get("loop_score", 0.0),
                    pacing_score=breakdown.get("pacing_score", 0.0),
                ),
                transcript_snippet=c.get("transcript_snippet", ""),
                hook_text=c.get("hook_text"),
                suggested_caption=c.get("suggested_caption"),
                dominant_emotion=c.get("dominant_emotion"),
                face_track=[FaceTrackPoint(**fp) for fp in c.get("face_track", [])],
                rank=rank,
            )
        )

    return DetectClipsResponse(
        source_media_id=payload.source_media_id,
        clips=clips,
        total_candidates_evaluated=total_evaluated,
        processing_time_s=round(elapsed, 2),
    )
