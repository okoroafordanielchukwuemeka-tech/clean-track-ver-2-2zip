# RECEIPT_BRANDING_CERTIFICATION.md
## Phase 7.17.2B.3B — Receipt Branding & Business Identity
**Date:** 2026-07-20  
**Status:** ✅ CERTIFIED — LAUNCH READY

---

## 1. Issues Found & Fixed

### 1.1 Logo Upload — "Coming Soon" Placeholder (FIXED)
**Issue:** The Business Profile settings page showed a disabled "Coming soon" banner with no actual upload functionality. `logoUrl` was in the DB schema but no upload endpoint existed.

**Fix:**
- Added `POST /api/settings/logo` — multipart file upload using the existing `StorageDriver` abstraction (local disk or Cloudinary)
- Added `DELETE /api/settings/logo` — removes the file from storage and clears `logoUrl` from the DB
- Added `LogoUploadSection` React component in Settings > Business Profile with:
  - Live preview of current logo
  - Upload / Replace button
  - Remove Logo button with confirmation state
  - Supports JPG, PNG, WEBP up to 5 MB
  - Shows loading state during upload

**Files changed:**
- `artifacts/api-server/src/routes/settings.ts`
- `artifacts/clean-track/src/lib/api.ts` (`uploadLogo`, `deleteLogo` methods)
- `artifacts/clean-track/src/pages/settings.tsx` (`LogoUploadSection` component)

---

### 1.2 Logo Too Small & No Placeholder (FIXED)
**Issue:** Logo was capped at `80px × 60px`, which rendered too small for any meaningful branding. When no logo was uploaded, nothing was shown — no indication the field existed.

**Fix:**
- Logo CSS updated to `max-width: 140px; max-height: 90px; object-fit: contain` — scales proportionally, never stretches, never overflows
- Added `LogoPlaceholder` component: renders a rounded tile with the business initials (up to 2 letters) when no logo is uploaded — clean, professional fallback
- Added `print-color-adjust: exact` so logo colours render correctly when printing

**Files changed:**
- `artifacts/clean-track/src/components/receipt-view.tsx`
- `artifacts/clean-track/src/components/pickup-receipt-view.tsx`
- `artifacts/clean-track/src/index.css`

---

### 1.3 Bank Account Hidden Unless Balance > 0 (FIXED)
**Issue:** Bank name, account name, and account number were inside a `pricing.balance > 0` conditional block — meaning fully-paid orders showed no payment details. Per spec, bank account must always appear.

**Fix:**
- Extracted bank details to a dedicated `receipt-bank-block` section in the receipt header, always rendered when `paymentDetails` is configured
- Visual treatment: subtle bordered block below the header contact info, compact single-line format (`Bank: GTBank · 0123456789`)
- Payment instructions (free-text) remain in the balance-due section only when there is a remaining balance

**Files changed:**
- `artifacts/clean-track/src/components/receipt-view.tsx`
- `artifacts/clean-track/src/index.css` (`.receipt-bank-block`, `.receipt-bank-line`, `.receipt-bank-label`, `.receipt-bank-value` classes)

---

### 1.4 Missing `website` Field (FIXED)
**Issue:** No `website` field anywhere in the system — not in the DB schema, settings UI, API endpoints, or receipt view.

**Fix:**
- Added `website: z.string().url().optional().or(z.literal(""))` to `businessProfileSchema` in `settings.ts`
- Added `website` input to Settings > Business Profile form
- Added `website` to `BusinessProfile` TypeScript interface in `api.ts`
- Receipt header renders website (with `https://` stripped) when present
- Both `GET /receipts/:num` and `GET /orders/:id/receipt` now include `website` in the `laundry` object

**Files changed:**
- `artifacts/api-server/src/routes/settings.ts`
- `artifacts/api-server/src/routes/receipts.ts`
- `artifacts/api-server/src/routes/orders.ts`
- `artifacts/clean-track/src/lib/api.ts`
- `artifacts/clean-track/src/pages/settings.tsx`
- `artifacts/clean-track/src/components/receipt-view.tsx`

---

### 1.5 Receipt Actions — Share & Download Missing (FIXED)
**Issue:** The print page had only "Print / Save as PDF" and format selector buttons. No Share or Download actions.

**Fix:**
- **Share button:** Uses `navigator.share()` (native share sheet on mobile/desktop where supported), falls back to `navigator.clipboard.writeText()` to copy the receipt URL, falls back to `window.prompt()` if clipboard is unavailable. Shows "✓ Link copied" / "✓ Shared" confirmation.
- **Download PDF button:** Triggers `window.print()` (browser Save-as-PDF dialog) with tooltip clarifying the path. This is the correct web-native approach — no PDF library dependency needed.
- Actions reorganised into a two-row layout: format selector row + action buttons row.

**Files changed:**
- `artifacts/clean-track/src/pages/receipt-print.tsx`

---

### 1.6 Print CSS — Global `@page` Broke A4 (FIXED)
**Issue:** `@page { size: 80mm auto }` was a global rule that affected all print jobs, including A4 format. Switching to A4 in the UI still printed on a narrow 80mm roll.

**Fix:**
- Removed the global `@page` rule from `index.css`
- `receipt-print.tsx` now dynamically injects a `<style id="receipt-page-style">` tag whenever the format changes:
  - `58mm` → `@page { size: 58mm auto; margin: 2mm; }`
  - `80mm` → `@page { size: 80mm auto; margin: 2mm; }`
  - `a4` → `@page { size: A4 portrait; margin: 12mm; }`
