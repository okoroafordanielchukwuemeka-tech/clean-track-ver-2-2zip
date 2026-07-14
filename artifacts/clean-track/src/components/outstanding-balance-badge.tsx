import { cn } from "@/lib/utils";

interface OutstandingBalanceBadgeProps {
  balance: number;
  className?: string;
}

function formatCurrency(v: number): string {
  return `₦${v.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

/**
 * Reusable "balance due" pill used anywhere an order/customer/statement row
 * needs to flag an outstanding amount (orders table, customer list, order
 * detail header, statement rows). Renders nothing when there's nothing owed.
 */
export function OutstandingBalanceBadge({ balance, className }: OutstandingBalanceBadgeProps) {
  if (!balance || balance <= 0) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full",
        "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      Owes {formatCurrency(balance)}
    </span>
  );
}
