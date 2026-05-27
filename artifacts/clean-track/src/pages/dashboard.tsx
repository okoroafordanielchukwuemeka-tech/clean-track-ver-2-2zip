import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  ShoppingCart,
  TrendingUp,
  DollarSign,
  Clock,
  Package,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function Dashboard() {
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => api.analytics.overview(),
  });

  const { data: daily } = useQuery({
    queryKey: ["analytics", "daily"],
    queryFn: () => api.analytics.daily(),
  });

  const { data: recent } = useQuery({
    queryKey: ["orders", "recent"],
    queryFn: () => api.orders.recent(),
  });

  const { data: summary } = useQuery({
    queryKey: ["orders", "summary"],
    queryFn: () => api.orders.summary(),
  });

  if (overviewLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-16 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const growthPositive = (overview?.weeklyGrowthPercent ?? 0) >= 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Button asChild>
          <Link to="/orders">View All Orders</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Orders</p>
                <p className="text-2xl font-bold">{overview?.totalOrders ?? 0}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                <ShoppingCart className="h-5 w-5 text-blue-600" />
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2 text-xs">
              {growthPositive ? (
                <ArrowUpRight className="h-3 w-3 text-green-600" />
              ) : (
                <ArrowDownRight className="h-3 w-3 text-red-600" />
              )}
              <span className={growthPositive ? "text-green-600" : "text-red-600"}>
                {Math.abs(overview?.weeklyGrowthPercent ?? 0).toFixed(1)}% this week
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">{formatCurrency(overview?.totalRevenue ?? 0)}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Collected: {formatCurrency(overview?.collectedRevenue ?? 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Batches</p>
                <p className="text-2xl font-bold">{overview?.activeBatches ?? 0}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
                <Package className="h-5 w-5 text-purple-600" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {overview?.ordersThisMonth ?? 0} orders this month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Delayed Orders</p>
                <p className="text-2xl font-bold">{overview?.delayedOrders ?? 0}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Pending revenue: {formatCurrency(overview?.pendingRevenue ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: "Pending", value: summary.pending, color: "warning" },
            { label: "Processing", value: summary.processing, color: "info" },
            { label: "Ready", value: summary.ready, color: "success" },
            { label: "Unpaid", value: summary.unpaid, color: "destructive" },
            { label: "Partial", value: summary.partial, color: "warning" },
            { label: "Paid", value: summary.paid, color: "success" },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Badge variant={color as any}>{value}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Orders – Last 14 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={daily ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(v) => formatDate(v)} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={(v) => formatDate(v as string)} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Orders</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {(recent ?? []).slice(0, 6).map((order) => (
                <Link
                  key={order.id}
                  to={`/orders/${order.id}`}
                  className="flex items-center justify-between px-6 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium">{order.customerName}</p>
                    <p className="text-xs text-muted-foreground">{order.orderId}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        order.status === "ready"
                          ? "success"
                          : order.status === "processing"
                          ? "info"
                          : "warning"
                      }
                    >
                      {order.status}
                    </Badge>
                  </div>
                </Link>
              ))}
              {!recent?.length && (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No orders yet
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
