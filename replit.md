# Clean Track - Laundry Operations Management

## Project Overview
Clean Track is a professional laundry operations management SaaS application with:
- **Role-based access control** (Admin and Worker roles)
- **Order management** with full lifecycle tracking
- **Batch processing** for grouping orders
- **Payment recording** (cash, transfer, POS)
- **Analytics dashboard** with charts
- **Worker station** with PIN login and queue management
- **Services catalog** with tiered pricing (standard/express/premium)

## Architecture
- **Monorepo** managed with pnpm workspaces
- `artifacts/api-server/` — Express + TypeScript REST API (port 3001)
- `artifacts/clean-track/` — React + Vite frontend (port 5000)
- `lib/db/` — PostgreSQL + Drizzle ORM database package
- `lib/api-spec/` — OpenAPI 3.1 specification

## Tech Stack
- **Frontend**: React 18, Vite, TailwindCSS, shadcn/ui, React Query, Recharts
- **Backend**: Node.js, Express, TypeScript, tsx
- **Database**: PostgreSQL (Drizzle ORM)
- **Language**: TypeScript throughout

## Configured Services
| Service | Status | Notes |
|---------|--------|-------|
| PostgreSQL | ✅ Active | External database — `DATABASE_URL` set as Replit Secret |
| JWT / Session | ✅ Active | `JWT_SECRET`, `SESSION_SECRET`, `BACKUP_SECRET` set as Replit Secrets |
| SMTP (Resend) | ✅ Active | `SMTP_HOST`/`PORT`/`USER`/`FROM` as shared env vars |
| Paystack | ⚠️ Not configured | Set `PAYSTACK_SECRET_KEY` + `PAYSTACK_PUBLIC_KEY` as Replit Secrets to enable billing |
| Cloudinary | ⚠️ Not configured | Set `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`; falls back to local disk |
| WhatsApp | ⚠️ Not configured | Set `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |
| Off-site backups | ⚠️ Not configured | Set `BACKUP_OFFSITE_PROVIDER=r2` + R2 credentials to enable |

## Running the Project
```bash
pnpm dev         # starts both API server (port 3001) and frontend (port 5000)
```

## Database Workflow

### Development (fast schema sync)
```bash
pnpm db:push     # sync schema directly to DB — use in development only
```

### Production (safe migration history)
```bash
pnpm db:migrate:generate   # generate a new numbered SQL migration from schema changes
pnpm db:migrate            # apply all pending migrations (safe, with history)
pnpm db:migrate:check      # verify schema matches current migrations
```

> **Important**: Use `db:migrate` in production, never `db:push`.
> `db:push` can silently drop columns. Migrations create a permanent history
> in the `__drizzle_migrations` table and are safe to replay.

## Backup & Recovery

### Create a backup
```bash
pnpm db:backup                        # creates encrypted .sql.gz.enc in ./backups/
bash scripts/verify-backup.sh <file>  # verify integrity + decryption
```

### Restore from backup
```bash
bash scripts/restore.sh <file.sql.gz.enc>  # prompts for confirmation
bash scripts/restore.sh <file> --yes       # auto-confirm (CI/CD)
```

### End-to-end backup test
```bash
bash scripts/test-backup-restore.sh           # tests backup + verify (non-destructive)
bash scripts/test-backup-restore.sh --restore # also tests restore (DESTRUCTIVE)
```

### Off-site backups (Cloudflare R2)
Set these environment variables to enable automatic encrypted R2 uploads after each backup:
```
BACKUP_OFFSITE_PROVIDER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=cleantrack-backups
```

## Required Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (set automatically by Replit)
- `JWT_SECRET` — Token signing secret (min 32 chars)
- `SESSION_SECRET` — Session integrity secret (min 32 chars)
- `BACKUP_SECRET` — AES-256 backup encryption key + HMAC signing (min 32 chars)

See `.env.example` for the full list of required and optional variables.

## Replit Setup (updated 2026-07-17, external DB connected)
- Switched to external PostgreSQL via `EXTERNAL_DATABASE_URL` Replit Secret
- `lib/db/src/index.ts` and `lib/db/drizzle.config.ts` now prefer `EXTERNAL_DATABASE_URL` over Replit's managed `DATABASE_URL`
- Schema synced to external DB on startup; API healthz confirmed healthy (149ms)

## Replit Setup (updated 2026-07-20, re-imported again)
- Re-imported project again: node_modules dropped by import — ran `pnpm install` and restarted the workflow
- Secrets, DB, and workflow config already in place; no changes needed
- Verified: API server on port 3001, frontend login page renders correctly on port 5000; schema sync passed cleanly

## Replit Setup (updated 2026-07-17, re-imported)
- Re-imported project again: node_modules dropped by import — ran `pnpm install` (679 packages) and restarted the workflow
- Secrets, DB, and workflow config already in place; no changes needed
- Verified: API server on port 3001, frontend login page renders correctly on port 5000

## Replit Setup (updated 2026-07-15, re-verified)
- Re-imported project again: node_modules was missing (dropped by import) — ran `pnpm install` (678 packages) and restarted the workflow
- Secrets, DB, and workflow config were already in place from previous sessions, no changes needed
- Verified: API `/api/healthz` returns healthy (DB latency 1ms), frontend login page renders correctly on port 5000

## Replit Setup (updated 2026-07-14)
- Dependencies installed via `pnpm install` (661 packages)
- `JWT_SECRET` and `BACKUP_SECRET` stored as Replit shared env vars
- `SESSION_SECRET` stored as a Replit Secret
- `DATABASE_URL` provided automatically by Replit's managed PostgreSQL (helium)
- Database schema applied via `pnpm db:push` (all tables created, no pending changes)
- Both servers start cleanly with `pnpm dev` (frontend :5000, API :3001)
- `postgresql-16` module in `.replit` keeps pg tools (pg_dump etc.) available
- Workflow `Start application` configured and running

### First-time setup on a fresh clone
1. Run `pnpm install`
2. Add `JWT_SECRET`, `BACKUP_SECRET`, and `SESSION_SECRET` as Replit Secrets (min 32 chars each — generate with `openssl rand -hex 48`)
3. Run `pnpm dev` — schema is applied automatically before servers start

## User Preferences
- Currency displayed in Nigerian Naira (NGN)
- pnpm for package management
