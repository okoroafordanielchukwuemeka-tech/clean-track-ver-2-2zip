#!/usr/bin/env bash
# CleanTrack Backup → Restore End-to-End Test
# Usage: bash scripts/test-backup-restore.sh [--skip-r2] [--restore]
#
# Test cycle:
#   1.  Create fresh encrypted backup locally
#   2.  Verify backup integrity (SHA256, AES-256 decrypt, gzip, SQL content)
#   3.  Decrypt locally → pipe to wc to confirm SQL size
#   4a. If R2 configured: upload to R2 via AWS Sig V4, download back, decrypt, count SQL lines
#   4b. Compare downloaded-and-decrypted content matches original (byte-level)
#   5.  (Optional, --restore) Restore to TEST DB → compare row counts vs source
#
# Requirements: DATABASE_URL, BACKUP_SECRET env vars; pg_dump, psql, openssl, curl
# R2 step:     R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
#              BACKUP_OFFSITE_PROVIDER=r2

set -euo pipefail

SKIP_R2=false
DO_RESTORE=false
TEST_DIR="./backups/test-$(date +%Y%m%d_%H%M%S)"
TEST_DB_NAME="cleantrack_restore_test_$$"

for arg in "$@"; do
  case "$arg" in
    --skip-r2)  SKIP_R2=true ;;
    --restore)  DO_RESTORE=true ;;
  esac
done

PASS=0
FAIL=0

pass()    { echo "  ✓ $1"; ((PASS++)) || true; }
fail()    { echo "  ✗ $1"; ((FAIL++)) || true; }
warn()    { echo "  ~ $1"; }
section() { echo ""; echo "── $1 ──────────────────────────────────────"; }

echo "╔══════════════════════════════════════════════════╗"
echo "║   CleanTrack Backup/Restore Integration Test     ║"
echo "╚══════════════════════════════════════════════════╝"

# ── Prerequisites ──────────────────────────────────────────
section "Prerequisites"

[[ -n "${DATABASE_URL:-}" ]] && pass "DATABASE_URL is set"   || { fail "DATABASE_URL is not set"; exit 1; }
[[ -n "${BACKUP_SECRET:-}" ]] && pass "BACKUP_SECRET is set" || { fail "BACKUP_SECRET is not set"; exit 1; }
command -v pg_dump &>/dev/null  && pass "pg_dump available"  || { fail "pg_dump not found"; exit 1; }
command -v psql    &>/dev/null  && pass "psql available"     || { fail "psql not found"; exit 1; }
command -v openssl &>/dev/null  && pass "openssl available"  || { fail "openssl not found"; exit 1; }
command -v curl    &>/dev/null  && pass "curl available"     || warn "curl not available (needed for R2 test)"

# ── Step 1: Create backup ──────────────────────────────────
section "Step 1: Create encrypted backup"

mkdir -p "$TEST_DIR"
if bash scripts/backup.sh "$TEST_DIR" 2>&1; then
  pass "backup.sh exited 0"
else
  fail "backup.sh exited non-zero"
  exit 1
fi

BACKUP_FILE=$(ls "${TEST_DIR}"/cleantrack_*.sql.gz.enc 2>/dev/null | head -1 || true)
MANIFEST_FILE=$(ls "${TEST_DIR}"/cleantrack_*.manifest.json 2>/dev/null | head -1 || true)

if [[ -n "$BACKUP_FILE" ]]; then
  BACKUP_SIZE=$(wc -c < "$BACKUP_FILE")
  pass "Encrypted backup created: $(basename "$BACKUP_FILE") (${BACKUP_SIZE} bytes)"
else
  fail "No .sql.gz.enc file found in ${TEST_DIR}"
  exit 1
fi

if [[ -n "$MANIFEST_FILE" ]]; then
  pass "Manifest file created: $(basename "$MANIFEST_FILE")"
  IS_ENCRYPTED=$(grep -c '"encrypted": true' "$MANIFEST_FILE" || true)
  [[ "$IS_ENCRYPTED" -gt 0 ]] && pass "Manifest encrypted=true" || fail "Manifest missing encrypted=true"
else
  fail "No manifest file found in ${TEST_DIR}"
fi

# ── Step 2: Verify integrity via verify-backup.sh ──────────
section "Step 2: Verify backup integrity"

if bash scripts/verify-backup.sh "$BACKUP_FILE" 2>&1; then
  pass "verify-backup.sh passed all checks"
