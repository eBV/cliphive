"""
POST /transcribe
Accepts an S3 key or direct media URL, runs Whisper large-v3,
and returns a full transcript with word-level timestamps.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ─── Request / Response schemas ───────────────────────────────────────────────


class TranscribeRequest(BaseModel):
    s3_key: str | None = Field(default=None, description="S3 object key for media file")
    media_url: str | None = Field(default=None, description="Direct HTTPS URL to media file")
    language: str | None = Field(default=None, description="ISO-639-1 language code hint (e.g. 'en')")

    model_config = {"json_schema_extra": {"example": {"s3_key": "uploads/abc123.mp4", "language": "en"}}}


class WordTimestamp(BaseModel):
    word: str
    start: float
    end: float
    probability: float = 1.0


class TranscriptSegment(BaseModel):
    id: int
    start: float
    end: float
    text: str
    confidence: float
    words: list[WordTimestamp] = []


class TranscribeResponse(BaseModel):
    transcript: str
    segments: list[TranscriptSegment]
    duration: float
    language: str
    language_probability: float
    processing_time_s: float


# ─── Route ────────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=TranscribeResponse,
    summary="Transcribe media with Whisper large-v3",
    status_code=status.HTTP_200_OK,
)
async def transcribe(payload: TranscribeRequest) -> TranscribeResponse:
    """
    Download media from S3 (or URL), run OpenAI Whisper large-v3,
    and return full word-level transcript.
    """
    if not payload.s3_key and not payload.media_url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Either s3_key or media_url must be provided",
        )

    import time
    from app.main import get_model

    t0 = time.perf_counter()
    whisper_svc = get_model("whisper")

    log.info("transcribe.start", s3_key=payload.s3_key, media_url=payload.media_url)

    try:
        result = await whisper_svc.transcribe(
            s3_key=payload.s3_key,
            media_url=payload.media_url,
            language=payload.language,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("transcribe.error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Transcription failed: {exc}",
        ) from exc

    elapsed = time.perf_counter() - t0
    log.info("transcribe.done", duration=result["duration"], elapsed_s=round(elapsed, 2))

    return TranscribeResponse(
        transcript=result["transcript"],
        segments=[
            TranscriptSegment(
                id=i,
                start=seg["start"],
                end=seg["end"],
                text=seg["text"],
                confidence=seg.get("confidence", 1.0),
                words=[
                    WordTimestamp(
                        word=w["word"],
                        start=w["start"],
                        end=w["end"],
                        probability=w.get("probability", 1.0),
                    )
                    for w in seg.get("words", [])
                ],
            )
            for i, seg in enumerate(result["segments"])
        ],
        duration=result["duration"],
        language=result["language"],
        language_probability=result.get("language_probability", 1.0),
        processing_time_s=round(elapsed, 2),
    )
