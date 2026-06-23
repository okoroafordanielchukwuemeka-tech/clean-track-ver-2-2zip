import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WashingMachine, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export default function Signup() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({
    businessName: "",
    ownerEmail: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.businessName || !form.ownerEmail || !form.password) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (form.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await api.auth.signup({
        businessName: form.businessName,
        ownerEmail: form.ownerEmail,
        phone: form.phone || undefined,
        password: form.password,
      });
      login(res.token, res.user);
      toast.success(`Welcome to Clean Track, ${res.user.name}!`);
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Signup failed");
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
          <p className="text-slate-400 mt-1">Create your laundry workspace</p>
        </div>

        <Card className="border-slate-700 bg-slate-800/50 backdrop-blur">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-xl">Create Your Workspace</CardTitle>
            <CardDescription className="text-slate-400">
              Set up your laundry business on Clean Track
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Business Name <span className="text-red-400">*</span></Label>
                <Input
                  value={form.businessName}
                  onChange={set("businessName")}
                  placeholder="e.g. Bright Wash Laundry"
                  className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Email Address <span className="text-red-400">*</span></Label>
                <Input
                  type="email"
                  value={form.ownerEmail}
                  onChange={set("ownerEmail")}
                  placeholder="you@yourbusiness.com"
                  className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Business Phone <span className="text-slate-500 font-normal">(optional)</span></Label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder="+234 800 000 0000"
                  className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Password <span className="text-red-400">*</span></Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={set("password")}
                    placeholder="Min. 8 characters"
                    className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 pr-10"
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
                {form.password.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    {[
                      { ok: form.password.length >= 8, label: "8+ chars" },
                      { ok: /[A-Z]/.test(form.password), label: "Uppercase" },
                      { ok: /[0-9]/.test(form.password), label: "Number" },
                    ].map(({ ok, label }) => (
                      <div key={label} className={`flex items-center gap-1 text-xs rounded px-2 py-1 ${ok ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700 text-slate-400"}`}>
                        <span className="text-[10px]">{ok ? "✓" : "○"}</span>
                        {label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Confirm Password <span className="text-red-400">*</span></Label>
                <Input
                  type="password"
                  value={form.confirmPassword}
                  onChange={set("confirmPassword")}
                  placeholder="Re-enter your password"
                  className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                  disabled={loading}
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11 mt-2"
                disabled={loading}
              >
                {loading ? "Creating workspace..." : "Create Workspace"}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-slate-400">
              Already have an account?{" "}
              <Link to="/login" className="text-blue-400 hover:text-blue-300 font-medium">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
