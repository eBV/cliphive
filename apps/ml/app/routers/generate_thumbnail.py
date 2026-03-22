"""
POST /thumbnail
Extracts the optimal frame from a clip and optionally enhances it
with SDXL img2img. Uploads result to S3 and returns the URL.
"""
from __future__ import annotations

from typing import Literal

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ─── Request / Response Schemas ───────────────────────────────────────────────


class ThumbnailRequest(BaseModel):
    clip_id: str
    s3_key: str = Field(..., description="S3 key of the source video")
    timestamp: float | None = Field(
        default=None,
        description="Specific timestamp to extract frame from. If None, auto-selects highest-energy frame.",
    )
    style: Literal["natural", "enhanced", "dramatic", "bright"] = "natural"
    width: int = 1280
    height: int = 720

    model_config = {
        "json_schema_extra": {
            "example": {
                "clip_id": "clip_abc123",
                "s3_key": "uploads/video.mp4",
                "timestamp": 5.2,
                "style": "enhanced",
            }
        }
    }


class ThumbnailResponse(BaseModel):
    clip_id: str
    thumbnail_url: str
    s3_key: str
    timestamp_used: float
    width: int
    height: int
    style: str
    sdxl_enhanced: bool
    processing_time_s: float


# ─── Route ────────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=ThumbnailResponse,
    summary="Generate and upload a thumbnail for a clip",
    status_code=status.HTTP_200_OK,
)
async def generate_thumbnail(payload: ThumbnailRequest) -> ThumbnailResponse:
    """
    1. Download video from S3
    2. Find the optimal frame (highest energy score or at specified timestamp)
    3. Optionally enhance with SDXL img2img
    4. Upload thumbnail to S3
    5. Return presigned URL
    """
    import time
    from app.main import get_model

    t0 = time.perf_counter()
    thumb_gen = get_model("thumbnail_generator")

    log.info(
        "generate_thumbnail.start",
        clip_id=payload.clip_id,
        s3_key=payload.s3_key,
        style=payload.style,
    )

    try:
        result = await thumb_gen.generate(
            clip_id=payload.clip_id,
            s3_key=payload.s3_key,
            timestamp=payload.timestamp,
            style=payload.style,
            width=payload.width,
            height=payload.height,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("generate_thumbnail.error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Thumbnail generation failed: {exc}",
        ) from exc

    elapsed = time.perf_counter() - t0
    log.info(
        "generate_thumbnail.done",
        clip_id=payload.clip_id,
        s3_key=result["s3_key"],
        elapsed_s=round(elapsed, 2),
    )

    return ThumbnailResponse(
        clip_id=payload.clip_id,
        thumbnail_url=result["thumbnail_url"],
        s3_key=result["s3_key"],
        timestamp_used=result["timestamp_used"],
        width=result["width"],
        height=result["height"],
        style=payload.style,
        sdxl_enhanced=result.get("sdxl_enhanced", False),
        processing_time_s=round(elapsed, 2),
    )
