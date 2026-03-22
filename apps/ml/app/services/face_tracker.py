"""
FaceTracker – MediaPipe Face Mesh integration.

Tracks face positions across video frames and outputs time-series crop
coordinates for the face-zoom Remotion composition.
Returns: [{time, x, y, width, height, emotion}]
"""
from __future__ import annotations

from typing import Any

import numpy as np
import structlog

log = structlog.get_logger(__name__)


class FaceTracker:
    """Face tracking service using MediaPipe Face Detection."""

    _instance: "FaceTracker | None" = None

    def __new__(cls) -> "FaceTracker":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._initialized = True
        self._face_detection = None
        self._face_mesh = None
        self._load_models()

    def _load_models(self) -> None:
        """Initialize MediaPipe face detection and mesh."""
        try:
            import mediapipe as mp

            self._mp = mp
            self._face_detection = mp.solutions.face_detection.FaceDetection(
                model_selection=1,
                min_detection_confidence=0.5,
            )
            self._face_mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=4,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            log.info("face_tracker.models_loaded")
        except Exception as e:
            log.warning("face_tracker.models_unavailable", error=str(e))

    # ── Public API ────────────────────────────────────────────────────────────

    def track_faces_in_segment(
        self,
        video_path: str,
        start_time: float,
        end_time: float,
        sample_fps: float = 4.0,
    ) -> list[dict[str, Any]]:
        """
        Track faces through a video segment.

        Args:
            video_path: Path to local video file
            start_time: Segment start in seconds
            end_time: Segment end in seconds
            sample_fps: Frames per second to sample for tracking

        Returns:
            List of {time, x, y, width, height, emotion} dicts
        """
        if self._face_detection is None:
            return self._fallback_track(start_time, end_time, sample_fps)

        import cv2

        cap = cv2.VideoCapture(video_path)
        video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        width = cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280
        height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720

        track_points = []
        frame_interval = max(1, int(video_fps / sample_fps))

        start_frame = int(start_time * video_fps)
        end_frame = int(end_time * video_fps)
        current_frame = start_frame

        while current_frame <= end_frame:
            cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame)
            ret, frame = cap.read()
            if not ret:
                break

            timestamp = current_frame / video_fps
            face_data = self._process_frame(frame, timestamp, width, height)
            if face_data:
                track_points.append(face_data)

            current_frame += frame_interval

        cap.release()

        # Apply temporal smoothing
        if len(track_points) >= 3:
            track_points = self._smooth_track(track_points)

        return track_points

    # ── Internal Processing ───────────────────────────────────────────────────

    def _process_frame(
        self,
        frame,
        timestamp: float,
        video_width: float,
        video_height: float,
    ) -> dict[str, Any] | None:
        """Detect and locate primary face in a single frame."""
        import cv2

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self._face_detection.process(rgb)

        if not results.detections:
            return None

        # Use the most prominent (highest confidence) face
        best_detection = max(
            results.detections, key=lambda d: d.score[0] if d.score else 0.0
        )

        bbox = best_detection.location_data.relative_bounding_box
        confidence = best_detection.score[0] if best_detection.score else 0.0

        # Convert to absolute pixel coordinates, then normalize to [0,1]
        x = max(bbox.xmin, 0.0)
        y = max(bbox.ymin, 0.0)
        w = min(bbox.width, 1.0 - x)
        h = min(bbox.height, 1.0 - y)

        # Add padding around face for better framing (20%)
        pad_x = w * 0.20
        pad_y = h * 0.20
        x_padded = max(0.0, x - pad_x)
        y_padded = max(0.0, y - pad_y)
        w_padded = min(1.0 - x_padded, w + 2 * pad_x)
        h_padded = min(1.0 - y_padded, h + 2 * pad_y)

        return {
            "time": round(timestamp, 3),
            "x": round(x_padded, 4),
            "y": round(y_padded, 4),
            "width": round(w_padded, 4),
            "height": round(h_padded, 4),
            "emotion": None,  # populated by EmotionClassifier
            "confidence": round(float(confidence), 3),
        }

    @staticmethod
    def _smooth_track(
        track_points: list[dict[str, Any]],
        window: int = 3,
    ) -> list[dict[str, Any]]:
        """Apply moving average to smooth jittery face tracking."""
        fields = ["x", "y", "width", "height"]
        n = len(track_points)
        smoothed = []

        for i, pt in enumerate(track_points):
            lo = max(0, i - window // 2)
            hi = min(n, i + window // 2 + 1)
            neighbors = track_points[lo:hi]
            avg_pt = pt.copy()
            for f in fields:
                vals = [p[f] for p in neighbors if f in p]
                avg_pt[f] = round(float(np.mean(vals)), 4) if vals else pt.get(f, 0.0)
            smoothed.append(avg_pt)

        return smoothed

    @staticmethod
    def _fallback_track(
        start_time: float,
        end_time: float,
        sample_fps: float,
    ) -> list[dict[str, Any]]:
        """Return center-frame track when MediaPipe is unavailable."""
        n_points = max(1, int((end_time - start_time) * sample_fps))
        times = np.linspace(start_time, end_time, n_points)
        return [
            {
                "time": round(float(t), 3),
                "x": 0.25,
                "y": 0.1,
                "width": 0.5,
                "height": 0.8,
                "emotion": None,
                "confidence": 0.0,
            }
            for t in times
        ]
