import { useState, useEffect, useRef } from "react";
import { setIsOnline as updateSharedNetworkState } from "@/lib/network-state";

export interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
  lastSeenOnlineAt: Date | null;
}

const PROBE_INTERVAL_MS = 15_000;
const PROBE_URL = "/api/healthz";

/**
 * Tracks the real network status with two mechanisms:
 * 1. Browser online/offline events (fast, but can be unreliable)
 * 2. Active probing via HEAD /api/healthz every 15s (ground-truth verification)
 *
 * Returns:
 *  isOnline        — true if network is reachable
 *  wasOffline      — true if the app experienced at least one offline period this session
 *  lastSeenOnlineAt — Date when we last confirmed connectivity
 */
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [wasOffline, setWasOffline] = useState<boolean>(false);
  const [lastSeenOnlineAt, setLastSeenOnlineAt] = useState<Date | null>(
    navigator.onLine ? new Date() : null
  );

  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  const markOnline = () => {
    updateSharedNetworkState(true);
    setIsOnline(true);
    setLastSeenOnlineAt(new Date());
    isOnlineRef.current = true;
  };

  const markOffline = () => {
    updateSharedNetworkState(false);
    setIsOnline(false);
    setWasOffline(true);
    isOnlineRef.current = false;
  };

  useEffect(() => {
    const handleOnline = () => markOnline();
    const handleOffline = () => markOffline();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const probe = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(PROBE_URL, {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok || res.status < 500) {
          if (!isOnlineRef.current) markOnline();
        } else {
          if (isOnlineRef.current) markOffline();
        }
      } catch {
        if (isOnlineRef.current) markOffline();
      }
    };

    const probeTimer = setInterval(probe, PROBE_INTERVAL_MS);

    probe();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(probeTimer);
    };
  }, []);

  return { isOnline, wasOffline, lastSeenOnlineAt };
}
