import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { WashingMachine } from "lucide-react";

const DEMO_EMAIL = "demo@cleantrack.ng";
const DEMO_PASSWORD = "Demo@1234";

export default function DemoLogin() {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const attempted = useRef(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (attempted.current) return;
    attempted.current = true;

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
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-2 animate-pulse">
          <WashingMachine className="h-9 w-9 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-white">Clean Track</h1>
        <p className="text-slate-400">Loading demo workspace…</p>
      </div>
    </div>
  );
}
