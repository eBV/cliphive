"""
CaptionGenerator – OpenRouter LLM integration for viral caption generation.

Features:
- Platform-specific tone adjustment (TikTok, Instagram, YouTube, Twitter)
- Emoji insertion with hashtag-style placement
- Power word detection and emphasis
- Style variants: hook, storytelling, educational, funny, dramatic
- Tenacity retry logic for API resilience
"""
from __future__ import annotations

import json
from typing import Any

import structlog
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

log = structlog.get_logger(__name__)

PLATFORM_INSTRUCTIONS = {
    "tiktok": (
        "TikTok captions. Short (1–3 sentences). Punchy. Conversational. "
        "Use lowercase for informal tone. Emojis every sentence. "
        "Hook reader in first 5 words. No hashtags in body (add separately)."
    ),
    "instagram": (
        "Instagram captions. 2–4 sentences. Slightly more polished. "
        "Mix of emojis and line breaks. CTAs like 'Save this!', 'Tag a friend'. "
        "Longer captions with value are acceptable."
    ),
    "youtube": (
        "YouTube video title/description style. Descriptive but compelling. "
        "Use parentheses for clarification. 1–2 sentences. "
        "Include a question to drive comments."
    ),
    "twitter": (
        "Twitter/X captions. Under 280 characters (ideally 150). "
        "Punchy and opinionated. Thread hooks with '…' if continuing. "
        "Use minimal emojis. Strong point of view."
    ),
}

STYLE_INSTRUCTIONS = {
    "hook": (
        "Write a HOOK caption. Start with a statement that creates curiosity gap. "
        "The reader MUST want to watch to resolve it."
    ),
    "storytelling": (
        "Write a STORYTELLING caption. Set the scene briefly. "
        "Create an arc: situation → twist → revelation."
    ),
    "educational": (
        "Write an EDUCATIONAL caption. Open with '3 things…', 'How to…', or 'Why…'. "
        "Promise clear value. Be specific."
    ),
    "funny": (
        "Write a FUNNY caption. Use irony, self-deprecation, or absurdist observation. "
        "Punchline at the end. Relatable scenario."
    ),
    "dramatic": (
        "Write a DRAMATIC caption. Use present tense for immediacy. "
        "Short sentences. Cliffhanger feel. Raw emotion."
    ),
}


class CaptionGenerator:
    """OpenRouter LLM caption generation service."""

    _instance: "CaptionGenerator | None" = None
    _client = None

    def __new__(cls) -> "CaptionGenerator":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if hasattr(self, "_initialized"):
            return
        self._initialized = True
        self._init_client()

    def _init_client(self) -> None:
        """Initialize OpenAI-compatible client pointed at OpenRouter."""
        try:
            from openai import AsyncOpenAI
            from app.config import get_settings

            settings = get_settings()
            if settings.OPENROUTERAI_API_KEY:
                self._client = AsyncOpenAI(
                    api_key=settings.OPENROUTERAI_API_KEY,
                    base_url="https://openrouter.ai/api/v1",
                    timeout=settings.OPENROUTER_TIMEOUT,
                    max_retries=0,  # handled by tenacity
                )
                log.info("caption_generator.openrouter_initialized")
            else:
                log.warning("caption_generator.no_api_key_using_fallback")
        except Exception as e:
            log.warning("caption_generator.init_error", error=str(e))

    # ── Public API ────────────────────────────────────────────────────────────

    async def generate(
        self,
        transcript_snippet: str,
        style: str = "hook",
        platform: str = "tiktok",
        language: str = "en",
        emphasis_words: list[str] | None = None,
        topic_tags: list[str] | None = None,
    ) -> dict[str, Any]:
        """
        Generate a viral caption for the given transcript snippet.
        """
        if self._client is None:
            return self._fallback_caption(transcript_snippet, style)

        try:
            return await self._generate_with_llm(
                transcript_snippet, style, platform, language, emphasis_words or [], topic_tags or []
            )
        except Exception as e:
            log.exception("caption_generator.llm_error", error=str(e))
            return self._fallback_caption(transcript_snippet, style)

    # ── Internal LLM Call ─────────────────────────────────────────────────────

    @retry(
        retry=retry_if_exception_type(Exception),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def _generate_with_llm(
        self,
        transcript_snippet: str,
        style: str,
        platform: str,
        language: str,
        emphasis_words: list[str],
        topic_tags: list[str],
    ) -> dict[str, Any]:
        """Call OpenRouter LLM to generate caption with structured JSON output."""
        from app.config import get_settings

        settings = get_settings()

        platform_inst = PLATFORM_INSTRUCTIONS.get(
            platform, PLATFORM_INSTRUCTIONS["tiktok"]
        )
        style_inst = STYLE_INSTRUCTIONS.get(style, STYLE_INSTRUCTIONS["hook"])

        emphasis_note = ""
        if emphasis_words:
            emphasis_note = f"\nEmphasized words to weave in: {', '.join(emphasis_words)}"

        tags_note = ""
        if topic_tags:
            tags_note = f"\nContent topics: {', '.join(topic_tags)}"

        system_prompt = f"""You are an expert viral content writer specializing in short-form video captions.

Platform: {platform.upper()}
{platform_inst}

Style: {style.upper()}
{style_inst}

Language: {language}
{emphasis_note}{tags_note}

Output STRICT JSON with these fields:
{{
    "caption": "the full caption text with emojis",
    "emphasis_words": ["list", "of", "power", "words", "detected"],
    "suggested_hashtags": ["hashtag1", "hashtag2"],
    "hook_word": "first power word or null"
}}

Rules:
- caption must NOT include hashtags (return them separately in suggested_hashtags)
- suggested_hashtags: 5–10 relevant tags WITHOUT the # symbol
- emphasis_words: words that should be visually emphasized (uppercase/bold)
- Be specific to the transcript content, not generic"""

        user_prompt = f"""Transcript clip:
\"\"\"{transcript_snippet}\"\"\"

Write the caption now:"""

        response = await self._client.chat.completions.create(
            model=settings.OPENROUTER_MODEL_CAPTION,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.8,
            max_tokens=400,
        )

        content = response.choices[0].message.content
        data = json.loads(content)

        return {
            "caption": data.get("caption", ""),
            "emphasis_words": data.get("emphasis_words", []),
            "suggested_hashtags": data.get("suggested_hashtags", []),
            "hook_word": data.get("hook_word"),
        }

    @staticmethod
    def _fallback_caption(transcript_snippet: str, style: str) -> dict[str, Any]:
        """Generate a basic caption without GPT-4o."""
        words = transcript_snippet.strip().split()[:15]
        caption = " ".join(words)
        if caption and not caption[-1] in ".!?":
            caption += "..."

        # Detect power words
        from app.services.clip_ranker import POWER_WORDS

        emphasis = [w for w in words if w.lower().strip(".,!?") in POWER_WORDS]

        return {
            "caption": f"{caption} 👀",
            "emphasis_words": emphasis[:3],
            "suggested_hashtags": ["fyp", "foryou", "viral", "trending"],
            "hook_word": emphasis[0] if emphasis else None,
        }
