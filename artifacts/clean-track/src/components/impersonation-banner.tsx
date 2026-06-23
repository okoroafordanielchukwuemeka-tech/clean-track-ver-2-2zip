import { useNavigate } from "react-router-dom";
import { ShieldAlert, X } from "lucide-react";

const APP_TOKEN_KEY = "ct_token";
const IMPERSONATION_BACKUP_KEY = "ct_admin_impersonation_backup";

function parseJwt(token: string): Record<string, any> | null {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export function useImpersonation() {
  const token = localStorage.getItem(APP_TOKEN_KEY);
  if (!token) return { isImpersonating: false, impersonatedBy: null, businessName: null };

  const payload = parseJwt(token);
  if (!payload?.impersonatedBy) return { isImpersonating: false, impersonatedBy: null, businessName: null };

  return {
    isImpersonating: true,
    impersonatedBy: payload.impersonatedBy as { adminId: number; adminName: string; adminEmail: string },
    businessName: payload.name as string | null,
  };
}

export function startImpersonation(impersonationToken: string): void {
  const current = localStorage.getItem(APP_TOKEN_KEY);
  if (current) {
    localStorage.setItem(IMPERSONATION_BACKUP_KEY, current);
  }
  localStorage.setItem(APP_TOKEN_KEY, impersonationToken);
  window.location.href = "/dashboard";
}

export function exitImpersonation(): void {
  const backup = localStorage.getItem(IMPERSONATION_BACKUP_KEY);
  localStorage.removeItem(APP_TOKEN_KEY);
  localStorage.removeItem(IMPERSONATION_BACKUP_KEY);
  if (backup) {
    localStorage.setItem(APP_TOKEN_KEY, backup);
  }
  window.location.href = "/admin";
}

export function ImpersonationBanner() {
  const { isImpersonating, impersonatedBy, businessName } = useImpersonation();

  if (!isImpersonating || !impersonatedBy) return null;

  return (
    <div className="w-full bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between text-sm font-medium z-50">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        <span>
          You are viewing as{" "}
          <strong>{businessName ?? "a customer workspace"}</strong>.
          Admin: <strong>{impersonatedBy.adminName}</strong> — this session is fully audited.
        </span>
      </div>
      <button
        onClick={exitImpersonation}
        className="flex items-center gap-1 bg-amber-700/20 hover:bg-amber-700/40 border border-amber-700/40 rounded px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ml-4"
      >
        <X className="w-3 h-3" />
        Exit Impersonation
      </button>
    </div>
  );
}
