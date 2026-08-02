"""
STAGE 3 — The Validation Circuit (Hard Circuit Breaker)

Verifies cryptographic existence, resolution consistency, and file integrity
of ALL 20 source stills before allowing the pipeline to advance to Stage 4.
A single failure halts the entire pipeline — no partial pipelines allowed.
"""

import logging
import struct
import zlib
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional

from .config import PipelineConfig
from .utils import setup_logger, sha256_file, format_scene_id


class ValidationError(Exception):
    """Raised when any source still fails the validation circuit."""
    pass


class ValidationCircuit:
    """
    Hard circuit-breaker for the source stills validation gate.
    All 20 stills must pass every check before Stage 4 is permitted to run.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.logger = setup_logger(
            "pipeline.validator", config.log_file, config.log_level
        )

    def run(self, scenes: List[Dict[str, Any]], manifest_updater) -> List[Dict[str, Any]]:
        """
        Execute the full validation suite against all scenes.
        Returns the scenes list with validation metadata populated.
        Raises ValidationError if ANY scene fails — the pipeline must not advance.
        """
        self.logger.info(
            f"[STAGE 3] Validation Circuit — checking {len(scenes)} source stills..."
        )

        failures: List[str] = []
        expected_resolution: Optional[Tuple[int, int]] = None

        for scene in scenes:
            scene_id = scene["scene_id"]
            still_path = Path(scene["source_still_path"])

            # ── Check 1: File Existence ────────────────────────────────────────
            if not still_path.exists():
                msg = f"[{scene_id}] MISSING: {still_path}"
                self.logger.error(msg)
                failures.append(msg)
                continue

            # ── Check 2: Minimum File Size (anti-corruption) ───────────────────
            file_size = still_path.stat().st_size
            if file_size < self.config.min_file_size_bytes:
                msg = (
                    f"[{scene_id}] TOO SMALL: {file_size} bytes "
                    f"(minimum: {self.config.min_file_size_bytes} bytes). "
                    "File is likely corrupt or truncated."
                )
                self.logger.error(msg)
                failures.append(msg)
                continue

            # ── Check 3: PNG Signature Verification ───────────────────────────
            if not self._verify_png_signature(still_path):
                msg = f"[{scene_id}] INVALID FORMAT: Not a valid PNG file at {still_path}"
                self.logger.error(msg)
                failures.append(msg)
                continue

            # ── Check 4: PNG Chunk Integrity (CRC validation) ─────────────────
            integrity_ok, integrity_msg = self._verify_png_integrity(still_path)
            if not integrity_ok:
                msg = f"[{scene_id}] CORRUPT PNG: {integrity_msg}"
                self.logger.error(msg)
                failures.append(msg)
                continue

            # ── Check 5: Resolution Extraction & Consistency ──────────────────
            resolution = self._read_png_resolution(still_path)
            if resolution is None:
                msg = f"[{scene_id}] UNREADABLE RESOLUTION: Cannot parse IHDR chunk."
                self.logger.error(msg)
                failures.append(msg)
                continue

            width, height = resolution
            if expected_resolution is None:
                expected_resolution = resolution
                self.logger.info(
                    f"  [{scene_id}] Resolution baseline established: {width}x{height}"
                )
            elif resolution != expected_resolution:
                msg = (
                    f"[{scene_id}] RESOLUTION MISMATCH: Got {width}x{height}, "
                    f"expected {expected_resolution[0]}x{expected_resolution[1]}. "
                    "All stills must have identical dimensions."
                )
                self.logger.error(msg)
                failures.append(msg)
                continue

            # ── Check 6: SHA-256 Integrity Hash ───────────────────────────────
            sha256 = sha256_file(still_path)

            # ── All checks passed — record in manifest ─────────────────────────
            self.logger.info(
                f"  [{scene_id}] PASSED — {width}x{height}, "
                f"{file_size / 1024:.1f} KB, sha256={sha256[:16]}..."
            )
            manifest_updater(
                scene["scene_index"],
                {
                    "validation": {
                        "still_sha256": sha256,
                        "still_resolution": list(resolution),
                        "still_verified": True,
                        "file_size_bytes": file_size,
                    }
                },
            )

        # ── Circuit Breaker Decision ───────────────────────────────────────────
        if failures:
            error_summary = "\n  ".join(failures)
            raise ValidationError(
                f"\n[STAGE 3] CIRCUIT BREAKER TRIPPED — {len(failures)} validation failure(s):\n"
                f"  {error_summary}\n\n"
                "Pipeline advancement to Stage 4 is BLOCKED. "
                "Regenerate the failing stills and re-run Stage 3."
            )

        self.logger.info(
            f"[STAGE 3] COMPLETE — All {len(scenes)} source stills passed validation. "
            f"Consistent resolution: {expected_resolution[0]}x{expected_resolution[1]}. "
            "Pipeline is CLEARED to advance to Stage 4."
        )
        return scenes

    # ─── PNG Binary Inspection Methods ────────────────────────────────────────

    def _verify_png_signature(self, path: Path) -> bool:
        """Check the 8-byte PNG magic number at the start of the file."""
        PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
        try:
            with open(path, "rb") as f:
                header = f.read(8)
            return header == PNG_SIGNATURE
        except OSError:
            return False

    def _read_png_resolution(self, path: Path) -> Optional[Tuple[int, int]]:
        """
        Extract width and height from the PNG IHDR chunk.
        This is a low-level binary parse — no PIL/Pillow dependency required.
        IHDR structure: length(4) + 'IHDR'(4) + width(4) + height(4) + ...
        """
        try:
            with open(path, "rb") as f:
                f.seek(8)   # Skip PNG signature
                # Read chunk length and type
                chunk_header = f.read(8)
                if len(chunk_header) < 8:
                    return None
                length = struct.unpack(">I", chunk_header[:4])[0]
                chunk_type = chunk_header[4:8]
                if chunk_type != b"IHDR":
                    return None
                ihdr_data = f.read(length)
                if len(ihdr_data) < 8:
                    return None
                width = struct.unpack(">I", ihdr_data[0:4])[0]
                height = struct.unpack(">I", ihdr_data[4:8])[0]
                return (width, height)
        except (OSError, struct.error):
            return None

    def _verify_png_integrity(self, path: Path) -> Tuple[bool, str]:
        """
        Validate CRC checksums for all PNG chunks.
        A CRC mismatch indicates data corruption or truncation.
        """
        try:
            with open(path, "rb") as f:
                f.seek(8)   # Skip signature
                while True:
                    header = f.read(8)
                    if len(header) < 8:
                        break
                    length = struct.unpack(">I", header[:4])[0]
                    chunk_type = header[4:8]
                    data = f.read(length)
                    stored_crc_bytes = f.read(4)
                    if len(stored_crc_bytes) < 4:
                        return False, "Truncated file — missing CRC bytes"
                    stored_crc = struct.unpack(">I", stored_crc_bytes)[0]
                    computed_crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
                    if stored_crc != computed_crc:
                        return (
                            False,
                            f"CRC mismatch in chunk '{chunk_type.decode('ascii', errors='replace')}': "
                            f"stored=0x{stored_crc:08X}, computed=0x{computed_crc:08X}",
                        )
                    if chunk_type == b"IEND":
                        break
            return True, "OK"
        except OSError as exc:
            return False, f"OS error during integrity check: {exc}"
