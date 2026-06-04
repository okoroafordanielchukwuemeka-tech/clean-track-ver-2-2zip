#!/usr/bin/env bash
# CleanTrack Database Restore Script
# Usage: bash scripts/restore.sh <backup_file.sql.gz>
# Requires: psql, DATABASE_URL env var
# WARNING: This will DROP and recreate all tables. Use with care.

set -euo pipefail

BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: bash scripts/restore.sh <backup_file.sql.gz>" >&2
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[restore] ERROR: File not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[restore] ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "[restore] ERROR: psql not found. Install postgresql-client." >&2
  exit 1
fi

MANIFEST="${BACKUP_FILE%.sql.gz}.manifest.json"
if [[ -f "$MANIFEST" ]]; then
  echo "[restore] Verifying backup integrity..."
  EXPECTED_SHA=$(grep '"sha256"' "$MANIFEST" | sed 's/.*: *"\(.*\)".*/\1/')
  ACTUAL_SHA=$(sha256sum "$BACKUP_FILE" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')
  if [[ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
    echo "[restore] ERROR: SHA256 mismatch! Backup file may be corrupted." >&2
    echo "[restore]   Expected: ${EXPECTED_SHA}" >&2
    echo "[restore]   Actual:   ${ACTUAL_SHA}" >&2
    exit 1
  fi
  echo "[restore] Integrity check passed (SHA256: ${ACTUAL_SHA})"
else
  echo "[restore] WARNING: No manifest found, skipping integrity check."
fi

echo "[restore] Restoring from: ${BACKUP_FILE}"
echo "[restore] Target: ${DATABASE_URL%%@*}@***"
echo ""
read -r -p "[restore] This will overwrite the database. Continue? (yes/no): " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "[restore] Aborted."
  exit 0
fi

echo "[restore] Decompressing and restoring..."
gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1

echo "[restore] Restore complete."
echo "[restore] Run 'pnpm db:push' if schema needs to be re-synced."
