import { AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface PendingSyncBadgeProps {
  className?: string;
}

/**
 * Inline badge shown next to records that have been saved locally
 * while offline and are waiting to be synced to the server.
 *
 * The badge disappears automatically once Phase 3B sync runs and
 * sets the record's syncStatus to "synced".
 */
export function PendingSyncBadge({ className }: PendingSyncBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full",
        "bg-blue-100 text-blue-800 border border-blue-200",
        "dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800/50",
        className
      )}
    >
      <Clock className="h-3 w-3" />
      Pending Sync
    </span>
  );
}

interface ConflictSyncBadgeProps {
  className?: string;
  message?: string;
}

/**
 * Inline badge shown next to payment records that permanently failed
 * sync due to a financial conflict (e.g. order already paid, overpayment).
 *
 * These payments require manual review — they will not be retried
 * automatically.  The syncLog contains a "CONFLICT:<code>:" prefix
 * entry for detailed diagnostics.
 */
export function ConflictSyncBadge({ className, message }: ConflictSyncBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full",
        "bg-red-100 text-red-800 border border-red-200",
        "dark:bg-red-950/50 dark:text-red-400 dark:border-red-800/50",
        className
      )}
    >
      <AlertCircle className="h-3 w-3" />
      {message ?? "Sync Conflict"}
    </span>
  );
}
