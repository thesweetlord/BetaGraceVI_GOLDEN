"""
STAGE 2 — The Structural Anchor

Iterates through the manifest and generates 20 high-fidelity PNG source stills.
These images are the immutable first-frame anchors for every video clip.
Structural fidelity here directly determines downstream video quality.
"""

import base64
import logging
import time
from pathlib import Path
from typing import Dict, Any, Optional

import requests

from .config import PipelineConfig
from .utils import setup_logger, retry, generate_scene_seed, format_scene_id


class ImageGenerator:
    """
    Calls the configured text-to-image API to generate source stills.
    Output is always a high-resolution PNG saved to /assets/source_stills/.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.logger = setup_logger(
            "pipeline.image_gen", config.log_file, config.log_level
        )
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {config.image_api_key}",
            "Accept": "image/*",
        })

    def generate_all(
        self,
        scenes: list,
        manifest_updater,
        resume: bool = True,
    ) -> list:
        """
        Generate source stills for all scenes.
        If resume=True, skips scenes whose PNG already exists on disk (idempotent).
        Returns the updated scenes list.
        """
        self.logger.info(
            f"[STAGE 2] Structural Anchor — generating {len(scenes)} source stills..."
        )
        results = []
        for scene in scenes:
            idx = scene["scene_index"]
            output_path = Path(scene["source_still_path"])

            if resume and output_path.exists() and output_path.stat().st_size > self.config.min_file_size_bytes:
                self.logger.info(
                    f"  [{scene['scene_id']}] Skipping — PNG already exists at {output_path}"
                )
                results.append(scene)
                continue

            self.logger.info(
                f"  [{scene['scene_id']}] Generating image ({idx + 1}/{len(scenes)})..."
            )
            try:
                png_bytes = self._generate_image(scene)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(png_bytes)
                self.logger.info(
                    f"  [{scene['scene_id']}] Saved → {output_path} "
                    f"({len(png_bytes) / 1024:.1f} KB)"
                )
                # Record generation timestamp in manifest
                manifest_updater(
                    idx,
                    {
                        "status": {"image_generated": True},
                        "timestamps": {"image_generated_at": time.time()},
                    },
                )
            except Exception as exc:
                self.logger.error(
                    f"  [{scene['scene_id']}] FAILED to generate image: {exc}"
                )
                raise

            results.append(scene)
        self.logger.info("[STAGE 2] COMPLETE — all source stills generated.")
        return results

    @retry(max_attempts=3, delay=5.0)
    def _generate_image(self, scene: Dict[str, Any]) -> bytes:
        """
        Call the text-to-image API for a single scene.
        Returns raw PNG bytes.
        """
        seed = generate_scene_seed(scene["scene_index"])
        provider = self.config.image_api_provider.lower()

        if provider == "stability":
            return self._call_stability_t2i(scene, seed)
        elif provider == "openai":
            return self._call_openai_t2i(scene)
        else:
            raise NotImplementedError(
                f"Image API provider '{provider}' is not implemented. "
                "Supported: 'stability', 'openai'"
            )

    def _call_stability_t2i(self, scene: Dict[str, Any], seed: int) -> bytes:
        """Stability AI Stable Diffusion 3 text-to-image."""
        payload = {
            "prompt": scene["prompt"],
            "negative_prompt": scene["negative_prompt"],
            "mode": "text-to-image",
            "width": self.config.image_width,
            "height": self.config.image_height,
            "cfg_scale": scene.get("image_cfg_scale", self.config.image_cfg_scale),
            "steps": scene.get("image_steps", self.config.image_steps),
            "seed": seed,
            "output_format": "png",
        }
        if scene.get("style_preset"):
            payload["style_preset"] = scene["style_preset"]

        response = self._session.post(
            self.config.image_api_base_url,
            headers={
                "Authorization": f"Bearer {self.config.image_api_key}",
                "Accept": "image/*",
            },
            files={"none": ""},
            data=payload,
            timeout=120,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"Stability T2I API error {response.status_code}: {response.text[:500]}"
            )
        return response.content

    def _call_openai_t2i(self, scene: Dict[str, Any]) -> bytes:
        """OpenAI DALL-E 3 text-to-image (returns URL, downloads PNG)."""
        import json as _json

        headers = {
            "Authorization": f"Bearer {self.config.image_api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": "dall-e-3",
            "prompt": scene["prompt"],
            "n": 1,
            "size": "1792x1024",
            "quality": "hd",
            "response_format": "url",
        }
        response = self._session.post(
            "https://api.openai.com/v1/images/generations",
            headers=headers,
            json=body,
            timeout=120,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"OpenAI T2I API error {response.status_code}: {response.text[:500]}"
            )
        image_url = response.json()["data"][0]["url"]
        img_response = self._session.get(image_url, timeout=60)
        img_response.raise_for_status()
        return img_response.content
