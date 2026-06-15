#!/usr/bin/env bash
# CleanTrack Backup → Restore End-to-End Test
# Usage: bash scripts/test-backup-restore.sh [--skip-r2]
#
# What this tests:
#   1. Creates a fresh encrypted backup
#   2. Verifies the backup integrity (SHA256, decryption, SQL content)
#   3. If BACKUP_OFFSITE_PROVIDER=r2 (and R2 vars set): uploads to R2 and verifies
#   4. Runs a row-count check on the live database before and after a restore
#      (restore is only done if --restore flag is passed — destructive!)
#
# Requirements: DATABASE_URL, BACKUP_SECRET env vars

set -euo pipefail

SKIP_R2=false
DO_RESTORE=false
TEST_DIR="./backups/test-$(date +%Y%m%d_%H%M%S)"

for arg in "$@"; do
  case "$arg" in
    --skip-r2) SKIP_R2=true ;;
    --restore) DO_RESTORE=true ;;
  esac
done

PASS=0
FAIL=0

pass() { echo "  ✓ $1"; ((PASS++)) || true; }
fail() { echo "  ✗ $1"; ((FAIL++)) || true; }

section() { echo ""; echo "── $1 ──────────────────────────────────"; }

echo "╔══════════════════════════════════════════════════╗"
echo "║   CleanTrack Backup/Restore Integration Test     ║"
echo "╚══════════════════════════════════════════════════╝"

# ── Prerequisites ─────────────────────────────────────
section "Prerequisites"

if [[ -z "${DATABASE_URL:-}" ]]; then
  fail "DATABASE_URL is set"
  exit 1
else
  pass "DATABASE_URL is set"
fi

if [[ -z "${BACKUP_SECRET:-}" ]]; then
  fail "BACKUP_SECRET is set"
  exit 1
else
  pass "BACKUP_SECRET is set"
fi

command -v pg_dump &>/dev/null && pass "pg_dump available" || fail "pg_dump available"
command -v psql &>/dev/null && pass "psql available" || fail "psql available"
command -v openssl &>/dev/null && pass "openssl available" || fail "openssl available"

# ── Step 1: Create backup ─────────────────────────────
section "Step 1: Create encrypted backup"

mkdir -p "$TEST_DIR"
if bash scripts/backup.sh "$TEST_DIR" 2>&1; then
  pass "backup.sh exited 0"
else
  fail "backup.sh exited non-zero"
  exit 1
fi

BACKUP_FILE=$(ls "${TEST_DIR}"/cleantrack_*.sql.gz.enc 2>/dev/null | head -1)
MANIFEST_FILE=$(ls "${TEST_DIR}"/cleantrack_*.manifest.json 2>/dev/null | head -1)

if [[ -n "$BACKUP_FILE" ]]; then
  pass "Encrypted backup file created: $(basename "$BACKUP_FILE")"
else
  fail "No .sql.gz.enc file found in ${TEST_DIR}"
  exit 1
fi

if [[ -n "$MANIFEST_FILE" ]]; then
  pass "Manifest file created"
  IS_ENCRYPTED=$(grep '"encrypted"' "$MANIFEST_FILE" | grep -c "true" || true)
  [[ "$IS_ENCRYPTED" -gt 0 ]] && pass "Manifest reports encrypted=true" || fail "Manifest does not report encrypted=true"
else
  fail "No manifest file found"
fi

# ── Step 2: Verify backup ─────────────────────────────
section "Step 2: Verify backup integrity"

if bash scripts/verify-backup.sh "$BACKUP_FILE" 2>&1; then
  pass "verify-backup.sh passed"
else
  fail "verify-backup.sh failed"
fi

# ── Step 3: R2 upload test ────────────────────────────
section "Step 3: Off-site upload (R2)"

if [[ "$SKIP_R2" == "true" ]]; then
  echo "  (skipped — --skip-r2 flag set)"
elif [[ -z "${BACKUP_OFFSITE_PROVIDER:-}" ]]; then
  echo "  (skipped — BACKUP_OFFSITE_PROVIDER not set)"
elif [[ "${BACKUP_OFFSITE_PROVIDER}" == "r2" ]]; then
  if [[ -z "${R2_ACCOUNT_ID:-}" || -z "${R2_ACCESS_KEY_ID:-}" || -z "${R2_SECRET_ACCESS_KEY:-}" || -z "${R2_BUCKET_NAME:-}" ]]; then
    fail "R2 credentials not fully set (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)"
  else
    # Use the API's backup endpoint to trigger an off-site upload
    if [[ -n "${API_BASE_URL:-}" && -n "${ADMIN_TOKEN:-}" ]]; then
      R2_RESULT=$(curl -sf -X POST "${API_BASE_URL}/api/recovery/trigger-backup" \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" 2>&1 || true)
      [[ "$R2_RESULT" == *"success"* ]] && pass "R2 upload via API" || fail "R2 upload via API: ${R2_RESULT}"
    else
      echo "  (R2 upload test via API skipped — API_BASE_URL or ADMIN_TOKEN not set)"
      echo "  To test R2 upload: set API_BASE_URL and ADMIN_TOKEN and re-run."
    fi
  fi
fi

# ── Step 4: Restore test (optional, destructive) ──────
section "Step 4: Restore test (row-count validation)"

if [[ "$DO_RESTORE" == "false" ]]; then
  echo "  (skipped — pass --restore flag to run destructive restore test)"
else
  echo "  WARNING: This will restore the backup to the current DATABASE_URL!"

  # Get row counts before restore
  ORDERS_BEFORE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM orders;" 2>/dev/null | tr -d ' ')
  CUSTOMERS_BEFORE=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM customers;" 2>/dev/null | tr -d ' ')

  if bash scripts/restore.sh "$BACKUP_FILE" --yes 2>&1; then
    pass "restore.sh exited 0"
  else
    fail "restore.sh failed"
  fi

  ORDERS_AFTER=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM orders;" 2>/dev/null | tr -d ' ')
  CUSTOMERS_AFTER=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM customers;" 2>/dev/null | tr -d ' ')

  [[ "$ORDERS_BEFORE" == "$ORDERS_AFTER" ]] \
    && pass "Orders row count preserved (${ORDERS_BEFORE})" \
    || fail "Orders row count changed: ${ORDERS_BEFORE} → ${ORDERS_AFTER}"

  [[ "$CUSTOMERS_BEFORE" == "$CUSTOMERS_AFTER" ]] \
    && pass "Customers row count preserved (${CUSTOMERS_BEFORE})" \
    || fail "Customers row count changed: ${CUSTOMERS_BEFORE} → ${CUSTOMERS_AFTER}"
fi

# ── Cleanup test directory ────────────────────────────
rm -rf "$TEST_DIR"

# ── Results ───────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
echo "Results: ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -gt 0 ]]; then
  echo "STATUS: FAILED"
  exit 1
else
  echo "STATUS: PASSED"
fi
