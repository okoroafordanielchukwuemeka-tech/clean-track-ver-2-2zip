/**
 * Shared order and payment status badge utilities.
 * Single source of truth for all status rendering across Orders, Order Detail,
 * Receipts, Discount Approvals, and Worker Station.
 */
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Clock, XCircle } from "lucide-react";

// ── Order Status ──────────────────────────────────────────────────────────────

const ORDER_STATUS_VARIANT: Record<string, "warning" | "info" | "success" | "outline" | "destructive"> = {
  pending:        "warning",
  processing:     "info",
  ready:          "success",
  partial_pickup: "warning",
  completed:      "success",
  cancelled:      "destructive",
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending:        "Pending",
  processing:     "Processing",
  ready:          "Ready",
  partial_pickup: "Partial Pickup",
  completed:      "Completed",
  cancelled:      "Cancelled",
};

export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = ORDER_STATUS_VARIANT[status] ?? "outline";
  const label = ORDER_STATUS_LABEL[status] ?? status;
  return <Badge variant={variant} className={className}>{label}</Badge>;
}

// ── Payment Status ─────────────────────────────────────────────────────────────

const PAYMENT_STATUS_VARIANT: Record<string, "destructive" | "warning" | "success" | "outline"> = {
  unpaid:  "destructive",
  partial: "warning",
  paid:    "success",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid:  "Unpaid",
  partial: "Partial",
  paid:    "Paid",
};

export function PaymentStatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = PAYMENT_STATUS_VARIANT[status] ?? "outline";
  const label = PAYMENT_STATUS_LABEL[status] ?? status;
  return <Badge variant={variant} className={className}>{label}</Badge>;
}

// ── Payment Method ─────────────────────────────────────────────────────────────

const PAYMENT_METHOD_VARIANT: Record<string, "success" | "info" | "default" | "outline"> = {
  cash:     "success",
  transfer: "info",
  pos:      "default",
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash:     "Cash",
  transfer: "Transfer",
  pos:      "POS",
};

export function PaymentMethodBadge({ method, className }: { method: string; className?: string }) {
  const variant = PAYMENT_METHOD_VARIANT[method] ?? "outline";
  const label = PAYMENT_METHOD_LABEL[method] ?? method;
  return <Badge variant={variant} className={className}>{label}</Badge>;
}

// ── Discount / Approval Status ─────────────────────────────────────────────────

export function DiscountStatusBadge({ status, className }: { status: string; className?: string }) {
  if (status === "pending")
    return <Badge variant="warning" className={`gap-1 ${className ?? ""}`}><Clock className="h-3 w-3" />Pending</Badge>;
  if (status === "approved")
    return <Badge variant="success" className={`gap-1 ${className ?? ""}`}><CheckCircle className="h-3 w-3" />Approved</Badge>;
  return <Badge variant="destructive" className={`gap-1 ${className ?? ""}`}><XCircle className="h-3 w-3" />Rejected</Badge>;
}
