"""
Video Pipeline State Machine — Main Orchestrator

Implements the decoupled, multi-stage, stage-gated execution pipeline.
State is persisted to disk at every checkpoint, enabling safe resume after failure.

Stage flow:
  STAGE 1 → Narrative Manifest (manifest.json)
  STAGE 2 → Structural Anchor (source stills PNGs)
  STAGE 3 → Validation Circuit (circuit breaker)
  STAGE 4 → Kinematic Render (raw I2V clips)
  STAGE 5 → FFmpeg Normalization (normalized clips)
  STAGE 6 → Final Concatenation (final_output.mp4)
"""

import json
import logging
import time
from enum import Enum, auto
from pathlib import Path
from typing import List, Dict, Any, Optional

from .config import PipelineConfig
from .manifest import NarrativeManifestGenerator
from .image_gen import ImageGenerator
from .validator import ValidationCircuit, ValidationError
from .video_gen import VideoGenerator
from .ffmpeg_engine import FFmpegEngine
from .utils import setup_logger


class PipelineStage(Enum):
    IDLE = auto()
    STAGE_1_MANIFEST = auto()
    STAGE_2_IMAGE_GEN = auto()
    STAGE_3_VALIDATION = auto()
    STAGE_4_VIDEO_GEN = auto()
    STAGE_5_NORMALIZATION = auto()
    STAGE_6_CONCATENATION = auto()
    COMPLETE = auto()
    FAILED = auto()


