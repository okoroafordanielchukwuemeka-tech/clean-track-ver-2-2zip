import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { WashingMachine } from "lucide-react";

export default function DemoLogin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { login } = useAuth();
  const attempted = useRef(false);

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
      .catch(() => {
        navigate("/login", { replace: true });
      });
  }, []);

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
