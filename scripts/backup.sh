#!/usr/bin/env bash
# CleanTrack Database Backup Script
# Usage: bash scripts/backup.sh [output_dir]
# Requires: pg_dump, DATABASE_URL env var

set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${OUTPUT_DIR}/cleantrack_${TIMESTAMP}.sql.gz"
MANIFEST_FILE="${OUTPUT_DIR}/cleantrack_${TIMESTAMP}.manifest.json"
RETENTION_DAYS=30

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[backup] ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

if ! command -v pg_dump &>/dev/null; then
  echo "[backup] ERROR: pg_dump not found. Install postgresql-client." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "[backup] Starting backup at ${TIMESTAMP}..."
pg_dump "$DATABASE_URL" \
  --format=plain \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  | gzip -9 > "$BACKUP_FILE"

BACKUP_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
BACKUP_SHA256=$(sha256sum "$BACKUP_FILE" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')

cat > "$MANIFEST_FILE" <<EOF
{
  "timestamp": "${TIMESTAMP}",
  "file": "$(basename "$BACKUP_FILE")",
  "sizeBytes": ${BACKUP_SIZE},
  "sha256": "${BACKUP_SHA256}",
  "databaseUrl": "${DATABASE_URL%%@*}@***",
  "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "[backup] Backup complete: ${BACKUP_FILE} (${BACKUP_SIZE} bytes)"
echo "[backup] SHA256: ${BACKUP_SHA256}"
echo "[backup] Manifest: ${MANIFEST_FILE}"

echo "[backup] Pruning backups older than ${RETENTION_DAYS} days..."
find "$OUTPUT_DIR" -name "cleantrack_*.sql.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "$OUTPUT_DIR" -name "cleantrack_*.manifest.json" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true

echo "[backup] Done."
