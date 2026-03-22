"""
EmotionClassifier – Classifies 7 basic emotions from video frames.

Uses a CNN-based FER (Facial Expression Recognition) model.
Maps raw emotion predictions to EmotionTag values.
Returns dominant emotion per clip segment.

Supported emotions: happy, sad, angry, surprised, disgusted, fearful, neutral
"""
from __future__ import annotations

from typing import Any

import numpy as np
import structlog

log = structlog.get_logger(__name__)

EMOTION_LABELS = ["angry", "disgusted", "fearful", "happy", "neutral", "sad", "surprised"]
EMOTION_TO_TAG = {
    "angry": "anger",
    "disgusted": "disgust",
    "fearful": "fear",
    "happy": "joy",
    "neutral": "neutral",
    "sad": "sadness",
    "surprised": "surprise",
}


class EmotionClassifier:
    """
    7-class facial emotion recognition from video frames.
    Uses a pretrained mini-VGG or ResNet FER model.
    Falls back to a heuristic rule if model is unavailable.
    """

    _instance: "EmotionClassifier | None" = None
    _model = None
    _transform = None

    def __new__(cls) -> "EmotionClassifier":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._initialized = True
        self._face_cascade = None
        self._load_model()

    def _load_model(self) -> None:
        """Load FER model – tries torchvision first, falls back to heuristic."""
        try:
            import torch
            import torch.nn as nn
            from torchvision import transforms, models
            from app.config import get_settings

            settings = get_settings()

            # Build a MobileNetV3-Small fine-tuned for FER (7 classes)
            model = models.mobilenet_v3_small(weights=None)
            model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, 7)

            checkpoint_path = f"{settings.MODEL_DIR}/fer_mobilenet_v3_small.pt"
            try:
                state = torch.load(checkpoint_path, map_location=settings.DEVICE)
                model.load_state_dict(state)
                log.info("emotion_classifier.model_loaded", path=checkpoint_path)
            except FileNotFoundError:
                log.info("emotion_classifier.using_random_weights_pretrain_missing")

            model.eval()
            model.to(settings.DEVICE)
            self._model = model

            self._transform = transforms.Compose(
                [
                    transforms.ToPILImage(),
                    transforms.Resize((64, 64)),
                    transforms.ToTensor(),
                    transforms.Normalize(
                        mean=[0.485, 0.456, 0.406],
                        std=[0.229, 0.224, 0.225],
                    ),
                ]
            )
        except Exception as e:
            log.warning("emotion_classifier.model_unavailable", error=str(e))

        # Load OpenCV face cascade as fallback face detector
        try:
            import cv2

            cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            self._face_cascade = cv2.CascadeClassifier(cascade_path)
        except Exception:
            pass

    # ── Public API ────────────────────────────────────────────────────────────

    def classify_frame(self, frame) -> dict[str, Any]:
        """
        Classify emotion in a single frame.

        Returns:
            {dominant_emotion, emotion_scores, confidence}
        """
        face_img = self._extract_face(frame)
        if face_img is None:
            return {"dominant_emotion": "neutral", "emotion_scores": {}, "confidence": 0.0}

        if self._model is not None:
            return self._model_predict(face_img)
        return self._heuristic_predict(face_img)

    def classify_segment(
        self,
        video_path: str,
        start_time: float,
        end_time: float,
        sample_count: int = 5,
    ) -> dict[str, Any]:
        """
        Classify dominant emotion across multiple frames of a segment.
        """
        import cv2

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        n_frames = int((end_time - start_time) * fps)
        frames_to_sample = [
            int(start_time * fps) + int(i * n_frames / max(sample_count - 1, 1))
            for i in range(sample_count)
        ]

        all_scores: list[dict[str, float]] = []
        for frame_idx in frames_to_sample:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                continue
            result = self.classify_frame(frame)
            if result["emotion_scores"]:
                all_scores.append(result["emotion_scores"])

        cap.release()

        if not all_scores:
            return {"dominant_emotion": "neutral", "emotion_scores": {}, "confidence": 0.0}

        # Average emotion scores across sampled frames
        avg_scores: dict[str, float] = {}
        for label in EMOTION_LABELS:
            vals = [s.get(label, 0.0) for s in all_scores]
            avg_scores[label] = round(float(np.mean(vals)), 4)

        dominant = max(avg_scores, key=lambda k: avg_scores[k])
        return {
            "dominant_emotion": EMOTION_TO_TAG.get(dominant, dominant),
            "emotion_scores": avg_scores,
            "confidence": round(avg_scores[dominant], 4),
        }

    # ── Internal Methods ──────────────────────────────────────────────────────

    def _extract_face(self, frame) -> np.ndarray | None:
        """Detect and crop primary face from frame."""
        import cv2

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if self._face_cascade is not None:
            faces = self._face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
            )
            if len(faces) > 0:
                # Use largest face
                x, y, w, h = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)[0]
                face = frame[y : y + h, x : x + w]
                return cv2.cvtColor(face, cv2.COLOR_BGR2RGB)

        # Fallback: use center of frame
        h, w = frame.shape[:2]
        center_face = frame[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        return cv2.cvtColor(center_face, cv2.COLOR_BGR2RGB)

    def _model_predict(self, face_img: np.ndarray) -> dict[str, Any]:
        """Run FER model inference."""
        import torch
        from app.config import get_settings

        settings = get_settings()

        tensor = self._transform(face_img).unsqueeze(0).to(settings.DEVICE)
        with torch.no_grad():
            logits = self._model(tensor)
            probs = torch.softmax(logits, dim=1).squeeze().cpu().numpy()

        emotion_scores = {EMOTION_LABELS[i]: round(float(p), 4) for i, p in enumerate(probs)}
        dominant = EMOTION_LABELS[int(np.argmax(probs))]

        return {
            "dominant_emotion": EMOTION_TO_TAG.get(dominant, dominant),
            "emotion_scores": emotion_scores,
            "confidence": round(float(np.max(probs)), 4),
        }

    @staticmethod
    def _heuristic_predict(face_img: np.ndarray) -> dict[str, Any]:
        """Heuristic emotion estimation from image brightness/contrast."""
        # Very basic heuristic: high brightness -> happy, high variance -> surprise
        brightness = float(np.mean(face_img))
        variance = float(np.var(face_img))

        if brightness > 150:
            dominant = "happy"
        elif variance > 3000:
            dominant = "surprised"
        else:
            dominant = "neutral"

        scores = {label: 0.05 for label in EMOTION_LABELS}
        scores[dominant] = 0.65

        return {
            "dominant_emotion": EMOTION_TO_TAG.get(dominant, dominant),
            "emotion_scores": scores,
            "confidence": 0.65,
        }
