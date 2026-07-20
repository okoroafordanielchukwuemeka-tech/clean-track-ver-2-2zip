import { useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/use-page-title";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { CachedDataBadge } from "@/components/cached-data-badge";
import { PendingSyncBadge } from "@/components/pending-sync-badge";
import { usePendingLocalOrders } from "@/hooks/use-pending-local";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import {
  Plus, Search, Eye, AlertTriangle, ArrowUpDown, ShoppingCart,
  Download, RefreshCw, CheckSquare, X, ChevronDown,
  Package, Clock, CheckCircle, Loader,
} from "lucide-react";
import { CountdownTimer } from "@/components/countdown-timer";
import { computeDueAt, getUrgency } from "@/lib/urgency";
import { cn } from "@/lib/utils";
import { CreateOrderDialog } from "@/components/create-order-dialog";
import { useBranch } from "@/context/branch-context";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Order } from "@/lib/api";
import { OrderStatusBadge, PaymentStatusBadge } from "@/lib/order-status";

function formatCurrency(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);
}

type SortKey = "urgency" | "date";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready",
  partial_pickup: "Partial Pickup",
  completed: "Completed",
};

const BULK_STATUSES = [
  { value: "processing", label: "Mark Processing", icon: Loader },
  { value: "ready", label: "Mark Ready", icon: CheckCircle },
  { value: "completed", label: "Mark Completed", icon: Package },
];

