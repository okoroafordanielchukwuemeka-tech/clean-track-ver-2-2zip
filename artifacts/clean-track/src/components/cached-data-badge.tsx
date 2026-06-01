import { DatabaseZap } from "lucide-react";
import { cn } from "@/lib/utils";

interface CachedDataBadgeProps {
  show: boolean;
  className?: string;
}

/**
 * Inline badge shown next to a page title when the displayed data
 * is coming from the persisted IndexedDB cache rather than a fresh
 * network response (i.e. the device is offline or the server is
 * unreachable but a previous response is cached).
 */
export function CachedDataBadge({ show, className }: CachedDataBadgeProps) {
  if (!show) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full",
        "bg-amber-100 text-amber-800 border border-amber-200",
        "dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800/50",
        className
      )}
    >
      <DatabaseZap className="h-3 w-3" />
      Viewing Cached Data
    </span>
  );
}
