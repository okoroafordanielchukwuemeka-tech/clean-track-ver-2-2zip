#!/usr/bin/env bash
# CleanTrack Database Backup Script
# Usage: bash scripts/backup.sh [output_dir]
# Requires: pg_dump, DATABASE_URL, BACKUP_SECRET env vars
#
# Output: <output_dir>/cleantrack_<timestamp>.sql.gz.enc  (AES-256-CBC encrypted)
#         <output_dir>/cleantrack_<timestamp>.manifest.json

set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${OUTPUT_DIR}/cleantrack_${TIMESTAMP}.sql.gz.enc"
MANIFEST_FILE="${OUTPUT_DIR}/cleantrack_${TIMESTAMP}.manifest.json"
RETENTION_DAYS=30

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[backup] ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

if [[ -z "${BACKUP_SECRET:-}" ]]; then
  echo "[backup] ERROR: BACKUP_SECRET is not set — required for AES-256 encryption" >&2
  exit 1
fi

if ! command -v pg_dump &>/dev/null; then
  echo "[backup] ERROR: pg_dump not found. Install postgresql-client." >&2
  exit 1
fi

if ! command -v openssl &>/dev/null; then
  echo "[backup] ERROR: openssl not found." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "[backup] Starting encrypted backup at ${TIMESTAMP}..."

# Dump → gzip → AES-256-CBC encrypt using BACKUP_SECRET as passphrase
pg_dump "$DATABASE_URL" \
  --format=plain \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  | grep -v "^SET transaction_timeout" \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 \
      -pass "pass:${BACKUP_SECRET}" \
      -out "$BACKUP_FILE"

BACKUP_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
BACKUP_SHA256=$(sha256sum "$BACKUP_FILE" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')

cat > "$MANIFEST_FILE" <<EOF
{
  "timestamp": "${TIMESTAMP}",
  "file": "$(basename "$BACKUP_FILE")",
  "encrypted": true,
  "encryption": "aes-256-cbc-pbkdf2",
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
find "$OUTPUT_DIR" -name "cleantrack_*.sql.gz.enc" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "$OUTPUT_DIR" -name "cleantrack_*.manifest.json" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true

echo "[backup] Done."
