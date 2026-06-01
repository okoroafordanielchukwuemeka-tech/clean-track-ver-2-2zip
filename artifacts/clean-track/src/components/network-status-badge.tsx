import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { syncEngine } from "@/lib/sync-engine";
import type { SyncState } from "@/lib/sync-engine";

export function NetworkStatusBadge() {
  const { isOnline } = useNetworkStatus();
  const [syncState, setSyncState] = useState<SyncState>(() =>
    syncEngine.getState()
  );

  useEffect(() => {
    const unsubscribe = syncEngine.subscribe(() => {
      setSyncState(syncEngine.getState());
    });
    return unsubscribe;
  }, []);

  const { pendingCount, failedCount, status } = syncState;
  const isSyncing = status === "syncing";
  const hasFailed = failedCount > 0;
  const hasPending = pendingCount > 0;

  if (isOnline && !hasPending && !hasFailed) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 mx-3 mb-1 rounded-md">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-xs text-sidebar-foreground/50 font-medium">Online</span>
      </div>
    );
  }

  if (isOnline && isSyncing) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 mx-3 mb-1 rounded-md bg-blue-950/40">
        <RefreshCw className="h-3 w-3 text-blue-400 animate-spin" />
        <span className="text-xs text-blue-400 font-medium">Syncing…</span>
      </div>
    );
  }

  if (isOnline && hasPending) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 mx-3 mb-1 rounded-md bg-amber-950/40 border border-amber-800/40">
        <Wifi className="h-3 w-3 text-amber-400" />
        <span className="flex-1 text-xs text-amber-400 font-medium">Online</span>
        <span
          className={cn(
            "text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1",
            hasFailed ? "bg-red-600 text-white" : "bg-amber-500 text-white"
          )}
        >
          {hasFailed ? failedCount : pendingCount}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mx-3 mb-1 rounded-md bg-slate-800/60 border border-slate-700/50">
      <WifiOff className="h-3 w-3 text-slate-400" />
      <span className="flex-1 text-xs text-slate-400 font-medium">Offline</span>
      {hasPending && (
        <span className="text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 bg-amber-500 text-white">
          {pendingCount}
        </span>
      )}
    </div>
  );
}
