import { useState, useEffect } from "react";
import { syncEngine, type SyncState } from "@/lib/sync-engine";
import { cn } from "@/lib/utils";

/**
 * SyncProgressBar
 *
 * Shown during processQueue() cycles that have 20+ entries so workers get
 * live feedback during large offline-batch sync events.  Hidden instantly
 * when the cycle completes (progress is cleared to null by the engine).
 *
 * Visibility threshold (≥ 20 entries):
 *  - Small queues (< 20) finish so fast the bar would flash and disappear,
 *    which is more disorienting than showing nothing.
 *  - Large queues genuinely benefit from progress feedback to reassure
 *    workers that the device is not frozen.
 */
export function SyncProgressBar() {
  const [state, setState] = useState<SyncState>(syncEngine.getState());

  useEffect(() => {
    return syncEngine.subscribe(() => {
      setState(syncEngine.getState());
    });
  }, []);

  const { progress } = state;

  if (!progress || progress.total < 20) return null;

  const pct = progress.total > 0
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : 0;

  return (
    <div className="bg-teal-50 dark:bg-teal-950/40 border-b border-teal-200 dark:border-teal-800 px-4 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-teal-700 dark:text-teal-300 truncate">
          Syncing queue — {progress.phase}
        </span>
        <span
          className={cn(
            "text-xs tabular-nums ml-2 shrink-0",
            pct === 100
              ? "text-green-600 dark:text-green-400"
              : "text-teal-600 dark:text-teal-400"
          )}
        >
          {progress.done}/{progress.total} ({pct}%)
        </span>
      </div>
      <div className="w-full bg-teal-200 dark:bg-teal-800/60 rounded-full h-1.5 overflow-hidden">
        <div
          className={cn(
            "h-1.5 rounded-full transition-all duration-200",
            pct === 100
              ? "bg-green-500 dark:bg-green-400"
              : "bg-[#0F766E] dark:bg-teal-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
