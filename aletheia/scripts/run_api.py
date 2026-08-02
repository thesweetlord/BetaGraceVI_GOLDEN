"""Run the Aletheia FastAPI service.

Usage:
  python aletheia/scripts/run_api.py        # default 0.0.0.0:8765
  ALETHEIA_PORT=9000 python aletheia/scripts/run_api.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn  # noqa: E402

if __name__ == "__main__":
    host = os.environ.get("ALETHEIA_HOST", "0.0.0.0")
    port = int(os.environ.get("ALETHEIA_PORT", "8000"))
    uvicorn.run("aletheia.api:app", host=host, port=port, log_level="info")
