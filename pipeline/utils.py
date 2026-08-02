"""
Utility functions — logging setup, retry decorator, seed generation, file hashing.
"""

import hashlib
import logging
import random
import time
import functools
from pathlib import Path
from typing import Callable, TypeVar, Any

F = TypeVar("F", bound=Callable[..., Any])


def setup_logger(name: str, log_file: str, level: str = "INFO") -> logging.Logger:
    """Configure a logger that writes to both stdout and a rotating log file."""
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    fmt = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Console handler
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    # File handler
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    return logger


def retry(max_attempts: int = 3, delay: float = 5.0, exceptions=(Exception,)):
    """
    Decorator that retries a function up to `max_attempts` times on failure.
    Implements exponential back-off with jitter.
    """
    def decorator(fn: F) -> F:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            logger = logging.getLogger("pipeline.retry")
            last_exc = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except exceptions as exc:
                    last_exc = exc
                    wait = delay * (2 ** (attempt - 1)) + random.uniform(0, 1)
                    logger.warning(
                        f"[Attempt {attempt}/{max_attempts}] {fn.__name__} failed: {exc}. "
                        f"Retrying in {wait:.1f}s..."
                    )
                    time.sleep(wait)
            raise RuntimeError(
                f"{fn.__name__} failed after {max_attempts} attempts. "
                f"Last error: {last_exc}"
            ) from last_exc
        return wrapper  # type: ignore
    return decorator


def generate_scene_seed(scene_index: int, salt: int = None) -> int:
    """
    Generate a unique, isolated seed per scene.
    Using a per-scene salt eliminates latent space collisions that occur when
    a single global seed is applied across varying visual prompts.
    """
    if salt is None:
        salt = random.randint(100_000, 999_999)
    # XOR with a large prime to prevent sequential seed correlation
    seed = ((scene_index + 1) * 1_000_003 ^ salt) % (2**31 - 1)
    return max(1, seed)


def sha256_file(path: Path) -> str:
    """Compute the SHA-256 hash of a file for integrity verification."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def format_scene_id(index: int) -> str:
    """Zero-padded scene identifier string, e.g. scene_01, scene_20."""
    return f"scene_{index + 1:02d}"
