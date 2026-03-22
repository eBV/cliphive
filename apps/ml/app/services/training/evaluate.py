"""
Model evaluation for ViralityScorerModel.

Metrics:
- RMSE: Root Mean Squared Error
- MAE: Mean Absolute Error
- Spearman Correlation: rank-order correlation between predicted and actual
- A/B comparison: compare two model versions on held-out data
"""
from __future__ import annotations

from typing import Any

import numpy as np
import structlog
import torch
import torch.nn as nn

log = structlog.get_logger(__name__)


def evaluate_model(
    model: nn.Module,
    val_loader,
    device: torch.device,
    criterion: nn.Module | None = None,
) -> tuple[float, dict[str, float]]:
    """
    Evaluate model on validation set.

    Returns:
        (val_loss, metrics_dict)
        metrics_dict contains: rmse, mae, spearman, pearson, bias
    """
    from scipy.stats import spearmanr, pearsonr

    model.eval()
    all_preds: list[float] = []
    all_targets: list[float] = []
    total_loss = 0.0
    n_batches = 0

    if criterion is None:
        criterion = nn.MSELoss()

    with torch.no_grad():
        for features, targets in val_loader:
            features = features.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)

            preds = model(features)
            loss = criterion(preds, targets)
            total_loss += loss.item()
            n_batches += 1

            all_preds.extend(preds.squeeze().cpu().tolist())
            all_targets.extend(targets.squeeze().cpu().tolist())

    if not all_preds:
        return float("inf"), {}

    preds_arr = np.array(all_preds, dtype=np.float64)
    targets_arr = np.array(all_targets, dtype=np.float64)

    rmse = float(np.sqrt(np.mean((preds_arr - targets_arr) ** 2)))
    mae = float(np.mean(np.abs(preds_arr - targets_arr)))
    bias = float(np.mean(preds_arr - targets_arr))  # systematic over/under prediction

    # Spearman rank correlation
    if len(preds_arr) > 2:
        spearman_corr, spearman_p = spearmanr(preds_arr, targets_arr)
        pearson_corr, pearson_p = pearsonr(preds_arr, targets_arr)
    else:
        spearman_corr = spearman_p = pearson_corr = pearson_p = 0.0

    avg_loss = total_loss / max(n_batches, 1)

    metrics = {
        "rmse": round(rmse, 6),
        "mae": round(mae, 6),
        "bias": round(bias, 6),
        "spearman": round(float(spearman_corr), 6),
        "spearman_p": round(float(spearman_p), 6),
        "pearson": round(float(pearson_corr), 6),
        "pearson_p": round(float(pearson_p), 6),
        "n_samples": len(preds_arr),
    }

    log.info("evaluate.metrics", **metrics)
    return avg_loss, metrics


def ab_compare_models(
    model_a: nn.Module,
    model_b: nn.Module,
    val_loader,
    device: torch.device,
    model_a_name: str = "model_a",
    model_b_name: str = "model_b",
) -> dict[str, Any]:
    """
    A/B comparison between two model versions on the same validation set.

    Returns comparative metrics to determine which model is better.
    """
    criterion = nn.MSELoss()

    loss_a, metrics_a = evaluate_model(model_a, val_loader, device, criterion)
    loss_b, metrics_b = evaluate_model(model_b, val_loader, device, criterion)

    # Determine winner
    winner = model_a_name if loss_a < loss_b else model_b_name
    improvement = abs(loss_a - loss_b)
    improvement_pct = (improvement / max(loss_a, 1e-8)) * 100

    spearman_winner = (
        model_a_name
        if metrics_a.get("spearman", 0) > metrics_b.get("spearman", 0)
        else model_b_name
    )

    result = {
        "winner": winner,
        "improvement_pct": round(improvement_pct, 2),
        "model_a": {
            "name": model_a_name,
            "val_loss": round(loss_a, 6),
            **metrics_a,
        },
        "model_b": {
            "name": model_b_name,
            "val_loss": round(loss_b, 6),
            **metrics_b,
        },
        "recommendation": (
            f"Use {winner} (lower val loss by {improvement_pct:.1f}%). "
            f"Rank correlation winner: {spearman_winner}"
        ),
    }

    log.info(
        "ab_compare.result",
        winner=winner,
        improvement_pct=improvement_pct,
        loss_a=loss_a,
        loss_b=loss_b,
    )

    return result


def compute_calibration_error(
    preds: np.ndarray, targets: np.ndarray, n_bins: int = 10
) -> dict[str, float]:
    """
    Compute Expected Calibration Error (ECE) for regression.
    Bins predictions and checks if actual values fall within predicted ranges.
    """
    bins = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    n = len(preds)

    for i in range(n_bins):
        lo, hi = bins[i], bins[i + 1]
        mask = (preds >= lo) & (preds < hi)
        if mask.sum() == 0:
            continue
        bin_preds = preds[mask]
        bin_targets = targets[mask]
        bin_rmse = float(np.sqrt(np.mean((bin_preds - bin_targets) ** 2)))
        ece += (mask.sum() / n) * bin_rmse

    return {
        "ece": round(ece, 6),
        "n_bins": n_bins,
        "n_samples": n,
    }
