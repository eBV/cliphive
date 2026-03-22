"""Unit tests for AudioAnalyzer."""
import pytest
import numpy as np
from app.services.audio_analyzer import AudioAnalyzer


@pytest.fixture
def analyzer():
    return AudioAnalyzer(device="cpu")


@pytest.fixture
def synthetic_audio():
    """Generate 5 seconds of synthetic audio at 22050 Hz."""
    sr = 22050
    t = np.linspace(0, 5, sr * 5)
    audio = 0.5 * np.sin(2 * np.pi * 440 * t)  # 440 Hz sine wave
    return audio, sr


def test_energy_map_shape(analyzer, synthetic_audio):
    """Energy map should be a 1D array."""
    audio, sr = synthetic_audio
    energy = analyzer.compute_energy_map(audio, sr)
    assert energy.ndim == 1
    assert len(energy) > 0
    assert np.all(energy >= 0)


def test_silence_detection(analyzer):
    """Silence detector should find gaps in audio."""
    sr = 22050
    # 5 second audio: 1s sound, 2s silence, 1s sound
    audio = np.zeros(sr * 4, dtype=np.float32)
    audio[:sr] = np.random.randn(sr) * 0.5   # 0-1s: sound
    audio[3 * sr:] = np.random.randn(sr) * 0.5  # 3-4s: sound
    # 1-3s is silence

    gaps = analyzer.detect_silence_gaps(audio, sr, min_gap=1.5)
    assert len(gaps) >= 1
