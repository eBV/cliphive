"""
POST /captions
Generates viral captions using GPT-4o with platform-specific
tone, emoji placement, and emphasis word detection.
"""
from __future__ import annotations

from typing import Literal

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ─── Request / Response Schemas ───────────────────────────────────────────────


class CaptionRequest(BaseModel):
    transcript_snippet: str = Field(
        ...,
        description="Transcript text of the clip to caption",
        min_length=1,
        max_length=4000,
    )
    style: Literal["hook", "storytelling", "educational", "funny", "dramatic"] = "hook"
    platform: Literal["tiktok", "instagram", "youtube", "twitter"] = "tiktok"
    language: str = "en"
    emphasis_words: list[str] = Field(
        default=[],
        description="Words to emphasize (bold/caps) in the caption",
    )
    topic_tags: list[str] = Field(
        default=[],
        description="Topic tags from the content to guide caption tone",
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "transcript_snippet": "I can't believe what just happened. This is insane.",
                "style": "hook",
                "platform": "tiktok",
                "emphasis_words": ["insane"],
            }
        }
    }


class CaptionResponse(BaseModel):
    caption: str
    emphasis_words: list[str]
    suggested_hashtags: list[str]
    caption_length: int
    hook_word: str | None = None
    platform: str


# ─── Route ────────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=CaptionResponse,
    summary="Generate a viral caption with GPT-4o",
    status_code=status.HTTP_200_OK,
)
async def generate_captions(payload: CaptionRequest) -> CaptionResponse:
    """
    Calls GPT-4o to generate a platform-optimized, viral caption.
    Detects emphasis words and suggests hashtags based on content.
    """
    import time
    from app.main import get_model

    t0 = time.perf_counter()
    caption_gen = get_model("caption_generator")

    log.info("generate_captions.start", platform=payload.platform, style=payload.style)

    try:
        result = await caption_gen.generate(
            transcript_snippet=payload.transcript_snippet,
            style=payload.style,
            platform=payload.platform,
            language=payload.language,
            emphasis_words=payload.emphasis_words,
            topic_tags=payload.topic_tags,
        )
    except Exception as exc:
        log.exception("generate_captions.error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Caption generation failed: {exc}",
        ) from exc

    elapsed = time.perf_counter() - t0
    log.info("generate_captions.done", elapsed_s=round(elapsed, 2))

    caption = result["caption"]
    return CaptionResponse(
        caption=caption,
        emphasis_words=result.get("emphasis_words", []),
        suggested_hashtags=result.get("suggested_hashtags", []),
        caption_length=len(caption),
        hook_word=result.get("hook_word"),
        platform=payload.platform,
    )
