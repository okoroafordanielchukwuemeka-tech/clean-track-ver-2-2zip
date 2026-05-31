---
name: Customer Statement Feature
description: How the customer statement ledger works — backend endpoint and frontend tab
---

## Backend: GET /customers/:id/statement

Route in `artifacts/api-server/src/routes/customers.ts`. Must be declared BEFORE `/:id` route.

**Query params**: `from` (ISO date string), `to` (ISO date string). Defaults to last 90 days.

**Entry types**: `order`, `payment`, `discount`, `extra_charge`, `pickup`
- `order` → charge (+)
- `payment` → credit (-)
- `discount` → credit (-)  
- `extra_charge` → charge (+)
- `pickup` → informational (charge=0, credit=0, balance unchanged)

**Running balance**: cumulative `charge - credit` across all entries sorted chronologically. Negative `closingBalance` = customer is in credit (overpaid).

**Response shape**:
```ts
{ customer, period: { from, to }, entries: StatementEntry[], summary: { totalCharged, totalPaid, closingBalance, orderCount, paymentCount } }
```

## Frontend: Statement Tab in customers.tsx

Tab value `"statement"` in the 3-tab profile dialog (Orders | Receipts | Statement).

**Period selector**: 30d / 90d / custom (date inputs). `stmtParams` computed via IIFE based on `statementPeriod` state.

**Query enabled**: only when `profileTab === "statement"` — lazy fetch.

**Running balance table**: color-coded red (charge) / green (credit/balance). Negative balance shows `{fmt(Math.abs(e.balance))} CR`.

**Print/PDF**: `window.open("", "_blank")` → write HTML table with inline styles → `printWindow.print()`. No server-side PDF needed.

**Receipt links**: each `payment` entry shows an eye icon that opens the receipt print page in a new tab.

## Type
`CustomerStatement` and `StatementEntry` interfaces exported from `artifacts/clean-track/src/lib/api.ts`.
