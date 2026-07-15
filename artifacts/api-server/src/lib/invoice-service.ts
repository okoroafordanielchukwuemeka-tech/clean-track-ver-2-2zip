/**
 * Invoice Service — Phase 7.8
 *
 * Generates permanent, downloadable invoices for every billing event.
 * Invoices are rendered as print-friendly HTML (browser "print to PDF"),
 * the same pattern already used for receipts and the customer statement
 * (see Customer Statement Feature in memory) — no new PDF dependency needed.
 */
import { db } from "@workspace/db";
import { invoices, laundries, type InvoiceType } from "@workspace/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getPlanPricing, formatNGN, CURRENCY } from "./pricing.js";
import { PLAN_DISPLAY_NAMES } from "./entitlements.js";

async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  // Count existing invoices this year for a sequential, human-friendly number.
  const [{ count: existing }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(sql`extract(year from ${invoices.issueDate}) = ${year}`);

  const seq = (existing ?? 0) + 1;
  return `INV-${year}-${String(seq).padStart(6, "0")}`;
}

export interface CreateInvoiceParams {
  laundryId: number;
  type: InvoiceType;
  plan: string;
  billingPeriod?: string;
  amountNgn: number;
  status: "paid" | "pending" | "failed";
  paymentMethod: "paystack" | "manual" | "bank_transfer";
  transactionReference?: string;
  subscriptionPaymentId?: number;
  paidAt?: Date;
}

/**
 * Creates a permanent invoice record. Tax is currently 0 — CleanTrack does
 * not collect VAT on behalf of tenants at this time; the field exists so
 * this can be enabled later without a schema change.
 */
export async function createInvoice(params: CreateInvoiceParams) {
  const [laundry] = await db
    .select({
      businessName: laundries.businessName,
      ownerEmail: laundries.ownerEmail,
    })
    .from(laundries)
    .where(eq(laundries.id, params.laundryId));

  if (!laundry) throw new Error(`Laundry ${params.laundryId} not found`);

  const invoiceNumber = await nextInvoiceNumber();
  const planDisplayName = (PLAN_DISPLAY_NAMES as any)[params.plan] ?? params.plan;
  const issueDate = new Date();
  const dueDate = new Date(issueDate.getTime() + 3 * 86_400_000);

  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber,
      laundryId: params.laundryId,
      subscriptionPaymentId: params.subscriptionPaymentId ?? null,
      type: params.type,
      businessName: laundry.businessName,
      customerName: laundry.businessName,
      customerEmail: laundry.ownerEmail,
      plan: params.plan,
      planDisplayName,
      billingPeriod: params.billingPeriod ?? null,
      subtotalNgn: Math.round(params.amountNgn),
      taxNgn: 0,
      totalNgn: Math.round(params.amountNgn),
      status: params.status,
      paymentMethod: params.paymentMethod,
      transactionReference: params.transactionReference ?? null,
      issueDate,
      dueDate,
      paidAt: params.paidAt ?? (params.status === "paid" ? issueDate : null),
    })
    .returning();

  return invoice;
}

export async function markInvoicePaid(invoiceId: number, transactionReference: string, subscriptionPaymentId?: number) {
  const [invoice] = await db
    .update(invoices)
    .set({
      status: "paid",
      transactionReference,
      subscriptionPaymentId: subscriptionPaymentId ?? undefined,
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId))
    .returning();
  return invoice;
}

export async function markInvoiceFailed(invoiceId: number) {
  await db
    .update(invoices)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));
}

export async function listInvoices(laundryId: number, limit = 50) {
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.laundryId, laundryId))
    .orderBy(desc(invoices.issueDate))
    .limit(limit);
}

export async function getInvoice(laundryId: number, invoiceId: number) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!invoice || invoice.laundryId !== laundryId) return null;
  return invoice;
}

/**
 * Renders a print-friendly, standalone invoice HTML document. Opened in a
 * new tab and printed to PDF by the browser, matching the customer
 * statement pattern.
 */
export function renderInvoiceHtml(invoice: typeof invoices.$inferSelect): string {
  const statusColor =
    invoice.status === "paid" ? "#166534" : invoice.status === "pending" ? "#92400e" : "#991b1b";
  const statusBg =
    invoice.status === "paid" ? "#f0fdf4" : invoice.status === "pending" ? "#fffbeb" : "#fef2f2";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${invoice.invoiceNumber}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; margin: 0; padding: 40px; background: #fff; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1d4ed8; padding-bottom: 20px; margin-bottom: 24px; }
  .brand { font-size: 24px; font-weight: 800; color: #1d4ed8; }
  .invoice-title { text-align: right; }
  .invoice-title h1 { margin: 0; font-size: 22px; }
  .status-badge { display: inline-block; margin-top: 6px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: ${statusColor}; background: ${statusBg}; }
  .meta-grid { display: flex; justify-content: space-between; margin-bottom: 28px; }
  .meta-block h3 { font-size: 11px; text-transform: uppercase; color: #64748b; margin: 0 0 6px; letter-spacing: 0.05em; }
  .meta-block p { margin: 2px 0; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; padding: 10px 8px; }
  td { padding: 14px 8px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
  .totals { margin-left: auto; width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 6px 8px; font-size: 14px; }
  .totals-row.grand { font-weight: 800; font-size: 16px; border-top: 2px solid #0f172a; margin-top: 6px; padding-top: 10px; }
  .footer { margin-top: 40px; text-align: center; color: #94a3b8; font-size: 12px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">CleanTrack</div>
    <div class="invoice-title">
      <h1>${invoice.invoiceNumber}</h1>
      <span class="status-badge">${invoice.status}</span>
    </div>
  </div>
  <div class="meta-grid">
    <div class="meta-block">
      <h3>Billed to</h3>
      <p><strong>${invoice.businessName}</strong></p>
      <p>${invoice.customerName}</p>
      <p>${invoice.customerEmail}</p>
    </div>
    <div class="meta-block">
      <h3>Invoice details</h3>
      <p>Issued: ${new Date(invoice.issueDate).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}</p>
      <p>Due: ${new Date(invoice.dueDate).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}</p>
      ${invoice.paidAt ? `<p>Paid: ${new Date(invoice.paidAt).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}</p>` : ""}
      ${invoice.transactionReference ? `<p>Ref: ${invoice.transactionReference}</p>` : ""}
    </div>
  </div>
  <table>
    <thead><tr><th>Description</th><th>Type</th><th style="text-align:right;">Amount</th></tr></thead>
    <tbody>
      <tr>
        <td>CleanTrack ${invoice.planDisplayName} plan${invoice.billingPeriod ? ` — ${invoice.billingPeriod}` : ""}</td>
        <td>${invoice.type.replace(/_/g, " ")}</td>
        <td style="text-align:right;">${formatNGN(invoice.subtotalNgn)}</td>
      </tr>
    </tbody>
  </table>
  <div class="totals">
    <div class="totals-row"><span>Subtotal</span><span>${formatNGN(invoice.subtotalNgn)}</span></div>
    <div class="totals-row"><span>Tax</span><span>${formatNGN(invoice.taxNgn)}</span></div>
    <div class="totals-row grand"><span>Total (${CURRENCY})</span><span>${formatNGN(invoice.totalNgn)}</span></div>
  </div>
  <div class="footer">
    CleanTrack Laundry Operations Management &middot; support@cleantrack.ng<br>
    This is a computer-generated invoice and does not require a signature.
  </div>
</body>
</html>`;
}
