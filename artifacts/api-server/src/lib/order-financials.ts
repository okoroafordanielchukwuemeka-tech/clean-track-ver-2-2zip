/**
 * CleanTrack — Single Source of Truth for Order-Level Financial Calculations
 *
 * Every printable/exportable document (Order Receipt, Payment Receipt,
 * Pickup Receipt) that needs an order's price breakdown MUST derive it
 * from this module instead of re-deriving the formula inline.
 *
 * This mirrors exactly the per-order math used by the verified Customer
 * Statement engine (artifacts/api-server/src/routes/customers.ts):
 *   totalDue = basePrice + extraCharge - discount
 *   balance  = max(0, totalDue - amountPaid)
 *
 * Before this module existed, receipts.ts, orders.ts (/:id/receipt) and
 * pickups.ts each re-implemented this formula independently — functionally
 * identical today, but a future edit to one call site (e.g. rounding,
 * cancelled-order handling) could silently desync the documents. Centralizing
 * it here removes that risk.
 */

export interface OrderFinancialInput {
  price: string | number | null | undefined;
  extraCharge: string | number | null | undefined;
  discount: string | number | null | undefined;
  amountPaid: string | number | null | undefined;
  /** Optional — when "cancelled", pricing zeroes out per the rule documented below. */
  status?: string | null;
}

export interface OrderPricing {
  basePrice: number;
  extraCharge: number;
  discount: number;
  /** basePrice + extraCharge - discount (0 for cancelled orders) */
  totalDue: number;
  amountPaid: number;
  /** max(0, totalDue - amountPaid) — never negative */
  balance: number;
  /** True when the source order's status was "cancelled" */
  isCancelled: boolean;
}

function toNumber(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Computes the canonical price breakdown for a single order.
 *
 * Cancelled orders are zeroed out (basePrice/extraCharge/discount/totalDue = 0,
 * balance = 0) to exactly match how the Customer Statement engine treats them
 * (artifacts/api-server/src/routes/customers.ts — "Cancelled orders contribute
 * ₦0 to balance"). Before this, Order/Payment/Pickup receipts ignored order
 * status entirely and would show the pre-cancellation totalDue/balance, which
 * could never reconcile against the Statement for the same order. amountPaid
 * is preserved as-is (it is a historical fact — money that was actually
 * collected — not something cancellation erases); any refund process for that
 * money is a separate, out-of-scope workflow.
 */
export function computeOrderPricing(order: OrderFinancialInput): OrderPricing {
  const isCancelled = order.status === "cancelled";
  const basePrice = isCancelled ? 0 : toNumber(order.price);
  const extraCharge = isCancelled ? 0 : toNumber(order.extraCharge);
  const discount = isCancelled ? 0 : toNumber(order.discount);
  const totalDue = basePrice + extraCharge - discount;
  const amountPaid = toNumber(order.amountPaid);
  const balance = Math.max(0, totalDue - amountPaid);

  return { basePrice, extraCharge, discount, totalDue, amountPaid, balance, isCancelled };
}
