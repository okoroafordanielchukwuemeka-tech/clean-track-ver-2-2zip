---
name: Railway Deployment
description: Phase 7.19A audit findings and Railway production deployment preparation notes
---

# Railway Deployment Notes

## What was done (Phase 7.19A)
- Created `artifacts/api-server/build.mjs` — esbuild bundles `@workspace/*` inline, keeps npm packages external
- Created `railway.toml` — build: `pnpm install && pnpm build`; start: `db:push && node artifacts/api-server/dist/index.js`; healthcheck: `/api/healthz`
- Fixed `STORAGE_ROOT` in `storage.ts` — now respects `LOCAL_UPLOAD_PATH` env var
- Added React.lazy to 39 pages in `App.tsx` — Vite now code-splits each route

## Critical deploy requirements
- `NODE_ENV=production` must be set — triggers `ALLOWED_ORIGINS` enforcement (process.exit if missing)
- `ALLOWED_ORIGINS` must be set in production — enforced in `env-validation.ts`
- Cloudinary required in production — local disk storage is NOT persistent on Railway
- Three required secrets: `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `BACKUP_SECRET` (≥32 chars)

## Migration situation
- Checked-in Drizzle migrations now cover the complete schema, including the baseline tables added after the original audit.
- Railway startup uses `pnpm --filter @workspace/db migrate`, so production schema changes are reviewable and replayable.
- A fresh Neon database can apply the complete journal in order; existing databases should be backed up and reconciled before adopting the journal.

## Build architecture (production)
- API server: esbuild compiles `src/index.ts` → `dist/index.js` (ESM, Node 20)
- `@workspace/db` TypeScript source bundled inline (exports `.ts` files, can't be external)
- Frontend: Vite builds `artifacts/clean-track/dist/`
- In production, API server serves frontend static files from `../clean-track/dist` (relative to `dist/`)
- SPA catch-all: `/^(?!\/api\/).*$/` → `index.html`

**Why:** `@workspace/db` package.json exports raw `.ts` files — Node.js can't run them. Must bundle inline.

## Known performance risks (acceptable for launch)
- `GET /customers` — in-memory filtering/sorting; no DB-level pagination. Safe < 5,000 customers.
- Analytics routes — in-memory aggregation over all orders. Safe < 10,000 orders per account.
- The dashboard's Recharts dependency is isolated into a lazy chunk; it is not part of the initial login shell.

## Full audit report
`docs/PHASE_7_19A_AUDIT.md` — score 91/100, complete deployment checklist inside