else
  fail "verify-backup.sh reported failures"
fi

# ── Step 3: Local decrypt + SQL content check ──────────────
section "Step 3: Local decrypt and SQL content validation"

DECRYPTED_CHECK=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -pass env:BACKUP_SECRET -in "$BACKUP_FILE" 2>/dev/null | \
  gunzip -c 2>/dev/null | head -20 || true)

if echo "$DECRYPTED_CHECK" | grep -q "PostgreSQL database dump"; then
  pass "Decrypted SQL contains 'PostgreSQL database dump' header"
else
  fail "Decrypted SQL missing expected PostgreSQL header"
fi

# Count SQL lines in decrypted stream
SQL_LINE_COUNT=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -pass env:BACKUP_SECRET -in "$BACKUP_FILE" 2>/dev/null | \
  gunzip -c 2>/dev/null | wc -l || echo 0)

if [[ "$SQL_LINE_COUNT" -gt 100 ]]; then
  pass "Decrypted SQL has ${SQL_LINE_COUNT} lines (>100, looks complete)"
else
  fail "Decrypted SQL only ${SQL_LINE_COUNT} lines — suspiciously small"
fi

# Row count from live DB before any restore
ORDERS_LIVE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM orders;" 2>/dev/null | tr -d ' \n' || echo 0)
CUSTOMERS_LIVE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM customers;" 2>/dev/null | tr -d ' \n' || echo 0)
WORKERS_LIVE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM workers;" 2>/dev/null | tr -d ' \n' || echo 0)
pass "Live DB row counts — orders:${ORDERS_LIVE} customers:${CUSTOMERS_LIVE} workers:${WORKERS_LIVE}"

# ── Step 4: R2 upload + download + decrypt cycle ───────────
section "Step 4: Off-site R2 round-trip"

