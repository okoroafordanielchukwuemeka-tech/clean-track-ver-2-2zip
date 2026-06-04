import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { syncEngine } from "./lib/sync-engine";
import { runRecovery } from "./lib/recovery";
import { initTelemetry } from "./lib/telemetry";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

syncEngine.start();
runRecovery()
  .catch(err => console.error("[CleanTrack] Startup recovery failed:", err))
  .finally(() => initTelemetry());

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        if (registrations.length === 0) {
          console.info("[CleanTrack] Service worker not yet registered — PWA build required.");
        } else {
          console.info(`[CleanTrack] ${registrations.length} service worker(s) active.`);
        }
      })
      .catch(() => {});
  });
}
