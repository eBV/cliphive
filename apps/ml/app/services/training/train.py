"""
Training loop for ViralityScorerModel.

Features:
- AdamW optimizer with weight decay
- Cosine annealing LR schedule with warm restarts
- Early stopping (patience=5)
- Model checkpoint saving (best val loss)
- Optional W&B logging
- Gradient clipping for stability
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import structlog
import torch
import torch.nn as nn
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingWarmRestarts

log = structlog.get_logger(__name__)

FEATURE_DIM = 512


def run_training(
    feedback_data: list[dict[str, Any]],
    job_id: str,
    epochs: int = 10,
    learning_rate: float = 1e-4,
    batch_size: int = 64,
    model_version: str | None = None,
    weight_decay: float = 1e-2,
    early_stopping_patience: int = 5,
) -> dict[str, Any]:
    """
    Main training entry point called from the retrain endpoint.

    Returns:
        metrics dict: {best_val_loss, final_train_loss, epochs_run, checkpoint_path}
    """
    from app.config import get_settings
    from app.services.training.model import ViralityScorerModel
    from app.services.training.dataset import ViralityDataset
    from app.services.training.evaluate import evaluate_model

    settings = get_settings()
    device = torch.device(settings.DEVICE)

    log.info(
        "training.start",
        job_id=job_id,
        n_samples=len(feedback_data),
        epochs=epochs,
        lr=learning_rate,
        device=str(device),
    )

    # ── Data ─────────────────────────────────────────────────────────────────
    train_loader, val_loader = ViralityDataset.create_dataloaders(
        samples=feedback_data,
        batch_size=batch_size,
        num_workers=0,  # Single-threaded for background tasks
        feature_dim=FEATURE_DIM,
    )

    log.info(
        "training.data_loaded",
        train_batches=len(train_loader),
        val_batches=len(val_loader),
    )

    # ── Model ─────────────────────────────────────────────────────────────────
    model = ViralityScorerModel(input_dim=FEATURE_DIM).to(device)

    # Load existing checkpoint if specified
    checkpoint_dir = Path(settings.MODEL_CHECKPOINT_DIR)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    if model_version:
        load_path = checkpoint_dir / f"virality_scorer_{model_version}.pt"
        if load_path.exists():
            state = torch.load(load_path, map_location=device)
            model.load_state_dict(state)
            log.info("training.loaded_checkpoint", path=str(load_path))

    log.info("training.model_initialized", params=model.num_parameters)

    # ── Optimizer + Scheduler ─────────────────────────────────────────────────
    optimizer = AdamW(
        model.parameters(),
        lr=learning_rate,
        weight_decay=weight_decay,
        betas=(0.9, 0.999),
    )

    scheduler = CosineAnnealingWarmRestarts(
        optimizer,
        T_0=max(epochs // 3, 2),
        T_mult=1,
        eta_min=learning_rate * 0.01,
    )

    criterion = nn.MSELoss()  # Regression task

    # ── W&B (optional) ────────────────────────────────────────────────────────
    wandb_run = None
    if settings.WANDB_ENABLED and settings.WANDB_API_KEY:
        try:
            import wandb

            wandb_run = wandb.init(
                project=settings.WANDB_PROJECT,
                name=job_id,
                config={
                    "epochs": epochs,
                    "lr": learning_rate,
                    "batch_size": batch_size,
                    "n_samples": len(feedback_data),
                    "model_params": model.num_parameters,
                },
            )
        except Exception as e:
            log.warning("training.wandb_init_failed", error=str(e))

    # ── Training Loop ─────────────────────────────────────────────────────────
    best_val_loss = float("inf")
    patience_counter = 0
    best_checkpoint_path = checkpoint_dir / f"virality_scorer_best_{job_id}.pt"
    history = []

    for epoch in range(1, epochs + 1):
        epoch_start = time.perf_counter()

        # Training phase
        train_loss = _train_epoch(model, train_loader, optimizer, criterion, device)

        # Validation phase
        val_loss, val_metrics = evaluate_model(model, val_loader, device, criterion)

        scheduler.step()
        current_lr = optimizer.param_groups[0]["lr"]
        epoch_time = time.perf_counter() - epoch_start

        epoch_record = {
            "epoch": epoch,
            "train_loss": round(train_loss, 6),
            "val_loss": round(val_loss, 6),
            "val_rmse": round(val_metrics.get("rmse", 0.0), 6),
            "val_mae": round(val_metrics.get("mae", 0.0), 6),
            "val_spearman": round(val_metrics.get("spearman", 0.0), 6),
            "lr": current_lr,
            "epoch_time_s": round(epoch_time, 2),
        }
        history.append(epoch_record)

        log.info("training.epoch", **epoch_record)

        if wandb_run:
            try:
                wandb_run.log(epoch_record)
            except Exception:
                pass

        # ── Early Stopping + Checkpointing ────────────────────────────────
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            torch.save(model.state_dict(), best_checkpoint_path)
            log.info("training.checkpoint_saved", path=str(best_checkpoint_path), val_loss=val_loss)
        else:
            patience_counter += 1
            if patience_counter >= early_stopping_patience:
                log.info("training.early_stopping", epoch=epoch, patience=early_stopping_patience)
                break

    # ── Save as "latest" for production use ──────────────────────────────────
    latest_path = checkpoint_dir / "virality_scorer_latest.pt"
    if best_checkpoint_path.exists():
        import shutil
        shutil.copy(best_checkpoint_path, latest_path)
        log.info("training.promoted_to_latest", path=str(latest_path))

    # Save training history
    history_path = checkpoint_dir / f"training_history_{job_id}.json"
    with open(history_path, "w") as f:
        json.dump(history, f, indent=2)

    if wandb_run:
        try:
            wandb_run.finish()
        except Exception:
            pass

    return {
        "best_val_loss": round(best_val_loss, 6),
        "final_train_loss": round(train_loss, 6),
        "epochs_run": len(history),
        "checkpoint_path": str(latest_path),
        "val_metrics": history[-1] if history else {},
    }


def _train_epoch(
    model: nn.Module,
    loader,
    optimizer: AdamW,
    criterion: nn.Module,
    device: torch.device,
    grad_clip: float = 1.0,
) -> float:
    """Run a single training epoch. Returns mean loss."""
    model.train()
    total_loss = 0.0
    n_batches = 0

    for features, targets in loader:
        features = features.to(device, non_blocking=True)
        targets = targets.to(device, non_blocking=True)

        optimizer.zero_grad(set_to_none=True)
        predictions = model(features)
        loss = criterion(predictions, targets)

        loss.backward()
        # Gradient clipping
        nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
        optimizer.step()

        total_loss += loss.item()
        n_batches += 1

    return total_loss / max(n_batches, 1)
