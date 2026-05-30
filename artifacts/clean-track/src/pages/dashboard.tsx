import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type AnalyticsPeriod } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, BarChart, Bar,
} from "recharts";
import {
  DollarSign, ShoppingCart, Users, AlertTriangle, TrendingUp,
  TrendingDown, Clock, CheckCircle, ShoppingBag, Package,
  Crown, RefreshCw, ArrowUpRight, ArrowDownRight, Minus,
  Activity, UserCheck, Zap, Receipt, Settings, Percent,
} from "lucide-react";

const fmt = (v: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);

const fmtShort = (v: number) => {
  if (v >= 1_000_000) return `₦${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `₦${(v / 1_000).toFixed(0)}K`;
  return fmt(v);
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function GrowthBadge({ pct }: { pct: number }) {
  if (pct > 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs text-green-600 font-medium">
      <ArrowUpRight className="h-3 w-3" />{pct.toFixed(1)}%
    </span>
  );
  if (pct < 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs text-red-600 font-medium">
      <ArrowDownRight className="h-3 w-3" />{Math.abs(pct).toFixed(1)}%
    </span>
  );
  return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" />0%</span>;
}

function KpiCard({
  label, value, sub, icon: Icon, iconBg, iconColor, growth, valueClass,
}: {
  label: string; value: string; sub?: string; icon: any;
  iconBg: string; iconColor: string; growth?: number; valueClass?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl font-bold truncate ${valueClass ?? ""}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
            {growth !== undefined && <div className="mt-1"><GrowthBadge pct={growth} /></div>}
          </div>
          <div className={`h-10 w-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0 ml-3`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border rounded-lg p-3 shadow-lg text-xs">
      <p className="font-medium mb-1">{fmtDate(label)}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span style={{ color: p.color }}>●</span>
          <span className="text-muted-foreground capitalize">{p.name}:</span>
          <span className="font-medium">
            {p.name === "orders" ? p.value : fmtShort(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("7d");

  const { data: full, isLoading } = useQuery({
    queryKey: ["analytics", "full", period],
    queryFn: () => api.analytics.full(period),
  });

  const { data: custData } = useQuery({
    queryKey: ["analytics", "customers"],
    queryFn: () => api.analytics.customerAnalytics(),
  });

  const { data: workerData } = useQuery({
    queryKey: ["analytics", "workers"],
    queryFn: () => api.analytics.workerAnalytics(),
  });

  const { data: recent } = useQuery({
    queryKey: ["orders", "recent"],
    queryFn: () => api.orders.recent(),
  });

  const { data: slaData } = useQuery({
    queryKey: ["analytics", "sla"],
    queryFn: () => api.settings.getSlaAnalytics(),
    refetchInterval: 60_000,
  });

  const { data: pendingDiscounts } = useQuery({
    queryKey: ["discount-approvals", "pending-count"],
    queryFn: () => api.discountApprovals.pendingCount(),
    refetchInterval: 30_000,
  });

  const ov = full?.overview;
  const gr = full?.growth;
  const profit = ov?.estimatedProfit ?? 0;
  const isProfitable = profit >= 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Operational control center</p>
        </div>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as AnalyticsPeriod)}>
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="7d">7 Days</TabsTrigger>
            <TabsTrigger value="30d">30 Days</TabsTrigger>
            <TabsTrigger value="90d">90 Days</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i}><CardContent className="p-5"><div className="h-16 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Revenue"
              value={fmtShort(ov?.totalRevenue ?? 0)}
              sub={PERIOD_LABELS[period]}
              icon={DollarSign}
              iconBg="bg-green-100 dark:bg-green-950/40"
              iconColor="text-green-600"
              growth={gr?.revenue}
            />
            <KpiCard
              label="Collected"
              value={fmtShort(ov?.collectedRevenue ?? 0)}
              sub={`${fmtShort(ov?.outstandingBalance ?? 0)} outstanding`}
              icon={TrendingUp}
              iconBg="bg-blue-100 dark:bg-blue-950/40"
              iconColor="text-blue-600"
              growth={gr?.collected}
            />
            <KpiCard
              label="Total Expenses"
              value={fmtShort(ov?.totalExpenses ?? 0)}
              sub="Operational costs"
              icon={TrendingDown}
              iconBg="bg-red-100 dark:bg-red-950/40"
              iconColor="text-red-600"
            />
            <KpiCard
              label="Est. Profit"
              value={fmtShort(Math.abs(profit))}
              sub={isProfitable ? "Revenue − Expenses" : "Running at a loss"}
              icon={isProfitable ? TrendingUp : AlertTriangle}
              iconBg={isProfitable ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-red-100 dark:bg-red-950/40"}
              iconColor={isProfitable ? "text-emerald-600" : "text-red-600"}
              valueClass={isProfitable ? "text-emerald-600" : "text-red-600"}
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Active Orders"
              value={String(ov?.activeOrders ?? 0)}
              sub="In progress"
              icon={Activity}
              iconBg="bg-orange-100 dark:bg-orange-950/40"
              iconColor="text-orange-600"
            />
            <KpiCard
              label="Total Orders"
              value={String(ov?.totalOrders ?? 0)}
              sub={`Avg ${fmt(ov?.avgOrderValue ?? 0)}/order`}
              icon={ShoppingCart}
              iconBg="bg-purple-100 dark:bg-purple-950/40"
              iconColor="text-purple-600"
              growth={gr?.orders}
            />
            <KpiCard
              label="Partial Pickups"
              value={String(ov?.partialPickup ?? 0)}
              sub={`${ov?.totalRemainingItems ?? 0} items remaining`}
              icon={ShoppingBag}
              iconBg="bg-amber-100 dark:bg-amber-950/40"
              iconColor="text-amber-600"
            />
            <KpiCard
              label="Outstanding Balance"
              value={fmtShort(ov?.outstandingBalance ?? 0)}
              sub={`${full?.paymentCounts.unpaid ?? 0} unpaid orders`}
              icon={AlertTriangle}
              iconBg="bg-rose-100 dark:bg-rose-950/40"
              iconColor="text-rose-600"
            />
          </div>

          {!isProfitable && (ov?.totalExpenses ?? 0) > 0 && (
            <Card className="border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-400">Low Profit Warning</p>
                  <p className="text-xs text-red-600 dark:text-red-500">
                    Expenses ({fmtShort(ov?.totalExpenses ?? 0)}) exceed collected revenue ({fmtShort(ov?.collectedRevenue ?? 0)}) for {PERIOD_LABELS[period].toLowerCase()}. Review your expenditures.
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild className="shrink-0 border-red-300 text-red-700 hover:bg-red-100">
                  <Link to="/expenditures">View Expenses</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {(pendingDiscounts?.count ?? 0) > 0 && (
            <Card className="border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="p-4 flex items-center gap-3">
                <Percent className="h-5 w-5 text-amber-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
                    {pendingDiscounts!.count} discount request{pendingDiscounts!.count !== 1 ? "s" : ""} awaiting approval
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-500">Workers are waiting — review and approve or reject</p>
                </div>
                <Button variant="outline" size="sm" asChild className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100">
                  <Link to="/discount-approvals">Review</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {slaData && (slaData.overdueCount > 0 || slaData.dueSoonCount > 0) && (
            <div className="flex flex-col sm:flex-row gap-3">
              {slaData.overdueCount > 0 && (
                <Card className="flex-1 border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-red-800 dark:text-red-400">
                        {slaData.overdueCount} overdue order{slaData.overdueCount > 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-red-600 dark:text-red-500">Past operational deadline — prioritise immediately</p>
                    </div>
                    <Button variant="outline" size="sm" asChild className="shrink-0 border-red-300 text-red-700 hover:bg-red-100">
                      <Link to="/orders">View</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
              {slaData.dueSoonCount > 0 && (
                <Card className="flex-1 border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <Clock className="h-5 w-5 text-amber-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
                        {slaData.dueSoonCount} due within 24h
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-500">Ensure workers are on these orders</p>
                    </div>
                    <Button variant="outline" size="sm" asChild className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100">
                      <Link to="/orders">View</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  SLA Performance
                </CardTitle>
                <Button variant="ghost" size="sm" asChild className="text-xs gap-1">
                  <Link to="/settings"><Settings className="h-3 w-3" />Configure</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {slaData ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="text-center p-3 rounded-xl bg-muted/50">
                    <p className={`text-2xl font-bold ${slaData.overdueCount > 0 ? "text-red-600" : "text-green-600"}`}>
                      {slaData.overdueCount}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Overdue</p>
                  </div>
                  <div className="text-center p-3 rounded-xl bg-muted/50">
                    <p className={`text-2xl font-bold ${slaData.dueSoonCount > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {slaData.dueSoonCount}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Due Soon</p>
                  </div>
                  <div className="text-center p-3 rounded-xl bg-muted/50">
                    <p className={`text-2xl font-bold ${slaData.onTimeRate >= 90 ? "text-green-600" : slaData.onTimeRate >= 70 ? "text-amber-600" : "text-red-600"}`}>
                      {slaData.onTimeRate.toFixed(0)}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">On-Time Rate</p>
                  </div>
                  <div className="text-center p-3 rounded-xl bg-muted/50">
                    <p className="text-2xl font-bold text-blue-600">
                      {slaData.avgCompletionHours != null ? `${slaData.avgCompletionHours.toFixed(0)}h` : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Avg Completion</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-4">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}
                </div>
              )}

              {slaData && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-3">Breakdown by service type</p>
                  <div className="space-y-2">
                    {(["express", "standard", "premium"] as const).map(type => {
                      const stat = slaData.byServiceType?.[type];
                      if (!stat || stat.count === 0) return null;
                      const slaHours = type === "express"
                        ? slaData.slaSettings?.expressTurnaroundHours
                        : type === "premium"
                        ? slaData.slaSettings?.premiumTurnaroundHours
                        : slaData.slaSettings?.standardTurnaroundHours;
                      return (
                        <div key={type} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground capitalize w-16 shrink-0">
                            {type}
                          </span>
                          <span className="text-xs text-muted-foreground w-12 shrink-0">
                            {slaHours ?? "—"}h SLA
                          </span>
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <span className="text-xs font-medium">{stat.count} orders</span>
                            {stat.overdueCount > 0 && (
                              <Badge variant="destructive" className="text-xs px-1 py-0">{stat.overdueCount} overdue</Badge>
                            )}
                            {stat.avgHours != null && (
                              <span className="text-xs text-muted-foreground">avg {stat.avgHours.toFixed(0)}h</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Revenue Trend — {PERIOD_LABELS[period]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={full?.trends ?? []} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => fmtShort(v)} tick={{ fontSize: 10 }} width={50} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="revenue" name="revenue" stroke="hsl(var(--primary))" fill="url(#revGrad)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="collected" name="collected" stroke="#22c55e" fill="url(#colGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  Order Pipeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {full && [
                  { label: "Pending", count: full.statusCounts.pending, color: "bg-yellow-400", max: full.overview.totalOrders },
                  { label: "Processing", count: full.statusCounts.processing, color: "bg-blue-400", max: full.overview.totalOrders },
                  { label: "Ready", count: full.statusCounts.ready, color: "bg-emerald-400", max: full.overview.totalOrders },
                  { label: "Partial Pickup", count: full.statusCounts.partial_pickup, color: "bg-orange-400", max: full.overview.totalOrders },
                  { label: "Completed", count: full.statusCounts.completed, color: "bg-green-500", max: full.overview.totalOrders },
                ].map(({ label, count, color, max }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full ${color} rounded-full transition-all`}
                        style={{ width: max > 0 ? `${(count / max) * 100}%` : "0%" }}
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t mt-3 space-y-1">
                  {full && [
                    { label: "Unpaid", count: full.paymentCounts.unpaid, variant: "destructive" },
                    { label: "Partial Pay", count: full.paymentCounts.partial, variant: "warning" },
                    { label: "Paid", count: full.paymentCounts.paid, variant: "success" },
                  ].map(({ label, count, variant }) => (
                    <div key={label} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <Badge variant={variant as any} className="text-xs">{count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Daily Orders — {PERIOD_LABELS[period]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={full?.trends ?? []} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={25} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="orders" name="orders" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-red-500" />
                  Expenses by Category
                </CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/expenditures">Manage</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {full?.expenses && Object.keys(full.expenses.byCategory).length > 0 ? (
                  <>
                    {Object.entries(full.expenses.byCategory)
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, amount]) => {
                        const pct = full.expenses.total > 0 ? (amount / full.expenses.total) * 100 : 0;
                        return (
                          <div key={cat}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-muted-foreground capitalize">{cat}</span>
                              <span className="font-medium">{fmtShort(amount)}</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-red-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    <div className="pt-2 border-t flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-bold text-red-600">{fmtShort(full.expenses.total)}</span>
                    </div>
                  </>
                ) : (
                  <div className="py-6 text-center text-muted-foreground text-sm">
                    <Receipt className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No expenses recorded for this period</p>
                    <Button variant="outline" size="sm" className="mt-3" asChild>
                      <Link to="/expenditures">Add expenses</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Operational Alerts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(full?.alerts.delayedOrders.length ?? 0) === 0 &&
                  (full?.alerts.unpaidCount ?? 0) === 0 &&
                  (full?.alerts.partialPickupCount ?? 0) === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-emerald-600 py-4 justify-center">
                    <CheckCircle className="h-4 w-4" />
                    All clear — no active alerts
                  </div>
                ) : (
                  <>
                    {(full?.alerts.unpaidCount ?? 0) > 0 && (
                      <Link to="/orders?paymentStatus=unpaid" className="flex items-center gap-3 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors">
                        <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-red-800 dark:text-red-400">{full?.alerts.unpaidCount} unpaid orders</p>
                          <p className="text-xs text-red-600 dark:text-red-500">Outstanding balance needs collection</p>
                        </div>
                        <ArrowUpRight className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      </Link>
                    )}
                    {(full?.alerts.partialPickupCount ?? 0) > 0 && (
                      <Link to="/orders?status=partial_pickup" className="flex items-center gap-3 p-2.5 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900 hover:bg-orange-100 dark:hover:bg-orange-950/40 transition-colors">
                        <ShoppingBag className="h-4 w-4 text-orange-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-orange-800 dark:text-orange-400">{full?.alerts.partialPickupCount} partial pickups</p>
                          <p className="text-xs text-orange-600 dark:text-orange-500">{ov?.totalRemainingItems} items still waiting</p>
                        </div>
                        <ArrowUpRight className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      </Link>
                    )}
                    {full?.alerts.delayedOrders.slice(0, 3).map((o) => (
                      <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center gap-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors">
                        <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-amber-800 dark:text-amber-400 truncate">{o.customerName}</p>
                          <p className="text-xs text-amber-600 dark:text-amber-500">{o.orderId} · {o.daysOld}d old · {o.status}</p>
                        </div>
                        <ArrowUpRight className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      </Link>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Recent Orders
                </CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/orders">View all</Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {(recent ?? []).slice(0, 5).map((order) => {
                    const remainingS = Math.max(0, order.shirts - (order.shirtsPickedUp ?? 0));
                    const remainingT = Math.max(0, order.trousers - (order.trousersPickedUp ?? 0));
                    const statusVariant: Record<string, any> = {
                      pending: "warning", processing: "info", ready: "success",
                      partial_pickup: "warning", completed: "success",
                    };
                    const statusLabel: Record<string, string> = { partial_pickup: "Partial" };
                    return (
                      <Link key={order.id} to={`/orders/${order.id}`}
                        className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{order.customerName}</p>
                          <p className="text-xs text-muted-foreground">{order.orderId} · {order.shirts}S/{order.trousers}T</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          {order.status === "partial_pickup" && (
                            <span className="text-xs text-orange-500">{remainingS}S/{remainingT}T</span>
                          )}
                          <Badge variant={statusVariant[order.status] ?? "outline"} className="text-xs">
                            {statusLabel[order.status] ?? order.status}
                          </Badge>
                        </div>
                      </Link>
                    );
                  })}
                  {!recent?.length && (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">No orders yet</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Customer Intelligence
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/customers">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {custData ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Total", value: custData.segments.total, icon: Users, color: "text-blue-600" },
                    { label: "VIP", value: custData.segments.vip, icon: Crown, color: "text-yellow-600" },
                    { label: "Repeat", value: custData.segments.repeat, icon: RefreshCw, color: "text-purple-600" },
                    { label: "New (30d)", value: custData.segments.newThisMonth, icon: UserCheck, color: "text-green-600" },
                    { label: "Inactive", value: custData.segments.inactive, icon: Zap, color: "text-gray-500" },
                    { label: "With Balance", value: custData.segments.withBalance, icon: AlertTriangle, color: "text-red-600" },
                  ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="text-center p-2 bg-muted/40 rounded-lg">
                      <Icon className={`h-4 w-4 ${color} mx-auto mb-1`} />
                      <p className="text-lg font-bold">{value}</p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
                {custData.segments.totalOutstanding > 0 && (
                  <div className="flex items-center justify-between p-2.5 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-900 text-sm">
                    <span className="text-red-700 dark:text-red-400">Total outstanding from customers</span>
                    <span className="font-bold text-red-600">{fmt(custData.segments.totalOutstanding)}</span>
                  </div>
                )}
                {custData.topSpenders.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Top Spenders</p>
                    <div className="space-y-1.5">
                      {custData.topSpenders.slice(0, 5).map((c, i) => (
                        <div key={c.id} className="flex items-center gap-2.5">
                          <span className="text-xs text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium truncate">{c.fullName}</p>
                              {c.isVip && <Crown className="h-3 w-3 text-yellow-500 shrink-0" />}
                            </div>
                            <p className="text-xs text-muted-foreground">{c.totalOrders} orders</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold">{fmtShort(c.totalSpending)}</p>
                            {c.outstandingBalance > 0 && (
                              <p className="text-xs text-red-500">-{fmtShort(c.outstandingBalance)} owed</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-primary" />
                Worker Performance
              </CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/workers">View all</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {workerData ? (
                <>
                  {workerData.workers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No workers configured yet</p>
                  ) : (
                    <div className="space-y-2.5">
                      {workerData.workers.filter(w => w.isActive).map((w) => (
                        <div key={w.id} className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <p className="text-sm font-medium truncate">{w.name}</p>
                              <Badge variant={w.role === "admin" ? "info" : "outline"} className="text-xs">{w.role}</Badge>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full"
                                style={{ width: workerData.workers[0]?.totalAssigned > 0 ? `${(w.totalAssigned / Math.max(...workerData.workers.map(x => x.totalAssigned), 1)) * 100}%` : "0%" }}
                              />
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold">{w.totalAssigned}</p>
                            <p className="text-xs text-muted-foreground">{w.recentPickups} pickups</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {workerData.unassignedOrders > 0 && (
                    <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Unassigned active orders</span>
                      <Badge variant="warning">{workerData.unassignedOrders}</Badge>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
