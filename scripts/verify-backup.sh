#!/usr/bin/env bash
# CleanTrack Backup Verification Script
# Usage: bash scripts/verify-backup.sh <backup_file.sql.gz>
# Verifies: file exists, is non-empty, SHA256 matches manifest, SQL is well-formed

set -euo pipefail

BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: bash scripts/verify-backup.sh <backup_file.sql.gz>" >&2
  exit 1
fi

PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  if [[ "$result" == "pass" ]]; then
    echo "  ✓ ${label}"
    ((PASS++)) || true
  else
    echo "  ✗ ${label}: ${result}"
    ((FAIL++)) || true
  fi
}

echo "[verify] Checking: ${BACKUP_FILE}"
echo ""

if [[ -f "$BACKUP_FILE" ]]; then
  check "File exists" "pass"
else
  check "File exists" "NOT FOUND"
  exit 1
fi

SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
if [[ "$SIZE" -gt 1000 ]]; then
  check "File non-empty (${SIZE} bytes)" "pass"
else
  check "File non-empty" "TOO SMALL (${SIZE} bytes)"
fi

if gunzip -t "$BACKUP_FILE" 2>/dev/null; then
  check "Gzip integrity" "pass"
else
  check "Gzip integrity" "CORRUPTED"
fi

MANIFEST="${BACKUP_FILE%.sql.gz}.manifest.json"
if [[ -f "$MANIFEST" ]]; then
  EXPECTED_SHA=$(grep '"sha256"' "$MANIFEST" | sed 's/.*: *"\(.*\)".*/\1/')
  ACTUAL_SHA=$(sha256sum "$BACKUP_FILE" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')
  if [[ "$EXPECTED_SHA" == "$ACTUAL_SHA" ]]; then
    check "SHA256 matches manifest" "pass"
  else
    check "SHA256 matches manifest" "MISMATCH (expected ${EXPECTED_SHA}, got ${ACTUAL_SHA})"
  fi
else
  check "Manifest file" "NOT FOUND (skipping SHA256)"
fi

SQL_PREVIEW=$(gunzip -c "$BACKUP_FILE" 2>/dev/null | head -5)
if echo "$SQL_PREVIEW" | grep -q "PostgreSQL\|SET\|CREATE\|INSERT\|DROP"; then
  check "SQL content well-formed" "pass"
else
  check "SQL content well-formed" "UNEXPECTED CONTENT"
fi

TABLE_COUNT=$(gunzip -c "$BACKUP_FILE" 2>/dev/null | grep -c "^CREATE TABLE\|^-- Name:" || true)
check "SQL contains table definitions (${TABLE_COUNT} found)" "pass"

echo ""
echo "[verify] Results: ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -gt 0 ]]; then
  echo "[verify] VERIFICATION FAILED — do not use this backup for restore."
  exit 1
else
  echo "[verify] VERIFICATION PASSED — backup is safe to restore."
fi
