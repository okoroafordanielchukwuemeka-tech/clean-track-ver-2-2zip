import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WashingMachine, Eye, EyeOff, FlaskConical } from "lucide-react";
import { toast } from "sonner";

const DEMO_EMAIL = "demo@cleantrack.ng";
const DEMO_PASSWORD = "Demo@1234";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const from = (location.state as any)?.from?.pathname || "/dashboard";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error("Enter your email and password"); return; }
    setLoading(true);
    try {
      const res = await api.auth.ownerLogin({ email, password });
      login(res.token, res.user);
      toast.success(`Welcome back, ${res.user.name}!`);
      navigate(from, { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    try {
      const res = await api.auth.ownerLogin({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
      login(res.token, res.user);
      toast.success("Welcome to the Clean Track demo!");
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Demo login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <WashingMachine className="h-9 w-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Clean Track</h1>
          <p className="text-slate-400 mt-1">Sign in to your laundry workspace</p>
        </div>

        <div className="bg-blue-950/60 border border-blue-700/50 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <FlaskConical className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-300">Demo Account</p>
              <p className="text-xs text-blue-400/80 mt-0.5">
                <span className="font-mono">{DEMO_EMAIL}</span>
                <span className="mx-1.5 opacity-50">·</span>
                <span className="font-mono">{DEMO_PASSWORD}</span>
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleDemoLogin}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-500 text-white shrink-0 text-xs h-7 px-3"
            >
              Try Demo
            </Button>
          </div>
        </div>

        <Card className="border-slate-700 bg-slate-800/50 backdrop-blur">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-xl">Owner Sign In</CardTitle>
            <CardDescription className="text-slate-400">
              Enter your email and password to access your dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Email Address</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@yourbusiness.com"
                  className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Password</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 pr-10"
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11 mt-2"
                disabled={loading}
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <div className="mt-6 space-y-3 text-center text-sm">
              <Link
                to="/forgot-password"
                className="block text-slate-400 hover:text-blue-400 transition-colors"
              >
                Forgot your password?
              </Link>
              <p className="text-slate-400">
                New laundry business?{" "}
                <Link to="/signup" className="text-blue-400 hover:text-blue-300 font-medium">
                  Create your workspace
                </Link>
              </p>
              <div className="border-t border-slate-700 pt-3">
                <Link
                  to="/worker-login"
                  className="text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Worker? Sign in with phone & PIN →
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
