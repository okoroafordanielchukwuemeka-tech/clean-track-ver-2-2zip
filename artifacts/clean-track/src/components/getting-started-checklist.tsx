import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, ArrowRight, X, Rocket } from "lucide-react";

interface Step {
  id: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
}

const DISMISS_KEY = "ct_onboarding_dismissed";

export function GettingStartedChecklist() {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => api.branches.list(),
    staleTime: 60_000,
  });

  const { data: services } = useQuery({
    queryKey: ["services"],
    queryFn: () => api.services.list(),
    staleTime: 60_000,
  });

  const { data: workers } = useQuery({
    queryKey: ["workers"],
    queryFn: () => api.workers.list(),
    staleTime: 60_000,
  });

  const { data: customers } = useQuery({
    queryKey: ["customers", "checklist"],
    queryFn: () => api.customers.list(),
    staleTime: 60_000,
  });

  const { data: recentOrders } = useQuery({
    queryKey: ["orders", "recent", null],
    queryFn: () => api.orders.recent(null),
    staleTime: 60_000,
  });

  if (dismissed) return null;

  const steps: Step[] = [
    {
      id: "branch",
      label: "Create your first branch",
      description: "Set up your laundry location",
      href: "/branches",
      done: (branches?.length ?? 0) > 0,
    },
    {
      id: "services",
      label: "Add your laundry services",
      description: "Define what you offer and at what price",
      href: "/services",
      done: (services?.length ?? 0) > 0,
    },
    {
      id: "workers",
      label: "Add your first worker",
      description: "Give your team access to process orders",
      href: "/workers",
      done: (workers?.length ?? 0) > 0,
    },
    {
      id: "customer",
      label: "Add your first customer",
      description: "Register a customer to start taking orders",
      href: "/customers",
      done: (customers?.length ?? 0) > 0,
    },
    {
      id: "order",
      label: "Create your first order",
      description: "Your entire workflow in one place",
      href: "/orders",
      done: (recentOrders?.length ?? 0) > 0,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const pct = Math.round((doneCount / steps.length) * 100);

  if (allDone) {
    return null;
  }

  return (
    <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <Rocket className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">Welcome to CleanTrack 👋</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {doneCount} of {steps.length} setup steps complete
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => {
              try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
              setDismissed(true);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1.5">
          {steps.map((step) => (
            <Link
              key={step.id}
              to={step.done ? "#" : step.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors group ${
                step.done
                  ? "opacity-60 cursor-default"
                  : "hover:bg-blue-100 dark:hover:bg-blue-900/30 cursor-pointer"
              }`}
            >
              {step.done ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              ) : (
                <Circle className="h-5 w-5 text-blue-400 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium leading-tight ${step.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                  {step.label}
                </p>
                {!step.done && (
                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                )}
              </div>
              {!step.done && (
                <ArrowRight className="h-4 w-4 text-blue-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
