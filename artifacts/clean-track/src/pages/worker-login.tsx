import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WashingMachine } from "lucide-react";
import { toast } from "sonner";

export default function WorkerLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !pin) { toast.error("Enter your phone number and PIN"); return; }
    setLoading(true);
    try {
      const res = await api.auth.workerLogin({ phone, pin });
      login(res.token, res.user);
      toast.success(`Welcome, ${res.user.name}!`);
      navigate("/worker-station", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Invalid phone number or PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <WashingMachine className="h-9 w-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Worker Login</h1>
          <p className="text-slate-400 mt-1">Clean Track Worker Station</p>
        </div>

        <Card className="border-slate-700 bg-slate-800/50 backdrop-blur">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-xl">Sign In</CardTitle>
            <CardDescription className="text-slate-400">
              Enter your phone number and PIN to access your station
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Phone Number</Label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+234 800 000 0000"
                  className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                  autoComplete="tel"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">PIN</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSubmit(e as any)}
                  placeholder="Enter your PIN"
                  className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 text-center text-2xl tracking-widest"
                  disabled={loading}
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11 mt-2"
                disabled={loading}
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <div className="mt-5 text-center">
              <Link
                to="/login"
                className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                ← Business owner? Sign in here
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
