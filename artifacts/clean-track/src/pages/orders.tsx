import { useState } from "react";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { CachedDataBadge } from "@/components/cached-data-badge";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { Plus, Search, Eye, AlertTriangle, ArrowUpDown } from "lucide-react";
import { CountdownTimer } from "@/components/countdown-timer";
import { computeDueAt, getUrgency } from "@/lib/urgency";
import { cn } from "@/lib/utils";
import { CreateOrderDialog } from "@/components/create-order-dialog";
import { useBranch } from "@/context/branch-context";

function statusBadge(status: string) {
  const map: Record<string, any> = {
    pending: "warning",
    processing: "info",
    ready: "success",
    partial_pickup: "warning",
    completed: "success",
  };
  const label: Record<string, string> = {
    partial_pickup: "Partial Pickup",
    completed: "Completed",
  };
  return <Badge variant={map[status] || "outline"}>{label[status] ?? status}</Badge>;
}

function paymentBadge(status: string) {
  const map: Record<string, any> = { unpaid: "destructive", partial: "warning", paid: "success" };
  const labels: Record<string, string> = { unpaid: "Unpaid", partial: "Partial", paid: "Paid" };
  return <Badge variant={map[status] || "outline"}>{labels[status] ?? status}</Badge>;
}

function formatCurrency(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);
}

type SortKey = "urgency" | "date";

export default function Orders() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const [showCreate, setShowCreate] = useState(false);
  const { activeBranchId } = useBranch();

  const { data: orders = [], isLoading, isViewingCache } = useCachedQuery({
    queryKey: ["orders", activeBranchId],
    queryFn: () => api.orders.list(activeBranchId ? { branchId: String(activeBranchId) } : undefined),
  });

  const { data: sla } = useCachedQuery({
    queryKey: ["settings", "sla"],
    queryFn: () => api.settings.getSla(),
  });

  const ordersWithUrgency = orders.map(o => {
    const dueAt = computeDueAt(o.createdAt, o.serviceType, sla, o.processingDueAt);
    return { ...o, _urgency: getUrgency(dueAt) };
  });

  const filtered = ordersWithUrgency.filter(o => {
    const matchSearch =
      !search ||
      o.customerName.toLowerCase().includes(search.toLowerCase()) ||
      o.orderId.includes(search) ||
      o.phone.includes(search);
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    const matchPayment = paymentFilter === "all" || o.paymentStatus === paymentFilter;
    const matchUrgency = urgencyFilter === "all" || o._urgency.level === urgencyFilter;
    return matchSearch && matchStatus && matchPayment && matchUrgency;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "urgency") return a._urgency.hoursRemaining - b._urgency.hoursRemaining;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const overdueCount = ordersWithUrgency.filter(o => o._urgency.level === "overdue" && o.status !== "completed").length;
  const urgentCount = ordersWithUrgency.filter(o => o._urgency.level === "urgent" && o.status !== "completed").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">Orders</h1>
            <CachedDataBadge show={isViewingCache} />
          </div>
          {(overdueCount > 0 || urgentCount > 0) && (
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-500">
                  <AlertTriangle className="h-3 w-3" />{overdueCount} overdue
                </span>
              )}
              {urgentCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500">
                  <AlertTriangle className="h-3 w-3" />{urgentCount} urgent
                </span>
              )}
            </div>
          )}
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Order</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, order ID, or phone..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Urgency" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Urgency</SelectItem>
                <SelectItem value="overdue">🔴 Overdue</SelectItem>
                <SelectItem value="urgent">🟠 Urgent</SelectItem>
                <SelectItem value="attention">🟡 Attention</SelectItem>
                <SelectItem value="safe">🟢 Safe</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="ready">Ready</SelectItem>
                <SelectItem value="partial_pickup">Partial Pickup</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Payment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payments</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortKey(k => k === "urgency" ? "date" : "urgency")}
              className="gap-2 whitespace-nowrap"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortKey === "urgency" ? "By Urgency" : "By Date"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">{sorted.length} order{sorted.length !== 1 ? "s" : ""}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading orders...</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden sm:table-cell">Type</TableHead>
                    <TableHead className="hidden md:table-cell">Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Payment</TableHead>
                    <TableHead className="hidden sm:table-cell">Price</TableHead>
                    <TableHead className="hidden lg:table-cell">Timer</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map(order => {
                    const urg = order._urgency;
                    const isActive = !["completed", "partial_pickup"].includes(order.status);
                    const hasItems = (order.itemCount ?? 0) > 0;
                    return (
                      <TableRow key={order.id} className={cn(isActive ? urg.rowClass : "")}>
                        <TableCell className="pr-0">
                          {isActive && <span className={cn("block h-2 w-2 rounded-full mx-auto", urg.dotClass)} />}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{order.orderId}</TableCell>
                        <TableCell className="font-medium">
                          <span className="block">{order.customerName}</span>
                          <span className="sm:hidden text-xs text-muted-foreground">{formatCurrency(order.price as any)} · {order.paymentStatus}</span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span className="capitalize text-sm">{order.serviceType}</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">
                          {hasItems
                            ? <span className="text-primary font-medium">{order.itemCount} item{order.itemCount !== 1 ? "s" : ""}</span>
                            : `${order.shirts}S / ${order.trousers}T`
                          }
                        </TableCell>
                        <TableCell>{statusBadge(order.status)}</TableCell>
                        <TableCell className="hidden sm:table-cell">{paymentBadge(order.paymentStatus)}</TableCell>
                        <TableCell className="hidden sm:table-cell">{formatCurrency(order.price as any)}</TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <CountdownTimer
                            createdAt={order.createdAt}
                            serviceType={order.serviceType}
                            processingDueAt={order.processingDueAt}
                            status={order.status}
                            slaSettings={sla}
                            compact
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" asChild>
                            <Link to={`/orders/${order.id}`}><Eye className="h-4 w-4" /></Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!sorted.length && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                        {orders.length === 0
                          ? "No orders yet. Create your first order using the button above."
                          : "No orders match the current filters. Try adjusting or clearing the filters."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateOrderDialog
        open={showCreate}
        onOpenChange={setShowCreate}
      />
    </div>
  );
}
