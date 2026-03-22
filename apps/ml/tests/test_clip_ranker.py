"""Unit tests for the ClipRanker virality engine."""
import pytest
import numpy as np
from app.services.clip_ranker import ClipRanker, ClipCandidate


class MockTranscriptSegment:
    def __init__(self, start, end, text, confidence=0.9):
        self.start = start
        self.end = end
        self.text = text
        self.confidence = confidence


@pytest.fixture
def ranker():
    return ClipRanker(device="cpu")


def test_clip_ranker_returns_candidates(ranker):
    """ClipRanker should return a list of ClipCandidate objects."""
    segments = [
        {"start": 0.0, "end": 5.0, "text": "This is a great hook right here!"},
        {"start": 5.0, "end": 15.0, "text": "And then something amazing happened."},
        {"start": 15.0, "end": 25.0, "text": "You won't believe what came next."},
        {"start": 25.0, "end": 35.0, "text": "This is the punchline that drives shares."},
    ]
    scene_graph = {
        "scenes": [
            {
                "scene_id": 0,
                "start_time": 0.0,
                "end_time": 35.0,
                "energy_score": 0.7,
                "face_count": 1,
                "motion_magnitude": 0.5,
            }
        ],
        "total_scenes": 1,
    }

    candidates = ranker.rank_clips(
        transcript_segments=segments,
        scene_graph=scene_graph,
        total_duration=35.0,
        top_k=5,
    )

    assert isinstance(candidates, list)
    assert len(candidates) > 0
    for c in candidates:
        assert 0 <= c["virality_score"] <= 1
        assert c["duration_seconds"] <= 30
        assert c["start_time"] >= 0


def test_nms_removes_overlapping_candidates(ranker):
    """NMS should deduplicate heavily overlapping clip windows."""
    candidates_raw = [
        {"start_time": 0.0, "end_time": 15.0, "virality_score": 0.9},
        {"start_time": 1.0, "end_time": 16.0, "virality_score": 0.85},  # high overlap with above
        {"start_time": 20.0, "end_time": 30.0, "virality_score": 0.8},  # distinct
    ]
    result = ranker._apply_nms(candidates_raw, iou_threshold=0.5)
    assert len(result) == 2  # first and third should survive


def test_virality_score_bounds(ranker):
    """Virality scores must always be in [0, 1]."""
    for _ in range(10):
        scores = {
            "hook_score": np.random.random(),
            "retention_prediction": np.random.random(),
            "audio_energy_score": np.random.random(),
            "emotion_intensity": np.random.random(),
            "quotability_score": np.random.random(),
            "visual_dynamism": np.random.random(),
            "loop_score": np.random.random(),
            "trend_alignment": np.random.random(),
        }
        composite = ranker._compute_composite_score(scores)
        assert 0 <= composite <= 1, f"Score out of bounds: {composite}"
