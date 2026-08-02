"""
STAGE 1 — The Narrative Manifest

Generates and validates the full prompt/metadata array for all 20 scenes simultaneously
and exports it to a structured manifest.json. This stage runs ONCE and its output is
the immutable contract for all subsequent stages.
"""

import json
import logging
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

from .config import PipelineConfig
from .utils import setup_logger, format_scene_id


class NarrativeManifestGenerator:
    """
    Responsible for creating the structured scene manifest.
    The manifest is the single source of truth — every downstream stage reads from it.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.logger = setup_logger(
            "pipeline.manifest", config.log_file, config.log_level
        )

    def build_scene_metadata(self, scene_index: int, prompt: str, **kwargs) -> Dict[str, Any]:
        """
        Construct a fully-specified scene metadata block.
        Every field that any downstream stage might need is pre-declared here.
        This eliminates ambiguity at generation time.
        """
        scene_id = format_scene_id(scene_index)
        return {
            "scene_id": scene_id,
            "scene_index": scene_index,
            "prompt": prompt,
            "negative_prompt": kwargs.get(
                "negative_prompt",
                "blurry, low quality, distorted, watermark, text, ugly, deformed, "
                "artifacts, noise, grain, oversaturated, underexposed",
            ),
            "image_cfg_scale": kwargs.get("image_cfg_scale", self.config.image_cfg_scale),
            "image_steps": kwargs.get("image_steps", self.config.image_steps),
            "style_preset": kwargs.get("style_preset", None),
            "motion_bucket_id": kwargs.get("motion_bucket_id", self.config.motion_bucket_id),
            "conditioning_scale": kwargs.get(
                "conditioning_scale", self.config.image_conditioning_scale
            ),
            "scene_duration_seconds": kwargs.get(
                "scene_duration_seconds", self.config.scene_duration_seconds
            ),
            "camera_motion": kwargs.get("camera_motion", "static"),  # static | pan_left | pan_right | zoom_in | zoom_out
            "source_still_path": str(
                self.config.source_stills_dir / f"{scene_id}.png"
            ),
            "raw_clip_path": str(
                self.config.raw_clips_dir / f"{scene_id}_raw.mp4"
            ),
            "normalized_clip_path": str(
                self.config.normalized_clips_dir / f"{scene_id}_norm.mp4"
            ),
            "validation": {
                "still_sha256": None,
                "still_resolution": None,
                "still_verified": False,
            },
            "status": {
                "image_generated": False,
                "video_generated": False,
                "clip_normalized": False,
            },
            "timestamps": {
                "manifest_created": time.time(),
                "image_generated_at": None,
                "video_generated_at": None,
                "normalized_at": None,
            },
            "metadata": kwargs.get("metadata", {}),
        }

    def generate_manifest(self, scene_prompts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Build the full 20-scene manifest from a list of prompt dicts.
        Each prompt dict must contain at minimum a 'prompt' key.
        Validates scene count matches config before writing.
        """
        self.logger.info(
            f"[STAGE 1] Generating Narrative Manifest for {len(scene_prompts)} scenes..."
        )

        if len(scene_prompts) != self.config.total_scenes:
            raise ValueError(
                f"Scene count mismatch: expected {self.config.total_scenes}, "
                f"received {len(scene_prompts)}. Refusing to generate partial manifest."
            )

        scenes = []
        for idx, scene_input in enumerate(scene_prompts):
            if "prompt" not in scene_input:
                raise ValueError(f"Scene index {idx} is missing a 'prompt' key.")
            scene = self.build_scene_metadata(
                scene_index=idx,
                **scene_input,
            )
            scenes.append(scene)
            self.logger.debug(f"  Scene {scene['scene_id']} manifest entry created.")

        self.logger.info(f"[STAGE 1] Manifest built. Writing to {self.config.manifest_path}")
        self._write_manifest(scenes)
        self.logger.info("[STAGE 1] COMPLETE — manifest.json written and locked.")
        return scenes

    def _write_manifest(self, scenes: List[Dict[str, Any]]):
        manifest_data = {
            "pipeline_version": "2.0.0",
            "created_at": time.time(),
            "total_scenes": len(scenes),
            "config": {
                "image_width": self.config.image_width,
                "image_height": self.config.image_height,
                "video_width": self.config.video_width,
                "video_height": self.config.video_height,
                "target_fps": self.config.target_fps,
                "motion_bucket_id": self.config.motion_bucket_id,
                "conditioning_scale": self.config.image_conditioning_scale,
            },
            "scenes": scenes,
        }
        with open(self.config.manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest_data, f, indent=2, ensure_ascii=False)

    def load_manifest(self) -> List[Dict[str, Any]]:
        """Load an existing manifest from disk. Raises if not found."""
        if not self.config.manifest_path.exists():
            raise FileNotFoundError(
                f"manifest.json not found at {self.config.manifest_path}. "
                "Run Stage 1 first."
            )
        with open(self.config.manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.logger.info(
            f"[STAGE 1] Loaded existing manifest: {len(data['scenes'])} scenes."
        )
        return data["scenes"]

    def update_scene_in_manifest(self, scene_index: int, updates: Dict[str, Any]):
        """
        Atomically update a single scene's fields in the manifest JSON.
        Used by downstream stages to record status and validation results.
        """
        with open(self.config.manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        scene = data["scenes"][scene_index]
        self._deep_update(scene, updates)
        data["scenes"][scene_index] = scene

        tmp_path = Path(str(self.config.manifest_path) + ".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        tmp_path.replace(self.config.manifest_path)

    def _deep_update(self, base: dict, updates: dict):
        """Recursively merge update dict into base dict in-place."""
        for key, value in updates.items():
            if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                self._deep_update(base[key], value)
            else:
                base[key] = value
