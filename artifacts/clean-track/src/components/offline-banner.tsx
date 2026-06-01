import { WifiOff } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";

/**
 * Phase 2: Top-of-content offline banner.
 *
 * Rendered above the page <Outlet /> in the main layout. Visible
 * whenever the real network probe confirms the device is offline.
 * Tells the user they are looking at cached data and changes will
 * sync once connectivity is restored.
 */
export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 bg-slate-900/95 border-b border-slate-700/80 text-sm shrink-0">
      <WifiOff className="h-4 w-4 text-slate-400 shrink-0" />
      <span className="font-semibold text-slate-200">You're offline.</span>
      <span className="text-slate-400 hidden sm:inline">
        Displaying cached data — changes will sync when you reconnect.
      </span>
    </div>
  );
}
