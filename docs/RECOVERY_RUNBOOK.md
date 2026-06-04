# CleanTrack — Disaster Recovery Runbook

**Last Updated:** June 2026  
**Owner:** CleanTrack Operations  
**Classification:** Internal — Operations

---

## Emergency Contacts

| Role | Action |
|---|---|
| Database down | Restart Replit workflow → check Replit status page |
| Data corruption | Run restore procedure (Section 4) |
| All else fails | Replit support → support.replit.com |

---

## Section 1 — Immediate Triage

Before doing anything:

1. **Is the API responding?** → `GET /api/healthz`
2. **Is the database reachable?** → Check Replit PostgreSQL dashboard
3. **Is data missing or corrupted?** → Check soft-delete recovery bin first (Operations → Recovery)
4. **Was a deployment just made?** → Attempt Replit checkpoint rollback first

---

## Section 2 — Soft Delete Recovery (fastest, ~10 seconds)

Use for: accidentally deleted workers, customers, branches, or voided payments.

**Via the UI:**
1. Log in as owner
2. Go to **Operations Center** → **Recovery** tab
3. Find the deleted item
4. Click **Restore**

**Via API (if UI is unavailable):**
```bash
# Restore a deleted worker
curl -X POST https://your-app.replit.app/api/recovery/workers/{id}/restore \
  -H "Authorization: Bearer YOUR_TOKEN"

# Restore a deleted customer
curl -X POST https://your-app.replit.app/api/recovery/customers/{id}/restore \
  -H "Authorization: Bearer YOUR_TOKEN"

# Restore a deleted branch
curl -X POST https://your-app.replit.app/api/recovery/branches/{id}/restore \
  -H "Authorization: Bearer YOUR_TOKEN"

# Restore a voided payment (recalculates balance automatically)
curl -X POST https://your-app.replit.app/api/recovery/payments/{id}/restore \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Section 3 — Database Backup

### Create a backup now
```bash
pnpm db:backup
# Output: ./backups/cleantrack_YYYYMMDD_HHMMSS.sql.gz
# Also creates a .manifest.json with SHA256 checksum
```

### Verify a backup
```bash
pnpm db:verify-backup ./backups/cleantrack_YYYYMMDD_HHMMSS.sql.gz
# Runs 6 checks: exists, non-empty, gzip integrity, SHA256, SQL content, table count
```

### Backup retention
- Local backups auto-pruned after 30 days
- **Always download a copy off-platform** — local backups are on the same server

### Where backups are stored
```
/home/runner/workspace/backups/
  cleantrack_YYYYMMDD_HHMMSS.sql.gz    ← compressed SQL dump
  cleantrack_YYYYMMDD_HHMMSS.manifest.json ← SHA256 + metadata
