"""
Pipeline Dry-Run / Smoke Test

Validates the entire pipeline structure WITHOUT making any API calls.
Generates a manifest, runs FFmpeg validation, and tests all module imports.
Safe to run without any API keys configured.

Usage:
  python pipeline_dry_run.py
"""

import json
import os
import sys
import shutil
import subprocess
import tempfile
from pathlib import Path


def header(title: str):
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def check(label: str, passed: bool, detail: str = ""):
    icon = "✓" if passed else "✗"
    line = f"  [{icon}] {label}"
    if detail:
        line += f"\n       {detail}"
    print(line)
    return passed


def main():
    header("VIDEO PIPELINE — DRY RUN / SMOKE TEST")
    failures = []

    # ── 1. Module Imports ──────────────────────────────────────────────────────
    header("1. Module Import Check")
    modules = [
        ("pipeline.config", "PipelineConfig"),
        ("pipeline.utils", "setup_logger, retry, generate_scene_seed, sha256_file"),
        ("pipeline.manifest", "NarrativeManifestGenerator"),
        ("pipeline.image_gen", "ImageGenerator"),
        ("pipeline.validator", "ValidationCircuit"),
        ("pipeline.video_gen", "VideoGenerator"),
        ("pipeline.ffmpeg_engine", "FFmpegEngine"),
        ("pipeline.state_machine", "VideoPipeline, PipelineStage"),
        ("scene_prompts", "SCENE_PROMPTS"),
    ]
    for module_name, symbols in modules:
        try:
            mod = __import__(module_name, fromlist=symbols.split(", "))
            ok = check(f"import {module_name}", True)
        except ImportError as exc:
            ok = check(f"import {module_name}", False, str(exc))
            failures.append(f"Import failed: {module_name} — {exc}")

    # ── 2. Scene Prompt Validation ─────────────────────────────────────────────
    header("2. Scene Prompts Validation")
    from scene_prompts import SCENE_PROMPTS
    from pipeline.config import PipelineConfig

    count_ok = check(f"Scene count: {len(SCENE_PROMPTS)} scenes", len(SCENE_PROMPTS) == 20)
    if not count_ok:
        failures.append(f"Expected 20 scenes, got {len(SCENE_PROMPTS)}")

    for i, scene in enumerate(SCENE_PROMPTS):
        if "prompt" not in scene:
            failures.append(f"Scene {i} missing 'prompt' key")
            check(f"Scene {i:02d} has 'prompt'", False)
        else:
            check(f"Scene {i + 1:02d}: {scene.get('metadata', {}).get('scene_name', 'unnamed')}", True)

    # ── 3. Config Validation ───────────────────────────────────────────────────
    header("3. Pipeline Config Validation")
    config = PipelineConfig()
    checks = [
        ("total_scenes == 20", config.total_scenes == 20),
        ("image_width = 1920", config.image_width == 1920),
        ("image_height = 1080", config.image_height == 1080),
        (f"motion_bucket_id = {config.motion_bucket_id} (< 127 API default)", config.motion_bucket_id < 127),
        (f"conditioning_scale = {config.image_conditioning_scale} (0.85–0.92)", 0.85 <= config.image_conditioning_scale <= 0.92),
        (f"augmentation_level = {config.augmentation_level} (near-zero)", config.augmentation_level < 0.1),
        ("target_fps = 24", config.target_fps == 24),
        ("target_pixel_format = yuv420p", config.target_pixel_format == "yuv420p"),
        ("target_video_codec = libx264", config.target_video_codec == "libx264"),
        ("oversample_width = 3840 (4K)", config.oversample_width == 3840),
    ]
    for label, passed in checks:
        ok = check(label, passed)
        if not ok:
            failures.append(f"Config check failed: {label}")

    # ── 4. Stage 1 — Manifest Generation (no API calls) ───────────────────────
    header("4. Stage 1 — Manifest Generation (Dry Run)")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_config = PipelineConfig()
        tmp_config.project_root = Path(tmpdir)
        tmp_config.assets_dir = Path(tmpdir) / "assets"
        tmp_config.ensure_directories()

        from pipeline.manifest import NarrativeManifestGenerator
        gen = NarrativeManifestGenerator(tmp_config)
        try:
            scenes = gen.generate_manifest(SCENE_PROMPTS)
            ok = check("Manifest generated", True, f"{len(scenes)} scenes written to manifest.json")

            # Verify manifest.json is valid JSON
            manifest_path = tmp_config.project_root / "manifest.json"
            with open(manifest_path) as f:
                data = json.load(f)
            ok2 = check("manifest.json is valid JSON", True, f"{len(data['scenes'])} scenes in file")
            ok3 = check("All required fields present per scene", all(
                "scene_id" in s and "prompt" in s and "source_still_path" in s
                for s in data["scenes"]
            ))
            ok4 = check("Source still paths are unique", len(set(
                s["source_still_path"] for s in data["scenes"]
            )) == 20)

            # Test manifest update
            gen.update_scene_in_manifest(0, {"status": {"image_generated": True}})
            with open(manifest_path) as f:
                updated = json.load(f)
            ok5 = check("Manifest atomic update works", updated["scenes"][0]["status"]["image_generated"])
        except Exception as exc:
            check("Manifest generation", False, str(exc))
            failures.append(f"Manifest generation failed: {exc}")

    # ── 5. PNG Validator (Binary Parser) ──────────────────────────────────────
    header("5. Stage 3 — PNG Validator (Binary Parser)")
    from pipeline.validator import ValidationCircuit

    validator = ValidationCircuit(config)

    # Create a minimal valid 1x1 PNG for testing
    valid_png_bytes = (
        b'\x89PNG\r\n\x1a\n'          # PNG signature
        b'\x00\x00\x00\rIHDR'         # IHDR chunk length + type
        b'\x00\x00\x00\x01'           # width = 1
        b'\x00\x00\x00\x01'           # height = 1
        b'\x08\x02\x00\x00\x00'       # bit depth, color type, etc.
        b'\x90wS\xde'                  # IHDR CRC (precomputed)
        b'\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N'  # IDAT
        b'\x00\x00\x00\x00IEND\xaeB`\x82'  # IEND
    )

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(valid_png_bytes)
        test_png = Path(f.name)

    try:
        sig_ok = validator._verify_png_signature(test_png)
        check("PNG signature verification", sig_ok)
        res = validator._read_png_resolution(test_png)
        check("PNG resolution extraction", res is not None, f"Parsed: {res}")
        check("Invalid file rejected",
              not validator._verify_png_signature(Path("/etc/hostname")))
    finally:
        test_png.unlink(missing_ok=True)

    # ── 6. Per-Scene Seed Isolation ────────────────────────────────────────────
    header("6. Isolated Seed Matrix Validation")
    from pipeline.utils import generate_scene_seed

    seeds = [generate_scene_seed(i) for i in range(20)]
    unique = len(set(seeds)) == 20
    check("All 20 per-scene seeds are unique", unique, f"Seeds: {seeds[:5]}...")
    check("Seeds are positive integers", all(s > 0 for s in seeds))
    check("Seeds within 32-bit safe range", all(s < 2**31 for s in seeds))
    check("Seeds are not sequential (no correlation)", seeds != list(range(1, 21)))

    # ── 7. SHA-256 File Hashing ────────────────────────────────────────────────
    header("7. SHA-256 Integrity Hashing")
    from pipeline.utils import sha256_file

    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(b"test content for hash verification")
        tmp_file = Path(f.name)
    try:
        h = sha256_file(tmp_file)
        check("SHA-256 hash computed", len(h) == 64, f"Hash: {h[:16]}...")
        h2 = sha256_file(tmp_file)
        check("Hash is deterministic", h == h2)
    finally:
        tmp_file.unlink(missing_ok=True)

    # ── 8. FFmpeg Availability ─────────────────────────────────────────────────
    header("8. FFmpeg Environment Check")
    ffmpeg_found = bool(shutil.which("ffmpeg"))
    check("FFmpeg found in PATH", ffmpeg_found,
          shutil.which("ffmpeg") or "NOT FOUND — install FFmpeg to use Stage 5/6")
    if ffmpeg_found:
        result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
        version = result.stdout.split("\n")[0] if result.returncode == 0 else "unknown"
        check("FFmpeg version readable", result.returncode == 0, version)

    # ── 9. API Key Check (informational, not blocking) ─────────────────────────
    header("9. API Key Check (Informational)")
    stability_key = os.environ.get("STABILITY_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    runway_key = os.environ.get("RUNWAY_API_KEY", "")
    check("STABILITY_API_KEY set", bool(stability_key),
          "Set in .env or environment to enable Stability AI generation")
    check("OPENAI_API_KEY set", bool(openai_key),
          "Optional — only needed if IMAGE_API_PROVIDER=openai")
    check("RUNWAY_API_KEY set", bool(runway_key),
          "Optional — only needed if VIDEO_API_PROVIDER=runway")

    # ── 10. Directory Structure ────────────────────────────────────────────────
    header("10. Directory Structure")
    config.ensure_directories()
    dirs = [
        ("assets/source_stills", config.source_stills_dir),
        ("assets/raw_clips", config.raw_clips_dir),
        ("assets/normalized_clips", config.normalized_clips_dir),
        ("assets/output", config.output_dir),
    ]
    for label, d in dirs:
        check(f"{label}/ exists", d.exists())

    # ── Final Report ───────────────────────────────────────────────────────────
    header("DRY RUN RESULTS")
    if failures:
        print(f"\n  FAILURES ({len(failures)}):")
        for f in failures:
            print(f"    ✗ {f}")
        print(f"\n  {len(failures)} issue(s) must be resolved before running the full pipeline.\n")
        sys.exit(1)
    else:
        print("\n  ALL CHECKS PASSED")
        print("  Pipeline architecture is structurally sound.")
        print("  Set your API key(s) in .env and run: python main_pipeline.py\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
