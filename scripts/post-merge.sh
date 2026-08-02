#!/bin/bash
set -e

echo "[post-merge] Installing npm dependencies..."
npm install --no-audit --no-fund

echo "[post-merge] Pushing database schema..."
npm run db:push -- --force || npm run db:push

echo "[post-merge] Done."
