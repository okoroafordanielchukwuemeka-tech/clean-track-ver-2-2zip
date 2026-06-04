import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { isClientOutdated, subscribeOutdated } from "@/lib/api";

/**
 * Persistent banner shown when the server signals that the running client
 * version is below the minimum it supports.
 *
 * Displayed above the main content area (inside Layout, above <main>).
 * The user can dismiss it for the session, but it reappears on next load
 * if the version is still outdated.
 *
 * The banner does NOT block usage — workers can keep operating offline.
 * It only prompts a hard-reload to pick up the latest service-worker build.
 */
export function OutdatedClientBanner() {
  const [outdated, setOutdated] = useState(() => isClientOutdated());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return subscribeOutdated(() => setOutdated(true));
  }, []);

  if (!outdated || dismissed) return null;

  return (
    <div className="bg-amber-500 text-white px-4 py-2 flex items-center gap-3 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        A newer version of CleanTrack is available. Reload the page to get the
        latest updates and ensure your data syncs correctly.
      </span>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 rounded px-2.5 py-1 text-xs font-medium transition-colors shrink-0"
      >
        <RefreshCw className="h-3 w-3" />
        Reload now
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="hover:bg-white/20 rounded p-1 transition-colors shrink-0"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
