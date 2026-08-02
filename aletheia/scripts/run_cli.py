"""Thin wrapper so you can run `python aletheia/scripts/run_cli.py ...`."""

from __future__ import annotations

import sys
from pathlib import Path

# Make the package importable when running as a loose script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aletheia.cli import app  # noqa: E402

if __name__ == "__main__":
    app()
