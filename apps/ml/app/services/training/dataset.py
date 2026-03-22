"""
ViralityDataset – PyTorch Dataset for virality model training.

Loads feedback loop data containing:
- 512-dim feature vectors
- Actual view counts + engagement rates
- Normalizes features and targets
- Handles train/val split

Target computation:
    virality_score = log(views + 1) / max_log_views * 0.7
                   + engagement_rate * 0.3
    clamped to [0, 1]
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader


class ViralityDataset(Dataset):
    """
    PyTorch Dataset for virality prediction training.

    Each sample: (feature_vector: Tensor[512], virality_score: Tensor[1])
    """

    def __init__(
        self,
        samples: list[dict[str, Any]],
        feature_dim: int = 512,
        normalize: bool = True,
        split: str = "train",
        val_ratio: float = 0.15,
        seed: int = 42,
    ) -> None:
        """
        Args:
            samples: List of dicts with keys:
                - feature_vector: list[float] (512-dim)
                - actual_views: int
                - actual_engagement: float [0, 1]
                - predicted_score: float (optional, used for evaluation)
            feature_dim: Expected feature dimension
            normalize: Whether to z-score normalize features
            split: 'train' or 'val'
            val_ratio: Fraction of data for validation
            seed: Random seed for reproducible splits
        """
        self.feature_dim = feature_dim
        self.split = split

        # Filter valid samples
        valid_samples = [
            s for s in samples
            if "feature_vector" in s
            and len(s["feature_vector"]) == feature_dim
            and "actual_views" in s
            and "actual_engagement" in s
        ]

        if not valid_samples:
            raise ValueError(f"No valid samples with {feature_dim}-dim feature vectors found")

        # Reproducible split
        rng = np.random.default_rng(seed)
        indices = rng.permutation(len(valid_samples))
        val_count = max(1, int(len(valid_samples) * val_ratio))

        if split == "val":
            split_indices = indices[:val_count]
        else:
            split_indices = indices[val_count:]

        split_samples = [valid_samples[i] for i in split_indices]

        # Build tensors
        features = np.array([s["feature_vector"] for s in split_samples], dtype=np.float32)
        targets = np.array(
            [self._compute_virality_score(s) for s in split_samples],
            dtype=np.float32,
        )

        # Normalize features
        if normalize:
            self._feature_mean = features.mean(axis=0)
            self._feature_std = features.std(axis=0) + 1e-8
            features = (features - self._feature_mean) / self._feature_std
        else:
            self._feature_mean = np.zeros(feature_dim, dtype=np.float32)
            self._feature_std = np.ones(feature_dim, dtype=np.float32)

        # Clip features to [-5, 5] for numerical stability
        features = np.clip(features, -5.0, 5.0)

        self.features = torch.from_numpy(features)
        self.targets = torch.from_numpy(targets).unsqueeze(1)  # [N, 1]
        self.metadata = [
            {
                "predicted_score": s.get("predicted_score", 0.0),
                "actual_views": s.get("actual_views", 0),
                "actual_engagement": s.get("actual_engagement", 0.0),
                "platform": s.get("platform"),
            }
            for s in split_samples
        ]

    def __len__(self) -> int:
        return len(self.features)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        return self.features[idx], self.targets[idx]

    def get_metadata(self, idx: int) -> dict[str, Any]:
        """Return metadata for a sample (for evaluation logging)."""
        return self.metadata[idx]

    @staticmethod
    def _compute_virality_score(sample: dict[str, Any]) -> float:
        """
        Compute ground-truth virality score from views + engagement.

        Formula:
            views_score = log1p(actual_views) / log1p(10_000_000)  # normalize to 10M max
            engagement_score = min(actual_engagement / 0.20, 1.0)   # 20% engagement = max
            virality = 0.70 * views_score + 0.30 * engagement_score
        """
        views = max(0, sample.get("actual_views", 0))
        engagement = max(0.0, min(1.0, sample.get("actual_engagement", 0.0)))

        log_max_views = math.log1p(10_000_000)
        views_score = math.log1p(views) / log_max_views
        engagement_score = min(engagement / 0.20, 1.0)

        virality = 0.70 * views_score + 0.30 * engagement_score
        return float(max(0.0, min(1.0, virality)))

    def save_normalization_stats(self, path: str) -> None:
        """Save feature normalization stats for inference."""
        stats = {
            "mean": self._feature_mean.tolist(),
            "std": self._feature_std.tolist(),
        }
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(stats, f)

    @classmethod
    def load_from_jsonl(cls, jsonl_path: str, **kwargs) -> "ViralityDataset":
        """Load samples from a JSONL file."""
        samples = []
        with open(jsonl_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    samples.append(json.loads(line))
        return cls(samples, **kwargs)

    @classmethod
    def create_dataloaders(
        cls,
        samples: list[dict[str, Any]],
        batch_size: int = 64,
        num_workers: int = 2,
        feature_dim: int = 512,
    ) -> tuple["DataLoader", "DataLoader"]:
        """Create train and val DataLoaders."""
        train_ds = cls(samples, feature_dim=feature_dim, split="train")
        val_ds = cls(
            samples,
            feature_dim=feature_dim,
            split="val",
            normalize=True,
        )
        # Share normalization stats from train to val
        val_ds._feature_mean = train_ds._feature_mean
        val_ds._feature_std = train_ds._feature_std
        # Re-normalize val features with train stats
        val_feats = val_ds.features.numpy()
        val_feats = (val_feats - train_ds._feature_mean) / train_ds._feature_std
        val_ds.features = torch.from_numpy(np.clip(val_feats, -5.0, 5.0).astype(np.float32))

        train_loader = DataLoader(
            train_ds,
            batch_size=batch_size,
            shuffle=True,
            num_workers=num_workers,
            pin_memory=True,
            drop_last=len(train_ds) > batch_size,
        )
        val_loader = DataLoader(
            val_ds,
            batch_size=batch_size * 2,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=True,
        )
        return train_loader, val_loader
