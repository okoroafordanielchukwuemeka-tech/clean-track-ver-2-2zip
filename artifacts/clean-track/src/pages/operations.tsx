import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/use-page-title";
import { APP_VERSION as CURRENT_APP_VERSION } from "@/lib/version";
import type {
  OpsAuditLogResponse,
  OpsPaymentsResponse,
  OpsPickupsResponse,
  OpsWorkerActivityResponse,
  OpsHealthResponse,
  OpsSyncHealthResponse,
  OpsSyncHealthDevice,
  OpsFailedMessagesResponse,
  FailedMessageEntry,
  RecoverySummary,
  DeletedWorker,
  DeletedCustomer,
  DeletedBranch,
  DeletedPayment,
  DRReadiness,
  DRCheck,
  BackupTriggerResult,
  BackupVerifyResult,
  SchemaSnapshot,
  AlertRecord,
  AlertCounts,
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
  Wifi,
  WifiOff,
  Monitor,
  RotateCcw,
  Trash2,
  UserX,
  Building2,
  ReceiptText,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Database,
  HardDrive,
  Lock,
  BookOpen,
  History,
  Shield,
  Play,
  Terminal,
  FileText,
  Download,
  CheckSquare,
  AlertTriangle,
  Zap,
  Bell,
  MessageSquareX,
  Send,
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
        <div className="space-y-2 py-4 px-2 animate-pulse">{[...Array(4)].map((_,i)=><div key={i} className="h-8 bg-muted rounded" />)}</div>
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
        <div className="space-y-2 py-4 px-2 animate-pulse">{[...Array(4)].map((_,i)=><div key={i} className="h-8 bg-muted rounded" />)}</div>
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
        <div className="space-y-2 py-4 px-2 animate-pulse">{[...Array(4)].map((_,i)=><div key={i} className="h-8 bg-muted rounded" />)}</div>
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
        <div className="space-y-2 py-4 px-2 animate-pulse">{[...Array(4)].map((_,i)=><div key={i} className="h-8 bg-muted rounded" />)}</div>
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
        <div className="space-y-2 py-4 px-2 animate-pulse">{[...Array(4)].map((_,i)=><div key={i} className="h-8 bg-muted rounded" />)}</div>
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

function SummaryCard({
  label, value, color, note,
}: { label: string; value: number; color: string; note: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-bold mt-1", color)}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{note}</div>
    </div>
  );
}

function DeviceStatusBadge({ staleness, isOnline }: { staleness: string; isOnline: boolean }) {
  if (!isOnline) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <WifiOff className="h-3 w-3" /> Offline
      </span>
    );
  }
  if (staleness === "fresh") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <Wifi className="h-3 w-3" /> Live
      </span>
    );
  }
  if (staleness === "stale") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <Clock className="h-3 w-3" /> Stale
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <AlertCircle className="h-3 w-3" /> Gone
    </span>
  );
}

function MetricBadge({ value, warn, danger }: { value: number; warn?: boolean; danger?: boolean }) {
  if (value === 0) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className={cn(
      "inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded font-bold text-[10px]",
      danger
        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        : warn
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    )}>
      {value}
    </span>
  );
}

function SyncHealthTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ops-sync-health"],
    queryFn: () => api.operations.syncHealth(),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const health = data as OpsSyncHealthResponse | undefined;
  const devices = health?.devices ?? [];
  const summary = health?.summary;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {health?.generatedAt ? `Updated ${fmtAge(health.generatedAt)}` : "Loading..."}
          {" · "}Auto-refreshes every 30s
        </p>
        <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard label="Online Now" value={summary.active} color="text-green-600 dark:text-green-400" note="active in last 5 min" />
          <SummaryCard label="Away" value={summary.stale} color="text-amber-600 dark:text-amber-400" note="5–60 min ago" />
          <SummaryCard label="Not Seen" value={summary.veryStale} color="text-red-600 dark:text-red-400" note="over 1 hour ago" />
          <SummaryCard label="Need Review" value={summary.withConflicts} color="text-rose-600 dark:text-rose-400" note="data conflicts found" />
        </div>
      )}

      {summary && (summary.withPending > 0 || summary.withFailed > 0 || summary.offline > 0) && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard label="Changes Waiting" value={summary.withPending} color="text-blue-600 dark:text-blue-400" note="devices with unsent changes" />
          <SummaryCard label="Sync Errors" value={summary.withFailed} color="text-red-600 dark:text-red-400" note="devices with failed items" />
          <SummaryCard label="Offline" value={summary.offline} color="text-slate-500 dark:text-slate-400" note="reported offline" />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2 py-4 px-2 animate-pulse">{[...Array(4)].map((_,i)=><div key={i} className="h-8 bg-muted rounded" />)}</div>
      ) : devices.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <Monitor className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No active devices yet</p>
          <p className="text-xs mt-1 opacity-70 max-w-sm mx-auto">
            Devices appear here automatically once any worker or owner opens the app.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Device</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Branch</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Last Seen</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Pending</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Failed</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Conflicts</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden lg:table-cell">Last Sync</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden xl:table-cell">Version</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {devices.map((d: OpsSyncHealthDevice) => {
                const hasIssue = d.failedCount > 0 || d.conflictCount > 0;
                const isStuckPending = d.pendingCount > 0 && d.staleness !== "fresh";
                const rowClass = cn(
                  "transition-colors",
                  hasIssue
                    ? "bg-red-50/50 dark:bg-red-950/20"
                    : isStuckPending
                    ? "bg-amber-50/50 dark:bg-amber-950/20"
                    : d.staleness === "very_stale"
                    ? "opacity-55"
                    : "hover:bg-muted/30",
                );
                return (
                  <tr key={d.id} className={rowClass}>
                    <td className="px-3 py-2">
                      <div className="font-medium truncate max-w-[120px]">
                        {d.workerName ?? (d.actorType === "owner" ? "Owner" : "Unknown")}
                      </div>
                      <div className={cn("text-[10px]", d.actorType === "owner" ? "text-blue-500" : "text-amber-500")}>
                        {d.actorType}
                      </div>
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">
                      {d.branchName ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <DeviceStatusBadge staleness={d.staleness} isOnline={d.isOnline} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="cursor-default" title={d.lastSeenAt}>{fmtAge(d.lastSeenAt)}</div>
                      <div className="text-muted-foreground text-[10px]">{d.minutesSinceLastSeen}m ago</div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <MetricBadge value={d.pendingCount} warn={isStuckPending} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <MetricBadge value={d.failedCount} danger={d.failedCount > 0} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <MetricBadge value={d.conflictCount} danger={d.conflictCount > 0} />
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell text-muted-foreground whitespace-nowrap">
                      {d.lastSyncedAt ? fmtAge(d.lastSyncedAt) : "—"}
                    </td>
                    <td className="px-3 py-2 hidden xl:table-cell font-mono text-[10px] text-muted-foreground">
                      <div className="flex flex-col gap-0.5">
                        <span>{d.appVersion ?? "—"}</span>
                        {d.appVersion && d.appVersion !== CURRENT_APP_VERSION && (
                          <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-[9px] font-semibold px-1.5 py-0.5 rounded w-fit">
                            outdated
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {devices.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          <span className="font-semibold text-amber-600">Away</span> = no activity for 5–60 min ·{" "}
          <span className="font-semibold text-red-600">Not Seen</span> = no activity for over 1 hour ·{" "}
          <span className="font-semibold text-amber-600">Changes Waiting + Away</span> = device has unsent changes but is not syncing
        </p>
      )}
    </div>
  );
}

function RecoverySection<T extends { id: number }>({
  title,
  icon,
  items,
  isLoading,
  renderRow,
  onRestore,
  restoring,
}: {
  title: string;
  icon: React.ReactNode;
  items: T[] | undefined;
  isLoading: boolean;
  renderRow: (item: T) => React.ReactNode;
  onRestore: (id: number) => void;
  restoring: number | null;
}) {
  if (isLoading) return <p className="text-xs text-muted-foreground py-4">Loading…</p>;
  if (!items || items.length === 0)
    return <p className="text-xs text-muted-foreground py-3 italic">No deleted {title.toLowerCase()} found.</p>;
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs bg-muted/30">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground">{icon}</span>
            <div className="min-w-0">{renderRow(item)}</div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0 gap-1"
            disabled={restoring === item.id}
            onClick={() => onRestore(item.id)}
          >
            <RotateCcw className="h-3 w-3" />
            {restoring === item.id ? "Restoring…" : "Restore"}
          </Button>
        </div>
      ))}
    </div>
  );
}

function scoreColor(score: number) {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

function scoreBg(score: number) {
  if (score >= 80) return "bg-green-50 border-green-200";
  if (score >= 60) return "bg-yellow-50 border-yellow-200";
  return "bg-red-50 border-red-200";
}

function CheckStatusIcon({ status }: { status: DRCheck["status"] }) {
  if (status === "pass") return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "warn") return <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
}

