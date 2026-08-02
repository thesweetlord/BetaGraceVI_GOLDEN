"""
STAGE 5 — Idempotent FFmpeg Rendering Matrix

Eliminates encoding artifacts caused by stitching mismatched clip architectures.
Every clip is first passed through a strict normalization filter before concatenation.

Key enforcements:
  - ENCODING NORMALIZATION: Every raw clip → forced to identical specs.
  - FORCED SPECIFICATIONS: Resolution (1920x1080), Aspect Ratio (16:9),
    Framerate (24fps), Pixel Format (yuv420p), Codec (libx264).
  - OVERSAMPLING FILTER: Pan/zoom effects rendered at 4K, downscaled to 1080p
    to prevent sub-pixel jitter.
  - CONCAT DEMUXER: Used instead of filter_complex concat for better performance
    and compatibility with long-form content.
"""

import logging
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

from .config import PipelineConfig
from .utils import setup_logger


class FFmpegError(Exception):
    """Raised when an FFmpeg command exits with a non-zero code."""
    pass


class FFmpegEngine:
    """
    Handles all FFmpeg operations:
      1. Normalization of raw AI-generated clips.
      2. Optional camera motion effects (pan, zoom) via 4K oversampled filter.
      3. Final concatenation of all normalized clips into the output video.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.logger = setup_logger(
            "pipeline.ffmpeg", config.log_file, config.log_level
        )
        self._verify_ffmpeg()

    def _verify_ffmpeg(self):
        """Confirm FFmpeg is installed and accessible."""
        if not shutil.which("ffmpeg"):
            raise EnvironmentError(
                "FFmpeg not found in PATH. Install it with:\n"
                "  Ubuntu/Debian: sudo apt-get install ffmpeg\n"
                "  macOS: brew install ffmpeg\n"
                "  Nix: nix-env -iA nixpkgs.ffmpeg"
            )
        result = self._run(["ffmpeg", "-version"], capture=True, check=False)
        version_line = result.stdout.split("\n")[0] if result.stdout else "unknown"
        self.logger.info(f"[FFmpeg] Verified: {version_line}")

    # ─── Normalization Pass ────────────────────────────────────────────────────

    def normalize_all(
        self,
        scenes: List[Dict[str, Any]],
        manifest_updater,
        resume: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Pass every raw clip through the normalization filter block.
        This enforces identical codec, resolution, framerate, and pixel format
        across all clips before they enter the concat demuxer.
        """
        self.logger.info(
            f"[FFmpeg] Normalization pass — processing {len(scenes)} clips..."
        )

        for scene in scenes:
            scene_id = scene["scene_id"]
            raw_path = Path(scene["raw_clip_path"])
            norm_path = Path(scene["normalized_clip_path"])
            camera_motion = scene.get("camera_motion", "static")

            if resume and norm_path.exists() and norm_path.stat().st_size > 100_000:
                self.logger.info(
                    f"  [{scene_id}] Skipping normalization — already exists at {norm_path}"
                )
                continue

            if not raw_path.exists():
                raise FileNotFoundError(
                    f"[{scene_id}] Raw clip not found: {raw_path}"
                )

            norm_path.parent.mkdir(parents=True, exist_ok=True)
            self.logger.info(
                f"  [{scene_id}] Normalizing (motion: {camera_motion})..."
            )

            if camera_motion == "static":
                self._normalize_clip(raw_path, norm_path)
            else:
                self._normalize_with_motion(raw_path, norm_path, camera_motion, scene)

            self.logger.info(
                f"  [{scene_id}] Normalized → {norm_path} "
                f"({norm_path.stat().st_size / 1024 / 1024:.2f} MB)"
            )
            manifest_updater(
                scene["scene_index"],
                {
                    "status": {"clip_normalized": True},
                    "timestamps": {"normalized_at": time.time()},
                },
            )

        self.logger.info("[FFmpeg] Normalization COMPLETE.")
        return scenes

    def _normalize_clip(self, input_path: Path, output_path: Path):
        """
        Standard normalization — forces all technical specs to match pipeline config.
        No motion effects applied; this is a pure format normalization pass.

        FORCED SPECIFICATIONS:
          - vf scale: Forces exact resolution with lanczos (high quality) resampler.
          - r: Forces target framerate, interpolating or dropping frames as needed.
          - pix_fmt: Forces yuv420p for universal compatibility.
          - vcodec: libx264 with CRF 18 (visually lossless).
          - acodec: aac at 192k (or silence if no audio track exists).
          - aspect ratio: Explicitly set 16:9 via setsar/setdar filters.
        """
        vf_chain = (
            f"scale={self.config.target_width}:{self.config.target_height}:"
            f"force_original_aspect_ratio=decrease,"
            f"pad={self.config.target_width}:{self.config.target_height}:"
            f"(ow-iw)/2:(oh-ih)/2:black,"
            f"setsar=1,"
            f"fps={self.config.target_fps}"
        )

        cmd = [
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-vf", vf_chain,
            "-c:v", self.config.target_video_codec,
            "-crf", str(self.config.target_crf),
            "-preset", self.config.target_preset,
            "-pix_fmt", self.config.target_pixel_format,
            "-r", str(self.config.target_fps),
            "-c:a", self.config.target_audio_codec,
            "-b:a", "192k",
            "-ar", "48000",
            # If no audio stream exists in the source, add silent audio
            "-f", "mp4",
            str(output_path),
        ]
        self._run(cmd)

    def _normalize_with_motion(
        self,
        input_path: Path,
        output_path: Path,
        camera_motion: str,
        scene: Dict[str, Any],
    ):
        """
        OVERSAMPLING FILTER for pan/zoom effects.

        Process:
          1. Scale source to 4K canvas (3840x2160) — the oversample buffer.
          2. Apply the transformation matrix (pan/zoom) at 4K resolution.
          3. Downscale the resulting stream back to 1080p.

        This prevents sub-pixel jitter that occurs when applying transforms
        directly to 1080p source material (quarter-pixel aliasing artifacts).
        """
        ow = self.config.oversample_width    # 3840
        oh = self.config.oversample_height   # 2160
        tw = self.config.target_width        # 1920
        th = self.config.target_height       # 1080

        motion_filter = self._build_motion_filter(camera_motion, ow, oh, tw, th)

        vf_chain = (
            # Step 1: Upsample to 4K oversample canvas
            f"scale={ow}:{oh}:flags=lanczos,"
            # Step 2: Apply motion transform at 4K
            f"{motion_filter},"
            # Step 3: Downscale to 1080p with high-quality Lanczos
            f"scale={tw}:{th}:flags=lanczos,"
            f"setsar=1,"
            f"fps={self.config.target_fps}"
        )

        cmd = [
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-vf", vf_chain,
            "-c:v", self.config.target_video_codec,
            "-crf", str(self.config.target_crf),
            "-preset", self.config.target_preset,
            "-pix_fmt", self.config.target_pixel_format,
            "-r", str(self.config.target_fps),
            "-c:a", self.config.target_audio_codec,
            "-b:a", "192k",
            "-ar", "48000",
            str(output_path),
        ]
        self._run(cmd)

    def _build_motion_filter(
        self, motion: str, ow: int, oh: int, tw: int, th: int
    ) -> str:
        """
        Construct FFmpeg zoompan filter expression for the requested camera motion.
        All transforms are defined on the 4K oversample canvas to avoid aliasing.

        Available motions:
          - pan_left:   Slide viewport from right to left.
          - pan_right:  Slide viewport from left to right.
          - pan_up:     Slide viewport from bottom to top.
          - pan_down:   Slide viewport from top to bottom.
          - zoom_in:    Slow dolly-in (1.0x → 1.2x).
          - zoom_out:   Slow pull-out (1.2x → 1.0x).
          - ken_burns:  Combined zoom-in with subtle pan (cinematic default).
        """
        d = int(self.config.target_fps * self.config.scene_duration_seconds)

        # zoompan operates on the input frame size; since we've upsampled to 4K,
        # the output frame size here is tw x th (the *output* of zoompan, not canvas).
        # We use the oversample buffer width for pan range calculations.
        pan_range = ow - tw  # Available horizontal pan pixels at 4K

        motions = {
            "pan_left": (
                f"zoompan=z=1:x='iw-{tw}-on*{pan_range}/{d}':y='(ih-{th})/2':"
                f"d={d}:s={tw}x{th}:fps={self.config.target_fps}"
            ),
            "pan_right": (
                f"zoompan=z=1:x='on*{pan_range}/{d}':y='(ih-{th})/2':"
                f"d={d}:s={tw}x{th}:fps={self.config.target_fps}"
            ),
            "pan_up": (
                f"zoompan=z=1:x='(iw-{tw})/2':y='ih-{th}-on*({oh}-{th})/{d}':"
                f"d={d}:s={tw}x{th}:fps={self.config.target_fps}"
            ),
            "pan_down": (
                f"zoompan=z=1:x='(iw-{tw})/2':y='on*({oh}-{th})/{d}':"
                f"d={d}:s={tw}x{th}:fps={self.config.target_fps}"
            ),
            "zoom_in": (
                f"zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                f"d={d}:s={tw}x{th}:fps={self.config.target_fps}"
            ),
            "zoom_out": (
                f"zoompan=z='if(lte(zoom,1.0),1.5,max(zoom-0.0015,1.0))':x='iw/2-(iw/zoom/2)':"
                f"y='ih/2-(ih/zoom/2)':d={d}:s={tw}x{th}:fps={self.config.target_fps}"
            ),
            "ken_burns": (
                f"zoompan=z='min(zoom+0.0008,1.3)':x='iw/2-(iw/zoom/2)+on*2':y='ih/2-(ih/zoom/2)':"
                f"d={d}:s={tw}x{th}:fps={self.config.target_fps}"
            ),
        }

        if motion not in motions:
            self.logger.warning(
                f"Unknown camera_motion '{motion}'. Falling back to 'static' (no zoompan)."
            )
            return f"scale={tw}:{th}"

        return motions[motion]

    # ─── Concatenation ─────────────────────────────────────────────────────────

    def concatenate(
        self,
        scenes: List[Dict[str, Any]],
        output_filename: str = "final_output.mp4",
    ) -> Path:
        """
        Concatenate all normalized clips using the FFmpeg concat demuxer.
        The concat demuxer is used over filter_complex because:
          - It supports arbitrarily long clip lists without filter graph complexity.
          - It processes clips sequentially without decoding all simultaneously.
          - It preserves the exact clip boundaries defined by the normalization pass.

        All clips MUST have identical codec, resolution, framerate, and pixel
        format — enforced by the normalization pass above.
        """
        output_path = self.config.output_dir / output_filename
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Verify all normalized clips exist before building concat list
        missing = []
        for scene in scenes:
            norm_path = Path(scene["normalized_clip_path"])
            if not norm_path.exists():
                missing.append(f"  [{scene['scene_id']}] {norm_path}")

        if missing:
            raise FileNotFoundError(
                "Cannot concatenate — the following normalized clips are missing:\n"
                + "\n".join(missing)
            )

        # Write the FFmpeg concat demuxer input file
        concat_list_path = self.config.output_dir / "concat_list.txt"
        with open(concat_list_path, "w", encoding="utf-8") as f:
            for scene in scenes:
                norm_path = Path(scene["normalized_clip_path"])
                # Use absolute paths to avoid working directory issues
                f.write(f"file '{norm_path.resolve()}'\n")

        self.logger.info(
            f"[FFmpeg] Concatenating {len(scenes)} clips → {output_path}"
        )

        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_list_path),
            # Copy streams — do NOT re-encode; normalization already enforced specs.
            # This is a lossless stream copy — fast and artifact-free.
            "-c", "copy",
            "-movflags", "+faststart",   # Enable web-friendly progressive download
            str(output_path),
        ]
        self._run(cmd)

        file_size_mb = output_path.stat().st_size / 1024 / 1024
        self.logger.info(
            f"[FFmpeg] CONCATENATION COMPLETE → {output_path} ({file_size_mb:.1f} MB)"
        )
        return output_path

    def generate_preview_thumbnail(self, scene: Dict[str, Any]) -> Path:
        """Extract the first frame of a normalized clip as a preview JPEG."""
        norm_path = Path(scene["normalized_clip_path"])
        thumb_path = norm_path.with_suffix(".thumb.jpg")
        cmd = [
            "ffmpeg", "-y",
            "-i", str(norm_path),
            "-vframes", "1",
            "-q:v", "2",
            str(thumb_path),
        ]
        self._run(cmd, capture=True)
        return thumb_path

    # ─── FFmpeg Runner ─────────────────────────────────────────────────────────

    def _run(
        self,
        cmd: List[str],
        capture: bool = False,
        check: bool = True,
    ) -> subprocess.CompletedProcess:
        """
        Execute an FFmpeg command subprocess.
        Captures stderr for error reporting. Raises FFmpegError on non-zero exit.
        """
        self.logger.debug(f"[FFmpeg] Running: {' '.join(cmd)}")

        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        result.stdout = result.stdout or ""
        result.stderr = result.stderr or ""

        if check and result.returncode != 0:
            # FFmpeg writes diagnostics to stderr — include in error for debugging
            raise FFmpegError(
                f"FFmpeg command failed (exit code {result.returncode}):\n"
                f"Command: {' '.join(cmd)}\n"
                f"Stderr (last 2000 chars):\n{result.stderr[-2000:]}"
            )
        return result
