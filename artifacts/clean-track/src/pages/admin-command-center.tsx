import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAdmin } from "@/context/admin-context";
import { useQuery } from "@tanstack/react-query";
import {
  Shield, LayoutDashboard, Building2, MonitorSmartphone,
  HardDrive, Database, LogOut, RefreshCw, AlertTriangle,
  CheckCircle2, XCircle, Clock, Wifi, WifiOff, Activity,
  ChevronRight, Server, Users, ShoppingCart, Layers,
  TrendingUp, BarChart3, Archive, Package, FlaskConical,
  CreditCard, Ban, Hourglass, CheckCircle, ChevronDown,
  Rocket, Target, Mail, Zap, AlertCircle, Search, LogIn,
  ShieldCheck as ShieldRole,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { startImpersonation } from "@/components/impersonation-banner";

const API_BASE = "/api";

function adminFetch(path: string, token: string) {
  return fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
    return r.json();
  });
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatusDot({ status }: { status: "online" | "stale" | "offline" | "healthy" | "warning" | "critical" }) {
  const colors = {
    online: "bg-emerald-500",
    healthy: "bg-emerald-500",
    stale: "bg-amber-400",
    warning: "bg-amber-400",
    offline: "bg-red-500",
    critical: "bg-red-500",
  };
  return (
    <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", colors[status])} />
  );
}

function SubStatusBadge({ status, plan }: { status: string; plan?: string }) {
  const cfg: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    trial:     { cls: "bg-blue-900/50 text-blue-300 border-blue-700",   icon: <FlaskConical className="w-3 h-3" />, label: "Trial" },
    active:    { cls: "bg-emerald-900/50 text-emerald-300 border-emerald-700", icon: <CheckCircle className="w-3 h-3" />, label: plan ?? "Active" },
    past_due:  { cls: "bg-amber-900/50 text-amber-300 border-amber-700", icon: <Hourglass className="w-3 h-3" />, label: "Past Due" },
    suspended: { cls: "bg-red-900/50 text-red-300 border-red-700",      icon: <Ban className="w-3 h-3" />, label: "Suspended" },
    cancelled: { cls: "bg-slate-800 text-slate-400 border-slate-600",   icon: <XCircle className="w-3 h-3" />, label: "Cancelled" },
  };
  const c = cfg[status] ?? cfg.trial;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border font-medium", c.cls)}>
      {c.icon}{c.label}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === "critical" ? "bg-red-900/50 text-red-300 border-red-700"
    : severity === "warning" ? "bg-amber-900/50 text-amber-300 border-amber-700"
    : "bg-blue-900/50 text-blue-300 border-blue-700";
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-xs border font-medium", cls)}>
      {severity}
    </span>
  );
}

// ─── Growth Analytics ──────────────────────────────────────────────────────

const FUNNEL_LABELS: Record<string, string> = {
  workspace_created: "Signed Up",
  branch_created: "Branch Created",
  service_created: "Services Added",
  customer_created: "Customer Created",
  order_created: "First Order",
  payment_recorded: "Payment Recorded",
  order_completed: "Order Completed",
  worker_created: "Worker Added",
  first_return_login: "Return Login (7d+)",
};

const ACTIVATION_STATE_COLORS = {
  new: "text-slate-400 bg-slate-800 border-slate-700",
  onboarding: "text-amber-300 bg-amber-900/30 border-amber-700",
  activated: "text-emerald-300 bg-emerald-900/30 border-emerald-700",
};

