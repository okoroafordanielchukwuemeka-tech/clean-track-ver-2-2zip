/**
 * UpgradeRequired — shared premium feature gate component
 *
 * Renders a polished upgrade screen whenever a user on a lower plan
 * tries to access a premium feature. Never shows a raw error or blank page.
 */

import { Lock, CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

export interface UpgradeRequiredProps {
  /** Display name of the locked feature, e.g. "Expense Tracking" */
  featureTitle: string;
  /** One-line description of what the feature does */
  featureDescription: string;
  /** List of key benefits (2–5 bullets) */
  benefits: string[];
  /** Display name of the plan needed, e.g. "Professional" */
  requiredPlan: string;
  /** Display name of the user's current plan, e.g. "Starter" */
  currentPlan: string;
  /** Monthly price in NGN for the required plan */
  monthlyPriceNgn: number;
  /** Which icon/badge variant to show ("pro" | "enterprise") */
  variant?: "pro" | "enterprise";
}

export function UpgradeRequired({
  featureTitle,
  featureDescription,
  benefits,
  requiredPlan,
  currentPlan,
  monthlyPriceNgn,
  variant = "pro",
}: UpgradeRequiredProps) {
  const navigate = useNavigate();

  const accentColor =
    variant === "enterprise"
      ? "text-amber-600 dark:text-amber-400"
      : "text-blue-600 dark:text-blue-400";

  const badgeClass =
    variant === "enterprise"
      ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700"
      : "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700";

  const ringClass =
    variant === "enterprise"
      ? "ring-amber-500/30"
      : "ring-blue-500/30";

  return (
    <div className="flex items-start justify-center min-h-[420px] py-10 px-4">
      <div
        className={`w-full max-w-md rounded-2xl border bg-card shadow-sm ring-1 ${ringClass} overflow-hidden`}
      >
        {/* Header bar */}
        <div
          className={`px-6 py-4 border-b flex items-center gap-3 ${
            variant === "enterprise"
              ? "bg-amber-50/60 dark:bg-amber-950/20"
              : "bg-blue-50/60 dark:bg-blue-950/20"
          }`}
        >
          <div
            className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
              variant === "enterprise"
                ? "bg-amber-100 dark:bg-amber-900/40"
                : "bg-blue-100 dark:bg-blue-900/40"
            }`}
          >
            <Lock className={`h-5 w-5 ${accentColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold truncate">{featureTitle}</h2>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${badgeClass}`}
              >
                <Sparkles className="h-3 w-3" />
                {requiredPlan}+
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {featureDescription}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Current vs required plan */}
          <div className="flex items-center gap-3 text-sm">
            <div className="flex-1 rounded-lg border px-3 py-2.5 text-center bg-muted/40">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">
                Your plan
              </p>
              <p className="font-bold">{currentPlan}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <div
              className={`flex-1 rounded-lg border px-3 py-2.5 text-center ${
                variant === "enterprise"
                  ? "border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/20"
                  : "border-blue-400/60 bg-blue-50/50 dark:bg-blue-950/20"
              }`}
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">
                Required
              </p>
              <p className={`font-bold ${accentColor}`}>{requiredPlan}</p>
            </div>
          </div>

          {/* Benefits */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
              What you unlock
            </p>
            <ul className="space-y-2">
              {benefits.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Price */}
          <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold">
              ₦{monthlyPriceNgn.toLocaleString("en-NG")}
            </span>
            <span className="text-sm text-muted-foreground">/month</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {requiredPlan} plan
            </span>
          </div>

          {/* CTA */}
          <Button
            className="w-full gap-2"
            onClick={() => navigate("/settings", { state: { section: "billing" } })}
          >
            <Sparkles className="h-4 w-4" />
            Upgrade to {requiredPlan}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Contact support to upgrade · Plans activate within 24 hours
          </p>
        </div>
      </div>
    </div>
  );
}
