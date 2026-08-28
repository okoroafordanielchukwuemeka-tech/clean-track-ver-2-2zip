import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { WashingMachine } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DemoLogin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { login } = useAuth();
  const attempted = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // Always do a fresh demo login — never rely on existing auth state.
    // Clear the React Query cache first so the dashboard always shows
    // up-to-date subscription/usage/analytics data (not stale IDB data).
    queryClient.clear();

    api.auth.demoLogin()
      .then((res) => {
        login(res.token, res.user);
        navigate("/dashboard", { replace: true });
      })
      .catch((err: any) => {
        setError(err?.message || "The demo workspace is temporarily unavailable.");
      });
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-900/70">
            <WashingMachine className="h-9 w-9 text-red-200" />
          </div>
          <h1 className="text-2xl font-bold text-white">Demo unavailable</h1>
          <p className="text-slate-400">{error}</p>
          <Button
            onClick={() => window.location.reload()}
            className="bg-[#0F766E] hover:bg-teal-700 text-white"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#0F766E] mb-2 animate-pulse">
          <WashingMachine className="h-9 w-9 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-white">CleanTrack</h1>
        <p className="text-slate-400">Loading demo workspace…</p>
      </div>
    </div>
  );
}
