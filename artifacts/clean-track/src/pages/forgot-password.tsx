import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WashingMachine, ArrowLeft, Mail, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { toast.error("Please enter your email address"); return; }
    setLoading(true);
    try {
      await api.auth.forgotPassword(email.trim());
      setSent(true);
    } catch {
      // Always show success to prevent email enumeration — backend does the same
      setSent(true);
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
          <p className="text-slate-400 mt-1">Password Recovery</p>
        </div>

        <Card className="border-slate-700 bg-slate-800/50 backdrop-blur">
          {sent ? (
            <CardContent className="pt-8 pb-6">
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30">
                  <CheckCircle className="h-7 w-7 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-lg">Check your inbox</h3>
                  <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                    If <span className="text-slate-300 font-medium">{email}</span> is registered,
                    you'll receive a reset link within a few minutes.
                  </p>
                  <p className="text-slate-500 text-xs mt-3">
                    The link expires in 1 hour. Check your spam folder if you don't see it.
                  </p>
                </div>
                <div className="pt-2">
                  <Button
                    variant="ghost"
                    className="text-slate-400 hover:text-white"
                    onClick={() => { setSent(false); setEmail(""); }}
                  >
                    Try a different email
                  </Button>
                </div>
              </div>
            </CardContent>
          ) : (
            <>
              <CardHeader className="pb-4">
                <CardTitle className="text-white text-xl">Reset your password</CardTitle>
                <CardDescription className="text-slate-400">
                  Enter the email address on your CleanTrack account and we'll send you a reset link.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@yourbusiness.com"
                        className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 pl-10"
                        autoComplete="email"
                        autoFocus
                        disabled={loading}
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11 mt-2"
                    disabled={loading}
                  >
                    {loading ? "Sending..." : "Send Reset Link"}
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