```

---

## Section 4 — Database Restore Procedure

**RPO Impact:** All data created after the backup timestamp will be lost.

### Step 1: Choose your backup
```bash
ls -lh backups/
# Pick the most recent verified backup
```

### Step 2: Verify the backup
```bash
bash scripts/verify-backup.sh backups/cleantrack_YYYYMMDD_HHMMSS.sql.gz
# Must show: VERIFICATION PASSED
```

### Step 3: Stop the application
Stop the Replit workflow before restoring.

### Step 4: Run the restore
```bash
pnpm db:restore backups/cleantrack_YYYYMMDD_HHMMSS.sql.gz
# You will be prompted: "Continue? (yes/no)"
# Type: yes
```

### Step 5: Re-sync the schema
```bash
pnpm db:push
```

### Step 6: Restart the application
Restart the Replit workflow.

### Step 7: Verify
- Log in and check that orders, workers, customers are visible
- Check **Operations → Recovery** dashboard for readiness score
- Run a test order creation

---

## Section 5 — Bad Migration Recovery

CleanTrack uses `drizzle-kit push` (no migration files). This means:

- Schema changes are **immediately applied** to the database
- There is **no automatic rollback** for schema changes
- The only recovery for a bad migration is **a database restore** (Section 4)

### Prevention
- Always take a backup **before** running `pnpm db:push`
- Never run `pnpm db:push-force` on production without a verified backup

### If a migration drops a column
1. Run restore from last backup (Section 4) — data loss = changes since backup
2. Re-apply the correct schema change after restore

---

## Section 6 — Server Outage Scenarios

### Scenario: API server down (< 1 hour)
- **Client behavior:** Workers continue using cached data + offline queue
- **Sync queue:** Items queue in IndexedDB, auto-sync when server returns
- **Action needed:** Restart Replit workflow → monitor sync health (Operations → Sync Health)

### Scenario: API server down (1–24 hours)
- **Client behavior:** Full offline mode; all operations queue locally
- **Data risk:** None — all operations persisted in device IndexedDB
- **Action needed:** Restart workflow; sync engine retries automatically (backoff up to 5 min)
- **Monitor:** Operations → Sync Health → check device queue lengths after recovery

### Scenario: API server down (> 24 hours)
- **Additional concern:** Idempotency keys may expire (24h TTL)
- **Risk:** Some sync operations may re-execute on restore
- **Mitigation:** Idempotency middleware prevents duplicate payments; status updates are last-write-wins
- **Action:** After recovery, check Operations → Payments for any duplicates

### Scenario: Replit outage (full platform)
- **Workers:** Fully offline — continue using PWA + IndexedDB
- **Owners:** Cannot access dashboard — use last-seen data
- **Recovery:** No action needed; sync resumes automatically on Replit restoration
- **RTO:** Depends on Replit SLA (typically < 4 hours for managed incidents)

---

## Section 7 — Ransomware / Malicious Deletion

### Signs
- Large number of records missing simultaneously
- Orders/customers/payments disappearing in bulk
- Audit log shows unusual bulk delete actions

### Immediate Response
1. **Do not panic.** Soft deletes protect workers, customers, branches, payments.
2. Check **Operations → Recovery** — restore soft-deleted items if recent.
3. Check **Operations → Audit Log** — identify the actor and time window.
4. If database tables were truncated or dropped → restore from backup (Section 4).
5. Immediately rotate `JWT_SECRET` in Replit Secrets and invalidate all sessions.
6. Change owner password.

### Data Loss Assessment
| Protected | How | Recovery |
|---|---|---|
| Workers | Soft delete | Instant via UI |
| Customers | Soft delete | Instant via UI |
| Branches | Soft delete + active-order guard | Instant via UI |
| Payments | Soft void | Instant via UI + auto balance recalc |
| Orders | Cancel (not delete) | PATCH to re-open |
| Audit log | Append-only, no delete API | N/A (inspect for evidence) |
| All tables | DB backup | Restore from last backup |

---

## Section 8 — Offline Device Recovery (30+ days offline)

### Worker device offline for > 30 days
- Sync queue holds all operations in IndexedDB (no expiry)
- On reconnect, sync engine replays all queued operations
- **Concern:** Idempotency keys expire after 24h — some operations may re-execute
- **Mitigation:** Payment sync validates against live order balance pre-submit
- **Action:** After sync completes, verify order balances via audit log

### Sync queue > 10,000 records
- The sync engine processes entries in passes with exponential backoff
- Large queues will take time but will process correctly
- **Monitor:** Operations → Sync Health → device queue length
- **Action:** If a device shows > 10,000 pending after 24h, manually reconcile via audit log

---

## Section 9 — Recovery Readiness Checklist

Run before any maintenance or deployment:

- [ ] Backup created and verified in last 24 hours (`pnpm db:backup && pnpm db:verify-backup`)
- [ ] Backup file downloaded off-platform
- [ ] Operations → Recovery → Readiness score ≥ 80
- [ ] All critical checks green (DB, soft deletes, backup recency)
- [ ] JWT_SECRET stored in Replit Secrets (not `.replit` file)
- [ ] No pending soft-deleted items that should be restored

---

## Section 10 — Backup Architecture Summary

| Layer | Method | RPO | RTO | Cost |
|---|---|---|---|---|
| Soft deletes (in-DB) | Automatic | 0 | Seconds | Free |
| Manual pg_dump | `pnpm db:backup` | Since last run | 1–3 hrs | Free |
| Replit managed snapshots | Automatic (daily) | 24 hours | 2–6 hrs | Included |
| Off-platform copy | Download backups/ | Since last download | 2–8 hrs | Free |
| Point-in-time recovery | **Not available** | N/A | N/A | Upgrade needed |

---

## Section 11 — Known Remaining Risks

| Risk | Severity | Workaround |
|---|---|---|
| No point-in-time recovery | HIGH | Frequent manual backups + download off-platform |
| `JWT_SECRET` in `.replit` file | HIGH | Move to Replit Secrets before publishing |
| `drizzle-kit push` in production | HIGH | Always backup before `pnpm db:push` |
| Cascade delete on `laundries` table | CRITICAL | No application exposes this; guard at DB level |
| No rate limiting | HIGH | Single bad actor can overload the API |
| Audit log unbounded | MEDIUM | Will slow at 10M+ rows; add pruning if needed |
| No 2FA on owner accounts | MEDIUM | Use strong password; consider email OTP |

---

*Run `pnpm db:backup` now if you haven't in the last 24 hours.*