function FunnelBar({ label, count, pct, dropOff, isFirst }: {
  label: string; count: number; pct: number; dropOff: number; isFirst: boolean;
}) {
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-slate-300 text-sm font-medium">{label}</span>
        <div className="flex items-center gap-3">
          {!isFirst && dropOff > 0 && (
            <span className="text-red-400 text-xs">−{dropOff}% drop</span>
          )}
          <span className="text-white text-sm font-semibold tabular-nums">{count.toLocaleString()}</span>
        </div>
      </div>
      <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`,
            background: pct > 60 ? "#10b981" : pct > 30 ? "#f59e0b" : "#ef4444",
          }}
        />
      </div>
      <div className="text-slate-500 text-xs mt-1">{pct}% of signups</div>
    </div>
  );
}

const STUCK_STAGE_LABELS: Record<string, string> = {
  no_branch: "No branch created",
  no_services: "No services added",
  no_customer: "No customer created",
  no_order: "No order created",
  no_completion: "No completed order",
};

const NUDGE_TYPE_LABELS: Record<string, string> = {
  "24h": "24-hour",
  "48h": "48-hour",
  "7d": "7-day",
};

function GrowthTab({ token }: { token: string }) {
  const { data: funnel, isLoading: funnelLoading } = useQuery({
    queryKey: ["admin", "activation", "funnel"],
    queryFn: () => adminFetch("/admin/activation/funnel", token),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ["admin", "activation", "metrics"],
    queryFn: () => adminFetch("/admin/activation/metrics", token),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ["admin", "activation", "health"],
    queryFn: () => adminFetch("/admin/activation/health", token),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const { data: scores, isLoading: scoresLoading } = useQuery({
    queryKey: ["admin", "activation", "scores"],
    queryFn: () => adminFetch("/admin/activation/scores", token),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const { data: nudges, isLoading: nudgesLoading } = useQuery({
    queryKey: ["admin", "activation", "nudges"],
    queryFn: () => adminFetch("/admin/activation/nudges", token),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const isLoading = funnelLoading || metricsLoading || healthLoading || scoresLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-violet-900/50 border border-violet-700/40 flex items-center justify-center">
          <Rocket className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <h2 className="text-white font-semibold text-lg">Growth Analytics</h2>
          <p className="text-slate-500 text-sm">Activation funnel, scoring, and onboarding health</p>
        </div>
      </div>

      {/* ── Key Metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400 text-xs">Activation Rate</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {metricsLoading ? "—" : `${metrics?.activationRate ?? 0}%`}
            </div>
            <div className="text-slate-500 text-xs mt-1">
              {metricsLoading ? "" : `${metrics?.activatedCount ?? 0} of ${metrics?.totalLaundries ?? 0} workspaces`}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-slate-400 text-xs">Avg. to First Order</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {metricsLoading ? "—" : metrics?.timeToFirstOrderHours != null
                ? `${metrics.timeToFirstOrderHours}h`
                : "N/A"}
            </div>
            <div className="text-slate-500 text-xs mt-1">from signup to order</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-blue-400" />
              <span className="text-slate-400 text-xs">Avg. to Completed</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {metricsLoading ? "—" : metrics?.timeToFirstCompletedHours != null
                ? `${metrics.timeToFirstCompletedHours}h`
                : "N/A"}
            </div>
            <div className="text-slate-500 text-xs mt-1">from signup to completion</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Mail className="w-4 h-4 text-violet-400" />
              <span className="text-slate-400 text-xs">Email Open Rate</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {metricsLoading ? "—" : `${metrics?.emailEngagement?.openRate ?? 0}%`}
            </div>
            <div className="text-slate-500 text-xs mt-1">
              {metricsLoading ? "" : `${metrics?.emailEngagement?.sent ?? 0} sent · ${metrics?.emailEngagement?.clicked ?? 0} clicked`}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Activation Funnel ── */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-slate-200 text-sm font-medium flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-violet-400" />
              Activation Funnel
              {funnel && <span className="text-slate-500 font-normal">({funnel.total} total signups)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {funnelLoading ? (
              <div className="text-slate-500 text-sm py-8 text-center">Loading…</div>
            ) : funnel?.funnel?.length ? (
              <div className="divide-y divide-slate-800/60">
                {funnel.funnel.map((step: any, idx: number) => (
                  <FunnelBar
                    key={step.step}
                    label={FUNNEL_LABELS[step.step] ?? step.step}
                    count={step.count}
                    pct={step.pct}
                    dropOff={step.dropOff}
                    isFirst={idx === 0}
                  />
                ))}
              </div>
            ) : (
              <div className="text-slate-500 text-sm py-8 text-center">No activation data yet</div>
            )}
          </CardContent>
        </Card>

        {/* ── Activation Score Distribution ── */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-slate-200 text-sm font-medium flex items-center gap-2">
              <Target className="w-4 h-4 text-violet-400" />
              Workspace Scores
              <span className="text-slate-500 font-normal text-xs">(most recent 100)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scoresLoading ? (
              <div className="text-slate-500 text-sm py-8 text-center">Loading…</div>
            ) : scores?.length ? (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {scores.map((ws: any) => (
                  <div key={ws.id} className="flex items-center gap-3 py-2 border-b border-slate-800/60">
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-200 text-sm font-medium truncate">{ws.businessName}</div>
                      <div className="text-slate-500 text-xs truncate">{ws.ownerEmail}</div>
                      {ws.stuck && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                          <span className="text-amber-400 text-xs truncate">{ws.stuck}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className="text-white text-sm font-bold">{ws.score}</div>
                        <div className="text-slate-500 text-xs">/ 100</div>
                      </div>
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-xs border font-medium capitalize",
                        ACTIVATION_STATE_COLORS[ws.state as keyof typeof ACTIVATION_STATE_COLORS] ?? ACTIVATION_STATE_COLORS.new
                      )}>
                        {ws.state}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 text-sm py-8 text-center">No workspaces yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Last 7 Days Health ── */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-slate-200 text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              Onboarding Health — Last 7 Days
            </span>
            {health?.summary && (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-emerald-400">{health.summary.activated} activated</span>
                <span className="text-amber-400">{health.summary.onboarding} onboarding</span>
                <span className="text-slate-400">{health.summary.nonActivated} new</span>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <div className="text-slate-500 text-sm py-8 text-center">Loading…</div>
          ) : health?.daily?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left text-slate-500 font-medium pb-2 pr-4">Workspace</th>
                    <th className="text-left text-slate-500 font-medium pb-2 pr-4">Email</th>
                    <th className="text-right text-slate-500 font-medium pb-2 pr-4">Score</th>
                    <th className="text-left text-slate-500 font-medium pb-2 pr-4">State</th>
                    <th className="text-left text-slate-500 font-medium pb-2">Stuck At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {health.daily.map((row: any) => (
                    <tr key={row.id}>
                      <td className="py-2 pr-4 text-slate-200 font-medium max-w-36 truncate">{row.businessName}</td>
                      <td className="py-2 pr-4 text-slate-400 text-xs max-w-40 truncate">{row.ownerEmail}</td>
                      <td className="py-2 pr-4 text-right">
                        <span className="text-white font-semibold">{row.score}</span>
                        <span className="text-slate-500 text-xs">/100</span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-xs border font-medium capitalize",
                          ACTIVATION_STATE_COLORS[row.state as keyof typeof ACTIVATION_STATE_COLORS] ?? ACTIVATION_STATE_COLORS.new
                        )}>
                          {row.state}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-amber-400 max-w-48">
                        {row.stuck ?? <span className="text-emerald-400">✓ Fully activated</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-slate-500 text-sm py-8 text-center">No new signups in the last 7 days</div>
          )}
        </CardContent>
      </Card>

      {/* ── Customer Success — Nudge Analytics ── */}
      <div className="flex items-center gap-3 pt-2">
        <div className="w-8 h-8 rounded-lg bg-emerald-900/50 border border-emerald-700/40 flex items-center justify-center">
          <Mail className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-white font-semibold text-lg">Customer Success — Email Nudges</h2>
          <p className="text-slate-500 text-sm">Automated stuck-user detection and rescue emails</p>
        </div>
      </div>

      {/* Nudge KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400 text-xs">Users Rescued</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {nudgesLoading ? "—" : nudges?.usersRescued ?? 0}
            </div>
            <div className="text-slate-500 text-xs mt-1">
              activated after a nudge
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-blue-400" />
              <span className="text-slate-400 text-xs">Nudge Activation Rate</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {nudgesLoading ? "—" : `${nudges?.activationRateAfterNudge ?? 0}%`}
            </div>
            <div className="text-slate-500 text-xs mt-1">
              {nudgesLoading ? "" : `${nudges?.laundiesNudged ?? 0} workspaces nudged`}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Mail className="w-4 h-4 text-violet-400" />
              <span className="text-slate-400 text-xs">Email Open Rate</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {nudgesLoading ? "—" : `${nudges?.openRate ?? 0}%`}
            </div>
            <div className="text-slate-500 text-xs mt-1">
              {nudgesLoading ? "" : `${nudges?.totalSent ?? 0} nudges sent`}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-slate-400 text-xs">Click Rate</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {nudgesLoading ? "—" : `${nudges?.clickRate ?? 0}%`}
            </div>
            <div className="text-slate-500 text-xs mt-1">
              {nudgesLoading ? "" : nudges?.mostCommonStuckStage
                ? `Top stuck: ${STUCK_STAGE_LABELS[nudges.mostCommonStuckStage] ?? nudges.mostCommonStuckStage}`
                : "No stuck users yet"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Nudge Breakdown by Stage */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-slate-200 text-sm font-medium flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              Stuck Stage Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nudgesLoading ? (
              <div className="text-slate-500 text-sm py-8 text-center">Loading…</div>
            ) : nudges?.stageBreakdown?.length ? (
              <div className="space-y-3">
                {nudges.stageBreakdown.map((s: any) => (
                  <div key={s.stuckStage} className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
                    <span className="text-slate-300 text-sm">{STUCK_STAGE_LABELS[s.stuckStage] ?? s.stuckStage}</span>
                    <span className="text-white font-semibold text-sm tabular-nums">{s.count} users</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 text-sm py-8 text-center">No nudges sent yet — engine runs hourly after 24h</div>
            )}
          </CardContent>
        </Card>

        {/* Nudge Type Performance */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-slate-200 text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Nudge Sequence Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nudgesLoading ? (
              <div className="text-slate-500 text-sm py-8 text-center">Loading…</div>
            ) : nudges?.byType?.length ? (
              <div className="space-y-3">
                {nudges.byType.map((t: any) => (
                  <div key={t.nudgeType} className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
                    <span className="text-slate-300 text-sm">{NUDGE_TYPE_LABELS[t.nudgeType] ?? t.nudgeType} nudge</span>
                    <div className="flex items-center gap-4 text-sm tabular-nums">
                      <span className="text-slate-400">{t.sent} sent</span>
                      <span className="text-emerald-400 font-semibold">{t.rescued} rescued</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 text-sm py-8 text-center">No data yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Nudges Log */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-slate-200 text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            Recent Nudge Log
            {nudges?.totalSent > 0 && (
              <span className="text-slate-500 font-normal text-xs">(last 20 of {nudges.totalSent})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {nudgesLoading ? (
            <div className="text-slate-500 text-sm py-8 text-center">Loading…</div>
          ) : nudges?.recentNudges?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left text-slate-500 font-medium pb-2 pr-4">Workspace</th>
                    <th className="text-left text-slate-500 font-medium pb-2 pr-4">Stage</th>
                    <th className="text-left text-slate-500 font-medium pb-2 pr-4">Type</th>
                    <th className="text-center text-slate-500 font-medium pb-2 pr-2">Opened</th>
                    <th className="text-center text-slate-500 font-medium pb-2 pr-2">Clicked</th>
                    <th className="text-center text-slate-500 font-medium pb-2">Rescued</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {nudges.recentNudges.map((n: any) => (
                    <tr key={n.id}>
                      <td className="py-2 pr-4">
                        <div className="text-slate-200 text-sm font-medium truncate max-w-32">{n.businessName}</div>
                        <div className="text-slate-500 text-xs truncate max-w-32">{n.ownerEmail}</div>
                      </td>
                      <td className="py-2 pr-4 text-xs text-amber-300">{STUCK_STAGE_LABELS[n.stuckStage] ?? n.stuckStage}</td>
                      <td className="py-2 pr-4 text-xs text-slate-400">{NUDGE_TYPE_LABELS[n.nudgeType] ?? n.nudgeType}</td>
                      <td className="py-2 pr-2 text-center">{n.openedAt ? <span className="text-emerald-400">✓</span> : <span className="text-slate-700">—</span>}</td>
                      <td className="py-2 pr-2 text-center">{n.clickedAt ? <span className="text-blue-400">✓</span> : <span className="text-slate-700">—</span>}</td>
                      <td className="py-2 text-center">{n.activatedAfter ? <span className="text-emerald-400 font-semibold">✓</span> : <span className="text-slate-700">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-slate-500 text-sm py-8 text-center">
              No nudges sent yet — the engine checks every hour and sends nudges after 24h of being stuck
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Platform Overview ─────────────────────────────────────────────────────

function OverviewTab({ token }: { token: string }) {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => adminFetch("/admin/overview", token),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorState />;

  const d = data as any;
  const deviceStatus = d.devices.total
    ? Math.round((d.devices.online / d.devices.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Platform Overview</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            Updated {timeAgo(new Date(dataUpdatedAt).toISOString())} · Auto-refreshes every 60s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Building2} label="Total Tenants" value={d.tenants.total}
          sub={`${d.tenants.active} active`} color="violet" />
        <MetricCard icon={ShoppingCart} label="Orders This Week" value={d.orders.thisWeek.toLocaleString()}
          sub={`${d.orders.total.toLocaleString()} total`} color="blue" />
        <MetricCard icon={MonitorSmartphone} label="Active Devices" value={d.devices.online}
          sub={`${deviceStatus}% online rate`} color={deviceStatus >= 80 ? "green" : deviceStatus >= 50 ? "amber" : "red"} />
        <MetricCard icon={AlertTriangle} label="Open Alerts" value={d.alerts.open}
          sub={`${d.alerts.critical} critical`} color={d.alerts.critical > 0 ? "red" : d.alerts.open > 0 ? "amber" : "green"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-slate-200 text-sm font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4 text-violet-400" /> Tenant Health
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4 space-y-2">
            <ProgressRow label="Active" value={d.tenants.active} total={d.tenants.total} color="emerald" />
            <ProgressRow label="Inactive" value={d.tenants.inactive} total={d.tenants.total} color="slate" />
            <div className="pt-1 border-t border-slate-800 flex justify-between text-xs text-slate-400">
              <span>{d.infrastructure.branches} branches</span>
              <span>{d.infrastructure.workers} workers</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-slate-200 text-sm font-semibold flex items-center gap-2">
              <MonitorSmartphone className="w-4 h-4 text-blue-400" /> Device Fleet
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4 space-y-2">
            <ProgressRow label="Online (<30m)" value={d.devices.online} total={d.devices.total} color="emerald" />
            <ProgressRow label="Stale (30m–24h)" value={d.devices.stale} total={d.devices.total} color="amber" />
            <ProgressRow label="Offline (>24h)" value={d.devices.offline} total={d.devices.total} color="red" />
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-slate-200 text-sm font-semibold flex items-center gap-2">
              <Database className="w-4 h-4 text-teal-400" /> Database
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-sm">Total Size</span>
              <span className="text-white font-semibold text-sm">{d.database.sizeFormatted}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-sm">Alert Tenants</span>
              <span className={cn("font-semibold text-sm", d.alerts.affectedTenants > 0 ? "text-red-400" : "text-emerald-400")}>
                {d.alerts.affectedTenants} affected
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-sm">Critical Alerts</span>
              <SeverityBadge severity={d.alerts.critical > 0 ? "critical" : "info"} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Tenant Health ─────────────────────────────────────────────────────────

type TenantSort = "default" | "utilization" | "critical" | "plan";

function UsageBarMini({ pct, warnLevel }: { pct: number; warnLevel?: string }) {
  const barColor =
    warnLevel === "critical_100" ? "bg-red-500" :
    pct >= 85 ? "bg-amber-400" :
    pct >= 70 ? "bg-amber-300" :
    "bg-emerald-500";
  return (
    <div className="h-1 bg-slate-800 rounded-full overflow-hidden w-16">
      <div className={cn("h-full rounded-full", barColor)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function TenantUsageRow({ usage }: { usage: any }) {
  if (!usage) return null;
  const { percentages } = usage;
  const highest = Math.max(percentages.orders, percentages.workers, percentages.branches, percentages.storage);
  const highestColor = highest >= 100 ? "text-red-400" : highest >= 85 ? "text-amber-400" : highest >= 70 ? "text-amber-300" : "text-slate-500";
  return (
    <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-800/60">
      <span className="text-xs text-slate-500 shrink-0">Usage:</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="flex flex-col gap-0.5 items-start">
          <span className="text-xs text-slate-500">Ord</span>
          <UsageBarMini pct={percentages.orders} />
        </div>
        <div className="flex flex-col gap-0.5 items-start">
          <span className="text-xs text-slate-500">Wrk</span>
          <UsageBarMini pct={percentages.workers} />
        </div>
        <div className="flex flex-col gap-0.5 items-start">
          <span className="text-xs text-slate-500">Br</span>
          <UsageBarMini pct={percentages.branches} />
        </div>
        <div className="flex flex-col gap-0.5 items-start">
          <span className="text-xs text-slate-500">Str</span>
          <UsageBarMini pct={percentages.storage} />
        </div>
      </div>
      <span className={cn("text-xs font-medium shrink-0", highestColor)}>
        {highest > 0 ? `${Math.max(percentages.orders, percentages.workers, percentages.branches, percentages.storage)}% peak` : "< 70%"}
      </span>
    </div>
  );
}

function TenantsTab({ token }: { token: string }) {
  const [selected, setSelected] = useState<any | null>(null);
  const [sort, setSort] = useState<TenantSort>("default");
  const [search, setSearch] = useState("");
  const [loginAsLoading, setLoginAsLoading] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin", "tenants", search],
    queryFn: () => adminFetch(`/admin/tenants${search ? `?search=${encodeURIComponent(search)}` : ""}`, token),
    staleTime: 30_000,
  });

  async function handleLoginAs(tenant: any) {
    if (!window.confirm(`You are about to impersonate "${tenant.businessName}". This action is fully audited. Continue?`)) return;
    setLoginAsLoading(true);
    try {
      const resp = await fetch(`/api/admin/tenants/${tenant.id}/impersonate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error((await resp.json()).error ?? "Failed");
      const { impersonationToken, businessName } = await resp.json();
      toast.success(`Entering ${businessName}'s workspace…`);
      setTimeout(() => startImpersonation(impersonationToken), 600);
    } catch (err: any) {
      toast.error(err.message ?? "Impersonation failed");
    } finally {
      setLoginAsLoading(false);
    }
  }

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorState />;

  const rawTenants = (data as any).tenants ?? [];

  const sortedTenants = [...rawTenants].sort((a: any, b: any) => {
    if (sort === "utilization") {
      return (b.usage?.highestPct ?? 0) - (a.usage?.highestPct ?? 0);
    }
    if (sort === "critical") {
      const aScore = (b.stats?.criticalAlerts ?? 0) * 10 + (b.stats?.openAlerts ?? 0) + (b.usage?.highestPct ?? 0) / 100;
      const bScore = (a.stats?.criticalAlerts ?? 0) * 10 + (a.stats?.openAlerts ?? 0) + (a.usage?.highestPct ?? 0) / 100;
      return aScore - bScore;
    }
    if (sort === "plan") {
      const planOrder: Record<string, number> = { business: 0, pro: 1, starter: 2, free: 3 };
      return (planOrder[a.subscriptionTier] ?? 4) - (planOrder[b.subscriptionTier] ?? 4);
    }
    return 0;
  });

  const atLimitCount = rawTenants.filter((t: any) => (t.usage?.highestPct ?? 0) >= 100).length;
  const nearLimitCount = rawTenants.filter((t: any) => { const p = t.usage?.highestPct ?? 0; return p >= 85 && p < 100; }).length;

  if (selected) {
    const t = selected;
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-slate-400 hover:text-white text-sm transition-colors">
          ← Back to all tenants
        </button>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">{t.businessName}</h2>
            <p className="text-slate-400 text-sm">{t.ownerEmail}</p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <Button
              size="sm"
              variant="outline"
              disabled={loginAsLoading}
              onClick={() => handleLoginAs(t)}
              className="border-amber-700/50 text-amber-300 hover:bg-amber-900/30 hover:border-amber-600 text-xs"
            >
              <LogIn className="w-3.5 h-3.5 mr-1.5" />
              {loginAsLoading ? "Opening…" : "Login as Customer"}
            </Button>
            <Badge className={t.isActive ? "bg-emerald-900/50 text-emerald-300 border-emerald-700" : "bg-red-900/50 text-red-300 border-red-700"}>
              {t.isActive ? "Active" : "Inactive"}
            </Badge>
            <Badge className="bg-slate-800 text-slate-300 border-slate-700">{t.planDisplayName ?? t.subscriptionTier}</Badge>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat label="Orders (7d)" value={t.stats.orders7d} />
          <MiniStat label="Orders (Total)" value={t.stats.ordersTotal} />
          <MiniStat label="Branches" value={t.stats.branches} />
          <MiniStat label="Workers" value={t.stats.workers} />
          <MiniStat label="Devices" value={t.stats.devices} />
          <MiniStat label="Online" value={t.stats.onlineDevices} />
          <MiniStat label="Open Alerts" value={t.stats.openAlerts} highlight={t.stats.openAlerts > 0} />
          <MiniStat label="Critical" value={t.stats.criticalAlerts} highlight={t.stats.criticalAlerts > 0} />
        </div>

        {t.usage && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="px-5 pt-4 pb-2">
              <CardTitle className="text-slate-200 text-sm font-semibold">Plan Usage</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4 space-y-3">
              {([
                { label: "Monthly Orders", used: t.stats.monthlyOrders, limit: t.usage.limits.maxOrdersPerMonth, pct: t.usage.percentages.orders },
                { label: "Active Workers", used: t.stats.workers, limit: t.usage.limits.maxWorkers, pct: t.usage.percentages.workers },
                { label: "Branches", used: t.stats.branches, limit: t.usage.limits.maxBranches, pct: t.usage.percentages.branches },
                { label: "Storage (est.)", used: `${t.stats.storageUsedMb} MB`, limit: t.usage.limits.maxStorageMb, pct: t.usage.percentages.storage },
              ] as Array<{ label: string; used: any; limit: number; pct: number }>).map(row => {
                const unlimited = !isFinite(row.limit);
                const barColor = row.pct >= 100 ? "bg-red-500" : row.pct >= 85 ? "bg-amber-400" : "bg-emerald-500";
                return (
                  <div key={row.label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">{row.label}</span>
                      <span className={cn("font-medium", row.pct >= 100 ? "text-red-400" : row.pct >= 85 ? "text-amber-400" : "text-slate-300")}>
                        {unlimited ? `${row.used} / ∞` : `${row.used} / ${row.limit} (${row.pct}%)`}
                      </span>
                    </div>
                    {!unlimited && (
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${Math.min(100, row.pct)}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="px-5 py-4 space-y-2">
            <div className="flex justify-between text-sm items-center">
              <span className="text-slate-400">Subscription</span>
              <SubStatusBadge status={t.subscriptionStatus ?? "trial"} plan={t.subscriptionTier} />
            </div>
            {t.trialEndsAt && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Trial Ends</span>
                <span className="text-white">{new Date(t.trialEndsAt).toLocaleDateString()}</span>
              </div>
            )}
            {t.convertedAt && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Converted</span>
                <span className="text-emerald-400">{new Date(t.convertedAt).toLocaleDateString()}</span>
              </div>
            )}
            {t.subscriptionRenewsAt && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Renews</span>
                <span className="text-white">{new Date(t.subscriptionRenewsAt).toLocaleDateString()}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Last Snapshot</span>
              <span className={cn("font-medium", t.stats.lastSnapshotAt ? "text-white" : "text-red-400")}>
                {t.stats.lastSnapshotAt ? timeAgo(t.stats.lastSnapshotAt) : "Never"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Registered</span>
              <span className="text-white">{new Date(t.createdAt).toLocaleDateString()}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-white">
          Tenant Health <span className="text-slate-500 font-normal text-sm ml-1">({rawTenants.length})</span>
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded pl-7 pr-3 py-1.5 focus:outline-none focus:border-violet-600 w-44"
            />
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as TenantSort)}
            className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-violet-600"
          >
            <option value="default">Sort: Recent</option>
            <option value="utilization">Sort: Highest Usage</option>
            <option value="critical">Sort: Most Alerts</option>
            <option value="plan">Sort: Plan Tier</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => refetch()}
            className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
          </Button>
        </div>
      </div>

      {(atLimitCount > 0 || nearLimitCount > 0) && (
        <div className="flex gap-3 flex-wrap">
          {atLimitCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs bg-red-950/20 border border-red-800/30 rounded-lg px-3 py-1.5 text-red-300">
              <AlertTriangle className="w-3.5 h-3.5" />
              {atLimitCount} tenant{atLimitCount > 1 ? "s" : ""} at plan limit — new resource creation blocked
            </div>
          )}
          {nearLimitCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs bg-amber-950/20 border border-amber-800/30 rounded-lg px-3 py-1.5 text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5" />
              {nearLimitCount} tenant{nearLimitCount > 1 ? "s" : ""} approaching limits (≥85%)
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {sortedTenants.map((t: any) => (
          <button key={t.id} onClick={() => setSelected(t)}
            className={cn("w-full text-left bg-slate-900 border rounded-lg px-4 py-3 hover:border-slate-600 hover:bg-slate-800/70 transition-all",
              (t.usage?.highestPct ?? 0) >= 100 ? "border-red-800/50" :
              (t.usage?.highestPct ?? 0) >= 85 ? "border-amber-800/40" :
              "border-slate-800"
            )}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn("w-2 h-2 rounded-full shrink-0",
                  t.stats?.criticalAlerts > 0 ? "bg-red-500" :
                  (t.usage?.highestPct ?? 0) >= 100 ? "bg-red-500" :
                  t.stats?.openAlerts > 0 ? "bg-amber-400" :
                  (t.usage?.highestPct ?? 0) >= 85 ? "bg-amber-400" :
                  t.isActive ? "bg-emerald-500" : "bg-slate-500"
                )} />
                <div className="min-w-0">
                  <div className="text-white font-medium text-sm truncate">{t.businessName}</div>
                  <div className="text-slate-400 text-xs truncate">{t.ownerEmail}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="hidden sm:flex gap-3 text-xs text-slate-400">
                  <span>{t.stats?.orders7d ?? 0} orders/7d</span>
                  {t.stats?.openAlerts > 0 && (
                    <span className={t.stats.criticalAlerts > 0 ? "text-red-400" : "text-amber-400"}>
                      {t.stats.openAlerts} alerts
                    </span>
                  )}
                </div>
                <SubStatusBadge status={t.subscriptionStatus ?? "trial"} plan={t.subscriptionTier} />
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </div>
            </div>
            {t.usage && <TenantUsageRow usage={t.usage} />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Device Fleet ──────────────────────────────────────────────────────────

function DevicesTab({ token }: { token: string }) {
  const [filter, setFilter] = useState<"all" | "online" | "stale" | "offline">("all");
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin", "devices"],
    queryFn: () => adminFetch("/admin/devices", token),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorState />;

  const { devices, summary } = data as any;
  const filtered = filter === "all" ? devices : devices.filter((d: any) => d.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-white">Device Fleet</h2>
        <Button variant="outline" size="sm" onClick={() => refetch()}
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button onClick={() => setFilter("all")}
          className={cn("bg-slate-900 border rounded-lg px-4 py-3 text-center transition-all",
            filter === "all" ? "border-violet-600 bg-violet-950/30" : "border-slate-800 hover:border-slate-600")}>
          <div className="text-2xl font-bold text-white">{summary.total}</div>
          <div className="text-xs text-slate-400 mt-0.5">All Devices</div>
        </button>
        <button onClick={() => setFilter("online")}
          className={cn("bg-slate-900 border rounded-lg px-4 py-3 text-center transition-all",
            filter === "online" ? "border-emerald-600 bg-emerald-950/30" : "border-slate-800 hover:border-slate-600")}>
          <div className="text-2xl font-bold text-emerald-400">{summary.online}</div>
          <div className="text-xs text-slate-400 mt-0.5">Online</div>
        </button>
        <button onClick={() => setFilter("stale")}
          className={cn("bg-slate-900 border rounded-lg px-4 py-3 text-center transition-all",
            filter === "stale" ? "border-amber-600 bg-amber-950/30" : "border-slate-800 hover:border-slate-600")}>
          <div className="text-2xl font-bold text-amber-400">{summary.stale}</div>
          <div className="text-xs text-slate-400 mt-0.5">Stale</div>
        </button>
        <button onClick={() => setFilter("offline")}
          className={cn("bg-slate-900 border rounded-lg px-4 py-3 text-center transition-all",
            filter === "offline" ? "border-red-600 bg-red-950/30" : "border-slate-800 hover:border-slate-600")}>
          <div className="text-2xl font-bold text-red-400">{summary.offline}</div>
          <div className="text-xs text-slate-400 mt-0.5">Offline</div>
        </button>
      </div>

      {(summary.totalPending > 0 || summary.totalFailed > 0 || summary.totalConflicts > 0) && (
        <div className="flex gap-4 bg-amber-950/20 border border-amber-800/30 rounded-lg px-4 py-2.5 text-sm">
          {summary.totalPending > 0 && <span className="text-amber-300">⚡ {summary.totalPending.toLocaleString()} pending syncs</span>}
          {summary.totalFailed > 0 && <span className="text-red-300">✗ {summary.totalFailed} failed</span>}
          {summary.totalConflicts > 0 && <span className="text-orange-300">⚠ {summary.totalConflicts} conflicts</span>}
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">No {filter === "all" ? "" : filter} devices found</div>
        ) : filtered.map((d: any) => (
          <div key={d.id} className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <StatusDot status={d.status} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium font-mono truncate">{d.deviceId}</span>
                    <Badge className={cn("text-xs shrink-0",
                      d.status === "online" ? "bg-emerald-900/40 text-emerald-400 border-emerald-800" :
                      d.status === "stale" ? "bg-amber-900/40 text-amber-400 border-amber-800" :
                      "bg-red-900/40 text-red-400 border-red-800"
                    )}>
                      {d.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate">
                    {d.tenantName ?? `Tenant #${d.laundryId}`}
                    {d.branchName && <span className="text-slate-500"> · {d.branchName}</span>}
                    {d.workerName && <span className="text-slate-500"> · {d.workerName}</span>}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-slate-400">{timeAgo(d.lastSeenAt)}</div>
                {d.appVersion && <div className="text-xs text-slate-500 font-mono">{d.appVersion}</div>}
              </div>
            </div>
            {(d.pendingCount > 0 || d.failedCount > 0 || d.conflictCount > 0) && (
              <div className="flex gap-3 mt-2 pt-2 border-t border-slate-800/60 text-xs">
                {d.pendingCount > 0 && <span className="text-amber-400">{d.pendingCount} pending</span>}
                {d.failedCount > 0 && <span className="text-red-400">{d.failedCount} failed</span>}
                {d.conflictCount > 0 && <span className="text-orange-400">{d.conflictCount} conflicts</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Storage Health ────────────────────────────────────────────────────────

function StorageTab({ token }: { token: string }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin", "storage"],
    queryFn: () => adminFetch("/admin/storage", token),
    staleTime: 120_000,
  });

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorState />;

  const d = data as any;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Storage Health</h2>
        <Button variant="outline" size="sm" onClick={() => refetch()}
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard icon={Database} label="DB Total Size" value={d.database.sizeFormatted} color="teal" />
        <MetricCard icon={ShoppingCart} label="Total Orders" value={d.exactCounts.orders.toLocaleString()} color="blue" />
        <MetricCard icon={Activity} label="Audit Log Rows" value={d.exactCounts.auditLog.toLocaleString()} color="violet" />
        <MetricCard icon={MonitorSmartphone} label="Devices" value={d.exactCounts.deviceHeartbeats.toLocaleString()} color="slate" />
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="px-5 pt-4 pb-2">
          <CardTitle className="text-slate-200 text-sm font-semibold">Table Sizes</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <div className="space-y-2">
            {d.tables.slice(0, 15).map((t: any) => (
              <div key={t.table} className="flex items-center gap-3">
                <span className="text-slate-300 text-sm font-mono w-48 truncate shrink-0">{t.table}</span>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-500 rounded-full"
                    style={{ width: `${Math.max(1, Math.min(100, (t.totalSizeBytes / d.database.sizeBytes) * 100 * 8))}%` }}
                  />
                </div>
                <span className="text-slate-400 text-xs text-right w-16 shrink-0">{t.totalSize}</span>
                <span className="text-slate-500 text-xs text-right w-20 shrink-0 hidden sm:block">
                  ~{Number(t.estimatedRows).toLocaleString()} rows
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-white font-semibold mb-3 text-sm">Scale Projections</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {d.scaleProjections.map((p: any) => (
            <Card key={p.tenants} className="bg-slate-900 border-slate-800">
              <CardHeader className="px-5 pt-4 pb-2">
                <CardTitle className="text-slate-200 text-sm font-semibold">{p.tenants.toLocaleString()} Tenants</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Monthly orders</span>
                  <span className="text-white">{p.monthlyOrders.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Monthly growth</span>
                  <span className="text-white">{p.monthlyGrowthEstimate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Yearly growth</span>
                  <span className="text-white">{p.yearlyGrowthEstimate}</span>
                </div>
                <div className="pt-2 border-t border-slate-800 text-xs text-slate-500">
                  Retention: {p.recommendedRetention}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Backup Health ─────────────────────────────────────────────────────────

function BackupsTab({ token }: { token: string }) {
  const [filter, setFilter] = useState<"all" | "healthy" | "warning" | "critical">("all");
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin", "backups"],
    queryFn: () => adminFetch("/admin/backups", token),
    staleTime: 60_000,
  });

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorState />;

  const { summary, tenants } = data as any;
  const filtered = filter === "all" ? tenants : tenants.filter((t: any) => t.backupHealth === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Backup Health</h2>
        <Button variant="outline" size="sm" onClick={() => refetch()}
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button onClick={() => setFilter("all")}
          className={cn("bg-slate-900 border rounded-lg px-4 py-3 text-center transition-all",
            filter === "all" ? "border-violet-600 bg-violet-950/30" : "border-slate-800 hover:border-slate-600")}>
          <div className="text-2xl font-bold text-white">{summary.total}</div>
          <div className="text-xs text-slate-400 mt-0.5">All Tenants</div>
        </button>
        <button onClick={() => setFilter("healthy")}
          className={cn("bg-slate-900 border rounded-lg px-4 py-3 text-center transition-all",
            filter === "healthy" ? "border-emerald-600 bg-emerald-950/30" : "border-slate-800 hover:border-slate-600")}>
          <div className="text-2xl font-bold text-emerald-400">{summary.healthy}</div>
          <div className="text-xs text-slate-400 mt-0.5">Healthy</div>
        </button>
        <button onClick={() => setFilter("warning")}
          className={cn("bg-slate-900 border rounded-lg px-4 py-3 text-center transition-all",
            filter === "warning" ? "border-amber-600 bg-amber-950/30" : "border-slate-800 hover:border-slate-600")}>
          <div className="text-2xl font-bold text-amber-400">{summary.warning}</div>
          <div className="text-xs text-slate-400 mt-0.5">Warning</div>
        </button>
        <button onClick={() => setFilter("critical")}
          className={cn("bg-slate-900 border rounded-lg px-4 py-3 text-center transition-all",
            filter === "critical" ? "border-red-600 bg-red-950/30" : "border-slate-800 hover:border-slate-600")}>
          <div className="text-2xl font-bold text-red-400">{summary.critical}</div>
          <div className="text-xs text-slate-400 mt-0.5">Critical</div>
        </button>
      </div>

      {summary.critical > 0 && (
        <div className="flex items-center gap-2 text-red-300 bg-red-950/20 border border-red-800/30 rounded-lg px-4 py-2.5 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {summary.critical} tenant{summary.critical > 1 ? "s" : ""} have no recent schema snapshots — backup risk is elevated.
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((t: any) => (
          <div key={t.laundryId} className={cn("bg-slate-900 border rounded-lg px-4 py-3",
            t.backupHealth === "critical" ? "border-red-800/50" :
            t.backupHealth === "warning" ? "border-amber-800/50" :
            "border-slate-800"
          )}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <StatusDot status={t.backupHealth as any} />
                <div className="min-w-0">
                  <div className="text-white text-sm font-medium truncate">{t.businessName}</div>
                  <div className="text-slate-400 text-xs">{t.ownerEmail}</div>
                </div>
              </div>
              <div className="text-right shrink-0 space-y-0.5">
                <div className={cn("text-sm font-medium",
                  t.backupHealth === "critical" ? "text-red-400" :
                  t.backupHealth === "warning" ? "text-amber-400" :
                  "text-emerald-400"
                )}>
                  {t.latestSnapshot ? timeAgo(t.latestSnapshot.createdAt) : "Never"}
                </div>
                <div className="text-xs text-slate-500">
                  {t.snapshotsLast7Days} snap{t.snapshotsLast7Days !== 1 ? "s" : ""}/7d
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Subscriptions Tab ─────────────────────────────────────────────────────

function SubscriptionsTab({ token }: { token: string }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin", "subscriptions"],
    queryFn: () => adminFetch("/admin/subscriptions/trial-candidates", token),
    staleTime: 60_000,
  });
  const [transitioning, setTransitioning] = useState<number | null>(null);

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorState />;

  const d = data as any;

  async function transition(laundryId: number, newStatus: string, plan?: string) {
    setTransitioning(laundryId);
    try {
      const body: Record<string, string> = { laundryId: String(laundryId), newStatus };
      if (plan) body.plan = plan;
      await adminFetch("/admin/subscriptions/state-transitions", token);
      // POST manually
      const r = await fetch(`${API_BASE}/admin/subscriptions/state-transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      await refetch();
    } catch (e: any) {
      console.error(e);
    } finally {
      setTransitioning(null);
    }
  }

  const statColors: Record<string, string> = {
    trial: "text-blue-400",
    active: "text-emerald-400",
    past_due: "text-amber-400",
    suspended: "text-red-400",
    cancelled: "text-slate-500",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Subscriptions</h2>
        <Button variant="outline" size="sm" onClick={() => refetch()}
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {d.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Object.entries(d.summary as Record<string, number>).map(([k, v]) => (
            <div key={k} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-3 text-center">
              <div className={cn("text-xl font-bold", statColors[k] ?? "text-white")}>{v}</div>
              <div className="text-xs text-slate-400 mt-0.5 capitalize">{k.replace("_", " ")}</div>
            </div>
          ))}
        </div>
      )}

      {d.trialCandidates?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <FlaskConical className="w-4 h-4 text-blue-400" /> Trial Tenants ({d.trialCandidates.length})
          </h3>
          <div className="space-y-2">
            {d.trialCandidates.map((t: any) => {
              const daysLeft = t.trialEndsAt
                ? Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / 86400000)
                : null;
              return (
                <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-white text-sm font-medium truncate">{t.businessName}</div>
                      <div className="text-slate-400 text-xs">{t.ownerEmail}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className={cn("text-xs font-medium", daysLeft != null && daysLeft <= 0 ? "text-red-400" : daysLeft != null && daysLeft <= 3 ? "text-amber-400" : "text-blue-400")}>
                        {daysLeft == null ? "—" : daysLeft <= 0 ? "Expired" : `${daysLeft}d left`}
                      </div>
                      <button
                        onClick={() => transition(t.id, "active", t.subscriptionTier)}
                        disabled={transitioning === t.id}
                        className="text-xs px-2 py-1 rounded bg-emerald-700/30 text-emerald-300 border border-emerald-700/50 hover:bg-emerald-700/50 transition-colors disabled:opacity-50"
                      >
                        {transitioning === t.id ? "…" : "Convert → Active"}
                      </button>
                      <button
                        onClick={() => transition(t.id, "cancelled")}
                        disabled={transitioning === t.id}
                        className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  {t.trialEndsAt && (
                    <div className="text-xs text-slate-500 mt-1">
                      Trial ends {new Date(t.trialEndsAt).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {d.allTenants && (
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-slate-400" /> All Tenants
          </h3>
          <div className="space-y-2">
            {d.allTenants.map((t: any) => (
              <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-white text-sm font-medium truncate">{t.businessName}</div>
                  <div className="text-slate-400 text-xs">{t.ownerEmail}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <SubStatusBadge status={t.subscriptionStatus ?? "trial"} plan={t.subscriptionTier} />
                  {t.subscriptionRenewsAt && (
                    <span className="text-xs text-slate-500">
                      Renews {new Date(t.subscriptionRenewsAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared UI Helpers ─────────────────────────────────────────────────────

const colorMap = {
  violet: { bg: "bg-violet-950/40", icon: "text-violet-400", border: "border-violet-800/30" },
  blue: { bg: "bg-blue-950/40", icon: "text-blue-400", border: "border-blue-800/30" },
  green: { bg: "bg-emerald-950/40", icon: "text-emerald-400", border: "border-emerald-800/30" },
  amber: { bg: "bg-amber-950/40", icon: "text-amber-400", border: "border-amber-800/30" },
  red: { bg: "bg-red-950/40", icon: "text-red-400", border: "border-red-800/30" },
  teal: { bg: "bg-teal-950/40", icon: "text-teal-400", border: "border-teal-800/30" },
  slate: { bg: "bg-slate-800/60", icon: "text-slate-400", border: "border-slate-700/30" },
};

function MetricCard({ icon: Icon, label, value, sub, color = "slate" }: any) {
  const c = colorMap[color as keyof typeof colorMap] ?? colorMap.slate;
  return (
    <Card className={cn("border", c.bg, c.border)}>
      <CardContent className="px-4 py-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-slate-400 text-xs mb-1">{label}</div>
            <div className="text-2xl font-bold text-white">{value}</div>
            {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
          </div>
          <Icon className={cn("w-5 h-5 mt-0.5", c.icon)} />
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, highlight = false }: { label: string; value: any; highlight?: boolean }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-3 text-center">
      <div className={cn("text-xl font-bold", highlight && value > 0 ? "text-red-400" : "text-white")}>{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

function ProgressRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const barColor = color === "emerald" ? "bg-emerald-500" : color === "amber" ? "bg-amber-400" : color === "red" ? "bg-red-500" : "bg-slate-600";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300">{value} / {total}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-violet-500 animate-spin" />
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-2 text-slate-500">
      <XCircle className="w-8 h-8" />
      <p>Failed to load data</p>
    </div>
  );
}

// ─── Main Shell ────────────────────────────────────────────────────────────

export default function AdminCommandCenter() {
  const navigate = useNavigate();
  const { admin, token, isAuthenticated, logout } = useAdmin();
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/admin/login", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated || !token) return null;

  const handleLogout = () => {
    logout();
    toast.success("Signed out of admin portal");
    navigate("/admin/login", { replace: true });
  };

  const navTabs = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "tenants", label: "Tenants", icon: Building2 },
    { id: "subscriptions", label: "Subscriptions", icon: CreditCard },
    { id: "devices", label: "Devices", icon: MonitorSmartphone },
    { id: "storage", label: "Storage", icon: HardDrive },
    { id: "backups", label: "Backups", icon: Archive },
    { id: "growth", label: "Growth", icon: Rocket },
  ];

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <header className="bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
            <Shield className="w-4.5 h-4.5 text-white w-5 h-5" />
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-none">CleanTrack Admin</div>
            <div className="text-slate-500 text-xs mt-0.5">Platform Command Center</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-sm hidden sm:block">{admin?.name}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}
            className="text-slate-400 hover:text-white hover:bg-slate-800">
            <LogOut className="w-4 h-4 mr-1.5" /> Sign Out
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden lg:flex flex-col w-52 bg-slate-900 border-r border-slate-800 py-4 px-3 shrink-0">
          <nav className="space-y-1 flex-1">
            {navTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all",
                  tab === id
                    ? "bg-violet-600/20 text-violet-300 border border-violet-700/40"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
          <div className="pt-4 border-t border-slate-800 px-3 space-y-1">
            <div className="text-slate-300 text-xs font-medium truncate">{admin?.name ?? "Admin"}</div>
            <div className="text-slate-600 text-xs truncate">{admin?.email ?? ""}</div>
            {admin?.role && (
              <div className="inline-flex items-center gap-1 text-xs bg-violet-900/30 border border-violet-700/30 text-violet-400 rounded px-1.5 py-0.5">
                <ShieldRole className="w-3 h-3" />
                {admin.role === "super_admin" ? "Super Admin" : admin.role === "support_admin" ? "Support" : "Finance"}
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="lg:hidden border-b border-slate-800 bg-slate-900 px-4 py-2">
            <div className="flex gap-1 overflow-x-auto">
              {navTabs.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setTab(id)}
                  className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-all",
                    tab === id ? "bg-violet-600/20 text-violet-300" : "text-slate-400 hover:text-white"
                  )}>
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {tab === "overview" && <OverviewTab token={token} />}
            {tab === "tenants" && <TenantsTab token={token} />}
            {tab === "subscriptions" && <SubscriptionsTab token={token} />}
            {tab === "devices" && <DevicesTab token={token} />}
            {tab === "storage" && <StorageTab token={token} />}
            {tab === "backups" && <BackupsTab token={token} />}
            {tab === "growth" && <GrowthTab token={token} />}
          </div>
        </main>
      </div>
    </div>
  );
}
