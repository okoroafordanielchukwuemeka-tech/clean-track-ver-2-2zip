#!/usr/bin/env bash
# CleanTrack Database Restore Script
# Usage: bash scripts/restore.sh <backup_file> [--yes|-y]
#
# Supports both encrypted (.sql.gz.enc) and legacy unencrypted (.sql.gz) backups.
# Requires: psql, DATABASE_URL, BACKUP_SECRET (for encrypted backups) env vars
# WARNING: This will DROP and recreate all tables. Use with care.

set -euo pipefail

BACKUP_FILE="${1:-}"
AUTO_CONFIRM=false

for arg in "$@"; do
  if [[ "$arg" == "--yes" || "$arg" == "-y" ]]; then
    AUTO_CONFIRM=true
  fi
done

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: bash scripts/restore.sh <backup_file.sql.gz.enc|backup_file.sql.gz> [--yes|-y]" >&2
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

# Determine if file is encrypted
IS_ENCRYPTED=false
if [[ "$BACKUP_FILE" == *.enc ]]; then
  IS_ENCRYPTED=true
  if [[ -z "${BACKUP_SECRET:-}" ]]; then
    echo "[restore] ERROR: BACKUP_SECRET is not set — required to decrypt this backup" >&2
    exit 1
  fi
  if ! command -v openssl &>/dev/null; then
    echo "[restore] ERROR: openssl not found — required to decrypt this backup" >&2
    exit 1
  fi
fi

# Integrity check against manifest
MANIFEST="${BACKUP_FILE%.enc}"
MANIFEST="${MANIFEST%.sql.gz}.manifest.json"
if [[ -f "$MANIFEST" ]]; then
  echo "[restore] Verifying backup integrity..."
  EXPECTED_SHA=$(grep '"sha256"' "$MANIFEST" | sed 's/.*: *"\(.*\)".*/\1/')
  ACTUAL_SHA=$(sha256sum "$BACKUP_FILE" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')
  if [[ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
    echo "[restore] ERROR: SHA256 mismatch! Backup file may be corrupted or tampered." >&2
    echo "[restore]   Expected: ${EXPECTED_SHA}" >&2
    echo "[restore]   Actual:   ${ACTUAL_SHA}" >&2
    exit 1
  fi
  echo "[restore] Integrity check passed (SHA256: ${ACTUAL_SHA})"
else
  echo "[restore] WARNING: No manifest found, skipping integrity check."
fi

DB_DISPLAY=$(echo "$DATABASE_URL" | sed 's|://[^@]*@|://***:***@|')
echo "[restore] Restoring from: ${BACKUP_FILE}"
echo "[restore] Encrypted: ${IS_ENCRYPTED}"
echo "[restore] Target: ${DB_DISPLAY}"
echo ""

if [[ "$AUTO_CONFIRM" == "false" ]]; then
  read -r -p "[restore] This will overwrite the database. Continue? (yes/no): " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "[restore] Aborted."
    exit 0
  fi
else
  echo "[restore] Auto-confirmed (--yes flag)."
fi

echo "[restore] Decompressing, decrypting, and restoring..."

if [[ "$IS_ENCRYPTED" == "true" ]]; then
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
    -pass "pass:${BACKUP_SECRET}" \
    -in "$BACKUP_FILE" \
    | gunzip -c \
    | psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 2>&1
else
  # Legacy unencrypted .sql.gz support
  gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 2>&1
fi

echo "[restore] Restore complete."
echo "[restore] Run 'pnpm db:migrate' to apply any pending schema migrations."
