import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  OpsAuditLogResponse,
  OpsPaymentsResponse,
  OpsPickupsResponse,
  OpsWorkerActivityResponse,
  OpsHealthResponse,
} from "@/lib/api";
import { useBranch } from "@/context/branch-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Activity,
  CreditCard,
  Package,
  Users,
  Heart,
  RefreshCw,
  Search,
  Clock,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  CheckCircle,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
];

const PAGE_SIZE = 50;

const fmt = (v: number | string) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(v));

const fmtDate = (d: string) => format(new Date(d), "dd MMM yyyy, HH:mm");
const fmtAge = (d: string) => formatDistanceToNow(new Date(d), { addSuffix: true });

function PeriodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-32 h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIODS.map((p) => (
          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Pagination({
  page, total, pageSize, onChange,
}: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-end mt-3">
      <span className="text-xs text-muted-foreground">
        Page {page + 1} of {totalPages} ({total} total)
      </span>
      <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="h-3 w-3" />
      </Button>
      <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => onChange(page + 1)}>
        <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const colorMap: Record<string, string> = {
    payment_recorded: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    pickup_completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    pickup_partial: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
    order_created: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    order_updated: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    order_cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    status_updated: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    discount_applied: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    payment_deleted: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  const cls = colorMap[action] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap", cls)}>
      {action.replace(/_/g, " ")}
    </span>
  );
}

function MethodBadge({ method }: { method: string }) {
  const map: Record<string, string> = {
    cash: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    transfer: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    pos: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase", map[method] ?? "bg-slate-100 text-slate-600")}>
      {method}
    </span>
  );
}

function ActorBadge({ type, name }: { type: string; name: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium truncate max-w-[120px]">{name}</span>
      <span className={cn("text-[10px]", type === "owner" ? "text-blue-500" : "text-amber-500")}>
        {type}
      </span>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground text-sm">
      <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
      No {label} found for the selected period.
    </div>
  );
}

function AuditLogTab() {
  const [period, setPeriod] = useState("7d");
  const [search, setSearch] = useState("");
  const [actorType, setActorType] = useState("all");
  const [page, setPage] = useState(0);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ops-audit-log", period, search, actorType, page],
    queryFn: () => api.operations.auditLog({
      period,
      action: search || undefined,
      actorType: actorType === "all" ? undefined : actorType,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    staleTime: 30_000,
  });

  const entries = (data as OpsAuditLogResponse | undefined)?.entries ?? [];
  const total = (data as OpsAuditLogResponse | undefined)?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <PeriodSelect value={period} onChange={(v) => { setPeriod(v); setPage(0); }} />
        <Select value={actorType} onValueChange={(v) => { setActorType(v); setPage(0); }}>
          <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
            <SelectItem value="worker">Worker</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Filter by action..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
        {total > 0 && <span className="text-xs text-muted-foreground">{total} entries</span>}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm animate-pulse">Loading...</div>
      ) : entries.length === 0 ? (
        <EmptyState label="audit log entries" />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Actor</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Action</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Order / Customer</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden lg:table-cell">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div title={fmtDate(e.createdAt)} className="cursor-default">
                      {fmtAge(e.createdAt)}
                    </div>
                    <div className="text-muted-foreground text-[10px]">{fmtDate(e.createdAt)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <ActorBadge type={e.actorType} name={e.actorName} />
                  </td>
                  <td className="px-3 py-2">
                    <ActionBadge action={e.action} />
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    {e.orderRef && (
                      <div className="font-mono text-[10px] text-muted-foreground">{e.orderRef}</div>
                    )}
                    {e.customerName && (
                      <div className="truncate max-w-[120px]">{e.customerName}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 hidden lg:table-cell max-w-[200px]">
                    {e.metadata && Object.keys(e.metadata).length > 0 && (
                      <code className="text-[10px] text-muted-foreground truncate block">
                        {JSON.stringify(e.metadata).slice(0, 80)}
                      </code>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
}

function PaymentsTab() {
  const [period, setPeriod] = useState("7d");
  const [method, setMethod] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ops-payments", period, method, search, page],
    queryFn: () => api.operations.payments({
      period,
      method: method === "all" ? undefined : method,
      recordedBy: search || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    staleTime: 30_000,
  });

  const payments = (data as OpsPaymentsResponse | undefined)?.payments ?? [];
  const total = (data as OpsPaymentsResponse | undefined)?.total ?? 0;
  const totalAmount = (data as OpsPaymentsResponse | undefined)?.totalAmount ?? "0";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <PeriodSelect value={period} onChange={(v) => { setPeriod(v); setPage(0); }} />
        <Select value={method} onValueChange={(v) => { setMethod(v); setPage(0); }}>
          <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="transfer">Transfer</SelectItem>
            <SelectItem value="pos">POS</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Filter by recorded by..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            {total} payments · {fmt(totalAmount)} total
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm animate-pulse">Loading...</div>
      ) : payments.length === 0 ? (
        <EmptyState label="payments" />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Method</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Order</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Customer</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">Recorded By</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground hidden lg:table-cell">Balance After</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div title={fmtDate(p.recordedAt)} className="cursor-default">{fmtAge(p.recordedAt)}</div>
                    <div className="text-muted-foreground text-[10px]">{fmtDate(p.recordedAt)}</div>
                  </td>
                  <td className="px-3 py-2 font-semibold text-green-700 dark:text-green-400 whitespace-nowrap">
                    {fmt(p.amount)}
                  </td>
                  <td className="px-3 py-2"><MethodBadge method={p.method} /></td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <div className="font-mono text-[10px] text-muted-foreground">{p.orderRef ?? `#${p.orderId}`}</div>
                    {p.receiptNumber && (
                      <div className="text-[10px] text-muted-foreground">{p.receiptNumber}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <div className="truncate max-w-[120px]">{p.customerName}</div>
                    <div className="text-[10px] text-muted-foreground">{p.phone}</div>
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell">
                    <div className="truncate max-w-[100px]">{p.recordedBy ?? p.workerName ?? "—"}</div>
                    {p.branchName && (
                      <div className="text-[10px] text-muted-foreground">{p.branchName}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right hidden lg:table-cell">
                    <span className={cn(
                      "font-mono",
                      Number(p.remainingBalance) === 0 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
                    )}>
                      {fmt(p.remainingBalance)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
}

function PickupsTab() {
  const [period, setPeriod] = useState("7d");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ops-pickups", period, search, page],
    queryFn: () => api.operations.pickups({
      period,
      recordedBy: search || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    staleTime: 30_000,
  });

  const pickups = (data as OpsPickupsResponse | undefined)?.pickups ?? [];
  const total = (data as OpsPickupsResponse | undefined)?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <PeriodSelect value={period} onChange={(v) => { setPeriod(v); setPage(0); }} />
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Filter by worker..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
        {total > 0 && <span className="text-xs text-muted-foreground">{total} pickups</span>}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm animate-pulse">Loading...</div>
      ) : pickups.length === 0 ? (
        <EmptyState label="pickups" />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Order</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Customer</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Items</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">Recorded By</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden lg:table-cell">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pickups.map((p) => {
                const totalItems = p.shirtsPickedUp + p.trousersPickedUp;
                return (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div title={fmtDate(p.createdAt)} className="cursor-default">{fmtAge(p.createdAt)}</div>
                      <div className="text-muted-foreground text-[10px]">{fmtDate(p.createdAt)}</div>
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell font-mono text-[10px] text-muted-foreground">
                      {p.orderRef ?? `#${p.orderId}`}
                    </td>
                    <td className="px-3 py-2">
                      <div className="truncate max-w-[120px]">{p.customerName}</div>
                      <div className="text-[10px] text-muted-foreground">{p.phone}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.shirtsPickedUp > 0 && (
                          <span className="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded text-[10px] font-medium">
                            {p.shirtsPickedUp} shirt{p.shirtsPickedUp !== 1 ? "s" : ""}
                          </span>
                        )}
                        {p.trousersPickedUp > 0 && (
                          <span className="bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 px-1.5 py-0.5 rounded text-[10px] font-medium">
                            {p.trousersPickedUp} trouser{p.trousersPickedUp !== 1 ? "s" : ""}
                          </span>
                        )}
                        {p.itemPickups && p.itemPickups.length > 0 && totalItems === 0 && (
                          <span className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 px-1.5 py-0.5 rounded text-[10px]">
                            {p.itemPickups.length} item{p.itemPickups.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      <div className="truncate max-w-[100px]">{p.recordedBy ?? p.workerName ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell text-muted-foreground truncate max-w-[160px]">
                      {p.notes ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
}

function WorkerActivityTab() {
  const [period, setPeriod] = useState("7d");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ops-worker-activity", period, search, page],
    queryFn: () => api.operations.workerActivity({
      period,
      actorName: search || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    staleTime: 30_000,
  });

  const entries = (data as OpsWorkerActivityResponse | undefined)?.entries ?? [];
  const total = (data as OpsWorkerActivityResponse | undefined)?.total ?? 0;
  const summary = (data as OpsWorkerActivityResponse | undefined)?.summary ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <PeriodSelect value={period} onChange={(v) => { setPeriod(v); setPage(0); }} />
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Filter by worker name..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
      </div>

      {!isLoading && summary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {summary.map((s) => (
            <div key={s.actorId ?? s.actorName} className="border rounded-lg p-3">
              <div className="text-sm font-medium truncate">{s.actorName}</div>
              <div className="text-xl font-bold mt-1">{s.count}</div>
              <div className="text-[10px] text-muted-foreground">actions</div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm animate-pulse">Loading...</div>
      ) : entries.length === 0 ? (
        <EmptyState label="worker actions" />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Worker</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Action</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Order / Customer</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden lg:table-cell">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div title={fmtDate(e.createdAt)} className="cursor-default">{fmtAge(e.createdAt)}</div>
                    <div className="text-muted-foreground text-[10px]">{fmtDate(e.createdAt)}</div>
                  </td>
                  <td className="px-3 py-2 font-medium truncate max-w-[100px]">{e.actorName}</td>
                  <td className="px-3 py-2"><ActionBadge action={e.action} /></td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    {e.orderRef && <div className="font-mono text-[10px] text-muted-foreground">{e.orderRef}</div>}
                    {e.customerName && <div className="truncate max-w-[120px]">{e.customerName}</div>}
                  </td>
                  <td className="px-3 py-2 hidden lg:table-cell max-w-[200px]">
                    {e.metadata && Object.keys(e.metadata).length > 0 && (
                      <code className="text-[10px] text-muted-foreground truncate block">
                        {JSON.stringify(e.metadata).slice(0, 80)}
                      </code>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-yellow-400",
    processing: "bg-blue-400",
    ready: "bg-green-400",
    partial_pickup: "bg-orange-400",
    completed: "bg-slate-400",
    cancelled: "bg-red-400",
  };
  return <span className={cn("inline-block w-2 h-2 rounded-full mr-1.5", map[status] ?? "bg-slate-300")} />;
}

function HealthTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ops-health"],
    queryFn: () => api.operations.health(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const health = data as OpsHealthResponse | undefined;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {health?.generatedAt ? `Generated ${fmtAge(health.generatedAt)}` : "Loading..."}
        </p>
        <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm animate-pulse">Loading...</div>
      ) : !health ? null : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                Orders by Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {health.orders.byStatus.map((row) => (
                  <div key={row.status} className="flex items-center justify-between">
                    <span className="text-sm flex items-center">
                      <StatusDot status={row.status} />
                      <span className="capitalize">{row.status.replace(/_/g, " ")}</span>
                    </span>
                    <span className="text-sm font-bold">{row.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                Payments (7 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold mb-3">{health.payments.last24h} <span className="text-sm font-normal text-muted-foreground">today</span></div>
              <div className="space-y-1.5">
                {health.payments.byMethod.map((row) => (
                  <div key={row.method} className="flex items-center justify-between">
                    <MethodBadge method={row.method} />
                    <div className="text-right">
                      <span className="text-xs font-medium">{row.count} · </span>
                      <span className="text-xs text-muted-foreground">{fmt(row.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                Pickups Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{health.pickups.last24h}</div>
              <div className="text-xs text-muted-foreground mt-1">pickups recorded in last 24h</div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2 lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                Top Actions (7 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {health.topActions.map((a) => (
                  <div key={a.action} className="flex items-center gap-1.5 border rounded-full px-3 py-1">
                    <ActionBadge action={a.action} />
                    <span className="text-xs font-bold">{a.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function OperationsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          Operations Center
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Read-only audit trail — payments, pickups, worker actions, and system health.
        </p>
      </div>

      <Tabs defaultValue="audit-log">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="audit-log" className="text-xs gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Audit Log
          </TabsTrigger>
          <TabsTrigger value="payments" className="text-xs gap-1.5">
            <CreditCard className="h-3.5 w-3.5" /> Payments
          </TabsTrigger>
          <TabsTrigger value="pickups" className="text-xs gap-1.5">
            <Package className="h-3.5 w-3.5" /> Pickups
          </TabsTrigger>
          <TabsTrigger value="worker-activity" className="text-xs gap-1.5">
            <Users className="h-3.5 w-3.5" /> Worker Activity
          </TabsTrigger>
          <TabsTrigger value="health" className="text-xs gap-1.5">
            <Heart className="h-3.5 w-3.5" /> System Health
          </TabsTrigger>
        </TabsList>

        <TabsContent value="audit-log" className="mt-4"><AuditLogTab /></TabsContent>
        <TabsContent value="payments" className="mt-4"><PaymentsTab /></TabsContent>
        <TabsContent value="pickups" className="mt-4"><PickupsTab /></TabsContent>
        <TabsContent value="worker-activity" className="mt-4"><WorkerActivityTab /></TabsContent>
        <TabsContent value="health" className="mt-4"><HealthTab /></TabsContent>
      </Tabs>
    </div>
  );
}