- Added `print-color-adjust: exact` to logo, bank block, and status badge elements so colours print correctly

**Files changed:**
- `artifacts/clean-track/src/pages/receipt-print.tsx`
- `artifacts/clean-track/src/index.css`

---

### 1.7 Receipt Visual Hierarchy — Improved (FIXED)
**Issue:** Header contact lines had no weight differentiation. Branch name was styled the same as address/phone/email.

**Fix:**
- Branch name receives `receipt-branch-name` class (semi-bold, slightly darker)
- Website rendered with `receipt-website` class (muted tone, clearly secondary)
- Bank block uses bordered tile treatment to separate it visually from contact info
- Logo placeholder gives receipts a clean professional stub even before a logo is uploaded

---

### 1.8 Mobile Responsiveness — Audit & Improvements (FIXED)
**Issue:** No mobile-specific receipt styles existed. Print action buttons could overflow on small screens.

**Fix:**
- Added `@media (max-width: 480px)` rules:
  - Action buttons stack vertically, full-width
  - Font size reduced to 12px, padding tightened
  - Business name font reduced to 15px
  - Logo capped smaller (110px × 70px) to avoid cropping on 58mm-equivalent mobile widths

**Files changed:**
- `artifacts/clean-track/src/index.css`

---

### 1.9 Pickup Receipt — Same Issues (FIXED)
**Issue:** `pickup-receipt-view.tsx` had the same logo-no-placeholder and balance-gated payment info problems as the main receipt view.

**Fix:**
- Added initials-based `LogoPlaceholder` inline
- Added `email` to pickup receipt header (was missing)
- Moved payment instructions to balance-only section (consistent with main receipt)

**Files changed:**
- `artifacts/clean-track/src/components/pickup-receipt-view.tsx`

---

## 2. Business Settings → Receipt Propagation

Every business identity field is fetched fresh from the DB on every receipt request — there is no cache between the settings save and receipt generation. Changes to any of the following propagate immediately to newly generated receipts:

| Field | Settings section | Receipt location |
|---|---|---|
| Business Name | Business Profile | Header — large title |
| Logo | Business Profile | Header — above title |
| Phone | Business Profile | Header — contact line |
| Email | Business Profile | Header — contact line |
| Address | Business Profile | Header — contact line |
| Website | Business Profile | Header — contact line (new) |
| Bank Name | Business Profile → Payment Details | Bank block — always visible (fixed) |
| Account Number | Business Profile → Payment Details | Bank block — always visible (fixed) |
| Account Name | Business Profile → Payment Details | Bank block — always visible (fixed) |
| Payment Instructions | Business Profile → Payment Details | Balance-due section only |
| Receipt Header Name | Branding | Header — overrides business name |
| Receipt Footer Text | Branding | Footer |

---

## 3. Receipt Actions — Verification Summary

| Action | Mechanism | Status |
|---|---|---|
| **View** | In-app `ReceiptView` component on order detail + receipts pages | ✅ Working |
| **Print** | `window.print()` — triggers browser print dialog | ✅ Working |
| **PDF** | Print dialog → "Save as PDF" destination (browser-native) | ✅ Working |
| **Download** | "Download PDF" button → `window.print()` with PDF tooltip | ✅ Working |
| **Share** | Web Share API with clipboard fallback | ✅ Working |

---

## 4. Print Optimization — Audit Results

| Check | Result |
|---|---|
| Margins | ✅ Dynamic per format (2mm thermal, 12mm A4) |
| Page breaks | ✅ `break-inside: avoid` on sections, table rows, barcode |
| Logo quality | ✅ `print-color-adjust: exact`, `object-fit: contain`, no stretching |
| Typography | ✅ Courier New monospace, appropriate size per format |
| No clipping | ✅ `max-width: 100%` on `receipt-root` during print; 58mm layout verified |
| No cropped sections | ✅ A4 now uses correct `@page { size: A4 }`, content uses `max-width: 190mm` |
| Status badges | ✅ `print-color-adjust: exact` added |

---

## 5. Mobile Receipt Audit

| Check | Result |
|---|---|
| Responsive layout | ✅ Action buttons stack vertically below 480px |
| Readable typography | ✅ 12px base, 15px business name on mobile |
| Correct spacing | ✅ Padding tightened (12px) |
| Buttons remain usable | ✅ Full-width buttons, min tap target maintained |
| Logo not cropped | ✅ Max 110px×70px on mobile |

---

## 6. Remaining Risks

| Risk | Severity | Notes |
|---|---|---|
| Logo upload requires Cloudinary in production for CDN performance | Low | Falls back to local disk storage which works fine for moderate traffic. Configure `CLOUDINARY_*` secrets when scaling. |
| Web Share API availability | Very Low | Available in all modern mobile browsers and Chrome/Edge on desktop. Receipt URL clipboard fallback covers all other cases. |
| Logo dimensions for very tall logos (e.g. 1:3 aspect ratio) | Low | `object-fit: contain` prevents distortion but tall logos may appear small within the 90px height cap. Owners should upload landscape or square logos. |

---

## 7. Launch Readiness

**VERDICT: ✅ GO**

All 9 issues found during the audit have been resolved. Receipt branding is now complete:
- Logo upload, replace, and delete work end-to-end
- Business identity fields (name, address, phone, email, website, bank) all appear on receipts
- Bank account is always visible — not gated on payment status
- Logo renders correctly on screen, mobile, and print
- Print formats (58mm, 80mm, A4) each use the correct paper size
- Share and Download actions are functional
- Settings changes propagate immediately to new receipts

No blocking issues remain for this phase.
