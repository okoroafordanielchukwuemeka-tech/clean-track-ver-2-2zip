import { Link } from "react-router-dom";
import { CheckCircle2, WashingMachine, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const PLANS = [
  {
    name: "Starter",
    price: "₦5,000",
    tagline: "For small laundry businesses",
    highlighted: false,
    features: [
      "1 branch",
      "Up to 5 workers",
      "Unlimited customers",
      "Unlimited orders",
      "Basic analytics",
      "Order & payment tracking",
      "Customer receipts",
    ],
  },
  {
    name: "Growth",
    price: "₦10,000",
    tagline: "For growing laundry businesses",
    highlighted: true,
    features: [
      "Up to 3 branches",
      "Up to 20 workers",
      "Unlimited customers",
      "Unlimited orders",
      "Advanced analytics & reports",
      "Expense tracking",
      "Batch order processing",
      "Priority email support",
    ],
  },
  {
    name: "Business",
    price: "₦20,000",
    tagline: "For multi-location laundry businesses",
    highlighted: false,
    features: [
      "Unlimited branches",
      "Unlimited workers",
      "Unlimited customers",
      "Unlimited orders",
      "Full analytics suite",
      "WhatsApp notifications",
      "Marketing tools",
      "Priority support",
    ],
  },
];

export default function Pricing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-5xl mx-auto px-4 py-16 space-y-12">

        <div className="text-center space-y-4">
          <div className="flex justify-center mb-6">
            <Link to="/login" className="flex items-center gap-2 text-white font-bold text-xl">
              <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center">
                <WashingMachine className="h-5 w-5 text-white" />
              </div>
              Clean Track
            </Link>
          </div>
          <h1 className="text-4xl font-bold text-white">Simple, honest pricing</h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Start with a free 14-day trial. No payment required. Pick a plan that fits your business when you're ready.
          </p>
          <div className="inline-flex items-center gap-2 bg-blue-600/20 border border-blue-500/40 rounded-full px-4 py-2 text-blue-300 text-sm">
            <Zap className="h-4 w-4" />
            14-day free trial includes all Growth features
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl border p-6 flex flex-col gap-5 ${
                plan.highlighted
                  ? "border-blue-500 bg-blue-600/10 shadow-xl shadow-blue-900/20"
                  : "border-slate-700 bg-slate-800/50"
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="bg-blue-600 text-white text-[11px] font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                    Most Popular
                  </span>
                </div>
              )}

              <div>
                <h2 className="text-white font-bold text-xl">{plan.name}</h2>
                <p className="text-slate-400 text-sm mt-1">{plan.tagline}</p>
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-white">{plan.price}</span>
                <span className="text-slate-400 text-sm">/month</span>
              </div>

              <ul className="space-y-2 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <Link to="/signup">
                <Button
                  className={`w-full h-11 font-semibold ${
                    plan.highlighted
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-slate-700 hover:bg-slate-600 text-white border-0"
                  }`}
                  variant={plan.highlighted ? "default" : "outline"}
                >
                  Start Free Trial
                </Button>
              </Link>
            </div>
          ))}
        </div>

        <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-8 text-center space-y-3">
          <h3 className="text-white font-semibold text-lg">How do I pay after the trial?</h3>
          <p className="text-slate-400 text-sm max-w-lg mx-auto">
            After your 14-day trial, contact us via WhatsApp or email to choose your plan and pay by bank transfer.
            Your plan is activated within 24 hours of payment confirmation.
          </p>
          <div className="flex items-center justify-center gap-6 flex-wrap pt-2">
            <div className="flex items-center gap-2 text-slate-300 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              No credit card required for trial
            </div>
            <div className="flex items-center gap-2 text-slate-300 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Cancel any time
            </div>
            <div className="flex items-center gap-2 text-slate-300 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              All data kept after trial
            </div>
          </div>
        </div>

        <div className="text-center space-y-4">
          <p className="text-slate-400 text-sm">Already have an account?</p>
          <div className="flex justify-center gap-4 flex-wrap">
            <Link to="/login">
              <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700">
                Sign In
              </Button>
            </Link>
            <Link to="/signup">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                Create Free Account
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