class VideoPipeline:
    """
    The top-level orchestrator. Manages stage transitions, state persistence,
    and coordinates all subsystems: manifest, image gen, validation,
    video gen, and FFmpeg rendering.

    Design principles:
      - Stage-gated: No stage can run until its predecessor has completed.
      - Idempotent: Every stage is safely resumable after interruption.
      - State-persistent: Pipeline state is written to disk after each stage.
      - Fail-fast: Any stage failure immediately halts the pipeline.
    """

    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or PipelineConfig()
        self.config.ensure_directories()

        self.logger = setup_logger(
            "pipeline.orchestrator", self.config.log_file, self.config.log_level
        )

        # Subsystems
        self._manifest_gen = NarrativeManifestGenerator(self.config)
        self._image_gen = ImageGenerator(self.config)
        self._validator = ValidationCircuit(self.config)
        self._video_gen = VideoGenerator(self.config)
        self._ffmpeg = FFmpegEngine(self.config)

        # Runtime state
        self._current_stage = PipelineStage.IDLE
        self._scenes: List[Dict[str, Any]] = []
        self._state: Dict[str, Any] = {}
        self._load_state()

    # ─── Public API ───────────────────────────────────────────────────────────

    def run(
        self,
        scene_prompts: List[Dict[str, Any]],
        output_filename: str = "final_output.mp4",
        resume: bool = True,
        start_from_stage: int = 1,
    ) -> Path:
        """
        Execute the full pipeline from Stage 1 through Stage 6.

        Args:
            scene_prompts:    List of dicts, each with at minimum a 'prompt' key.
                              Must contain exactly config.total_scenes entries.
            output_filename:  Name of the final concatenated MP4.
            resume:           If True, skip already-completed work (idempotent).
            start_from_stage: Override to resume from a specific stage number (1-6).

        Returns:
            Path to the final output video file.
        """
        self.logger.info("=" * 70)
        self.logger.info("  VIDEO PIPELINE — STARTING")
        self.logger.info(f"  Scenes: {len(scene_prompts)} | Resume: {resume}")
        self.logger.info("=" * 70)

        start_time = time.time()

        try:
            self.config.validate_api_keys()

            # ── STAGE 1: Narrative Manifest ────────────────────────────────────
            if start_from_stage <= 1:
                self._transition(PipelineStage.STAGE_1_MANIFEST)
                if resume and self.config.manifest_path.exists() and self._state.get("stage_1_complete"):
                    self.logger.info("[STAGE 1] Manifest exists — loading from disk.")
                    self._scenes = self._manifest_gen.load_manifest()
                else:
                    self._scenes = self._manifest_gen.generate_manifest(scene_prompts)
                self._complete_stage(1)

            # ── STAGE 2: Structural Anchor (Image Generation) ──────────────────
            if start_from_stage <= 2:
                self._transition(PipelineStage.STAGE_2_IMAGE_GEN)
                if not self._scenes:
                    self._scenes = self._manifest_gen.load_manifest()
                self._scenes = self._image_gen.generate_all(
                    self._scenes,
                    manifest_updater=self._manifest_gen.update_scene_in_manifest,
                    resume=resume,
                )
                self._complete_stage(2)

            # ── STAGE 3: Validation Circuit (Hard Circuit Breaker) ─────────────
            if start_from_stage <= 3:
                self._transition(PipelineStage.STAGE_3_VALIDATION)
                if not self._scenes:
                    self._scenes = self._manifest_gen.load_manifest()
                try:
                    self._scenes = self._validator.run(
                        self._scenes,
                        manifest_updater=self._manifest_gen.update_scene_in_manifest,
                    )
                except ValidationError as exc:
                    self._transition(PipelineStage.FAILED)
                    self._save_state({"failure_stage": 3, "failure_reason": str(exc)})
                    raise  # Re-raise — pipeline is BLOCKED
                self._complete_stage(3)

            # ── STAGE 4: Kinematic Render (I2V Generation) ────────────────────
            if start_from_stage <= 4:
                self._transition(PipelineStage.STAGE_4_VIDEO_GEN)
                if not self._scenes:
                    self._scenes = self._manifest_gen.load_manifest()
                self._scenes = self._video_gen.generate_all(
                    self._scenes,
                    manifest_updater=self._manifest_gen.update_scene_in_manifest,
                    resume=resume,
                )
                self._complete_stage(4)

            # ── STAGE 5: FFmpeg Normalization ──────────────────────────────────
            if start_from_stage <= 5:
                self._transition(PipelineStage.STAGE_5_NORMALIZATION)
                if not self._scenes:
                    self._scenes = self._manifest_gen.load_manifest()
                self._scenes = self._ffmpeg.normalize_all(
                    self._scenes,
                    manifest_updater=self._manifest_gen.update_scene_in_manifest,
                    resume=resume,
                )
                self._complete_stage(5)

            # ── STAGE 6: Final Concatenation ───────────────────────────────────
            if start_from_stage <= 6:
                self._transition(PipelineStage.STAGE_6_CONCATENATION)
                if not self._scenes:
                    self._scenes = self._manifest_gen.load_manifest()
                output_path = self._ffmpeg.concatenate(
                    self._scenes,
                    output_filename=output_filename,
                )
                self._complete_stage(6)

            # ── PIPELINE COMPLETE ──────────────────────────────────────────────
            self._transition(PipelineStage.COMPLETE)
            elapsed = time.time() - start_time
            self.logger.info("=" * 70)
            self.logger.info(f"  PIPELINE COMPLETE in {elapsed / 60:.1f} minutes")
            self.logger.info(f"  Output → {output_path}")
            self.logger.info("=" * 70)
            self._save_state({"pipeline_complete": True, "output_path": str(output_path)})
            return output_path

        except Exception as exc:
            self._transition(PipelineStage.FAILED)
            self.logger.error(f"PIPELINE FAILED at stage {self._current_stage.name}: {exc}")
            self._save_state({"pipeline_complete": False, "last_error": str(exc)})
            raise

    def run_stage_1_only(self, scene_prompts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Run Stage 1 independently — useful for reviewing the manifest before committing to generation."""
        self.config.validate_api_keys()
        self._transition(PipelineStage.STAGE_1_MANIFEST)
        self._scenes = self._manifest_gen.generate_manifest(scene_prompts)
        self._complete_stage(1)
        return self._scenes

    def run_stage_3_only(self) -> List[Dict[str, Any]]:
        """Re-run the validation circuit independently on existing source stills."""
        self._transition(PipelineStage.STAGE_3_VALIDATION)
        self._scenes = self._manifest_gen.load_manifest()
        self._scenes = self._validator.run(
            self._scenes,
            manifest_updater=self._manifest_gen.update_scene_in_manifest,
        )
        self._complete_stage(3)
        return self._scenes

    def run_ffmpeg_only(self, output_filename: str = "final_output.mp4") -> Path:
        """Re-run normalization and concatenation independently — useful after I2V tweaks."""
        self._scenes = self._manifest_gen.load_manifest()
        self._transition(PipelineStage.STAGE_5_NORMALIZATION)
        self._scenes = self._ffmpeg.normalize_all(
            self._scenes,
            manifest_updater=self._manifest_gen.update_scene_in_manifest,
        )
        self._complete_stage(5)
        self._transition(PipelineStage.STAGE_6_CONCATENATION)
        output_path = self._ffmpeg.concatenate(self._scenes, output_filename=output_filename)
        self._complete_stage(6)
        return output_path

    def get_status(self) -> Dict[str, Any]:
        """Return a human-readable status report of all scenes and pipeline stages."""
        status = {
            "current_stage": self._current_stage.name,
            "pipeline_state": self._state,
            "scenes": [],
        }
        for scene in self._scenes:
            status["scenes"].append({
                "scene_id": scene["scene_id"],
                "image_generated": scene["status"]["image_generated"],
                "validated": scene["validation"]["still_verified"],
                "video_generated": scene["status"]["video_generated"],
                "clip_normalized": scene["status"]["clip_normalized"],
            })
        return status

    # ─── State Persistence ────────────────────────────────────────────────────

    def _transition(self, stage: PipelineStage):
        self._current_stage = stage
        self.logger.info(f"[STATE MACHINE] → {stage.name}")
        self._save_state({"current_stage": stage.name})

    def _complete_stage(self, stage_number: int):
        key = f"stage_{stage_number}_complete"
        self._state[key] = True
        self._state[f"stage_{stage_number}_completed_at"] = time.time()
        self._save_state({key: True})
        self.logger.info(f"[STATE MACHINE] Stage {stage_number} checkpoint saved.")

    def _save_state(self, updates: Dict[str, Any]):
        self._state.update(updates)
        tmp = Path(str(self.config.state_path) + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._state, f, indent=2)
        tmp.replace(self.config.state_path)

    def _load_state(self):
        if self.config.state_path.exists():
            try:
                with open(self.config.state_path, "r", encoding="utf-8") as f:
                    self._state = json.load(f)
                self.logger.info(
                    f"[STATE MACHINE] Loaded existing pipeline state from {self.config.state_path}"
                )
            except (json.JSONDecodeError, OSError):
                self.logger.warning(
                    "Could not load pipeline state — starting fresh."
                )
                self._state = {}
        else:
            self._state = {}
