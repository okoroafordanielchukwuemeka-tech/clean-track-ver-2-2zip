---
name: Demo Environment
description: Credentials, structure, and seeder for the CleanTrack demo data environment
---

## Seed script
`scripts/seed-demo.ts` — run with `npx tsx scripts/seed-demo.ts` from workspace root.
Script is idempotent: re-running skips already-created records (checks by email / count).

## Owner credentials
- Email: `demo@cleantrack.ng`
- Password: `Demo@1234`

## Data structure
- 1 laundry: "CleanTrack Demo Laundry"
- 5 branches: Lagos Island, Ikeja, Victoria Island, Lekki, Surulere
- 20 workers: 4 per branch (1 admin + 3 workers), PIN-based login
- 200 customers: 40 per branch
- 1000 orders: 200 per branch, spread over last 90 days
- 10 services in catalog (clothing, formal, traditional, bedding, footwear)
- Payments, discount approvals, expenditures all seeded

## Discount settings
- autoApprovalThreshold: ₦500 (≤500 → auto-approved, >500 → pending)
- maxDiscountPerOrder: ₦5,000
- maxDiscountPercentage: 20%

## Known worker credentials (from last seed run)
- Branch A (Lagos Island): Phone `08072773142` | PIN `1234`
- Branch B (Ikeja): Phone `08045589928` | PIN `4444`
(These may differ after a re-seed since names/phones are random — check seeder output)
