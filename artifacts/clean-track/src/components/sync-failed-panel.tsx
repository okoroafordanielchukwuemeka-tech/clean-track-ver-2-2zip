import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useFailedSyncEntries } from "@/hooks/use-pending-local";
import { requeueFailedEntry, requeueAllFailed } from "@/lib/queue-service";
import type { SyncQueueEntry } from "@/lib/local-db";

const OPERATION_LABELS: Record<string, string> = {
  create_customer: "Create Customer",
  create_order: "Create Order",
  update_order_status: "Update Order Status",
  record_payment: "Record Payment",
  record_pickup: "Record Pickup",
};

function formatAge(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function stripConflictPrefix(error: string | null): string {
  if (!error) return "Unknown error";
  return error.replace(/^CONFLICT:[A-Z_]+:\s*/, "");
}

function isConflictEntry(entry: SyncQueueEntry): boolean {
  return (entry.lastError ?? "").startsWith("CONFLICT:");
}

interface FailedEntryRowProps {
  entry: SyncQueueEntry;
  onRetry: (id: number) => void;
  retrying: boolean;
}

function FailedEntryRow({ entry, onRetry, retrying }: FailedEntryRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isConflict = isConflictEntry(entry);
  const label = OPERATION_LABELS[entry.operation] ?? entry.operation;
  const errorMessage = stripConflictPrefix(entry.lastError);

  return (
    <div className="border border-amber-200/60 dark:border-amber-700/40 rounded-md overflow-hidden text-xs">
      <div className="flex items-start gap-2 px-3 py-2 bg-amber-50/60 dark:bg-amber-900/10">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-amber-900 dark:text-amber-200">{label}</span>
            {isConflict && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
                CONFLICT
              </span>
            )}
            <span className="text-amber-600/70 dark:text-amber-400/60">
              {formatAge(entry.createdAt ?? new Date().toISOString())}
            </span>
          </div>
          <p className="mt-0.5 text-amber-800/80 dark:text-amber-300/70 truncate pr-2">
            {errorMessage}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!isConflict && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-amber-700 hover:text-amber-900 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
              onClick={() => onRetry(entry.id!)}
              disabled={retrying}
              title="Retry this item"
            >
              <RefreshCw className={cn("h-3 w-3", retrying && "animate-spin")} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-amber-600/70 hover:text-amber-900 hover:bg-amber-100 dark:text-amber-400/60 dark:hover:bg-amber-900/30"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "Collapse" : "Show details"}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 py-2 bg-white/80 dark:bg-slate-900/40 border-t border-amber-100 dark:border-amber-800/30 space-y-1">
          <div className="flex gap-2">
            <span className="text-slate-400 w-20 shrink-0">Operation</span>
            <code className="text-slate-700 dark:text-slate-300 break-all">{entry.operation}</code>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-400 w-20 shrink-0">Local ID</span>
            <code className="text-slate-700 dark:text-slate-300 break-all">{entry.localId}</code>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-400 w-20 shrink-0">Attempts</span>
            <span className="text-slate-700 dark:text-slate-300">{entry.attempts}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-400 w-20 shrink-0">Error</span>
            <span className="text-red-600 dark:text-red-400 break-all">{entry.lastError ?? "—"}</span>
          </div>
          {isConflict && (
            <p className="mt-1 text-slate-500 dark:text-slate-400 italic">
              This is a data conflict that cannot be resolved by retrying. Please review the record manually.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline panel rendered just below the offline banner in the main layout.
 *
 * Shows only when there are sync queue entries with status="failed".
 * Provides:
 *  - A count badge so the operator sees problems at a glance
 *  - An expandable list of each failed operation with its error message
 *  - Per-item "Retry" button and a global "Retry All" button
 *  - Conflict entries are shown read-only (retrying would not help)
 */
export function SyncFailedPanel() {
  const failed = useFailedSyncEntries();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);

  if (failed.length === 0 || dismissed) return null;

  const retryable = failed.filter((e) => !isConflictEntry(e));
  const conflicts = failed.filter((e) => isConflictEntry(e));

  const handleRetry = async (id: number) => {
    setRetryingId(id);
    try {
      await requeueFailedEntry(id);
    } finally {
      setRetryingId(null);
    }
  };

  const handleRetryAll = async () => {
    setRetryingAll(true);
    try {
      await requeueAllFailed();
    } finally {
      setRetryingAll(false);
    }
  };

  return (
    <div className="border-b border-amber-300/60 bg-amber-50/95 dark:bg-amber-900/20 dark:border-amber-700/40 shrink-0">
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />

        <div className="flex-1 flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-semibold text-sm text-amber-900 dark:text-amber-200">
            {failed.length} sync item{failed.length !== 1 ? "s" : ""} failed
          </span>
          {retryable.length > 0 && (
            <span className="text-sm text-amber-700/80 dark:text-amber-300/70 hidden sm:inline">
              — {retryable.length} retryable, {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {retryable.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/40"
              onClick={handleRetryAll}
              disabled={retryingAll}
            >
              <RotateCcw className={cn("h-3 w-3 mr-1", retryingAll && "animate-spin")} />
              Retry All
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-amber-700/70 hover:text-amber-900 hover:bg-amber-100 dark:text-amber-400/60 dark:hover:bg-amber-900/30"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "Collapse" : "Show failed items"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-amber-700/70 hover:text-amber-900 hover:bg-amber-100 dark:text-amber-400/60 dark:hover:bg-amber-900/30"
            onClick={() => setDismissed(true)}
            title="Dismiss (items are still in the queue)"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5 max-h-72 overflow-y-auto">
          {failed.map((entry) => (
            <FailedEntryRow
              key={entry.id}
              entry={entry}
              onRetry={handleRetry}
              retrying={retryingId === entry.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
