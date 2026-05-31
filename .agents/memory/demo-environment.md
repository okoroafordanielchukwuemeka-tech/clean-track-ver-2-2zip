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
- Login endpoint: `POST /api/auth/owner-login` (NOT `/api/auth/login`)

## Worker login
- Endpoint: `POST /api/auth/worker-login` with `{ phone, pin }`
- PINs assigned round-robin: ["1234","5678","2222","3333","4444","5555","6666","7777","8888","9999"]
- Verified: phone=08086235845, pin=3333 (Branch 1 / Lagos Island)

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