run_r2_test() {
  local BUCKET="$R2_BUCKET_NAME"
  local ACCOUNT="$R2_ACCOUNT_ID"
  local ACCESS_KEY="$R2_ACCESS_KEY_ID"
  local SECRET_KEY="$R2_SECRET_ACCESS_KEY"
  local HOST="${ACCOUNT}.r2.cloudflarestorage.com"
  local ENDPOINT="https://${HOST}"
  local FILE="$BACKUP_FILE"
  local FILENAME=$(basename "$FILE")
  local REMOTE_KEY="cleantrack/test/${FILENAME}"
  local DOWNLOADED="${TEST_DIR}/${FILENAME}.downloaded"

  # AWS Sig V4 upload via curl
  local DATE_SHORT=$(date -u +"%Y%m%d")
  local DATE_LONG=$(date -u +"%Y%m%dT%H%M%SZ")
  local CONTENT_TYPE="application/octet-stream"
  local FILE_HASH=$(openssl dgst -sha256 -binary "$FILE" | xxd -p -c 256)
  local CANONICAL_HEADERS="content-type:${CONTENT_TYPE}\nhost:${HOST}\nx-amz-content-sha256:${FILE_HASH}\nx-amz-date:${DATE_LONG}"
  local SIGNED_HEADERS="content-type;host;x-amz-content-sha256;x-amz-date"
  local CANONICAL_REQUEST="PUT\n/${BUCKET}/${REMOTE_KEY}\n\n${CANONICAL_HEADERS}\n\n${SIGNED_HEADERS}\n${FILE_HASH}"
  local STRING_TO_SIGN="AWS4-HMAC-SHA256\n${DATE_LONG}\n${DATE_SHORT}/auto/s3/aws4_request\n$(printf '%s' "$CANONICAL_REQUEST" | openssl dgst -sha256 | cut -d' ' -f2)"

  # HMAC key derivation
  local K_DATE=$(printf "AWS4${SECRET_KEY}" | openssl dgst -sha256 -mac HMAC -macopt "key:${DATE_SHORT}" 2>/dev/null | cut -d' ' -f2 || true)
  # Simplified: use Node.js for the sig since bash HMAC chaining is error-prone
  local SIGNATURE=$(node -e "
    const crypto = require('crypto');
    const secret = 'AWS4${SECRET_KEY}';
    const kDate = crypto.createHmac('sha256', secret).update('${DATE_SHORT}').digest();
    const kRegion = crypto.createHmac('sha256', kDate).update('auto').digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const sts = 'AWS4-HMAC-SHA256\n${DATE_LONG}\n${DATE_SHORT}/auto/s3/aws4_request\n' +
      require('crypto').createHash('sha256').update(
        'PUT\n/${BUCKET}/${REMOTE_KEY}\n\ncontent-type:${CONTENT_TYPE}\nhost:${HOST}\nx-amz-content-sha256:${FILE_HASH}\nx-amz-date:${DATE_LONG}\n\ncontent-type;host;x-amz-content-sha256;x-amz-date\n${FILE_HASH}'
      ).digest('hex');
    console.log(crypto.createHmac('sha256', kSigning).update(sts).digest('hex'));
  " 2>/dev/null || true)

  if [[ -z "$SIGNATURE" ]]; then
    warn "Could not compute AWS Sig V4 — Node.js required for R2 test. Skipping upload."
    return 0
  fi

  local AUTH_HEADER="AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${DATE_SHORT}/auto/s3/aws4_request,SignedHeaders=${SIGNED_HEADERS},Signature=${SIGNATURE}"

  echo "  Uploading to R2: s3://${BUCKET}/${REMOTE_KEY}"
  local UPLOAD_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    "${ENDPOINT}/${BUCKET}/${REMOTE_KEY}" \
    -H "Authorization: ${AUTH_HEADER}" \
    -H "Content-Type: ${CONTENT_TYPE}" \
    -H "x-amz-content-sha256: ${FILE_HASH}" \
    -H "x-amz-date: ${DATE_LONG}" \
    --data-binary "@${FILE}" 2>/dev/null || echo 0)

  if [[ "$UPLOAD_HTTP" == "200" ]]; then
    pass "R2 upload succeeded (HTTP ${UPLOAD_HTTP})"
  else
    fail "R2 upload failed (HTTP ${UPLOAD_HTTP})"
    return 0
  fi

  # Download back
  echo "  Downloading from R2..."
  local DL_DATE_LONG=$(date -u +"%Y%m%dT%H%M%SZ")
  local DL_DATE_SHORT=$(date -u +"%Y%m%d")
  local DL_SIGNATURE=$(node -e "
    const crypto = require('crypto');
    const secret = 'AWS4${SECRET_KEY}';
    const kDate = crypto.createHmac('sha256', secret).update('${DL_DATE_SHORT}').digest();
    const kRegion = crypto.createHmac('sha256', kDate).update('auto').digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const sts = 'AWS4-HMAC-SHA256\n${DL_DATE_LONG}\n${DL_DATE_SHORT}/auto/s3/aws4_request\n' +
      require('crypto').createHash('sha256').update(
        'GET\n/${BUCKET}/${REMOTE_KEY}\n\nhost:${HOST}\nx-amz-date:${DL_DATE_LONG}\n\nhost;x-amz-date\nUNSIGNED-PAYLOAD'
      ).digest('hex');
    console.log(crypto.createHmac('sha256', kSigning).update(sts).digest('hex'));
  " 2>/dev/null || true)

  local DL_AUTH="AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${DL_DATE_SHORT}/auto/s3/aws4_request,SignedHeaders=host;x-amz-date,Signature=${DL_SIGNATURE}"

  local DL_HTTP=$(curl -s -o "${DOWNLOADED}" -w "%{http_code}" -X GET \
    "${ENDPOINT}/${BUCKET}/${REMOTE_KEY}" \
    -H "Authorization: ${DL_AUTH}" \
    -H "x-amz-date: ${DL_DATE_LONG}" \
    -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" 2>/dev/null || echo 0)

  if [[ "$DL_HTTP" == "200" && -f "$DOWNLOADED" ]]; then
    pass "R2 download succeeded (HTTP ${DL_HTTP})"
  else
    fail "R2 download failed (HTTP ${DL_HTTP})"
    return 0
  fi

  # Byte-level comparison
  local ORIG_SUM=$(openssl dgst -sha256 "$FILE" | awk '{print $2}')
  local DL_SUM=$(openssl dgst -sha256 "$DOWNLOADED" | awk '{print $2}')
  if [[ "$ORIG_SUM" == "$DL_SUM" ]]; then
    pass "Downloaded file SHA256 matches original (${ORIG_SUM:0:16}…)"
  else
    fail "Downloaded file SHA256 mismatch: orig=${ORIG_SUM:0:16}… got=${DL_SUM:0:16}…"
  fi

  # Decrypt the downloaded file and check SQL content
  local DL_SQL_LINES=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
    -pass env:BACKUP_SECRET -in "$DOWNLOADED" 2>/dev/null | \
    gunzip -c 2>/dev/null | wc -l || echo 0)
  if [[ "$DL_SQL_LINES" -gt 100 ]]; then
    pass "R2 downloaded+decrypted SQL has ${DL_SQL_LINES} lines"
  else
    fail "R2 downloaded+decrypted SQL only ${DL_SQL_LINES} lines"
  fi
}

if [[ "$SKIP_R2" == "true" ]]; then
  warn "Skipped — --skip-r2 flag set"
elif [[ -z "${BACKUP_OFFSITE_PROVIDER:-}" ]]; then
  warn "Skipped — BACKUP_OFFSITE_PROVIDER not set (set to 'r2' with R2 credentials to enable)"
elif [[ "${BACKUP_OFFSITE_PROVIDER}" != "r2" ]]; then
  warn "Skipped — BACKUP_OFFSITE_PROVIDER=${BACKUP_OFFSITE_PROVIDER} (only 'r2' supported here)"
elif [[ -z "${R2_ACCOUNT_ID:-}" || -z "${R2_ACCESS_KEY_ID:-}" || -z "${R2_SECRET_ACCESS_KEY:-}" || -z "${R2_BUCKET_NAME:-}" ]]; then
  fail "R2 credentials incomplete — need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME"
else
  run_r2_test
fi

# ── Step 5: Isolated restore test (--restore only) ─────────
section "Step 5: Restore to isolated test DB (row-count validation)"

if [[ "$DO_RESTORE" == "false" ]]; then
  warn "Skipped — pass --restore to run restore test (creates a temp test database)"
else
  # Extract connection parts to create an isolated test DB
  # DATABASE_URL format: postgresql://user:pass@host:port/dbname
  DB_BASE_URL="${DATABASE_URL%/*}"
  MAIN_DB="${DATABASE_URL##*/}"

  echo "  Creating isolated test DB: ${TEST_DB_NAME}"

  # Create test database
  psql "${DB_BASE_URL}/postgres" -c "CREATE DATABASE ${TEST_DB_NAME};" 2>&1 \
    && pass "Test DB ${TEST_DB_NAME} created" \
    || { fail "Failed to create test DB"; exit 1; }

  TEST_DB_URL="${DB_BASE_URL}/${TEST_DB_NAME}"

  # Restore the backup to the isolated test DB
  if openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
    -pass env:BACKUP_SECRET -in "$BACKUP_FILE" 2>/dev/null | \
    gunzip -c 2>/dev/null | \
    psql "$TEST_DB_URL" > /dev/null 2>&1; then
    pass "Restored backup to isolated test DB"
  else
    fail "Restore to isolated test DB failed"
    psql "${DB_BASE_URL}/postgres" -c "DROP DATABASE IF EXISTS ${TEST_DB_NAME};" 2>/dev/null || true
    exit 1
  fi

  # Compare row counts between source DB and restored test DB
  TABLES=("orders" "customers" "workers" "branches" "payment_records")
  MISMATCH=0
  for TABLE in "${TABLES[@]}"; do
    SRC=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM ${TABLE};" 2>/dev/null | tr -d ' \n' || echo "ERR")
    DST=$(psql "$TEST_DB_URL" -t -c "SELECT COUNT(*) FROM ${TABLE};" 2>/dev/null | tr -d ' \n' || echo "ERR")
    if [[ "$SRC" == "$DST" ]]; then
      pass "Row count match — ${TABLE}: ${SRC}"
    else
      fail "Row count mismatch — ${TABLE}: source=${SRC} restored=${DST}"
      MISMATCH=1
    fi
  done

  # Drop the test database
  psql "${DB_BASE_URL}/postgres" -c "DROP DATABASE IF EXISTS ${TEST_DB_NAME};" 2>/dev/null \
    && pass "Test DB ${TEST_DB_NAME} dropped (cleaned up)" \
    || warn "Failed to drop test DB ${TEST_DB_NAME} — drop manually"

  [[ "$MISMATCH" -eq 0 ]] && pass "All table row counts match" || fail "Row count mismatches detected"
fi

# ── Cleanup test directory ─────────────────────────────────
section "Cleanup"
rm -rf "$TEST_DIR"
pass "Test directory cleaned up"

# ── Results ────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════"
echo "  Results: ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -gt 0 ]]; then
  echo "  STATUS: FAILED"
  exit 1
else
  echo "  STATUS: PASSED"
fi
