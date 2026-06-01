import { Clock } from "lucide-react";
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
