"""
STAGE 4 — The Kinematic Render (KINEMATIC LOCKDOWN EDITION)

Processes validated source stills through the I2V generation loop under four
hard-coded rules that absolutely guarantee temporal consistency and eliminate
'Latent Overwrite' — the condition where text conditioning overpowers init_image.

═══════════════════════════════════════════════════════════════════════════════
  KINEMATIC LOCKDOWN — THE 4 IMMUTABLE RULES
═══════════════════════════════════════════════════════════════════════════════

  RULE 1 │ PROMPT STRIPPING (Null-Text Conditioning)
          │ Stage 2 gets the full narrative prompt. Stage 4 gets NOTHING but
          │ 3–5 mechanical motion words. Narrative text fed into I2V overwrites
          │ the init_image by shifting the latent space toward a new semantic
          │ target. The fix: starve the text encoder.
          │ Payload → prompt: "subtle cinematic motion, static camera"

  RULE 2 │ NEGATIVE PROMPT PURGE
          │ Massive negative arrays mathematically dilute the init_image weight
          │ by splitting the guidance vector across too many targets.
          │ Hard cap: exactly 5 structural anti-hallucination keywords.
          │ Payload → negative_prompt: "morphing, text, distortion, mutations, jitter"

  RULE 3 │ CFG & DENOISING INVERSION
          │ CFG scale (text guidance scale) at default (7–9) tells the model to
          │ aggressively pursue the text target. At 2.5–3.5, the model nearly
          │ ignores text and defers entirely to the image conditioning signal.
          │ image_weight → 0.95   (maximum structural anchor to Frame 0)
          │ denoising_strength → 0.35  (65% of output IS the init_image signal)
          │ cfg_scale → 3.0       (text signal near-muted)

  RULE 4 │ CONTEXT WINDOW CAPPING
          │ Long-tail generation causes structural decay — the model 'forgets'
          │ Frame 0 as the context window deepens. Hard cap at 14–25 frames
          │ (~1–2 seconds). Perfect 2-second clips are assembled into full
          │ duration via FFmpeg slow-motion interpolation / looping.
          │ num_frames → 25 (hard cap)

═══════════════════════════════════════════════════════════════════════════════
"""

import base64
import logging
import time
from pathlib import Path
from typing import Dict, Any, List

import requests

from .config import PipelineConfig
from .utils import setup_logger, retry, generate_scene_seed


# ─── Kinematic Lockdown Constants ─────────────────────────────────────────────
# These are NOT pulled from scene metadata. They are HARDCODED at the call site.
# Any attempt to override them with scene-level prompt data is a pipeline bug.

_I2V_STRIPPED_PROMPT = "subtle cinematic motion, static camera"
_I2V_PURGED_NEGATIVE  = "morphing, text, distortion, mutations, jitter"


