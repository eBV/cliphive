"""
ViralityScorerModel – PyTorch transformer architecture.

Architecture:
- Input: 512-dim feature vector (transcript + audio + visual + temporal)
- Positional encoding (for sequential segment analysis)
- Multi-head self-attention (4 heads)
- Feed-forward layers with GELU activations
- Dropout regularization
- Sigmoid output → virality probability [0, 1]

Parameters: ~4.2M
"""
from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F


class PositionalEncoding(nn.Module):
    """Sinusoidal positional encoding for the feature vector."""

    def __init__(self, d_model: int, max_len: int = 512, dropout: float = 0.1) -> None:
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)

        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model)
        )
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)  # (1, max_len, d_model)
        self.register_buffer("pe", pe)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.pe[:, : x.size(1), :]
        return self.dropout(x)


class FeedForward(nn.Module):
    """Position-wise feed-forward network."""

    def __init__(self, d_model: int, d_ff: int = 2048, dropout: float = 0.1) -> None:
        super().__init__()
        self.linear1 = nn.Linear(d_model, d_ff)
        self.linear2 = nn.Linear(d_ff, d_model)
        self.dropout = nn.Dropout(p=dropout)
        self.norm = nn.LayerNorm(d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x
        x = self.linear2(self.dropout(F.gelu(self.linear1(x))))
        return self.norm(x + residual)


class TransformerBlock(nn.Module):
    """Single transformer block: multi-head attention + feed-forward."""

    def __init__(
        self,
        d_model: int,
        n_heads: int = 4,
        d_ff: int = 2048,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.attn = nn.MultiheadAttention(
            embed_dim=d_model,
            num_heads=n_heads,
            dropout=dropout,
            batch_first=True,
        )
        self.attn_norm = nn.LayerNorm(d_model)
        self.ff = FeedForward(d_model, d_ff, dropout)
        self.dropout = nn.Dropout(p=dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Self-attention with residual
        attn_out, _ = self.attn(x, x, x)
        x = self.attn_norm(x + self.dropout(attn_out))
        # Feed-forward
        x = self.ff(x)
        return x


class ViralityScorerModel(nn.Module):
    """
    Virality prediction transformer model.

    Input:  [batch, input_dim] or [batch, seq_len, input_dim]
    Output: [batch, 1] virality probability

    When input is 2D (single window), it's treated as seq_len=1.
    When input is 3D (multiple windows), transformer attends across windows.
    """

    def __init__(
        self,
        input_dim: int = 512,
        d_model: int = 256,
        n_heads: int = 4,
        n_layers: int = 4,
        d_ff: int = 1024,
        dropout: float = 0.1,
        max_seq_len: int = 128,
    ) -> None:
        super().__init__()

        self.input_dim = input_dim
        self.d_model = d_model

        # Input projection: map feature vector to model dimension
        self.input_proj = nn.Sequential(
            nn.Linear(input_dim, d_model),
            nn.LayerNorm(d_model),
            nn.GELU(),
            nn.Dropout(dropout),
        )

        # Positional encoding
        self.pos_enc = PositionalEncoding(d_model, max_len=max_seq_len, dropout=dropout)

        # Transformer blocks
        self.transformer_blocks = nn.ModuleList(
            [TransformerBlock(d_model, n_heads, d_ff, dropout) for _ in range(n_layers)]
        )

        # Output head
        self.output_head = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model // 2, d_model // 4),
            nn.GELU(),
            nn.Dropout(dropout / 2),
            nn.Linear(d_model // 4, 1),
            nn.Sigmoid(),
        )

        self._init_weights()

    def _init_weights(self) -> None:
        """Initialize weights with Xavier uniform."""
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.xavier_uniform_(module.weight)
                if module.bias is not None:
                    nn.init.zeros_(module.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass.

        Args:
            x: [batch, input_dim] or [batch, seq_len, input_dim]

        Returns:
            [batch, 1] virality score
        """
        if x.dim() == 2:
            x = x.unsqueeze(1)  # Add seq_len=1 dimension

        # Project input to model dimension
        x = self.input_proj(x)  # [batch, seq, d_model]

        # Add positional encoding
        x = self.pos_enc(x)

        # Apply transformer blocks
        for block in self.transformer_blocks:
            x = block(x)

        # Global average pooling across sequence dimension
        x = x.mean(dim=1)  # [batch, d_model]

        # Output head
        return self.output_head(x)  # [batch, 1]

    def predict_virality(self, feature_vector: list[float]) -> float:
        """Convenience method for single feature vector inference."""
        self.eval()
        with torch.no_grad():
            x = torch.tensor(feature_vector, dtype=torch.float32).unsqueeze(0)
            score = self.forward(x)
            return float(score.squeeze().item())

    @property
    def num_parameters(self) -> int:
        """Total number of trainable parameters."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
