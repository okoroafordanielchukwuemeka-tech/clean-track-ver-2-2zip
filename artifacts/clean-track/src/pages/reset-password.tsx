import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WashingMachine, Eye, EyeOff, ArrowLeft, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setError("Invalid or missing reset token. Please request a new reset link.");
    }
  }, [token]);

  const passwordStrength = (() => {
    if (newPassword.length === 0) return null;
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasLength = newPassword.length >= 8;
    const score = [hasUpper, hasNumber, hasLength].filter(Boolean).length;
    if (score === 3) return { label: "Strong", color: "text-emerald-400" };
    if (score === 2) return { label: "Fair", color: "text-yellow-400" };
    return { label: "Weak", color: "text-red-400" };
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.auth.resetPassword(token, newPassword);
      setDone(true);
      toast.success("Password reset successfully!");
      setTimeout(() => navigate("/login"), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to reset password. The link may have expired.");
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
          <h1 className="text-3xl font-bold text-white">CleanTrack</h1>
          <p className="text-slate-400 mt-1">Set New Password</p>
        </div>

        <Card className="border-slate-700 bg-slate-800/50 backdrop-blur">
          {done ? (
            <CardContent className="pt-8 pb-6">
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30">
                  <CheckCircle className="h-7 w-7 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-lg">Password updated!</h3>
                  <p className="text-slate-400 text-sm mt-2">
                    You'll be redirected to the sign-in page in a moment.
                  </p>
                </div>
                <Link to="/login">
                  <Button className="bg-blue-600 hover:bg-blue-700 text-white mt-2">
                    Sign In Now
                  </Button>
                </Link>
              </div>
            </CardContent>
          ) : error && !token ? (
            <CardContent className="pt-8 pb-6">
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-500/20 border border-red-500/30">
                  <XCircle className="h-7 w-7 text-red-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-lg">Invalid reset link</h3>
                  <p className="text-slate-400 text-sm mt-2">{error}</p>
                </div>
                <Link to="/forgot-password">
                  <Button className="bg-blue-600 hover:bg-blue-700 text-white mt-2">
                    Request New Link
                  </Button>
                </Link>
              </div>
            </CardContent>
          ) : (
            <>
              <CardHeader className="pb-4">
                <CardTitle className="text-white text-xl">Create new password</CardTitle>
                <CardDescription className="text-slate-400">
                  Your password must be at least 8 characters, include one uppercase letter and one number.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-sm text-red-300">{error}</p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">New Password</Label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 pr-10"
                        autoComplete="new-password"
                        autoFocus
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
                    {passwordStrength && (
                      <p className={`text-xs ${passwordStrength.color}`}>
                        Strength: {passwordStrength.label}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Confirm Password</Label>
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                      autoComplete="new-password"
                      disabled={loading}
                    />
                    {confirmPassword && newPassword !== confirmPassword && (
                      <p className="text-xs text-red-400">Passwords do not match</p>
                    )}
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11 mt-2"
                    disabled={loading || !token || newPassword !== confirmPassword || newPassword.length < 8}
                  >
                    {loading ? "Updating..." : "Set New Password"}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>

        <div className="text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