function BackupHistoryPanel() {
  const { data: backups, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["recovery", "backups"],
    queryFn: api.recovery.backups,
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-blue-500" />
          Backup Files
          {backups && <span className="text-muted-foreground font-normal">({backups.length})</span>}
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching} className="h-7 w-7 p-0">
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-2">Loading backup files…</p>
        ) : !backups?.length ? (
          <div className="text-center py-6 space-y-1">
            <AlertTriangle className="h-8 w-8 text-yellow-400 mx-auto" />
            <p className="text-sm font-medium">No backups found</p>
            <p className="text-xs text-muted-foreground">Use "Backup Now" in the DR Readiness panel above</p>
          </div>
        ) : (
          <div className="space-y-2">
            {backups.slice(0, 8).map((b, i) => (
              <div
                key={b.file}
                className={cn(
                  "flex items-center justify-between rounded-md border px-3 py-2",
                  i === 0 ? "bg-green-50/60 border-green-200" : "bg-muted/30"
                )}
              >
                <div className="min-w-0 text-xs">
                  <p className="font-mono font-medium truncate">{b.file}</p>
                  <p className="text-muted-foreground">
                    {fmtAge(b.createdAt)} ago · {b.sizeBytes != null ? (b.sizeBytes / 1024).toFixed(1) : "?"} KB
                    {b.sha256 && <> · <span className="font-mono">SHA: {b.sha256.substring(0, 14)}…</span></>}
                  </p>
                </div>
                {i === 0 && (
                  <Badge variant="outline" className="ml-2 shrink-0 text-[10px] text-green-700 border-green-300">Latest</Badge>
                )}
              </div>
            ))}
            {backups.length > 8 && (
              <p className="text-xs text-muted-foreground text-center">+{backups.length - 8} older backups on disk</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MigrationLogPanel() {
  const qc = useQueryClient();
  const { data: snapshots, isLoading } = useQuery({
    queryKey: ["recovery", "migrations"],
    queryFn: api.recovery.migrations,
    staleTime: 60_000,
  });

  const record = useMutation({
    mutationFn: () => api.recovery.recordSnapshot("Manual checkpoint"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recovery", "migrations"] }),
  });

  const typeColor = (t: string) => {
    if (t === "manual") return "text-blue-700 bg-blue-50 border-blue-200";
    if (t === "pre_migration") return "text-orange-700 bg-orange-50 border-orange-200";
    if (t === "post_migration") return "text-green-700 bg-green-50 border-green-200";
    return "text-muted-foreground bg-muted/30 border-border";
  };

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4 text-indigo-500" />
          System Checkpoints
          {snapshots && <span className="text-muted-foreground font-normal">({snapshots.length} saved)</span>}
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => record.mutate()}
          disabled={record.isPending}
          className="h-7 text-xs gap-1"
        >
          <Shield className="h-3 w-3" />
          {record.isPending ? "Recording…" : "Record Checkpoint"}
        </Button>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-2">Loading…</p>
        ) : !snapshots?.length ? (
          <div className="text-center py-6 space-y-1">
            <History className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-medium">No checkpoints recorded</p>
            <p className="text-xs text-muted-foreground">
              Save a checkpoint before making major changes so you can restore if needed.
            </p>
            {record.isSuccess && (
              <p className="text-xs text-green-600 font-medium">✓ Checkpoint recorded!</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {record.isSuccess && (
              <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700 font-medium flex items-center gap-1.5">
                <CheckSquare className="h-3.5 w-3.5" /> New checkpoint recorded
              </div>
            )}
            {snapshots.map((s, i) => (
              <div
                key={s.id}
                className={cn("rounded-md border px-3 py-2 text-xs", i === 0 ? "bg-indigo-50/50 border-indigo-200" : "bg-muted/20")}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium border", typeColor(s.snapshotType))}>
                      {s.snapshotType === "pre_migration" ? "Before Update" : s.snapshotType === "post_migration" ? "After Update" : s.snapshotType === "manual" ? "Manual" : s.snapshotType.replace(/_/g, " ")}
                    </span>
                    <span className="text-muted-foreground truncate">{fmtAge(s.createdAt)} ago</span>
                    {s.triggeredBy && (
                      <span className="text-muted-foreground hidden sm:inline truncate">by {s.triggeredBy}</span>
                    )}
                  </div>
                  <div className="text-right text-muted-foreground shrink-0">
                    {s.tableCount != null && <span>{s.tableCount} tables</span>}
                  </div>
                </div>
                {s.notes && <p className="text-muted-foreground mt-0.5 italic">{s.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const RUNBOOK_SECTIONS = [
  {
    id: "triage",
    icon: <Zap className="h-4 w-4 text-red-500" />,
    title: "Emergency Triage (first 5 minutes)",
    steps: [
      "Is the API server running? — Check workflow logs for crash errors",
      "Is the database reachable? — Open Operations → System Health → check DB connectivity",
      "Are financial records intact? — Check for any orders in 'paid' status with ₦0 amountPaid",
      "Is it data corruption or server crash? — Determine whether to restore vs restart",
      "Notify branch managers to hold transactions if data integrity is uncertain",
    ],
  },
  {
    id: "soft-delete",
    icon: <RotateCcw className="h-4 w-4 text-blue-500" />,
    title: "Soft-Delete Recovery",
    steps: [
      "Go to Operations → Recovery → Recovery Bin",
      "All deleted workers, customers, branches, and voided payments are listed here",
      "Click 'Restore' next to any item — it is re-activated immediately with order balances recalculated",
      "Audit log records every restoration (who triggered it and when)",
      "No data is permanently deleted without a hard-delete migration",
    ],
  },
  {
    id: "backup-restore",
    icon: <HardDrive className="h-4 w-4 text-green-500" />,
    title: "Full Database Restore from Backup",
    steps: [
      "Find the latest backup file in the Backup Files panel — the most recent one is highlighted",
      "Contact your technical support to run the restore script with that backup file",
      "After restore completes, the system will automatically reapply any pending updates",
      "Verify data is intact by checking order counts in the main dashboard",
      "Your maximum data loss is the time since your last backup — check 'Last backup' in the Backup Readiness panel",
    ],
  },
  {
    id: "bad-migration",
    icon: <AlertTriangle className="h-4 w-4 text-orange-500" />,
    title: "Bad Migration Recovery",
    steps: [
      "Always save a checkpoint in System Checkpoints (above) before any system updates",
      "If an update caused data loss: immediately restore from the backup taken before the update",
      "If the update only added or renamed fields: check System Checkpoints for the previous structure",
      "Always take a backup before any major system change — use 'Backup Now' in the panel above",
      "To undo: contact your technical support and provide the checkpoint timestamp",
      "For urgent situations, contact support immediately with your last known good backup date",
    ],
  },
  {
    id: "server-outage",
    icon: <Terminal className="h-4 w-4 text-slate-500" />,
    title: "Server Outage / Crash Loop",
    steps: [
      "Check if the system shows 'System Online' on the Business Health page",
      "Verify all required configuration settings are in place (contact your technical support if unsure)",
      "If recently updated, try reverting to the previous version via Replit checkpoint rollback",
      "Workers can continue operating in offline mode during an outage — no data will be lost",
      "All changes made offline will sync automatically once the system comes back online",
      "Check Worker Devices tab after recovery to confirm all pending changes have synced",
    ],
  },
  {
    id: "offline-recovery",
    icon: <Wifi className="h-4 w-4 text-indigo-500" />,
    title: "Offline Worker Queue Recovery",
    steps: [
      "Worker stations operate in offline mode when server is unreachable",
      "All actions (status updates, payments, pickups) are saved locally on the device when offline",
      "On reconnect, everything syncs automatically in the correct order — no manual steps needed",
      "Check Operations → Worker Devices for devices with unsent changes or conflicts",
      "Conflicts show a red badge on affected orders — review and resolve manually if needed",
      "Use 'Retry All Failed' in the Sync Failed panel to re-attempt permanently failed items",
    ],
  },
];

function RunbookTab() {
  const [expanded, setExpanded] = useState<string | null>("triage");

  return (
    <div className="space-y-4">
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="px-4 py-3 flex items-start gap-3">
          <BookOpen className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800">
            <strong>Recovery Runbook</strong> — step-by-step procedures for common disaster scenarios.
            Keep this tab open during an incident. All restore operations require Owner credentials.
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {RUNBOOK_SECTIONS.map((section) => {
          const isOpen = expanded === section.id;
          return (
            <Card key={section.id} className={cn("overflow-hidden transition-all", isOpen && "ring-1 ring-primary/20")}>
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left"
                onClick={() => setExpanded(isOpen ? null : section.id)}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {section.icon}
                  {section.title}
                </span>
                <span className={cn("text-muted-foreground transition-transform text-lg leading-none", isOpen && "rotate-180")}>
                  ⌄
                </span>
              </button>
              {isOpen && (
                <CardContent className="px-4 pb-4 pt-0">
                  <ol className="space-y-2">
                    {section.steps.map((step, i) => (
                      <li key={i} className="flex gap-2.5 text-xs">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-[10px] flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-foreground leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="border-slate-200">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" /> Key Recovery Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "RPO (target)", value: "≤ 24h", sub: "Recovery Point Objective", color: "text-blue-600" },
              { label: "RTO (target)", value: "≤ 2h", sub: "Recovery Time Objective", color: "text-green-600" },
              { label: "Backup method", value: "Encrypted", sub: "Full backup with integrity check", color: "text-slate-600" },
              { label: "Offline mode", value: "Unlimited", sub: "Workers queue changes offline, auto-syncs on reconnect", color: "text-indigo-600" },
            ].map((m) => (
              <div key={m.label} className="rounded-md border bg-muted/20 px-3 py-2">
                <p className={cn("text-lg font-bold", m.color)}>{m.value}</p>
                <p className="text-[10px] font-medium">{m.label}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{m.sub}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DRReadinessPanel() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["recovery", "readiness"],
    queryFn: api.recovery.readiness,
    staleTime: 60_000,
  });

  const [backupResult, setBackupResult] = useState<BackupTriggerResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<BackupVerifyResult | null>(null);

  const triggerBackup = useMutation({
    mutationFn: api.recovery.triggerBackup,
    onSuccess: (result) => {
      setBackupResult(result);
      qc.invalidateQueries({ queryKey: ["recovery", "readiness"] });
      qc.invalidateQueries({ queryKey: ["recovery", "backups"] });
    },
    onError: () => setBackupResult({ success: false, output: "", manifest: null, error: "Backup failed" }),
  });

  const verifyLatest = useMutation({
    mutationFn: api.recovery.verifyLatest,
    onSuccess: (result) => setVerifyResult(result),
    onError: () => setVerifyResult({ success: false, output: "", passed: 0, failed: 1, error: "Verification failed" }),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Calculating readiness score…
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const criticalFails = data.checks.filter(c => c.critical && c.status === "fail");
  const warns = data.checks.filter(c => c.status === "warn");

  return (
    <div className="space-y-4">
      <Card className={cn("border-2", scoreBg(data.score))}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className={cn("text-5xl font-black tabular-nums", scoreColor(data.score))}>{data.score}</p>
                <p className={cn("text-2xl font-bold", scoreColor(data.score))}>{data.grade}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Backup Score</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-sm">Backup Readiness</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="flex items-center gap-1 text-green-700">
                    <CheckCircle className="h-3 w-3" />
                    {data.checks.filter(c => c.status === "pass").length} passing
                  </span>
                  {warns.length > 0 && (
                    <span className="flex items-center gap-1 text-yellow-700">
                      <AlertCircle className="h-3 w-3" />
                      {warns.length} warnings
                    </span>
                  )}
                  {criticalFails.length > 0 && (
                    <span className="flex items-center gap-1 text-red-700 font-medium">
                      <XCircle className="h-3 w-3" />
                      {criticalFails.length} critical failures
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
                  <span className="flex items-center gap-1"><Database className="h-3 w-3" /> {data.dbStats.sizePretty} data stored</span>
                  <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" />
                    {data.lastBackup
                      ? `Last backup ${fmtAge(data.lastBackup.createdAt)} · ${(data.lastBackup.sizeBytes / 1024).toFixed(1)} KB`
                      : "No backup on record"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1 h-8 text-xs">
                <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => { setBackupResult(null); triggerBackup.mutate(); }}
                disabled={triggerBackup.isPending}
                className="gap-1 h-8 text-xs"
              >
                <HardDrive className="h-3 w-3" />
                {triggerBackup.isPending ? "Running…" : "Backup Now"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setVerifyResult(null); verifyLatest.mutate(); }}
                disabled={verifyLatest.isPending}
                className="gap-1 h-8 text-xs"
              >
                <CheckSquare className="h-3 w-3" />
                {verifyLatest.isPending ? "Verifying…" : "Verify"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {backupResult && (
        <Card className={cn("border", backupResult.success ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50")}>
          <CardContent className="px-4 py-3">
            <p className={cn("text-xs font-semibold flex items-center gap-1.5", backupResult.success ? "text-green-800" : "text-red-800")}>
              {backupResult.success ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {backupResult.success
                ? `Backup complete · ${backupResult.manifest ? (backupResult.manifest.sizeBytes / 1024).toFixed(1) + " KB" : ""}`
                : (backupResult.error ?? "Backup failed")}
            </p>
            {backupResult.output && (
              <pre className="mt-2 text-[10px] text-muted-foreground whitespace-pre-wrap max-h-32 overflow-auto bg-white/60 rounded p-2">
                {backupResult.output}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {verifyResult && (
        <Card className={cn("border", verifyResult.success ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50")}>
          <CardContent className="px-4 py-3">
            <p className={cn("text-xs font-semibold flex items-center gap-1.5", verifyResult.success ? "text-green-800" : "text-red-800")}>
              {verifyResult.success ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {verifyResult.success
                ? `Verification passed · ${verifyResult.passed} check(s) passed`
                : `Verification failed · ${verifyResult.failed} check(s) failed — ${verifyResult.error ?? ""}`}
            </p>
            {verifyResult.file && <p className="text-[10px] text-muted-foreground mt-1">File: {verifyResult.file}</p>}
            {verifyResult.output && (
              <pre className="mt-2 text-[10px] text-muted-foreground whitespace-pre-wrap max-h-28 overflow-auto bg-white/60 rounded p-2">
                {verifyResult.output}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {data.checks.map((check) => (
          <div
            key={check.id}
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
              check.status === "pass" && "bg-green-50/50 border-green-100",
              check.status === "warn" && "bg-yellow-50/50 border-yellow-100",
              check.status === "fail" && (check.critical ? "bg-red-50/70 border-red-200" : "bg-orange-50/50 border-orange-100"),
            )}
          >
            <CheckStatusIcon status={check.status} />
            <div className="min-w-0">
              <p className="font-medium leading-tight flex items-center gap-1">
                {check.label}
                {check.critical && <Lock className="h-2.5 w-2.5 text-muted-foreground" />}
              </p>
              <p className="text-muted-foreground leading-tight mt-0.5">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {criticalFails.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="px-4 py-3">
            <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
              <ShieldX className="h-4 w-4" /> {criticalFails.length} Critical Issue{criticalFails.length > 1 ? "s" : ""} Require Immediate Action
            </p>
            <ul className="mt-1 space-y-0.5">
              {criticalFails.map(c => (
                <li key={c.id} className="text-xs text-red-700">• {c.label}: {c.detail}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground text-right">
        Report generated {fmtAge(data.generatedAt)} · <Lock className="h-2.5 w-2.5 inline" /> = critical check
      </p>
    </div>
  );
}

function RecoveryTab() {
  const qc = useQueryClient();
  const [restoringWorker, setRestoringWorker] = useState<number | null>(null);
  const [restoringCustomer, setRestoringCustomer] = useState<number | null>(null);
  const [restoringBranch, setRestoringBranch] = useState<number | null>(null);
  const [restoringPayment, setRestoringPayment] = useState<number | null>(null);

  const { data: summary } = useQuery({ queryKey: ["recovery", "summary"], queryFn: api.recovery.summary });
  const { data: dWorkers, isLoading: wLoad } = useQuery({ queryKey: ["recovery", "workers"], queryFn: api.recovery.workers });
  const { data: dCustomers, isLoading: cLoad } = useQuery({ queryKey: ["recovery", "customers"], queryFn: api.recovery.customers });
  const { data: dBranches, isLoading: bLoad } = useQuery({ queryKey: ["recovery", "branches"], queryFn: api.recovery.branches });
  const { data: dPayments, isLoading: pLoad } = useQuery({ queryKey: ["recovery", "payments"], queryFn: api.recovery.payments });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["recovery"] });
    qc.invalidateQueries({ queryKey: ["workers"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["branches"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const restoreWorker = useMutation({
    mutationFn: (id: number) => { setRestoringWorker(id); return api.recovery.restoreWorker(id); },
    onSettled: () => { setRestoringWorker(null); invalidateAll(); },
  });
  const restoreCustomer = useMutation({
    mutationFn: (id: number) => { setRestoringCustomer(id); return api.recovery.restoreCustomer(id); },
    onSettled: () => { setRestoringCustomer(null); invalidateAll(); },
  });
  const restoreBranch = useMutation({
    mutationFn: (id: number) => { setRestoringBranch(id); return api.recovery.restoreBranch(id); },
    onSettled: () => { setRestoringBranch(null); invalidateAll(); },
  });
  const restorePayment = useMutation({
    mutationFn: (id: number) => { setRestoringPayment(id); return api.recovery.restorePayment(id); },
    onSettled: () => { setRestoringPayment(null); invalidateAll(); },
  });

  const total = summary?.total ?? 0;

  return (
    <div className="space-y-6">
      <DRReadinessPanel />
      <BackupHistoryPanel />
      <MigrationLogPanel />

      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-muted-foreground" /> Recovery Bin
        </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Deleted Workers", icon: <UserX className="h-4 w-4 text-red-500" />, count: summary?.workers ?? 0 },
          { label: "Deleted Customers", icon: <Users className="h-4 w-4 text-orange-500" />, count: summary?.customers ?? 0 },
          { label: "Deleted Branches", icon: <Building2 className="h-4 w-4 text-amber-500" />, count: summary?.branches ?? 0 },
          { label: "Voided Payments", icon: <ReceiptText className="h-4 w-4 text-purple-500" />, count: summary?.payments ?? 0 },
        ].map((s) => (
          <Card key={s.label} className="py-3">
            <CardContent className="px-4 py-0">
              <div className="flex items-center gap-2">
                {s.icon}
                <div>
                  <p className="text-xl font-bold">{s.count}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{s.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {total === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" />
            <p className="font-semibold">Nothing in the recovery bin</p>
            <p className="text-sm text-muted-foreground mt-1">All workers, customers, branches, and payments are active.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {(summary?.workers ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <UserX className="h-4 w-4 text-red-500" /> Deleted Workers
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <RecoverySection<DeletedWorker>
                  title="Workers"
                  icon={<UserX className="h-3.5 w-3.5" />}
                  items={dWorkers}
                  isLoading={wLoad}
                  restoring={restoringWorker}
                  onRestore={(id) => restoreWorker.mutate(id)}
                  renderRow={(w) => (
                    <div>
                      <p className="font-medium">{w.name} <span className="text-muted-foreground font-normal">({w.role})</span></p>
                      <p className="text-muted-foreground">{w.phone} · Deleted {fmtAge(w.deletedAt)} by {w.deletedByName ?? "unknown"}</p>
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          )}

          {(summary?.customers ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-orange-500" /> Deleted Customers
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <RecoverySection<DeletedCustomer>
                  title="Customers"
                  icon={<Users className="h-3.5 w-3.5" />}
                  items={dCustomers}
                  isLoading={cLoad}
                  restoring={restoringCustomer}
                  onRestore={(id) => restoreCustomer.mutate(id)}
                  renderRow={(c) => (
                    <div>
                      <p className="font-medium">{c.fullName}</p>
                      <p className="text-muted-foreground">{c.phone} · Deleted {fmtAge(c.deletedAt)} by {c.deletedByName ?? "unknown"}</p>
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          )}

          {(summary?.branches ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-amber-500" /> Deleted Branches
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <RecoverySection<DeletedBranch>
                  title="Branches"
                  icon={<Building2 className="h-3.5 w-3.5" />}
                  items={dBranches}
                  isLoading={bLoad}
                  restoring={restoringBranch}
                  onRestore={(id) => restoreBranch.mutate(id)}
                  renderRow={(b) => (
                    <div>
                      <p className="font-medium">{b.name}</p>
                      <p className="text-muted-foreground">{b.address ?? "No address"} · Deleted {fmtAge(b.deletedAt)} by {b.deletedByName ?? "unknown"}</p>
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          )}

          {(summary?.payments ?? 0) > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ReceiptText className="h-4 w-4 text-purple-500" /> Voided Payments
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <RecoverySection<DeletedPayment>
                  title="Payments"
                  icon={<ReceiptText className="h-3.5 w-3.5" />}
                  items={dPayments}
                  isLoading={pLoad}
                  restoring={restoringPayment}
                  onRestore={(id) => restorePayment.mutate(id)}
                  renderRow={(p) => (
                    <div>
                      <p className="font-medium">
                        {fmt(p.amount)} via {p.method.toUpperCase()}
                        {p.receiptNumber && <span className="text-muted-foreground font-normal ml-1">#{p.receiptNumber}</span>}
                      </p>
                      <p className="text-muted-foreground">Voided {fmtAge(p.deletedAt)} by {p.deletedByName ?? "unknown"} · Recorded by {p.recordedBy ?? "?"}</p>
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

const ALERT_SEVERITY_STYLES = {
  critical: {
    bg: "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800",
    badge: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400",
    icon: <ShieldX className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />,
    label: "Critical",
    cardBg: "bg-red-50 dark:bg-red-900/20",
  },
  warning: {
    bg: "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
    icon: <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />,
    label: "Warning",
    cardBg: "bg-amber-50 dark:bg-amber-900/20",
  },
  info: {
    bg: "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400",
    icon: <ShieldCheck className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />,
    label: "Info",
    cardBg: "bg-blue-50 dark:bg-blue-900/20",
  },
} as const;

function AlertCenterTab() {
  const queryClient = useQueryClient();
  const [statusTab, setStatusTab] = useState<"open" | "acknowledged" | "resolved">("open");
  const [severity, setSeverity] = useState("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);

  const { data: counts, isLoading: countsLoading, refetch: refetchCounts } = useQuery({
    queryKey: ["alert-counts"],
    queryFn: api.alerts.counts,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["alerts", statusTab, severity, category, page],
    queryFn: () =>
      api.alerts.list({
        status: statusTab,
        severity: severity !== "all" ? severity : undefined,
        category: category !== "all" ? category : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const ackMutation = useMutation({
    mutationFn: (id: number) => api.alerts.acknowledge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alert-counts"] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) => api.alerts.resolve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alert-counts"] });
    },
  });

  const runCheckMutation = useMutation({
    mutationFn: api.alerts.runCheck,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alert-counts"] });
    },
  });

  const handleStatusChange = (v: string) => {
    setStatusTab(v as "open" | "acknowledged" | "resolved");
    setPage(0);
  };

  const alertList: AlertRecord[] = data?.alerts ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">Critical</p>
                <p className="text-2xl font-bold text-red-700 dark:text-red-300">
                  {countsLoading ? "—" : (counts?.critical ?? 0)}
                </p>
              </div>
              <ShieldX className="h-7 w-7 text-red-400 opacity-60" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Warning</p>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
                  {countsLoading ? "—" : (counts?.warning ?? 0)}
                </p>
              </div>
              <ShieldAlert className="h-7 w-7 text-amber-400 opacity-60" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Info</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                  {countsLoading ? "—" : (counts?.info ?? 0)}
                </p>
              </div>
              <ShieldCheck className="h-7 w-7 text-blue-400 opacity-60" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Unresolved</p>
                <p className="text-2xl font-bold">
                  {countsLoading ? "—" : (counts?.unresolved ?? 0)}
                </p>
              </div>
              <Bell className="h-7 w-7 text-muted-foreground/40" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter + Action Row */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-2">
          <Select value={severity} onValueChange={(v) => { setSeverity(v); setPage(0); }}>
            <SelectTrigger className="w-34 h-8 text-xs">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(0); }}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="sync">Sync</SelectItem>
              <SelectItem value="backup">Backup</SelectItem>
              <SelectItem value="recovery">Recovery</SelectItem>
              <SelectItem value="payment">Payment</SelectItem>
              <SelectItem value="pickup">Pickup</SelectItem>
              <SelectItem value="worker">Worker</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="version">Version</SelectItem>
              <SelectItem value="security">Security</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            disabled={runCheckMutation.isPending}
            onClick={() => runCheckMutation.mutate()}
          >
            <Zap className={cn("h-3.5 w-3.5", runCheckMutation.isPending && "animate-pulse")} />
            {runCheckMutation.isPending ? "Checking…" : "Run Check"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            disabled={isFetching}
            onClick={() => { refetch(); refetchCounts(); }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Status Tabs */}
      <Tabs value={statusTab} onValueChange={handleStatusChange}>
        <TabsList className="h-8 gap-1">
          <TabsTrigger value="open" className="text-xs h-7 gap-1 px-3">
            <AlertCircle className="h-3 w-3" />
            Open
            {(counts?.open ?? 0) > 0 && (
              <span className="ml-0.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {counts!.open}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="acknowledged" className="text-xs h-7 gap-1 px-3">
            <CheckCircle className="h-3 w-3" />
            Acknowledged
            {(counts?.acknowledged ?? 0) > 0 && (
              <span className="ml-0.5 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {counts!.acknowledged}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="resolved" className="text-xs h-7 gap-1 px-3">
            <CheckSquare className="h-3 w-3" />
            Resolved
          </TabsTrigger>
        </TabsList>

        <TabsContent value={statusTab} className="mt-3">
          {isLoading ? (
            <p className="text-xs text-muted-foreground py-10 text-center">Loading alerts…</p>
          ) : alertList.length === 0 ? (
            <div className="text-center py-14 text-muted-foreground text-sm space-y-2">
              <Bell className="h-8 w-8 mx-auto opacity-20" />
              <p className="font-medium">No {statusTab} alerts</p>
              {statusTab === "open" && (
                <p className="text-xs">
                  Click <strong>Run Check</strong> above to evaluate alert rules now, or wait for the
                  next automatic check (every 5 minutes).
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {alertList.map((alert) => {
                const sev = ALERT_SEVERITY_STYLES[alert.severity];
                return (
                  <div
                    key={alert.id}
                    className={cn(
                      "rounded-lg border p-3",
                      sev.bg
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      {sev.icon}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span
                            className={cn(
                              "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                              sev.badge
                            )}
                          >
                            {sev.label}
                          </span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 uppercase tracking-wide">
                            {alert.category}
                          </span>
                          {alert.status === "acknowledged" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400">
                              Ack'd by {alert.acknowledgedBy}
                            </span>
                          )}
                          {alert.status === "resolved" && alert.resolvedBy === "system" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                              Auto-resolved
                            </span>
                          )}
                          {alert.status === "resolved" && alert.resolvedBy !== "system" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                              Resolved by {alert.resolvedBy}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-semibold leading-snug">{alert.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {alert.message}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                          <span title={fmtDate(alert.createdAt)}>{fmtAge(alert.createdAt)}</span>
                          {alert.deviceId && (
                            <span className="font-mono opacity-70">
                              device: {alert.deviceId.slice(0, 8)}…
                            </span>
                          )}
                          {alert.acknowledgedAt && (
                            <span>ack'd {fmtAge(alert.acknowledgedAt)}</span>
                          )}
                          {alert.resolvedAt && (
                            <span>resolved {fmtAge(alert.resolvedAt)}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0 mt-0.5">
                        {alert.status === "open" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] px-2 gap-1 font-medium"
                              disabled={ackMutation.isPending}
                              onClick={() => ackMutation.mutate(alert.id)}
                            >
                              <CheckCircle className="h-3 w-3" />
                              Ack
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] px-2 gap-1 font-medium"
                              disabled={resolveMutation.isPending}
                              onClick={() => resolveMutation.mutate(alert.id)}
                            >
                              <CheckSquare className="h-3 w-3" />
                              Resolve
                            </Button>
                          </>
                        )}
                        {alert.status === "acknowledged" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] px-2 gap-1 font-medium"
                            disabled={resolveMutation.isPending}
                            onClick={() => resolveMutation.mutate(alert.id)}
                          >
                            <CheckSquare className="h-3 w-3" />
                            Resolve
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FailedMessagesTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ops-failed-messages", page],
    queryFn: () => api.operations.failedMessages({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    staleTime: 30_000,
  });

  const entries = (data as OpsFailedMessagesResponse | undefined)?.entries ?? [];
  const total = (data as OpsFailedMessagesResponse | undefined)?.total ?? 0;

  const requeueMutation = useMutation({
    mutationFn: (id: number) => api.operations.requeueMessage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-failed-messages"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Failed Notifications</p>
          <p className="text-xs text-muted-foreground">
            These messages could not be delivered after multiple attempts. You can retry them below.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {total > 0 && (
            <span className="text-xs text-red-600 dark:text-red-400 font-medium">
              {total} failed message{total !== 1 ? "s" : ""}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm animate-pulse">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquareX className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">No failed messages</p>
          <p className="text-xs mt-1 opacity-70">
            Messages that exhaust all retry attempts will appear here.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Created</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Recipient</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Template</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">Attempts</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden lg:table-cell">Last Error</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e: FailedMessageEntry) => (
                <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div title={e.createdAt ? fmtDate(e.createdAt) : ""} className="cursor-default">
                      {e.createdAt ? fmtAge(e.createdAt) : "—"}
                    </div>
                    <div className="text-muted-foreground text-[10px]">
                      {e.lastAttemptAt ? fmtDate(e.lastAttemptAt) : "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium truncate max-w-[130px]">{e.recipientName ?? "—"}</div>
                    <div className="text-muted-foreground font-mono text-[10px]">{e.recipientPhone}</div>
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[10px] font-medium">
                      <Send className="h-2.5 w-2.5" />
                      {e.templateName}
                    </span>
                    <div className="text-muted-foreground text-[10px] mt-0.5 capitalize">{e.channel}</div>
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell">
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      {e.attempts}/{e.maxAttempts}
                    </span>
                    <div className="text-muted-foreground text-[10px]">attempts</div>
                  </td>
                  <td className="px-3 py-2 hidden lg:table-cell max-w-[220px]">
                    <p className="text-[10px] text-red-600 dark:text-red-400 truncate" title={e.lastError ?? ""}>
                      {e.lastError ?? "Unknown error"}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px] px-2 gap-1 font-medium"
                      disabled={requeueMutation.isPending}
                      onClick={() => requeueMutation.mutate(e.id)}
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      Re-queue
                    </Button>
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

export default function OperationsPage() {
  usePageTitle("Operations Center");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Operations Center</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Monitor orders, payments, staff activity, alerts, and backup status.
        </p>
      </div>

      <Tabs defaultValue="business-overview">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="business-overview" className="text-xs gap-1.5">
            <Heart className="h-3.5 w-3.5" /> Business Overview
          </TabsTrigger>
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
          <TabsTrigger value="worker-devices" className="text-xs gap-1.5">
            <Wifi className="h-3.5 w-3.5" /> Worker Devices
          </TabsTrigger>
          <TabsTrigger value="failed-notifications" className="text-xs gap-1.5">
            <MessageSquareX className="h-3.5 w-3.5" /> Failed Notifications
          </TabsTrigger>
          <TabsTrigger value="recovery" className="text-xs gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Backup & Recovery
          </TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs gap-1.5">
            <Bell className="h-3.5 w-3.5" /> Alert Center
          </TabsTrigger>
        </TabsList>

        <TabsContent value="business-overview" className="mt-4"><HealthTab /></TabsContent>
        <TabsContent value="audit-log" className="mt-4"><AuditLogTab /></TabsContent>
        <TabsContent value="payments" className="mt-4"><PaymentsTab /></TabsContent>
        <TabsContent value="pickups" className="mt-4"><PickupsTab /></TabsContent>
        <TabsContent value="worker-activity" className="mt-4"><WorkerActivityTab /></TabsContent>
        <TabsContent value="worker-devices" className="mt-4"><SyncHealthTab /></TabsContent>
        <TabsContent value="failed-notifications" className="mt-4"><FailedMessagesTab /></TabsContent>
        <TabsContent value="recovery" className="mt-4"><RecoveryTab /></TabsContent>
        <TabsContent value="alerts" className="mt-4"><AlertCenterTab /></TabsContent>
      </Tabs>
    </div>
  );
}
