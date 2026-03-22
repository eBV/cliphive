"""
POST /hashtags
Generates an optimized hashtag set for a clip using GPT-4o
combined with trending hashtag correlation.
"""
from __future__ import annotations

from typing import Literal

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ─── Request / Response Schemas ───────────────────────────────────────────────


class HashtagRequest(BaseModel):
    topic_tags: list[str] = Field(
        ...,
        description="Content topic tags extracted from the clip",
        min_length=1,
    )
    platform: Literal["tiktok", "instagram", "youtube", "twitter"] = "tiktok"
    niche: str | None = Field(
        default=None,
        description="Content niche (e.g. 'fitness', 'comedy', 'news')",
    )
    trending_hashtags: list[str] = Field(
        default=[],
        description="Currently trending hashtags to consider including",
    )
    max_hashtags: int = Field(default=20, ge=5, le=30)
    caption_context: str | None = Field(
        default=None,
        description="Optional caption text for semantic context",
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "topic_tags": ["workout", "fitness", "gym"],
                "platform": "instagram",
                "niche": "fitness",
                "trending_hashtags": ["fyp", "foryou"],
                "max_hashtags": 15,
            }
        }
    }


class HashtagResponse(BaseModel):
    hashtags: list[str]
    reasoning: str
    primary_hashtags: list[str]
    niche_hashtags: list[str]
    trending_hashtags_used: list[str]
    broad_hashtags: list[str]
    platform: str


# ─── Route ────────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=HashtagResponse,
    summary="Generate optimized hashtag set with GPT-4o",
    status_code=status.HTTP_200_OK,
)
async def generate_hashtags(payload: HashtagRequest) -> HashtagResponse:
    """
    Generate a tiered hashtag strategy:
    - Primary: core content descriptors
    - Niche: community/interest-specific
    - Trending: currently viral tags
    - Broad: wide-reach discoverability
    """
    import time
    from app.main import get_model

    t0 = time.perf_counter()
    hashtag_opt = get_model("hashtag_optimizer")

    log.info("generate_hashtags.start", platform=payload.platform, niche=payload.niche)

    try:
        result = await hashtag_opt.generate(
            topic_tags=payload.topic_tags,
            platform=payload.platform,
            niche=payload.niche,
            trending_hashtags=payload.trending_hashtags,
            max_hashtags=payload.max_hashtags,
            caption_context=payload.caption_context,
        )
    except Exception as exc:
        log.exception("generate_hashtags.error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Hashtag generation failed: {exc}",
        ) from exc

    elapsed = time.perf_counter() - t0
    log.info(
        "generate_hashtags.done",
        hashtag_count=len(result.get("hashtags", [])),
        elapsed_s=round(elapsed, 2),
    )

    return HashtagResponse(
        hashtags=result["hashtags"],
        reasoning=result.get("reasoning", ""),
        primary_hashtags=result.get("primary_hashtags", []),
        niche_hashtags=result.get("niche_hashtags", []),
        trending_hashtags_used=result.get("trending_hashtags_used", []),
        broad_hashtags=result.get("broad_hashtags", []),
        platform=payload.platform,
    )
