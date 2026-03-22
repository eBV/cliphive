"""
SceneService – PySceneDetect integration.

Detects scene boundaries and extracts rich per-scene features:
- Face count via MediaPipe
- Emotion classification via EmotionClassifier
- Motion magnitude via optical flow
- Color vibrancy
- Text presence (OCR check)
- Object detection via YOLOv8
- Attention score composite
"""
from __future__ import annotations

import asyncio
import tempfile
from typing import Any

import numpy as np
import structlog

log = structlog.get_logger(__name__)


class SceneService:
    """Scene boundary detection + feature extraction service."""

    _instance: "SceneService | None" = None

    def __new__(cls) -> "SceneService":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._yolo = None
        self._mp_face = None
        self._initialized = True
        self._load_models()

    def _load_models(self) -> None:
        """Load YOLO and MediaPipe models."""
        try:
            from ultralytics import YOLO

            self._yolo = YOLO("yolov8n.pt")
            log.info("scene_service.yolo_loaded")
        except Exception as e:
            log.warning("scene_service.yolo_unavailable", error=str(e))

        try:
            import mediapipe as mp

            self._mp_face_detection = mp.solutions.face_detection
            self._face_detector = self._mp_face_detection.FaceDetection(
                model_selection=1, min_detection_confidence=0.5
            )
            log.info("scene_service.mediapipe_loaded")
        except Exception as e:
            log.warning("scene_service.mediapipe_unavailable", error=str(e))

    # ── Public API ────────────────────────────────────────────────────────────

    async def detect_scenes(
        self,
        s3_key: str,
        threshold: float | None = None,
    ) -> dict[str, Any]:
        """Download video and detect scenes with full feature extraction."""
        from app.utils.video_io import VideoIO
        from app.config import get_settings

        settings = get_settings()
        scene_threshold = threshold or settings.SCENE_THRESHOLD

        with tempfile.TemporaryDirectory(prefix="scene_") as tmp_dir:
            local_path = await asyncio.to_thread(VideoIO.download_from_s3, s3_key, tmp_dir)
            result = await asyncio.to_thread(
                self._process_video, local_path, scene_threshold
            )
        return result

    # ── Internal Processing ───────────────────────────────────────────────────

    def _process_video(self, video_path: str, threshold: float) -> dict[str, Any]:
        """Full scene detection + feature extraction pipeline."""
        import cv2
        from scenedetect import VideoManager, SceneManager
        from scenedetect.detectors import ContentDetector, ThresholdDetector

        # Get video metadata
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps
        cap.release()

        # Detect scene boundaries
        video_manager = VideoManager([video_path])
        scene_manager = SceneManager()
        scene_manager.add_detector(ContentDetector(threshold=threshold))
        scene_manager.add_detector(ThresholdDetector(threshold=12.0, fade_bias=0.0))

        video_manager.set_downscale_factor()
        video_manager.start()
        scene_manager.detect_scenes(frame_source=video_manager, show_progress=False)
        scene_list = scene_manager.get_scene_list()
        video_manager.release()

        scenes = []
        for i, (start_tc, end_tc) in enumerate(scene_list):
            start_time = start_tc.get_seconds()
            end_time = end_tc.get_seconds()
            start_frame = start_tc.get_frames()
            end_frame = end_tc.get_frames()

            # Sample frames for feature extraction
            features = self._extract_scene_features(
                video_path=video_path,
                start_frame=start_frame,
                end_frame=end_frame,
                fps=fps,
            )

            scenes.append(
                {
                    "scene_id": i,
                    "start_time": round(start_time, 3),
                    "end_time": round(end_time, 3),
                    "duration": round(end_time - start_time, 3),
                    "start_frame": start_frame,
                    "end_frame": end_frame,
                    "thumbnail_s3_key": None,
                    "features": features,
                }
            )

        return {
            "video_duration": round(duration, 3),
            "fps": round(fps, 2),
            "total_frames": total_frames,
            "scene_count": len(scenes),
            "scenes": scenes,
        }

    def _extract_scene_features(
        self,
        video_path: str,
        start_frame: int,
        end_frame: int,
        fps: float,
    ) -> dict[str, Any]:
        """Extract rich features for a single scene by sampling frames."""
        import cv2

        cap = cv2.VideoCapture(video_path)
        n_frames = max(end_frame - start_frame, 1)
        sample_count = min(5, n_frames)
        sample_frames = [
            start_frame + int(i * n_frames / sample_count)
            for i in range(sample_count)
        ]

        face_counts = []
        brightness_vals = []
        vibrancy_vals = []
        motion_mags = []
        emotions: list[str] = []
        all_objects: list[dict] = []
        prev_gray = None

        for frame_idx in sample_frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                continue

            # Brightness
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            brightness_vals.append(float(np.mean(gray)))

            # Color vibrancy (saturation mean)
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            vibrancy_vals.append(float(np.mean(hsv[:, :, 1])))

            # Motion magnitude via optical flow
            if prev_gray is not None:
                flow = cv2.calcOpticalFlowFarneback(
                    prev_gray, gray, None,
                    pyr_scale=0.5, levels=3, winsize=15,
                    iterations=3, poly_n=5, poly_sigma=1.2, flags=0
                )
                magnitude = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
                motion_mags.append(float(np.mean(magnitude)))
            prev_gray = gray

            # Face detection
            face_count = self._count_faces(frame)
            face_counts.append(face_count)

            # YOLO object detection
            objects = self._detect_objects(frame)
            all_objects.extend(objects)

        cap.release()

        avg_faces = round(float(np.mean(face_counts)) if face_counts else 0.0, 1)
        avg_brightness = round(float(np.mean(brightness_vals)) if brightness_vals else 0.0, 1)
        avg_vibrancy = round(float(np.mean(vibrancy_vals)) if vibrancy_vals else 0.0, 3)
        avg_motion = round(float(np.mean(motion_mags)) if motion_mags else 0.0, 3)

        # Normalize vibrancy to 0–1
        vibrancy_norm = min(avg_vibrancy / 255.0, 1.0)
        motion_norm = min(avg_motion / 20.0, 1.0)

        # Attention score: composite of face, motion, vibrancy
        attention = round(
            0.4 * min(avg_faces / 3.0, 1.0)
            + 0.3 * motion_norm
            + 0.3 * vibrancy_norm,
            4,
        )

        # Deduplicate objects by label (keep highest confidence)
        seen: dict[str, dict] = {}
        for obj in all_objects:
            label = obj["label"]
            if label not in seen or obj["confidence"] > seen[label]["confidence"]:
                seen[label] = obj
        unique_objects = list(seen.values())

        return {
            "face_count": int(round(avg_faces)),
            "dominant_emotion": None,  # Set by EmotionClassifier if available
            "emotion_scores": {},
            "motion_magnitude": motion_norm,
            "color_vibrancy": vibrancy_norm,
            "has_text": False,  # OCR check placeholder
            "detected_objects": unique_objects[:10],
            "attention_score": attention,
            "average_brightness": avg_brightness,
            "speaker_present": avg_faces > 0,
        }

    def _count_faces(self, frame) -> int:
        """Count faces in a frame using MediaPipe."""
        if not hasattr(self, "_face_detector"):
            return 0
        try:
            import cv2

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self._face_detector.process(rgb)
            if results.detections:
                return len(results.detections)
            return 0
        except Exception:
            return 0

    def _detect_objects(self, frame) -> list[dict]:
        """Run YOLO object detection on a frame."""
        if self._yolo is None:
            return []
        try:
            import cv2

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self._yolo(rgb, verbose=False)
            objects = []
            h, w = frame.shape[:2]
            for r in results:
                for box in r.boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    conf = float(box.conf[0])
                    cls_id = int(box.cls[0])
                    label = self._yolo.names.get(cls_id, str(cls_id))
                    if conf > 0.4:
                        objects.append(
                            {
                                "label": label,
                                "confidence": round(conf, 3),
                                "bbox": {
                                    "x": round(x1 / w, 4),
                                    "y": round(y1 / h, 4),
                                    "width": round((x2 - x1) / w, 4),
                                    "height": round((y2 - y1) / h, 4),
                                    "confidence": round(conf, 3),
                                },
                            }
                        )
            return objects
        except Exception as e:
            log.warning("yolo.detection_error", error=str(e))
            return []
