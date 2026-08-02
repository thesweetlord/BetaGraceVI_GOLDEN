# BetaGrace — a multistack AI Agent, a sophisticated API wrapper with 8 modes.
# Copyright (C) 2026  Jesse James Wheeler Jr.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

"""
Main Pipeline Entry Point

Run this script to execute the full 20-scene video generation pipeline.

Usage:
  python main_pipeline.py                     # Full pipeline run
  python main_pipeline.py --stage 1           # Generate manifest only
  python main_pipeline.py --stage 3           # Re-run validation only
  python main_pipeline.py --stage 5           # Re-run FFmpeg normalization + concat
  python main_pipeline.py --resume            # Resume interrupted run
  python main_pipeline.py --no-resume         # Force full re-run from scratch
  python main_pipeline.py --from-stage 4      # Resume from a specific stage

Environment Variables (set in .env or shell):
  STABILITY_API_KEY       — Required for Stability AI (image + video generation)
  IMAGE_API_PROVIDER      — 'stability' (default) or 'openai'
  VIDEO_API_PROVIDER      — 'stability' (default) or 'runway'
  LOG_LEVEL               — DEBUG, INFO (default), WARNING, ERROR
"""

import argparse
import logging
import os
import sys
from pathlib import Path

# Load .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from pipeline import VideoPipeline, PipelineConfig
from scene_prompts import SCENE_PROMPTS


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="20-Scene Automated Video Generation Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--stage",
        type=int,
        choices=[1, 3, 5],
        default=None,
        help="Run a single isolated stage (1=manifest, 3=validate, 5=ffmpeg only)",
    )
    parser.add_argument(
        "--from-stage",
        type=int,
        choices=[1, 2, 3, 4, 5, 6],
        default=1,
        dest="from_stage",
        help="Resume the full pipeline starting from a specific stage number",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        default=True,
        help="Skip already-completed work (default: True)",
    )
    parser.add_argument(
        "--no-resume",
        action="store_false",
        dest="resume",
        help="Force full pipeline re-run, ignoring prior work",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="final_output.mp4",
        help="Output filename for the final concatenated video",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Print current pipeline status and exit",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    config = PipelineConfig()
    pipeline = VideoPipeline(config)

    # ── Status report only ────────────────────────────────────────────────────
    if args.status:
        import json
        status = pipeline.get_status()
        print(json.dumps(status, indent=2))
        return

    # ── Single-stage isolated runs ─────────────────────────────────────────────
    if args.stage == 1:
        print("[Pipeline] Running Stage 1 (Narrative Manifest) only...")
        scenes = pipeline.run_stage_1_only(SCENE_PROMPTS)
        print(f"[Pipeline] Manifest written with {len(scenes)} scenes → manifest.json")
        return

    if args.stage == 3:
        print("[Pipeline] Running Stage 3 (Validation Circuit) only...")
        pipeline.run_stage_3_only()
        print("[Pipeline] All source stills validated.")
        return

    if args.stage == 5:
        print("[Pipeline] Running Stage 5+6 (FFmpeg Normalization + Concatenation) only...")
        output = pipeline.run_ffmpeg_only(output_filename=args.output)
        print(f"[Pipeline] Output → {output}")
        return

    # ── Full pipeline run ──────────────────────────────────────────────────────
    print(f"[Pipeline] Starting full pipeline from Stage {args.from_stage}...")
    output_path = pipeline.run(
        scene_prompts=SCENE_PROMPTS,
        output_filename=args.output,
        resume=args.resume,
        start_from_stage=args.from_stage,
    )
    print(f"\n[Pipeline] SUCCESS — Final video: {output_path}")


if __name__ == "__main__":
    main()
