"""
EmbeddingUtils – CLIP embeddings and multimodal feature vector construction.

Features:
- CLIP (ViT-B/32) image embeddings from video frames
- Text embeddings from transcript snippets
- Feature vector concatenation and normalization
- Modality fusion into 512-dim representations

Also exports legacy module-level functions for backward compatibility.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import structlog

log = structlog.get_logger(__name__)

FEATURE_DIM = 512  # Total output feature vector dimension
CLIP_EMB_DIM = 512  # CLIP ViT-B/32 output dimension

# ─── Lazy CLIP singleton ──────────────────────────────────────────────────────

_clip_model = None
_clip_preprocess = None
_clip_device = None


def get_clip_model(device: str = "cpu"):
    """Lazy-load CLIP model (singleton)."""
    global _clip_model, _clip_preprocess, _clip_device
    if _clip_model is None:
        try:
            import clip  # type: ignore

            _clip_device = device
            _clip_model, _clip_preprocess = clip.load("ViT-B/32", device=device)
            _clip_model.eval()
            log.info("clip_model_loaded", device=device)
        except ImportError:
            log.warning("clip_not_available_using_zero_embeddings")
        except Exception as e:
            log.warning("clip_load_error", error=str(e))
    return _clip_model, _clip_preprocess, _clip_device


# ─── Class-based API ─────────────────────────────────────────────────────────


class EmbeddingUtils:
    """Utility class for computing and combining multimodal embeddings."""

    _instance: "EmbeddingUtils | None" = None

    def __new__(cls) -> "EmbeddingUtils":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._initialized = True
        try:
            from app.config import get_settings
            self._device = get_settings().DEVICE
        except Exception:
            self._device = "cpu"
        # Pre-load CLIP
        get_clip_model(self._device)

    def compute_frame_embedding(self, frame) -> np.ndarray:
        """
        Compute CLIP embedding for a single BGR video frame.
        Returns numpy array of shape (512,), L2-normalized.
        """
        return embed_frame(frame, self._device)

    def compute_text_embedding(self, text: str) -> np.ndarray:
        """
        Compute CLIP embedding for a text snippet.
        Returns numpy array of shape (512,), L2-normalized.
        """
        return embed_text(text, self._device)

    def compute_clip_similarity(self, frame, text: str) -> float:
        """
        Compute cosine similarity between a frame and text description.
        Returns float in [-1, 1], higher = more similar.
        """
        frame_emb = self.compute_frame_embedding(frame)
        text_emb = self.compute_text_embedding(text)
        return float(np.dot(frame_emb, text_emb))

    def build_feature_vector(
        self,
        frames: list,
        transcript: str,
        audio_features: dict[str, Any] | None = None,
        temporal_features: dict[str, Any] | None = None,
    ) -> np.ndarray:
        """
        Build a 512-dim feature vector from multimodal inputs.

        Composition:
        - 128 dims: Visual (mean CLIP embedding of sampled frames, projected)
        - 128 dims: Text (CLIP text embedding, projected)
        - 128 dims: Audio features (aggregated from AudioAnalyzer)
        - 128 dims: Temporal + metadata features

        Returns numpy array of shape (512,).
        """
        visual_feats = self._build_visual_features(frames)
        text_feats = self._build_text_features(transcript)
        audio_feats = self._build_audio_features(audio_features or {})
        temporal_feats = self._build_temporal_features(temporal_features or {})

        feature_vec = np.concatenate([visual_feats, text_feats, audio_feats, temporal_feats])
        assert len(feature_vec) == FEATURE_DIM
        return feature_vec.astype(np.float32)

    def concatenate_features(self, feature_vectors: list[np.ndarray]) -> np.ndarray:
        """
        Concatenate multiple feature vectors and project to FEATURE_DIM.
        Returns numpy array of shape (FEATURE_DIM,).
        """
        if not feature_vectors:
            return np.zeros(FEATURE_DIM, dtype=np.float32)

        combined = np.concatenate(feature_vectors)

        if len(combined) > FEATURE_DIM:
            combined = _project_to_dim(combined, FEATURE_DIM)
        elif len(combined) < FEATURE_DIM:
            combined = np.pad(combined, (0, FEATURE_DIM - len(combined)))

        norm = np.linalg.norm(combined)
        if norm > 1e-8:
            combined = combined / norm

        return combined.astype(np.float32)

    def _build_visual_features(self, frames: list) -> np.ndarray:
        if not frames:
            return np.zeros(128, dtype=np.float32)
        sample_frames = frames[:: max(1, len(frames) // 5)][:5]
        embeddings = [self.compute_frame_embedding(f) for f in sample_frames]
        mean_emb = np.mean(embeddings, axis=0)  # (512,)
        # Project 512 → 128
        return mean_emb.reshape(4, 128).mean(axis=0).astype(np.float32)

    def _build_text_features(self, transcript: str) -> np.ndarray:
        if not transcript.strip():
            return np.zeros(128, dtype=np.float32)
        emb = self.compute_text_embedding(transcript[:200])  # (512,)
        return emb.reshape(4, 128).mean(axis=0).astype(np.float32)

    @staticmethod
    def _build_audio_features(audio_features: dict[str, Any]) -> np.ndarray:
        feats = np.zeros(128, dtype=np.float32)
        if not audio_features:
            return feats

        rms = np.array(audio_features.get("rms_energy", [0.0]), dtype=np.float32)
        if len(rms) > 0:
            rms_stats = np.percentile(rms, np.linspace(0, 100, 28)).astype(np.float32)
            rms_moments = np.array([rms.mean(), rms.std(), rms.min(), rms.max()], dtype=np.float32)
            feats[:32] = np.concatenate([rms_stats, rms_moments])

        spec = np.array(audio_features.get("spectral_centroid", [0.0]), dtype=np.float32)
        if len(spec) > 0:
            spec_max = max(float(spec.max()), 1.0)
            spec_norm = spec / spec_max
            spec_stats = np.percentile(spec_norm, np.linspace(0, 100, 28)).astype(np.float32)
            spec_moments = np.array([spec_norm.mean(), spec_norm.std(), spec_norm.min(), spec_norm.max()], dtype=np.float32)
            feats[32:64] = np.concatenate([spec_stats, spec_moments])

        onset = np.array(audio_features.get("onset_strength", [0.0]), dtype=np.float32)
        if len(onset) > 0:
            onset_max = max(float(onset.max()), 1.0)
            onset_norm = onset / onset_max
            onset_stats = np.percentile(onset_norm, np.linspace(0, 100, 28)).astype(np.float32)
            onset_moments = np.array([onset_norm.mean(), onset_norm.std(), onset_norm.min(), onset_norm.max()], dtype=np.float32)
            feats[64:96] = np.concatenate([onset_stats, onset_moments])

        feats[96] = min(float(audio_features.get("tempo", 120.0)) / 200.0, 1.0)
        feats[97] = float(audio_features.get("silence_ratio", 0.0))
        feats[98] = float(audio_features.get("beat_regularity", 0.5))
        return feats

    @staticmethod
    def _build_temporal_features(temporal: dict[str, Any]) -> np.ndarray:
        feats = np.zeros(128, dtype=np.float32)
        feats[0] = float(temporal.get("relative_start", 0.0))
        feats[1] = float(temporal.get("relative_end", 1.0))
        feats[2] = float(temporal.get("relative_duration", 1.0))
        feats[3] = min(float(temporal.get("abs_duration", 30.0)) / 60.0, 1.0)
        feats[4] = 1.0 if temporal.get("is_intro", False) else 0.0
        feats[5] = 1.0 if temporal.get("is_outro", False) else 0.0
        feats[6] = float(temporal.get("face_count_norm", 0.0))
        feats[7] = float(temporal.get("motion_magnitude", 0.0))
        feats[8] = float(temporal.get("color_vibrancy", 0.0))
        return feats


# ─── Helper functions ─────────────────────────────────────────────────────────


def _project_to_dim(vector: np.ndarray, target_dim: int) -> np.ndarray:
    """Simple linear projection via block mean-pooling."""
    n = len(vector)
    if n <= target_dim:
        return np.pad(vector, (0, target_dim - n))
    block_size = n // target_dim
    remainder = n - block_size * target_dim
    trimmed = vector[:n - remainder]
    return trimmed.reshape(target_dim, block_size).mean(axis=1)


# ─── Legacy module-level functions ───────────────────────────────────────────


def embed_frame(frame_bgr: np.ndarray, device: str = "cpu") -> np.ndarray:
    """
    Compute a 512-dim CLIP embedding for a single BGR frame.
    Falls back to zero embedding if CLIP is not available.
    """
    import cv2
    from PIL import Image
    import torch

    model, preprocess, dev = get_clip_model(device)

    if model is None:
        return np.zeros(512, dtype=np.float32)

    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(frame_rgb)
    tensor = preprocess(pil_image).unsqueeze(0).to(dev)

    with torch.no_grad():
        embedding = model.encode_image(tensor)
        embedding = embedding / embedding.norm(dim=-1, keepdim=True)

    return embedding.cpu().numpy()[0].astype(np.float32)


def embed_text(text: str, device: str = "cpu") -> np.ndarray:
    """Compute a 512-dim CLIP text embedding."""
    import torch

    model, _, dev = get_clip_model(device)

    if model is None:
        return np.zeros(512, dtype=np.float32)

    try:
        import clip

        tokens = clip.tokenize([text[:77]], truncate=True).to(dev)
        with torch.no_grad():
            embedding = model.encode_text(tokens)
            embedding = embedding / embedding.norm(dim=-1, keepdim=True)
        return embedding.cpu().numpy()[0].astype(np.float32)
    except Exception:
        return np.zeros(512, dtype=np.float32)


def build_feature_vector(
    audio_features: np.ndarray,
    visual_features: np.ndarray,
    text_features: np.ndarray,
    target_dim: int = 512,
) -> np.ndarray:
    """
    Concatenate and project multi-modal feature vectors to a fixed target_dim.
    Uses block-mean projection for dimensionality reduction.
    """
    combined = np.concatenate([audio_features, visual_features, text_features])

    if len(combined) == target_dim:
        return combined.astype(np.float32)

    if len(combined) < target_dim:
        padded = np.zeros(target_dim, dtype=np.float32)
        padded[: len(combined)] = combined
        return padded

    return _project_to_dim(combined, target_dim).astype(np.float32)
