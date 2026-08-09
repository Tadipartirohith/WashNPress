#!/usr/bin/env bash
# Bring the app live locally without Docker.
set -e
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci
echo "Starting Wash N Press backend on http://localhost:${PORT:-8080} ..."
npm start
