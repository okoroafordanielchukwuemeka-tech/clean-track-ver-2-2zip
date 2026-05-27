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
- `artifacts/clean-track/` — React + Vite frontend (port 5173)
- `lib/db/` — PostgreSQL + Drizzle ORM database package
- `lib/api-spec/` — OpenAPI 3.1 specification

## Tech Stack
- **Frontend**: React 18, Vite, TailwindCSS, shadcn/ui, React Query, Recharts
- **Backend**: Node.js, Express, TypeScript, tsx
- **Database**: PostgreSQL (Drizzle ORM)
- **Language**: TypeScript throughout

## Running the Project
- API server: `cd artifacts/api-server && pnpm dev`
- Frontend: `cd artifacts/clean-track && pnpm dev`
- Database push: `cd lib/db && pnpm push`

## Required Environment Variables
- `DATABASE_URL` — PostgreSQL connection string

## User Preferences
- Currency displayed in Nigerian Naira (NGN)
- pnpm for package management
