import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Users,
  ShoppingBag,
  CreditCard,
  CheckCircle2,
  FlaskConical,
  BarChart2,
  GitBranch,
  Layers,
  Zap,
} from "lucide-react";

export default function Welcome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api.auth.welcomeViewed().catch(() => {});
  }, []);

  const businessName = user?.name ?? "your laundry";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-8">

        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <span className="text-3xl">👋</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Welcome to CleanTrack!</h1>
          <p className="text-slate-400 mt-2 text-lg">{businessName} is ready to go.</p>
        </div>

        <div className="bg-blue-600/20 border border-blue-500/40 rounded-2xl px-6 py-5 flex items-start gap-4">
          <FlaskConical className="h-6 w-6 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-white font-semibold text-base">Your 14-day Growth trial has started</p>
            <p className="text-blue-200 text-sm mt-1">
              You have full access to all Growth plan features — no payment required during your trial.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
              {[
                { icon: BarChart2, label: "Analytics & reports" },
                { icon: GitBranch, label: "Multiple branches" },
                { icon: Layers, label: "Batch processing" },
                { icon: Users, label: "Up to 20 workers" },
                { icon: ShoppingBag, label: "Unlimited orders" },
                { icon: Zap, label: "Full dashboard" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-sm text-blue-100">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6 space-y-4">
          <h2 className="text-white font-semibold text-base">Your first 4 steps</h2>
          <div className="space-y-3">
            {[
              {
                icon: CheckCircle2,
                label: "Your services are ready",
                desc: "8 common laundry services have been added for you. Review and adjust prices anytime.",
                done: true,
              },
              {
                icon: Users,
                label: "Add your first customer",
                desc: "Register a customer — name and phone number is all you need.",
                done: false,
                href: "/customers",
              },
              {
                icon: ShoppingBag,
                label: "Create your first order",
                desc: "Pick services, choose a tier (standard, express, premium), and save.",
                done: false,
              },
              {
                icon: CreditCard,
                label: "Record payment",
                desc: "Accept cash, bank transfer, or POS — all tracked automatically.",
                done: false,
              },
            ].map((step, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-xl px-4 py-3 ${
                  step.done
                    ? "bg-emerald-900/20 border border-emerald-700/30"
                    : "bg-slate-700/40 border border-slate-600/30"
                }`}
              >
                <div
                  className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${
                    step.done
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-600 text-slate-300"
                  }`}
                >
                  {step.done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${step.done ? "text-emerald-300" : "text-white"}`}>
                    {step.label}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold h-12 text-base"
            onClick={() => navigate("/customers")}
          >
            <Users className="h-5 w-5 mr-2" />
            Add Your First Customer
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-700 h-12"
            onClick={() => navigate("/dashboard")}
          >
            Go to Dashboard
          </Button>
        </div>

        <p className="text-center text-xs text-slate-500">
          Your branch and services are already set up. Trial ends in 14 days — no credit card needed.
        </p>
      </div>
    </div>
  );
}