// ── Stats bar ──────────────────────────────────────────────────────────────
function StatsBar({ orders }: { orders: (Order & { _urgency: any })[] }) {
  const counts = orders.reduce(
    (acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const overdue = orders.filter(o => o._urgency.level === "overdue" && o.status !== "completed").length;
  // Order prices/amountPaid come back from the API as decimal strings (e.g. "1200.00"),
  // not numbers — summing them directly produced string concatenation → NaN once
  // formatCurrency ran Intl.NumberFormat over the result. Always parse first.
  const revenue = orders.reduce((s, o) => s + (parseFloat(String(o.price ?? 0)) || 0), 0);
  const collected = orders.reduce((s, o) => s + (parseFloat(String(o.amountPaid ?? 0)) || 0), 0);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
      {[
        { label: "Pending", count: counts.pending ?? 0, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" },
        { label: "Processing", count: counts.processing ?? 0, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800" },
        { label: "Ready", count: counts.ready ?? 0, color: "text-green-600", bg: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" },
        { label: "Completed", count: counts.completed ?? 0, color: "text-slate-600", bg: "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700" },
        { label: "Overdue", count: overdue, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" },
        {
          label: "Revenue",
          count: null,
          value: formatCurrency(revenue),
          sub: `${formatCurrency(collected)} collected`,
          color: "text-primary",
          bg: "bg-primary/5 border-primary/20",
        },
      ].map(({ label, count, value, sub, color, bg }) => (
        <div key={label} className={`rounded-lg border px-3 py-2.5 ${bg}`}>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value ?? count}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ── CSV export ─────────────────────────────────────────────────────────────
function exportToCSV(orders: (Order & { _urgency: any })[], filename = "orders.csv") {
  const headers = [
    "Order ID", "Customer", "Phone", "Service", "Status", "Payment",
    "Items", "Price (₦)", "Paid (₦)", "Created At",
  ];
  const rows = orders.map(o => [
    o.orderId,
    o.customerName,
    o.phone,
    o.serviceType,
    STATUS_LABELS[o.status] ?? o.status,
    o.paymentStatus,
    o.itemSummary ?? `${o.shirts}S/${o.trousers}T`,
    o.price ?? 0,
    o.amountPaid ?? 0,
    new Date(o.createdAt).toLocaleString("en-NG"),
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Bulk action toolbar ───────────────────────────────────────────────────
function BulkActionBar({
  selectedCount,
  onClearSelection,
  onBulkUpdate,
  isUpdating,
}: {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkUpdate: (status: string) => void;
  isUpdating: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap bg-primary/10 border border-primary/30 rounded-lg px-4 py-2.5">
      <CheckSquare className="h-4 w-4 text-primary shrink-0" />
      <span className="text-sm font-medium text-primary">
        {selectedCount} order{selectedCount !== 1 ? "s" : ""} selected
      </span>
      <div className="flex items-center gap-2 ml-2 flex-wrap">
        {BULK_STATUSES.map(({ value, label }) => (
          <Button
            key={value}
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            disabled={isUpdating}
            onClick={() => onBulkUpdate(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 ml-auto"
        onClick={onClearSelection}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default function Orders() {
  usePageTitle("Orders");
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") || "all");
  const [paymentFilter, setPaymentFilter] = useState(() => searchParams.get("payment") || "all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const [showCreate, setShowCreate] = useState(() => searchParams.get("create") === "1");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const navigate = useNavigate();
  const { activeBranchId } = useBranch();
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading, isViewingCache } = useCachedQuery({
    queryKey: ["orders", activeBranchId],
    queryFn: () => api.orders.list(activeBranchId ? { branchId: String(activeBranchId) } : undefined),
  });

  const { data: sla } = useCachedQuery({
    queryKey: ["settings", "sla"],
    queryFn: () => api.settings.getSla(),
  });

  const { laundryId } = useAuth();
  const pendingOrders = usePendingLocalOrders(laundryId);

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
    const matchStatus =
      statusFilter === "all" ? true :
      statusFilter === "pickup" ? (o.status === "ready" || o.status === "partial_pickup") :
      o.status === statusFilter;
    const matchPayment =
      paymentFilter === "all" ? true :
      paymentFilter === "outstanding" ? (o.paymentStatus === "unpaid" || o.paymentStatus === "partial") :
      o.paymentStatus === paymentFilter;
    const matchUrgency = urgencyFilter === "all" || o._urgency.level === urgencyFilter;
    return matchSearch && matchStatus && matchPayment && matchUrgency;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "urgency") return a._urgency.hoursRemaining - b._urgency.hoursRemaining;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const overdueCount = ordersWithUrgency.filter(o => o._urgency.level === "overdue" && o.status !== "completed").length;
  const urgentCount = ordersWithUrgency.filter(o => o._urgency.level === "urgent" && o.status !== "completed").length;

  // ── Selection helpers ──────────────────────────────────────────────────
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectableIds = sorted.filter(o => o.status !== "completed").map(o => o.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  }, [allSelected, selectableIds]);

  // ── Bulk status update ─────────────────────────────────────────────────
  const handleBulkUpdate = useCallback(async (status: string) => {
    if (selectedIds.size === 0) return;
    setIsBulkUpdating(true);
    const ids = [...selectedIds];
    let successCount = 0;
    let failCount = 0;
    await Promise.allSettled(
      ids.map(async id => {
        try {
          await api.orders.update(id, { status: status as any });
          successCount++;
        } catch {
          failCount++;
        }
      })
    );
    setIsBulkUpdating(false);
    setSelectedIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ["orders"] });
    if (successCount > 0) toast.success(`Updated ${successCount} order${successCount !== 1 ? "s" : ""} to ${STATUS_LABELS[status] ?? status}`);
    if (failCount > 0) toast.error(`${failCount} order${failCount !== 1 ? "s" : ""} failed to update`);
  }, [selectedIds, queryClient]);

  // ── CSV export ─────────────────────────────────────────────────────────
  const handleExport = () => {
    const toExport = someSelected
      ? sorted.filter(o => selectedIds.has(o.id))
      : sorted;
    const dateStr = new Date().toISOString().split("T")[0];
    exportToCSV(toExport, `cleantrack-orders-${dateStr}.csv`);
    toast.success(`Exported ${toExport.length} order${toExport.length !== 1 ? "s" : ""} to CSV`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">
              {statusFilter === "pickup" ? "Pickups" : paymentFilter === "outstanding" ? "Payments" : "Orders"}
            </h1>
            <CachedDataBadge show={isViewingCache} />
          </div>
          {statusFilter === "pickup" && (
            <p className="text-sm text-muted-foreground mt-0.5">Orders ready or awaiting partial pickup</p>
          )}
          {paymentFilter === "outstanding" && (
            <p className="text-sm text-muted-foreground mt-0.5">Orders with unpaid or partial balance</p>
          )}
          {statusFilter !== "pickup" && paymentFilter !== "outstanding" && (overdueCount > 0 || urgentCount > 0) && (
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
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={sorted.length === 0}
            className="gap-2 hidden sm:flex"
          >
            <Download className="h-3.5 w-3.5" />
            Export{someSelected ? ` (${selectedIds.size})` : ""}
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Order</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      {!isLoading && ordersWithUrgency.length > 0 && (
        <StatsBar orders={ordersWithUrgency} />
      )}

      {/* Bulk action toolbar */}
      {someSelected && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onClearSelection={() => setSelectedIds(new Set())}
          onBulkUpdate={handleBulkUpdate}
          isUpdating={isBulkUpdating}
        />
      )}

      {/* Filters */}
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
                aria-label="Search orders"
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
                <SelectItem value="pickup">Ready / Pickup</SelectItem>
                <SelectItem value="ready">Ready</SelectItem>
                <SelectItem value="partial_pickup">Partial Pickup</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Payment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payments</SelectItem>
                <SelectItem value="outstanding">Outstanding</SelectItem>
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
            {(search || statusFilter !== "all" || paymentFilter !== "all" || urgencyFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setPaymentFilter("all");
                  setUrgencyFilter("all");
                }}
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-0 flex-row items-center justify-between">
          <CardTitle className="text-base">{sorted.length} order{sorted.length !== 1 ? "s" : ""}</CardTitle>
          {/* Mobile export */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExport}
            disabled={sorted.length === 0}
            className="gap-1.5 text-muted-foreground sm:hidden"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-4 w-4 bg-muted animate-pulse rounded" />
                  <div className="h-2 w-2 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="h-4 w-20 bg-muted animate-pulse rounded font-mono" />
                  <div className="flex-1 space-y-1">
                    <div className="h-4 w-36 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-24 bg-muted animate-pulse rounded" />
                  </div>
                  <div className="h-5 w-16 bg-muted animate-pulse rounded hidden sm:block" />
                  <div className="h-5 w-14 bg-muted animate-pulse rounded hidden sm:block" />
                  <div className="h-4 w-20 bg-muted animate-pulse rounded hidden sm:block" />
                  <div className="h-8 w-8 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4">
                      {selectableIds.length > 0 && (
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      )}
                    </TableHead>
                    <TableHead className="w-6 pl-0"></TableHead>
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
                  {pendingOrders.map(o => (
                    <TableRow key={o.localId} className="bg-blue-50/40 dark:bg-blue-950/20 opacity-90">
                      <TableCell className="pl-4"><span className="block h-2 w-2 rounded-full mx-auto bg-blue-400" /></TableCell>
                      <TableCell className="pl-0"></TableCell>
                      <TableCell className="font-mono text-xs">{o.orderId ?? o.localId.slice(0, 12)}</TableCell>
                      <TableCell className="font-medium">
                        <span className="block">{o.customerName}</span>
                        <span className="sm:hidden text-xs text-muted-foreground">{o.phone}</span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className="capitalize text-sm">{o.serviceType}</span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">—</TableCell>
                      <TableCell><PendingSyncBadge /></TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">—</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm">{formatCurrency(o.price ?? 0)}</TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">—</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))}
                  {sorted.map(order => {
                    const urg = order._urgency;
                    const isActive = !["completed", "partial_pickup"].includes(order.status);
                    const hasItems = (order.itemCount ?? 0) > 0;
                    const isSelected = selectedIds.has(order.id);
                    const isSelectable = order.status !== "completed";
                    return (
                      <TableRow
                        key={order.id}
                        className={cn(
                          "cursor-pointer",
                          isActive ? urg.rowClass : "",
                          isSelected && "bg-primary/5 dark:bg-primary/10"
                        )}
                        onClick={(e) => {
                          const t = e.target as HTMLElement;
                          if (t.closest('[role="checkbox"]') || t.closest("button") || t.closest("a")) return;
                          navigate(`/orders/${order.id}`);
                        }}
                      >
                        <TableCell className="pl-4">
                          {isSelectable && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(order.id)}
                              aria-label={`Select order ${order.orderId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="pl-0">
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
                        <TableCell><OrderStatusBadge status={order.status} /></TableCell>
                        <TableCell className="hidden sm:table-cell"><PaymentStatusBadge status={order.paymentStatus} /></TableCell>
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
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0"
                            title="Open order"
                            onClick={() => navigate(`/orders/${order.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!sorted.length && !pendingOrders.length && (
                    <TableRow>
                      <TableCell colSpan={11}>
                        {orders.length === 0 ? (
                          <div className="text-center py-14 space-y-3">
                            <ShoppingCart className="h-10 w-10 mx-auto text-muted-foreground/40" />
                            <div>
                              <p className="font-medium text-foreground">No orders yet</p>
                              <p className="text-sm text-muted-foreground mt-1">Your first order takes less than 2 minutes to create.</p>
                            </div>
                            <Button size="sm" onClick={() => setShowCreate(true)}>
                              Create Your First Order
                            </Button>
                          </div>
                        ) : (
                          <div className="text-center py-10 text-muted-foreground text-sm">
                            No orders match the current filters.{" "}
                            <button
                              className="underline text-foreground hover:text-primary"
                              onClick={() => {
                                setSearch("");
                                setStatusFilter("all");
                                setPaymentFilter("all");
                                setUrgencyFilter("all");
                              }}
                            >
                              Clear filters
                            </button>
                          </div>
                        )}
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