class VideoGenerator:
    """
    Calls the configured Image-to-Video API for each validated scene still.
    All four Kinematic Lockdown rules are enforced at payload construction time —
    NOT as optional config values, but as hard constants in the call itself.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.logger = setup_logger(
            "pipeline.video_gen", config.log_file, config.log_level
        )
        self._session = requests.Session()

    # ─── Public Interface ──────────────────────────────────────────────────────

    def generate_all(
        self,
        scenes: List[Dict[str, Any]],
        manifest_updater,
        resume: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Generate video clips for all validated scenes sequentially.
        Sequential processing ensures API rate limits are respected and each
        clip's generation can be independently monitored and retried.
        """
        self.logger.info(
            f"[STAGE 4] Kinematic Render (LOCKDOWN) — {len(scenes)} scenes → I2V"
        )
        self._log_lockdown_parameters()

        for scene in scenes:
            idx      = scene["scene_index"]
            scene_id = scene["scene_id"]
            raw_path = Path(scene["raw_clip_path"])
            still    = Path(scene["source_still_path"])

            if resume and raw_path.exists() and raw_path.stat().st_size > 100_000:
                self.logger.info(f"  [{scene_id}] Skip — raw clip exists at {raw_path}")
                continue

            if not still.exists():
                raise FileNotFoundError(
                    f"[{scene_id}] Source still missing: {still}. "
                    "Stage 3 validation should have caught this."
                )

            self.logger.info(
                f"  [{scene_id}] Submitting I2V ({idx + 1}/{len(scenes)})..."
            )
            try:
                video_bytes = self._generate_video_clip(scene)
                raw_path.parent.mkdir(parents=True, exist_ok=True)
                raw_path.write_bytes(video_bytes)
                self.logger.info(
                    f"  [{scene_id}] Saved → {raw_path} "
                    f"({len(video_bytes) / 1024 / 1024:.2f} MB)"
                )
                manifest_updater(
                    idx,
                    {
                        "status":     {"video_generated": True},
                        "timestamps": {"video_generated_at": time.time()},
                    },
                )
            except Exception as exc:
                self.logger.error(f"  [{scene_id}] I2V FAILED: {exc}")
                raise

        self.logger.info("[STAGE 4] COMPLETE — all raw clips generated.")
        return scenes

    @retry(max_attempts=3, delay=10.0)
    def _generate_video_clip(self, scene: Dict[str, Any]) -> bytes:
        provider = self.config.video_api_provider.lower()
        if provider == "stability":
            return self._call_stability_i2v(scene)
        elif provider == "runway":
            return self._call_runway_i2v(scene)
        else:
            raise NotImplementedError(
                f"Video provider '{provider}' not implemented. "
                "Supported: 'stability', 'runway'"
            )

    # ─── Lockdown Payload Builder ──────────────────────────────────────────────

    def _build_i2v_payload(self, scene: Dict[str, Any]) -> Dict[str, Any]:
        """
        THE SINGLE AUTHORITATIVE PAYLOAD CONSTRUCTION FUNCTION.

        All four Kinematic Lockdown rules are applied here and ONLY here.
        No other method may inject scene prompts, negative text, CFG values,
        or frame counts into the video API payload.

        Rule 1 — PROMPT STRIPPING:
            The scene's full `prompt` field is NEVER read here.
            Only the 3-word mechanical constant is used.

        Rule 2 — NEGATIVE PROMPT PURGE:
            The scene's `negative_prompt` field is NEVER read here.
            Only the 5-keyword structural constant is used.

        Rule 3 — CFG & DENOISING INVERSION:
            cfg_scale      → 3.0  (near-muted text guidance)
            image_weight   → 0.95 (Frame 0 anchor maximized)
            denoising      → 0.35 (65% init_image signal preserved)

        Rule 4 — CONTEXT WINDOW CAPPING:
            num_frames     → 25   (hard cap, never exceeded)
        """
        return {
            # ── RULE 1: Stripped prompt — mechanical motion words ONLY ──────────
            "prompt":           _I2V_STRIPPED_PROMPT,

            # ── RULE 2: Purged negative — 5 structural keywords ONLY ────────────
            "negative_prompt":  _I2V_PURGED_NEGATIVE,

            # ── RULE 3: CFG inversion ────────────────────────────────────────────
            "cfg_scale":        self.config.i2v_cfg_scale,          # 3.0
            "image_weight":     self.config.i2v_image_weight,       # 0.95
            "denoising_strength": self.config.i2v_denoising_strength,  # 0.35

            # ── RULE 4: Frame cap ────────────────────────────────────────────────
            "num_frames":       self.config.i2v_num_frames,         # 25
            "fps":              self.config.i2v_fps,                # 25

            # ── Existing structural anchors (preserved) ──────────────────────────
            "motion_bucket_id": scene.get("motion_bucket_id", self.config.motion_bucket_id),
            "augmentation_level": self.config.augmentation_level,
            "seed":             generate_scene_seed(scene["scene_index"]),
        }

    # ─── Stability AI — Stable Video Diffusion ────────────────────────────────

    def _call_stability_i2v(self, scene: Dict[str, Any]) -> bytes:
        """
        Stability AI SVD Image-to-Video — Kinematic Lockdown edition.

        SVD is a pure image-conditioned model — it was not designed to process
        long text prompts. Its text encoder is vestigial; passing heavy text
        through it destabilizes the init_image weighting.

        Payload is sourced exclusively from _build_i2v_payload().
        No scene prompt data enters this function.
        """
        source_still = Path(scene["source_still_path"])
        payload      = self._build_i2v_payload(scene)

        self.logger.debug(
            f"    [{scene['scene_id']}] SVD payload: "
            f"prompt='{payload['prompt']}' | "
            f"cfg={payload['cfg_scale']} | "
            f"img_weight={payload['image_weight']} | "
            f"denoise={payload['denoising_strength']} | "
            f"frames={payload['num_frames']} | "
            f"motion_bucket={payload['motion_bucket_id']}"
        )

        with open(source_still, "rb") as f:
            image_data = f.read()

        response = self._session.post(
            self.config.video_api_base_url,
            headers={"Authorization": f"Bearer {self.config.video_api_key}"},
            files={
                # FIRST-FRAME CONSTRAINT: init_image is the primary input, not a hint
                "image": (source_still.name, image_data, "image/png"),
            },
            data={
                # RULE 1 — stripped prompt only
                "text_prompts[0][text]":   payload["prompt"],
                "text_prompts[0][weight]": "0.1",        # Near-zero text weight
                # RULE 2 — purged negative only
                "text_prompts[1][text]":   payload["negative_prompt"],
                "text_prompts[1][weight]": "-1",
                # RULE 3 — inverted CFG & denoising
                "cfg_scale":              str(payload["cfg_scale"]),
                "motion_bucket_id":       str(payload["motion_bucket_id"]),
                "augmentation_level":     str(payload["augmentation_level"]),
                # RULE 4 — frame cap (SVD uses video_length as frame count alias)
                "video_length":           str(payload["num_frames"]),
                # Isolated per-scene seed
                "seed":                   str(payload["seed"]),
            },
            timeout=60,
        )

        if response.status_code != 200:
            raise RuntimeError(
                f"SVD submission failed ({response.status_code}): "
                f"{response.text[:500]}"
            )

        generation_id = response.json().get("id")
        if not generation_id:
            raise RuntimeError(
                f"SVD returned no generation ID. Response: {response.text[:300]}"
            )

        self.logger.info(
            f"    [{scene['scene_id']}] SVD job ID: {generation_id} — polling..."
        )
        return self._poll_stability_result(generation_id, scene["scene_id"])

    def _poll_stability_result(self, generation_id: str, scene_id: str) -> bytes:
        """Poll Stability AI async endpoint until video is ready."""
        poll_url = f"{self.config.video_poll_base_url}/{generation_id}"
        headers  = {
            "Authorization": f"Bearer {self.config.video_api_key}",
            "Accept": "video/*",
        }
        deadline = time.time() + self.config.video_poll_timeout_seconds
        attempt  = 0

        while time.time() < deadline:
            attempt += 1
            resp = self._session.get(poll_url, headers=headers, timeout=30)

            if resp.status_code == 200:
                ctype = resp.headers.get("content-type", "")
                if "video" in ctype or len(resp.content) > 100_000:
                    self.logger.info(
                        f"    [{scene_id}] Ready after {attempt} poll(s) — "
                        f"{len(resp.content) / 1024 / 1024:.2f} MB"
                    )
                    return resp.content
            elif resp.status_code == 202:
                reason = resp.json().get("finish_reason", "in-progress")
                self.logger.info(f"    [{scene_id}] Processing (poll {attempt}): {reason}")
            elif resp.status_code == 404:
                raise RuntimeError(f"[{scene_id}] Generation ID {generation_id} not found.")
            else:
                self.logger.warning(
                    f"    [{scene_id}] Poll status {resp.status_code} — retrying..."
                )

            time.sleep(self.config.video_poll_interval_seconds)

        raise TimeoutError(
            f"[{scene_id}] Timed out after {self.config.video_poll_timeout_seconds}s. "
            f"ID: {generation_id}"
        )

    # ─── Runway ML — Gen-3 Alpha Image-to-Video ───────────────────────────────

    def _call_runway_i2v(self, scene: Dict[str, Any]) -> bytes:
        """
        Runway ML Gen-3 Alpha I2V — Kinematic Lockdown edition.

        Runway's text encoder is extremely powerful — it will aggressively
        recompose the frame toward any narrative text it receives. Lockdown
        eliminates this by feeding it only the 3-word mechanical prompt and
        maximizing imageWeight to 0.95.

        duration is derived from num_frames / fps rather than scene metadata
        to enforce the Rule 4 frame cap consistently across providers.
        """
        source_still = Path(scene["source_still_path"])
        payload      = self._build_i2v_payload(scene)

        # Derive capped duration from frame cap — never from scene_duration_seconds
        capped_duration_seconds = payload["num_frames"] / payload["fps"]  # e.g. 25/25 = 1.0s
        # Runway minimum is 2s; clamp up but never above the frame-cap equivalent
        runway_duration = max(2, min(int(capped_duration_seconds), 4))

        image_b64 = base64.b64encode(source_still.read_bytes()).decode("utf-8")

        self.logger.debug(
            f"    [{scene['scene_id']}] Runway payload: "
            f"promptText='{payload['prompt']}' | "
            f"imageWeight={payload['image_weight']} | "
            f"duration={runway_duration}s (capped from {capped_duration_seconds:.1f}s) | "
            f"cfg={payload['cfg_scale']}"
        )

        body = {
            "model": "gen3a_turbo",
            # FIRST-FRAME CONSTRAINT: source PNG as base64 primary anchor
            "promptImage": f"data:image/png;base64,{image_b64}",
            # RULE 1 — stripped prompt: 3 mechanical words, NOT the scene description
            "promptText": payload["prompt"],
            # RULE 3 — image weight maximized to 0.95; text guidance scale minimized
            "imageWeight": payload["image_weight"],
            # RULE 4 — duration capped from frame count, not scene_duration_seconds
            "duration": runway_duration,
            "ratio": "1280:768",
            "seed": payload["seed"],
        }

        resp = self._session.post(
            "https://api.dev.runwayml.com/v1/image_to_video",
            headers={
                "Authorization":  f"Bearer {self.config.video_api_key}",
                "Content-Type":   "application/json",
                "X-Runway-Version": "2024-11-06",
            },
            json=body,
            timeout=60,
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"Runway submission failed ({resp.status_code}): {resp.text[:500]}"
            )

        task_id = resp.json().get("id")
        self.logger.info(f"    [{scene['scene_id']}] Runway task: {task_id} — polling...")
        return self._poll_runway_result(task_id, scene["scene_id"])

    def _poll_runway_result(self, task_id: str, scene_id: str) -> bytes:
        """Poll Runway ML task endpoint until video is complete."""
        poll_url = f"https://api.dev.runwayml.com/v1/tasks/{task_id}"
        headers  = {
            "Authorization":    f"Bearer {self.config.video_api_key}",
            "X-Runway-Version": "2024-11-06",
        }
        deadline = time.time() + self.config.video_poll_timeout_seconds
        attempt  = 0

        while time.time() < deadline:
            attempt += 1
            resp = self._session.get(poll_url, headers=headers, timeout=30)
            resp.raise_for_status()
            task   = resp.json()
            status = task.get("status", "")

            if status == "SUCCEEDED":
                url = task.get("output", [None])[0]
                if not url:
                    raise RuntimeError(f"[{scene_id}] Runway succeeded but no output URL.")
                self.logger.info(
                    f"    [{scene_id}] SUCCEEDED (poll {attempt}) — downloading..."
                )
                dl = self._session.get(url, timeout=120)
                dl.raise_for_status()
                return dl.content
            elif status in ("FAILED", "CANCELLED"):
                raise RuntimeError(
                    f"[{scene_id}] Runway task {task_id} → {status}. "
                    f"Detail: {task.get('failure', 'none')}"
                )
            else:
                progress = task.get("progress", 0)
                self.logger.info(
                    f"    [{scene_id}] {status} {progress * 100:.0f}% (poll {attempt})"
                )

            time.sleep(self.config.video_poll_interval_seconds)

        raise TimeoutError(
            f"[{scene_id}] Runway task {task_id} timed out after "
            f"{self.config.video_poll_timeout_seconds}s."
        )

    # ─── Diagnostics ──────────────────────────────────────────────────────────

    def _log_lockdown_parameters(self):
        """Log the active Kinematic Lockdown configuration at pipeline start."""
        self.logger.info("  ┌─ KINEMATIC LOCKDOWN ACTIVE ──────────────────────────────")
        self.logger.info(f"  │  RULE 1 prompt    → '{_I2V_STRIPPED_PROMPT}'")
        self.logger.info(f"  │  RULE 2 negative  → '{_I2V_PURGED_NEGATIVE}'")
        self.logger.info(f"  │  RULE 3 cfg_scale → {self.config.i2v_cfg_scale}  "
                         f"(default 7–9 stripped to {self.config.i2v_cfg_scale})")
        self.logger.info(f"  │  RULE 3 img_wt    → {self.config.i2v_image_weight}  "
                         f"(Frame 0 anchor maximized)")
        self.logger.info(f"  │  RULE 3 denoise   → {self.config.i2v_denoising_strength}  "
                         f"(65% init_image signal preserved)")
        self.logger.info(f"  │  RULE 4 frames    → {self.config.i2v_num_frames} frames  "
                         f"@ {self.config.i2v_fps}fps = "
                         f"{self.config.i2v_num_frames / self.config.i2v_fps:.1f}s per clip")
        self.logger.info("  └──────────────────────────────────────────────────────────")
