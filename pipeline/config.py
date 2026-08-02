"""
Pipeline Configuration — all constants, paths, and API parameters in one place.
Modify this file to tune the pipeline to your specific API provider and project requirements.
"""

import os
import logging
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class PipelineConfig:
    # ─── Project Paths ────────────────────────────────────────────────────────
    project_root: Path = field(default_factory=lambda: Path(__file__).parent.parent)
    assets_dir: Path = field(default_factory=lambda: Path(__file__).parent.parent / "assets")

    @property
    def source_stills_dir(self) -> Path:
        return self.assets_dir / "source_stills"

    @property
    def raw_clips_dir(self) -> Path:
        return self.assets_dir / "raw_clips"

    @property
    def normalized_clips_dir(self) -> Path:
        return self.assets_dir / "normalized_clips"

    @property
    def output_dir(self) -> Path:
        return self.assets_dir / "output"

    @property
    def manifest_path(self) -> Path:
        return self.project_root / "manifest.json"

    @property
    def state_path(self) -> Path:
        return self.project_root / "pipeline_state.json"

    # ─── Scene Configuration ──────────────────────────────────────────────────
    total_scenes: int = 20
    scene_duration_seconds: float = 5.0

    # ─── Image Generation API Parameters ─────────────────────────────────────
    image_api_provider: str = os.getenv("IMAGE_API_PROVIDER", "stability")
    image_api_key: str = os.getenv("STABILITY_API_KEY", "")
    image_api_base_url: str = os.getenv(
        "IMAGE_API_BASE_URL",
        "https://api.stability.ai/v2beta/stable-image/generate/sd3"
    )
    image_width: int = 1920
    image_height: int = 1080
    image_cfg_scale: float = 7.5
    image_steps: int = 40
    image_sampler: str = "K_DPMPP_2M"
    image_output_format: str = "png"

    # ─── Video Generation (I2V) API Parameters ───────────────────────────────
    video_api_provider: str = os.getenv("VIDEO_API_PROVIDER", "stability")
    video_api_key: str = os.getenv("STABILITY_API_KEY", "")
    video_api_base_url: str = os.getenv(
        "VIDEO_API_BASE_URL",
        "https://api.stability.ai/v2beta/image-to-video"
    )
    video_poll_base_url: str = os.getenv(
        "VIDEO_POLL_BASE_URL",
        "https://api.stability.ai/v2beta/image-to-video/result"
    )

    # CONDITIONING SCALE OPTIMIZATION — bind the model tightly to Frame 0 geometry.
    # Range: 0.85–0.92 is the sweet spot for structural fidelity without total freeze.
    image_conditioning_scale: float = 0.90

    # MOTION BUCKET CONTROL — suppresses extreme pixel displacement.
    # Stability SVD default is 127. We lower it ~35% to prevent latent space tearing.
    motion_bucket_id: int = 80

    # Augmentation noise — keep very low to preserve first-frame structure.
    augmentation_level: float = 0.02

    video_width: int = 1920
    video_height: int = 1080

    # ── KINEMATIC LOCKDOWN PARAMETERS ─────────────────────────────────────────
    # These four parameters form a hard mathematical barrier against latent overwrite.

    # RULE 1 — PROMPT STRIPPING (Null-Text Conditioning)
    # The I2V model receives only these mechanical motion words — never the scene
    # description. Full narrative text fed into I2V overwrites the init_image.
    i2v_prompt: str = "subtle cinematic motion, static camera"

    # RULE 2 — NEGATIVE PROMPT PURGE
    # Massive negative arrays dilute init_image weight. Hard cap: 5 structural
    # keywords only. No scene-specific negative text allowed.
    i2v_negative_prompt: str = "morphing, text, distortion, mutations, jitter"

    # RULE 3 — CFG & DENOISING INVERSION
    # Low CFG forces the model to stop reasoning about text and defer to init_image.
    # Range: 2.5–3.5. Default API values (7–9) tear the latent space apart.
    i2v_cfg_scale: float = 3.0

    # Image weight maximized — model is mathematically anchored to Frame 0 pixels.
    i2v_image_weight: float = 0.95

    # Denoising strength inverted — low value = minimal deviation from source pixels.
    # 0.35 means 65% of the output is direct init_image signal.
    i2v_denoising_strength: float = 0.35

    # RULE 4 — CONTEXT WINDOW CAPPING (Frame Limiting)
    # Short burst generation prevents structural decay in later frames.
    # 25 frames @ 25fps = ~1 second. 14–24 frames is the safe consistency window.
    # Better to have 2 seconds of perfect consistency than 4 seconds of hallucination.
    i2v_num_frames: int = 25        # Hard cap: 14–25 frames maximum
    i2v_fps: int = 25               # Playback FPS for frame count → duration math

    # ─── FFmpeg Normalization Specifications ─────────────────────────────────
    target_fps: int = 24
    target_width: int = 1920
    target_height: int = 1080
    target_pixel_format: str = "yuv420p"
    target_video_codec: str = "libx264"
    target_audio_codec: str = "aac"
    target_crf: int = 18               # Constant Rate Factor — 18 is visually lossless
    target_preset: str = "slow"        # FFmpeg encoding preset (slower = better compression)

    # 4K oversampling canvas for pan/zoom filters — prevents sub-pixel jitter
    oversample_width: int = 3840
    oversample_height: int = 2160

    # ─── Retry / Resilience Parameters ───────────────────────────────────────
    max_retries: int = 3
    retry_delay_seconds: float = 5.0
    video_poll_interval_seconds: float = 10.0
    video_poll_timeout_seconds: float = 600.0  # 10 minute hard timeout per clip

    # ─── Validation Thresholds ────────────────────────────────────────────────
    min_file_size_bytes: int = 50_000   # Images smaller than 50KB are considered corrupt
    required_image_format: str = "PNG"

    # ─── Logging ─────────────────────────────────────────────────────────────
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    log_file: str = "pipeline.log"

    def ensure_directories(self):
        """Create all required output directories."""
        for d in [
            self.source_stills_dir,
            self.raw_clips_dir,
            self.normalized_clips_dir,
            self.output_dir,
        ]:
            d.mkdir(parents=True, exist_ok=True)

    def validate_api_keys(self):
        """Raise immediately if required API keys are absent."""
        missing = []
        if not self.image_api_key:
            missing.append("STABILITY_API_KEY (image generation)")
        if not self.video_api_key:
            missing.append("STABILITY_API_KEY (video generation)")
        if missing:
            raise EnvironmentError(
                f"Missing required environment variables:\n  - " + "\n  - ".join(missing)
            )
