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
}

export interface OrderPricing {
  basePrice: number;
  extraCharge: number;
  discount: number;
  /** basePrice + extraCharge - discount */
  totalDue: number;
  amountPaid: number;
  /** max(0, totalDue - amountPaid) — never negative */
  balance: number;
}

function toNumber(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Computes the canonical price breakdown for a single order.
 * Cancelled orders should be treated as ₦0 by the caller (as the Customer
 * Statement engine does) — this function computes the raw stored values;
 * it does not special-case order status since receipts are only ever
 * generated for non-cancelled orders.
 */
export function computeOrderPricing(order: OrderFinancialInput): OrderPricing {
  const basePrice = toNumber(order.price);
  const extraCharge = toNumber(order.extraCharge);
  const discount = toNumber(order.discount);
  const totalDue = basePrice + extraCharge - discount;
  const amountPaid = toNumber(order.amountPaid);
  const balance = Math.max(0, totalDue - amountPaid);

  return { basePrice, extraCharge, discount, totalDue, amountPaid, balance };
}
