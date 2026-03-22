"""
POST /detect-scenes
Runs PySceneDetect on a video and returns a SceneGraph with rich
per-scene feature annotations.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ─── Request / Response Schemas ───────────────────────────────────────────────


class DetectScenesRequest(BaseModel):
    s3_key: str = Field(..., description="S3 key of the source video")
    threshold: float | None = Field(default=None, description="Override ContentDetector threshold")

    model_config = {"json_schema_extra": {"example": {"s3_key": "uploads/video123.mp4"}}}


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float
    confidence: float


class DetectedObject(BaseModel):
    label: str
    confidence: float
    bbox: BoundingBox


class SceneFeatures(BaseModel):
    face_count: int
    dominant_emotion: str | None
    emotion_scores: dict[str, float] = {}
    motion_magnitude: float
    color_vibrancy: float
    has_text: bool
    detected_objects: list[DetectedObject] = []
    attention_score: float
    average_brightness: float
    speaker_present: bool


class Scene(BaseModel):
    scene_id: int
    start_time: float
    end_time: float
    duration: float
    start_frame: int
    end_frame: int
    thumbnail_s3_key: str | None = None
    features: SceneFeatures


class SceneGraph(BaseModel):
    video_duration: float
    fps: float
    total_frames: int
    scene_count: int
    scenes: list[Scene]
    processing_time_s: float


# ─── Route ────────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=SceneGraph,
    summary="Detect scenes and extract per-scene features",
    status_code=status.HTTP_200_OK,
)
async def detect_scenes(payload: DetectScenesRequest) -> SceneGraph:
    """
    Download video from S3, run PySceneDetect ContentDetector + ThresholdDetector,
    and annotate each scene with face count, emotion, motion, YOLO objects, etc.
    """
    import time
    from app.main import get_model

    t0 = time.perf_counter()
    scene_svc = get_model("scene")

    log.info("detect_scenes.start", s3_key=payload.s3_key)

    try:
        result = await scene_svc.detect_scenes(
            s3_key=payload.s3_key,
            threshold=payload.threshold,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("detect_scenes.error", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Scene detection failed: {exc}",
        ) from exc

    elapsed = time.perf_counter() - t0
    log.info(
        "detect_scenes.done",
        scene_count=result["scene_count"],
        elapsed_s=round(elapsed, 2),
    )

    scenes = []
    for s in result["scenes"]:
        feats = s["features"]
        scenes.append(
            Scene(
                scene_id=s["scene_id"],
                start_time=s["start_time"],
                end_time=s["end_time"],
                duration=s["duration"],
                start_frame=s["start_frame"],
                end_frame=s["end_frame"],
                thumbnail_s3_key=s.get("thumbnail_s3_key"),
                features=SceneFeatures(
                    face_count=feats["face_count"],
                    dominant_emotion=feats.get("dominant_emotion"),
                    emotion_scores=feats.get("emotion_scores", {}),
                    motion_magnitude=feats["motion_magnitude"],
                    color_vibrancy=feats["color_vibrancy"],
                    has_text=feats["has_text"],
                    detected_objects=[
                        DetectedObject(
                            label=o["label"],
                            confidence=o["confidence"],
                            bbox=BoundingBox(**o["bbox"]),
                        )
                        for o in feats.get("detected_objects", [])
                    ],
                    attention_score=feats["attention_score"],
                    average_brightness=feats["average_brightness"],
                    speaker_present=feats["speaker_present"],
                ),
            )
        )

    return SceneGraph(
        video_duration=result["video_duration"],
        fps=result["fps"],
        total_frames=result["total_frames"],
        scene_count=result["scene_count"],
        scenes=scenes,
        processing_time_s=round(elapsed, 2),
    )
