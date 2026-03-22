"""
HashtagOptimizer – OpenRouter LLM + trending hashtag correlation.

Generates a tiered hashtag strategy:
- Primary: core content descriptors (high relevance, medium reach)
- Niche: community/interest-specific (high relevance, targeted reach)
- Trending: currently viral tags (lower relevance, maximum reach boost)
- Broad: discoverability tags (#fyp, #viral, etc.)

Ranks hashtags by predicted reach × relevance score.
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

# Platform-specific max hashtag counts
PLATFORM_HASHTAG_LIMITS = {
    "tiktok": 5,      # TikTok benefits from fewer, targeted tags
    "instagram": 30,  # Instagram allows up to 30
    "youtube": 15,    # YouTube description hashtags
    "twitter": 3,     # Twitter: 1–3 max for best performance
}

# Default broad reach hashtags by platform
BROAD_HASHTAGS = {
    "tiktok": ["fyp", "foryou", "foryoupage", "viral", "trending"],
    "instagram": ["explore", "instagood", "reels", "instadaily", "content"],
    "youtube": ["youtube", "youtuber", "subscribe", "video"],
    "twitter": ["viral", "trending"],
}


class HashtagOptimizer:
    """OpenRouter LLM hashtag strategy generation with reach optimization."""

    _instance: "HashtagOptimizer | None" = None
    _client = None

    def __new__(cls) -> "HashtagOptimizer":
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
                    max_retries=0,
                )
                log.info("hashtag_optimizer.openrouter_initialized")
            else:
                log.warning("hashtag_optimizer.no_api_key")
        except Exception as e:
            log.warning("hashtag_optimizer.init_error", error=str(e))

    # ── Public API ────────────────────────────────────────────────────────────

    async def generate(
        self,
        topic_tags: list[str],
        platform: str = "tiktok",
        niche: str | None = None,
        trending_hashtags: list[str] | None = None,
        max_hashtags: int = 20,
        caption_context: str | None = None,
    ) -> dict[str, Any]:
        """
        Generate an optimized hashtag set.

        Returns:
            {
                hashtags: list[str],
                reasoning: str,
                primary_hashtags: list[str],
                niche_hashtags: list[str],
                trending_hashtags_used: list[str],
                broad_hashtags: list[str],
            }
        """
        platform_limit = PLATFORM_HASHTAG_LIMITS.get(platform, max_hashtags)
        effective_max = min(max_hashtags, platform_limit)

        if self._client is None:
            return self._fallback_hashtags(
                topic_tags, platform, trending_hashtags or [], effective_max
            )

        try:
            return await self._generate_with_llm(
                topic_tags=topic_tags,
                platform=platform,
                niche=niche,
                trending_hashtags=trending_hashtags or [],
                max_hashtags=effective_max,
                caption_context=caption_context,
            )
        except Exception as e:
            log.exception("hashtag_optimizer.llm_error", error=str(e))
            return self._fallback_hashtags(
                topic_tags, platform, trending_hashtags or [], effective_max
            )

    # ── Internal LLM Call ─────────────────────────────────────────────────────

    @retry(
        retry=retry_if_exception_type(Exception),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def _generate_with_llm(
        self,
        topic_tags: list[str],
        platform: str,
        niche: str | None,
        trending_hashtags: list[str],
        max_hashtags: int,
        caption_context: str | None,
    ) -> dict[str, Any]:
        """OpenRouter LLM hashtag generation with structured JSON response."""
        from app.config import get_settings

        settings = get_settings()

        niche_str = f"Content niche: {niche}" if niche else ""
        trending_str = (
            f"Currently trending hashtags to consider: {', '.join(trending_hashtags)}"
            if trending_hashtags
            else ""
        )
        caption_str = (
            f"Caption context: \"{caption_context}\""
            if caption_context
            else ""
        )
        broad = BROAD_HASHTAGS.get(platform, [])

        system_prompt = f"""You are a social media growth expert specializing in hashtag strategy.

Platform: {platform.upper()}
{niche_str}
{trending_str}
{caption_str}

Generate EXACTLY {max_hashtags} hashtags using this tiered strategy:
1. PRIMARY (30%): Core content descriptors. High relevance. 50k–5M posts.
2. NICHE (40%): Community-specific. Very high relevance. Under 500k posts.
3. TRENDING (20%): Currently viral tags from the list provided (or popular ones).
4. BROAD (10%): Discoverability. Always include some of: {', '.join(broad)}

Return STRICT JSON:
{{
    "hashtags": ["all", "hashtags", "combined", "without", "hash", "symbol"],
    "primary_hashtags": ["list"],
    "niche_hashtags": ["list"],
    "trending_hashtags_used": ["list"],
    "broad_hashtags": ["list"],
    "reasoning": "one sentence explaining the strategy"
}}

Rules:
- No # symbol in the hashtag strings
- All lowercase
- No spaces in hashtags (use camelCase or concatenation)
- Total count must be exactly {max_hashtags}
- Hashtags must be relevant to the content"""

        user_prompt = f"""Content topic tags: {', '.join(topic_tags)}

Generate the hashtag strategy:"""

        response = await self._client.chat.completions.create(
            model=settings.OPENROUTER_MODEL_HASHTAG,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.5,
            max_tokens=600,
        )

        content = response.choices[0].message.content
        data = json.loads(content)

        # Validate and clean hashtags
        hashtags = [
            h.lower().replace("#", "").replace(" ", "")
            for h in data.get("hashtags", [])
            if h and isinstance(h, str)
        ]

        return {
            "hashtags": hashtags[:max_hashtags],
            "reasoning": data.get("reasoning", ""),
            "primary_hashtags": data.get("primary_hashtags", []),
            "niche_hashtags": data.get("niche_hashtags", []),
            "trending_hashtags_used": data.get("trending_hashtags_used", []),
            "broad_hashtags": data.get("broad_hashtags", []),
        }

    @staticmethod
    def _fallback_hashtags(
        topic_tags: list[str],
        platform: str,
        trending_hashtags: list[str],
        max_hashtags: int,
    ) -> dict[str, Any]:
        """Generate basic hashtags without GPT-4o."""
        broad = BROAD_HASHTAGS.get(platform, ["viral", "trending"])
        primary = [t.lower().replace(" ", "") for t in topic_tags[:5]]
        trending_used = trending_hashtags[:3]
        all_tags = list(dict.fromkeys(primary + trending_used + broad))[:max_hashtags]

        return {
            "hashtags": all_tags,
            "reasoning": "Fallback: topic tags + platform broad tags",
            "primary_hashtags": primary,
            "niche_hashtags": [],
            "trending_hashtags_used": trending_used,
            "broad_hashtags": broad,
        }
