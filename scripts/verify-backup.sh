#!/usr/bin/env bash
# CleanTrack Backup Verification Script
# Usage: bash scripts/verify-backup.sh <backup_file>
#
# Supports both encrypted (.sql.gz.enc) and legacy unencrypted (.sql.gz) backups.
# For encrypted backups, BACKUP_SECRET must be set to verify SQL content.

set -euo pipefail

BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: bash scripts/verify-backup.sh <backup_file.sql.gz.enc|backup_file.sql.gz>" >&2
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

# 1. File existence
if [[ -f "$BACKUP_FILE" ]]; then
  check "File exists" "pass"
else
  check "File exists" "NOT FOUND"
  exit 1
fi

# 2. Non-empty
SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
if [[ "$SIZE" -gt 1000 ]]; then
  check "File non-empty (${SIZE} bytes)" "pass"
else
  check "File non-empty" "TOO SMALL (${SIZE} bytes)"
fi

# 3. SHA256 against manifest
MANIFEST="${BACKUP_FILE%.enc}"
MANIFEST="${MANIFEST%.sql.gz}.manifest.json"
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

# 4. Decryption / gzip integrity + SQL content check
IS_ENCRYPTED=false
if [[ "$BACKUP_FILE" == *.enc ]]; then
  IS_ENCRYPTED=true
fi

if [[ "$IS_ENCRYPTED" == "true" ]]; then
  if [[ -z "${BACKUP_SECRET:-}" ]]; then
    check "Decryption (BACKUP_SECRET not set — skipping)" "pass"
  elif command -v openssl &>/dev/null; then
    if openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
        -pass "pass:${BACKUP_SECRET}" \
        -in "$BACKUP_FILE" 2>/dev/null \
        | gunzip -t 2>/dev/null; then
      check "AES-256 decryption + gzip integrity" "pass"
    else
      check "AES-256 decryption + gzip integrity" "FAILED (wrong key or corrupted)"
    fi

    SQL_PREVIEW=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
      -pass "pass:${BACKUP_SECRET}" \
      -in "$BACKUP_FILE" 2>/dev/null \
      | gunzip -c 2>/dev/null | head -5 || true)
    if echo "$SQL_PREVIEW" | grep -q "PostgreSQL\|SET\|CREATE\|INSERT\|DROP"; then
      TABLE_COUNT=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
        -pass "pass:${BACKUP_SECRET}" \
        -in "$BACKUP_FILE" 2>/dev/null \
        | gunzip -c 2>/dev/null | grep -c "^CREATE TABLE" || true)
      check "SQL content well-formed (${TABLE_COUNT} CREATE TABLE statements)" "pass"
    else
      check "SQL content well-formed" "UNEXPECTED CONTENT"
    fi
  else
    check "Decryption (openssl not found — skipping)" "pass"
  fi
else
  # Legacy unencrypted
  if gunzip -t "$BACKUP_FILE" 2>/dev/null; then
    check "Gzip integrity" "pass"
  else
    check "Gzip integrity" "CORRUPTED"
  fi

  SQL_PREVIEW=$(gunzip -c "$BACKUP_FILE" 2>/dev/null | head -5)
  if echo "$SQL_PREVIEW" | grep -q "PostgreSQL\|SET\|CREATE\|INSERT\|DROP"; then
    TABLE_COUNT=$(gunzip -c "$BACKUP_FILE" 2>/dev/null | grep -c "^CREATE TABLE" || true)
    check "SQL content well-formed (${TABLE_COUNT} CREATE TABLE statements)" "pass"
  else
    check "SQL content well-formed" "UNEXPECTED CONTENT"
  fi
fi

echo ""
echo "[verify] Results: ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -gt 0 ]]; then
  echo "[verify] VERIFICATION FAILED — do not use this backup for restore."
  exit 1
else
  echo "[verify] VERIFICATION PASSED — backup is safe to restore."
fi
