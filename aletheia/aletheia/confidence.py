"""Confidence scoring.

Confidence is a float in [0, 1] combining:
  * base authority of the originating source (config.SOURCE_AUTHORITY)
  * agreement bonus: how many DISTINCT other sources have near-identical text
  * dampening when only one source supports it
"""

from __future__ import annotations

from . import config


def base_authority(source: str) -> float:
    return float(config.SOURCE_AUTHORITY.get(source, 0.5))


def confidence_for(
    source: str,
    *,
    distinct_supporting_sources: int,
) -> float:
    """Compute confidence for a fact contributed by `source`.

    distinct_supporting_sources counts ALL sources reporting near-identical
    text, including `source` itself (always >= 1).
    """
    if distinct_supporting_sources < 1:
        distinct_supporting_sources = 1

    base = base_authority(source)
    # Linear boost: full bonus reached at MIN_CROSS_SOURCES.
    bonus_ratio = min(1.0, (distinct_supporting_sources - 1) / max(1, config.MIN_CROSS_SOURCES - 1))
    # Cap the bonus at 0.25 — corroboration matters but cannot make a low
    # authority source "established" all by itself.
    bonus = 0.25 * bonus_ratio

    score = base + bonus
    return max(0.0, min(1.0, score))


def label(score: float) -> str:
    if score >= config.ESTABLISHED_AT:
        return "established"
    if score < config.UNCERTAIN_BELOW:
        return "uncertain"
    return "tentative"


def should_overwrite(
    *, existing_confidence: float, incoming_confidence: float
) -> bool:
    """Never replace a higher-confidence fact with much lower-confidence data."""
    return incoming_confidence + config.OVERWRITE_GUARD >= existing_confidence
