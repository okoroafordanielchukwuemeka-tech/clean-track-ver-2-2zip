import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { CachedDataBadge } from "@/components/cached-data-badge";
import { PendingSyncBadge } from "@/components/pending-sync-badge";
import { usePendingLocalCustomers } from "@/hooks/use-pending-local";
import { enqueueCustomerCreate } from "@/lib/queue-service";
import { getIsOnline } from "@/lib/network-state";
import { localDb, type LocalCustomer } from "@/lib/local-db";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { useBranch } from "@/context/branch-context";
import {
  api,
  type CustomerWithMetrics,
  type CustomerProfile,
  type CustomerInput,
  type CustomerUpdateInput,
  type CustomerStatement,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReceiptView } from "@/components/receipt-view";
import {
  Users, Search, Plus, Eye, Phone, AlertTriangle,
  ShoppingBag, Crown, RefreshCw, ArrowRight, Pencil, Trash2, CheckCircle,
  Printer, FileText, Calendar, TrendingUp, Download, Clock, Copy,
  Tag, X, ExternalLink, CreditCard, Building2, MapPin, Banknote,
  UserX, Archive, Filter, SortAsc, Undo2, Star, Zap, PackageCheck,
  ChevronRight, MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

// ─── Constants ────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const PRESET_TAGS = ["VIP", "Business", "Hotel", "Restaurant", "Hospital", "School", "Wholesale", "Wholesale"];
const UNIQUE_PRESET_TAGS = ["VIP", "Business", "Hotel", "Restaurant", "Hospital", "School", "Wholesale"];

const SORT_OPTIONS = [
  { value: "newest",             label: "Newest First" },
  { value: "oldest",             label: "Oldest First" },
  { value: "most_orders",        label: "Most Orders" },
  { value: "highest_spending",   label: "Highest Spending" },
  { value: "outstanding_balance",label: "Outstanding Balance" },
  { value: "last_visit",         label: "Last Visit" },
];

const FILTER_TABS = [
  { value: "all",         label: "All" },
  { value: "has_balance", label: "Balance" },
  { value: "has_pickups", label: "Pickups" },
  { value: "vip",         label: "VIP" },
  { value: "repeat",      label: "Repeat" },
  { value: "inactive",    label: "Inactive" },
  { value: "archived",    label: "Archived" },
];

// ─── Helper components ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, any> = {
    pending: "warning", processing: "info", ready: "success",
    partial_pickup: "warning", completed: "success",
  };
  const label: Record<string, string> = { partial_pickup: "Part. Pickup" };
  return <Badge variant={map[status] || "outline"} className="text-xs">{label[status] ?? status}</Badge>;
}

function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, any> = { paid: "success", partial: "warning", unpaid: "destructive" };
  return <Badge variant={map[status] || "outline"} className="text-xs capitalize">{status}</Badge>;
}

function AutoTags({ c }: { c: CustomerWithMetrics }) {
  return (
    <div className="flex flex-wrap gap-1">
      {c.isVip && <Badge variant="warning" className="text-xs gap-1"><Crown className="h-2.5 w-2.5" />VIP</Badge>}
      {c.isRepeat && <Badge variant="info" className="text-xs gap-1"><RefreshCw className="h-2.5 w-2.5" />Repeat</Badge>}
      {c.hasBalance && <Badge variant="destructive" className="text-xs gap-1"><AlertTriangle className="h-2.5 w-2.5" />Balance</Badge>}
      {c.hasRemainingPickups && <Badge variant="outline" className="text-xs gap-1"><ShoppingBag className="h-2.5 w-2.5" />Pickups</Badge>}
      {(c.customTags ?? []).map(t => (
        <Badge key={t} variant="secondary" className="text-xs gap-1"><Tag className="h-2.5 w-2.5" />{t}</Badge>
      ))}
    </div>
  );
}

function StatTile({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="p-3 bg-muted/40 rounded-lg">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-lg font-bold leading-tight ${color ?? ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Customers() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isOwner, laundryId, hasPermission } = useAuth();
  const { activeBranchId, branches } = useBranch();

  // List state
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [filter, setFilter] = useState("all");

  // Profile / dialog state
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [profileTab, setProfileTab] = useState<"orders" | "payments" | "statement">("orders");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [createForm, setCreateForm] = useState<CustomerInput>({ fullName: "", phone: "" });
  const [editForm, setEditForm] = useState<CustomerUpdateInput & { id?: number }>({});

  // Notes inline editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");

  // Tags editing
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [pendingTags, setPendingTags] = useState<string[]>([]);

  // Statement state
  const [statementPeriod, setStatementPeriod] = useState<"today" | "week" | "month" | "lastMonth" | "custom">("month");
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");

  const pendingCustomers = usePendingLocalCustomers(laundryId);

  // Debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300);
  }, []);

  // ── Data queries ─────────────────────────────────────────────────────────────

  const showArchived = filter === "archived";

  const { data: customers = [], isLoading, isViewingCache } = useCachedQuery({
    queryKey: ["customers", debouncedSearch, activeBranchId, showArchived],
    queryFn: () => api.customers.list({
      search: debouncedSearch || undefined,
      branchId: activeBranchId,
      archived: showArchived || undefined,
    }),
  });

  // Client-side filter + sort with useMemo for instant UI response
  const displayed = useMemo(() => {
    let result = [...customers];

    if (!showArchived) {
      if (filter === "has_balance")  result = result.filter(c => c.hasBalance);
      else if (filter === "has_pickups") result = result.filter(c => c.hasRemainingPickups);
      else if (filter === "vip")     result = result.filter(c => c.isVip || (c.customTags ?? []).some(t => t.toLowerCase() === "vip"));
      else if (filter === "repeat")  result = result.filter(c => c.isRepeat);
      else if (filter === "inactive") {
        const cutoff = Date.now() - 90 * 86400000;
        result = result.filter(c => !c.lastOrderDate || new Date(c.lastOrderDate).getTime() < cutoff);
      }
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case "oldest":             return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "most_orders":        return b.totalOrders - a.totalOrders;
        case "highest_spending":   return b.totalSpending - a.totalSpending;
        case "outstanding_balance":return b.outstandingBalance - a.outstandingBalance;
        case "last_visit": {
          const at = a.lastOrderDate ? new Date(a.lastOrderDate).getTime() : 0;
          const bt = b.lastOrderDate ? new Date(b.lastOrderDate).getTime() : 0;
          return bt - at;
        }
        default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    return result;
  }, [customers, filter, sortBy, showArchived]);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["customers", selectedId],
    queryFn: () => api.customers.get(selectedId!),
    enabled: selectedId != null,
  });

  const { data: customerPaymentsData, isLoading: paymentsLoading } = useQuery({
    queryKey: ["customerPayments", profile?.id],
    queryFn: () => api.receipts.getCustomerReceipts(profile!.id),
    enabled: profile != null && profileTab === "payments",
  });

  // Branding used to keep the printed Statement visually consistent with
  // Order/Payment Receipts (same header, logo, footer text).
  const { data: businessProfile } = useQuery({
    queryKey: ["settings", "business-profile"],
    queryFn: () => api.settings.getBusinessProfile(),
    enabled: profile != null && profileTab === "statement",
    staleTime: 5 * 60 * 1000,
  });
  const { data: brandingSettings } = useQuery({
    queryKey: ["settings", "branding"],
    queryFn: () => api.settings.getBranding(),
    enabled: profile != null && profileTab === "statement",
    staleTime: 5 * 60 * 1000,
  });

  const stmtParams = (() => {
    const now = new Date();
    const iso = (d: Date) => d.toISOString();

    if (statementPeriod === "today") {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end   = new Date(now); end.setHours(23, 59, 59, 999);
      return { from: iso(start), to: iso(end) };
    }
    if (statementPeriod === "week") {
      const day  = now.getDay();
      const diff = day === 0 ? -6 : 1 - day; // shift to Monday
      const start = new Date(now); start.setDate(now.getDate() + diff); start.setHours(0, 0, 0, 0);
      const end   = new Date(now); end.setHours(23, 59, 59, 999);
      return { from: iso(start), to: iso(end) };
    }
    if (statementPeriod === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end   = new Date(now); end.setHours(23, 59, 59, 999);
      return { from: iso(start), to: iso(end) };
    }
    if (statementPeriod === "lastMonth") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { from: iso(start), to: iso(end) };
    }
    // custom
    return { from: statementFrom || undefined, to: statementTo || undefined };
  })();

  const { data: statement, isLoading: stmtLoading } = useQuery({
    queryKey: ["customerStatement", profile?.id, stmtParams.from, stmtParams.to],
    queryFn: () => api.customers.statement(profile!.id, stmtParams),
    enabled: profile != null && profileTab === "statement",
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const backfillMutation = useMutation({
    mutationFn: () => api.customers.backfill(),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["customers"] }); toast.success(r.message); },
    onError: (e: Error) => toast.error("Could not run backfill — " + (e.message || "please try again.")),
  });

  const createMutation = useMutation<CustomerWithMetrics | null, Error, CustomerInput>({
    mutationFn: async (data: CustomerInput) => {
      if (!getIsOnline()) {
        if (!laundryId) throw new Error("Session data is missing. Please reload and try again.");
        const localId = crypto.randomUUID();
        const now = new Date().toISOString();
        const record: LocalCustomer = {
          localId, serverId: null, laundryId, branchId: activeBranchId,
          fullName: data.fullName, phone: data.phone,
          address: data.address ?? null, notes: data.notes ?? null,
          syncStatus: "pending_create", createdAt: now, updatedAt: now,
        };
        await enqueueCustomerCreate(localId, record, {
          fullName: data.fullName, phone: data.phone,
          address: data.address ?? null, notes: data.notes ?? null,
          branchId: activeBranchId, laundryId,
        });
        return null;
      }
      return api.customers.create(data);
    },
    onSuccess: (result) => {
      setShowCreate(false);
      setCreateForm({ fullName: "", phone: "" });
      if (result === null) {
        toast.info("Saved offline. Will sync automatically when connection returns.");
      } else {
        qc.invalidateQueries({ queryKey: ["customers"] });
        toast.success("Customer created successfully");
      }
    },
    onError: (e: Error) => toast.error("Could not create customer — " + (e.message || "please try again.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerUpdateInput }) => api.customers.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customers", editForm.id] });
      setShowEdit(false);
      toast.success("Customer updated successfully");
    },
    onError: (e: Error) => toast.error("Could not update customer — " + (e.message || "please try again.")),
  });

  const updateNotesMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) => api.customers.update(id, { notes: notes || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers", selectedId] });
      setEditingNotes(false);
      toast.success("Notes saved");
    },
    onError: (e: Error) => toast.error("Could not save notes — " + (e.message || "please try again.")),
  });

  const updateTagsMutation = useMutation({
    mutationFn: ({ id, tags }: { id: number; tags: string[] }) => api.customers.update(id, { tags }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customers", selectedId] });
      setEditingTags(false);
      toast.success("Tags updated");
    },
    onError: (e: Error) => toast.error("Could not update tags — " + (e.message || "please try again.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.customers.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      setSelectedId(null);
      setShowDelete(false);
      toast.success("Customer archived");
    },
    onError: (e: Error) => toast.error("Could not archive customer — " + (e.message || "please try again.")),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => api.customers.restore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      setSelectedId(null);
      toast.success("Customer restored");
    },
    onError: (e: Error) => toast.error("Could not restore customer — " + (e.message || "please try again.")),
  });

  // ── Derived values ─────────────────────────────────────────────────────────────

  const totals = useMemo(() => ({
    total: customers.filter(c => !showArchived).length,
    withBalance: customers.filter(c => c.hasBalance).length,
    withPickups: customers.filter(c => c.hasRemainingPickups).length,
    vip: customers.filter(c => c.isVip || (c.customTags ?? []).includes("VIP")).length,
  }), [customers, showArchived]);

  const branchName = useMemo(() => {
    if (!profile?.branchId) return null;
    return branches.find(b => b.id === profile.branchId)?.name ?? `Branch #${profile.branchId}`;
  }, [profile?.branchId, branches]);

  function openProfile(id: number) {
    setSelectedId(id);
    setProfileTab("orders");
    setEditingNotes(false);
    setEditingTags(false);
  }

  function closeProfile() {
    setSelectedId(null);
    setProfileTab("orders");
    setEditingNotes(false);
    setEditingTags(false);
  }

  function startTagEdit() {
    setPendingTags(profile?.customTags ?? []);
    setTagInput("");
    setEditingTags(true);
  }

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed || pendingTags.includes(trimmed)) return;
    setPendingTags(prev => [...prev, trimmed]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setPendingTags(prev => prev.filter(t => t !== tag));
  }

  function copyPhone(phone: string) {
    navigator.clipboard.writeText(phone).then(() => toast.success("Phone number copied"));
  }

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" /> Customers
          </h1>
          <CachedDataBadge show={isViewingCache} />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            title="Link existing orders to customer profiles"
          >
            <RefreshCw className={`h-4 w-4 ${backfillMutation.isPending ? "animate-spin" : ""}`} />
            Sync Orders
          </Button>
          {hasPermission("canCreateCustomers") && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> New Customer
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Customers", value: totals.total, color: "", onClick: () => setFilter("all") },
          { label: "With Balance", value: totals.withBalance, color: "text-red-600", onClick: () => setFilter("has_balance") },
          { label: "Remaining Pickups", value: totals.withPickups, color: "text-orange-600", onClick: () => setFilter("has_pickups") },
          { label: "VIP Customers", value: totals.vip, color: "text-yellow-600", onClick: () => setFilter("vip") },
        ].map(card => (
          <Card
            key={card.label}
            className={`cursor-pointer hover:bg-muted/30 transition-colors ${filter === "all" && card.label === "Total Customers" ? "ring-2 ring-primary/20" : ""}`}
            onClick={card.onClick}
          >
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
              <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + Filter + Sort */}
      <Card>
        <CardContent className="p-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, or customer ID…"
              className="pl-9"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label="Search customers"
            />
            {search && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => { setSearch(""); setDebouncedSearch(""); }}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Filter tabs + Sort */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex flex-wrap gap-1">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    filter === tab.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                >
                  {tab.label}
                  {tab.value === "has_balance" && totals.withBalance > 0 && (
                    <span className="ml-1 text-xs opacity-80">({totals.withBalance})</span>
                  )}
                </button>
              ))}
            </div>
            <div className="sm:ml-auto">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-8 text-xs w-44 gap-1">
                  <SortAsc className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending Offline Customers */}
      {pendingCustomers.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/30 dark:border-blue-900 dark:bg-blue-950/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-blue-800 dark:text-blue-300">
              <Clock className="h-4 w-4" />
              {pendingCustomers.length} customer{pendingCustomers.length !== 1 ? "s" : ""} saved offline, pending sync
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableBody>
                {pendingCustomers.map(c => (
                  <TableRow key={c.localId} className="opacity-90">
                    <TableCell className="font-medium py-3 pl-4">{c.fullName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground py-3">{c.phone}</TableCell>
                    <TableCell className="text-sm text-muted-foreground py-3 hidden sm:table-cell">{c.address ?? "—"}</TableCell>
                    <TableCell className="py-3 pr-4 text-right"><PendingSyncBadge /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Customer List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {isLoading ? "Loading…" : `${displayed.length} customer${displayed.length !== 1 ? "s" : ""}`}
            {filter !== "all" && filter !== "archived" && (
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                · filtered by {FILTER_TABS.find(t => t.value === filter)?.label}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-9 w-9 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-24 bg-muted animate-pulse rounded" />
                  </div>
                  <div className="h-4 w-20 bg-muted animate-pulse rounded hidden sm:block" />
                  <div className="h-5 w-16 bg-muted animate-pulse rounded" />
                  <div className="h-8 w-8 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-14 space-y-3">
              {search || filter !== "all" ? (
                <>
                  <Users className="h-10 w-10 mx-auto text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No customers match your search or filter.</p>
                  <Button variant="outline" size="sm" onClick={() => { setSearch(""); setDebouncedSearch(""); setFilter("all"); }}>
                    Clear filters
                  </Button>
                </>
              ) : (
                <>
                  <Users className="h-10 w-10 mx-auto text-muted-foreground/40" />
                  <div>
                    <p className="font-medium text-foreground">No customers yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Adding your first customer takes less than 30 seconds.</p>
                  </div>
                  <Button size="sm" onClick={() => setShowCreate(true)}>Add Your First Customer</Button>
                </>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden sm:table-cell">Phone</TableHead>
                  <TableHead className="hidden md:table-cell">Orders</TableHead>
                  <TableHead className="hidden lg:table-cell">Total Spent</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead className="hidden md:table-cell">Remaining</TableHead>
                  <TableHead className="hidden lg:table-cell">Last Visit</TableHead>
                  <TableHead className="hidden md:table-cell">Tags</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openProfile(c.id)}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        {c.isVip && <Crown className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                        <span className="truncate max-w-[140px]">{c.fullName}</span>
                      </span>
                      <span className="sm:hidden text-xs text-muted-foreground font-mono">{c.phone}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell font-mono text-sm">{c.phone}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="font-medium">{c.totalOrders}</span>
                      {c.activeOrders > 0 && (
                        <span className="ml-1 text-xs text-blue-600">({c.activeOrders} active)</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{fmt(c.totalSpending)}</TableCell>
                    <TableCell>
                      {c.outstandingBalance > 0 ? (
                        <span className="text-red-600 font-medium">{fmt(c.outstandingBalance)}</span>
                      ) : (
                        <span className="text-green-600 text-xs">Clear</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {c.remainingItems > 0 ? (
                        <span className="text-orange-600 font-medium">{c.remainingItems} item{c.remainingItems !== 1 ? "s" : ""}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {timeAgo(c.lastOrderDate)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell"><AutoTags c={c} /></TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" onClick={() => openProfile(c.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Customer Profile Modal ─────────────────────────────────────────────── */}
      <Dialog open={selectedId != null} onOpenChange={(open) => { if (!open) closeProfile(); }}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          {profileLoading || !profile ? (
            <div className="p-8 space-y-4">
              <div className="flex gap-3">
                <div className="h-12 w-12 bg-muted animate-pulse rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-6 w-48 bg-muted animate-pulse rounded" />
                  <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
              <div className="h-40 bg-muted animate-pulse rounded-lg" />
            </div>
          ) : (
            <>
              {/* Profile Header */}
              <div className="p-5 border-b bg-muted/20">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {profile.isVip && <Crown className="h-5 w-5 text-yellow-500 shrink-0" />}
                      <h2 className="text-xl font-bold truncate">{profile.fullName}</h2>
                      {profile.deletedAt && (
                        <Badge variant="destructive" className="text-xs">Archived</Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-sm text-muted-foreground">
                      <a href={`tel:${profile.phone}`} className="flex items-center gap-1 hover:text-primary transition-colors font-mono">
                        <Phone className="h-3.5 w-3.5 shrink-0" />{profile.phone}
                      </a>
                      {profile.address && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />{profile.address}
                        </span>
                      )}
                      {branchName && (
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />{branchName}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        Since {fmtDate(profile.createdAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        Last visit: {timeAgo(profile.lastOrderDate)}
                      </span>
                    </div>

                    {/* Auto tags */}
                    <div className="mt-2">
                      <AutoTags c={profile} />
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap shrink-0">
                    {profile.deletedAt ? (
                      isOwner && (
                        <Button size="sm" variant="outline" onClick={() => restoreMutation.mutate(profile.id)} disabled={restoreMutation.isPending}>
                          <Undo2 className="h-3.5 w-3.5" />Restore
                        </Button>
                      )
                    ) : (
                      <>
                        {isOwner && (
                          <Button size="sm" variant="outline" onClick={() => {
                            setEditForm({ id: profile.id, fullName: profile.fullName, phone: profile.phone, address: profile.address ?? "", notes: profile.notes ?? "" });
                            setShowEdit(true);
                          }}>
                            <Pencil className="h-3.5 w-3.5" />Edit
                          </Button>
                        )}
                        <Button size="sm" onClick={() => { closeProfile(); navigate(`/orders?phone=${encodeURIComponent(profile.phone)}`); }}>
                          <Plus className="h-3.5 w-3.5" />New Order
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Quick Actions Row */}
                {!profile.deletedAt && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" asChild>
                      <a href={`tel:${profile.phone}`}>
                        <Phone className="h-3.5 w-3.5" />Call
                      </a>
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => copyPhone(profile.phone)}>
                      <Copy className="h-3.5 w-3.5" />Copy Phone
                    </Button>
                    {profile.activeOrders > 0 && (
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => { closeProfile(); navigate(`/orders?phone=${encodeURIComponent(profile.phone)}&status=active`); }}>
                        <Zap className="h-3.5 w-3.5" />Active Orders ({profile.activeOrders})
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setProfileTab("payments")}>
                      <CreditCard className="h-3.5 w-3.5" />Payments
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setProfileTab("statement")}>
                      <FileText className="h-3.5 w-3.5" />Statement
                    </Button>
                    {isOwner && (
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={startTagEdit}>
                        <Tag className="h-3.5 w-3.5" />Tags
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Metrics Grid */}
              <div className="p-5 border-b space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className={`p-3 rounded-lg text-center ${profile.outstandingBalance > 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-green-50 dark:bg-green-950/20"}`}>
                    <p className={`text-2xl font-bold ${profile.outstandingBalance > 0 ? "text-red-600" : "text-green-600"}`}>
                      {fmt(profile.outstandingBalance)}
                    </p>
                    <p className="text-xs text-muted-foreground">Outstanding</p>
                  </div>
                  <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-center">
                    <p className="text-2xl font-bold text-green-700 dark:text-green-400">{fmt(profile.totalSpending)}</p>
                    <p className="text-xs text-muted-foreground">Lifetime Revenue</p>
                  </div>
                  <div className="p-3 bg-muted/40 rounded-lg text-center">
                    <p className="text-2xl font-bold">{profile.totalOrders}</p>
                    <p className="text-xs text-muted-foreground">Total Orders</p>
                  </div>
                  <div className={`p-3 rounded-lg text-center ${profile.remainingItems > 0 ? "bg-orange-50 dark:bg-orange-950/20" : "bg-muted/40"}`}>
                    <p className={`text-2xl font-bold ${profile.remainingItems > 0 ? "text-orange-600" : "text-muted-foreground"}`}>
                      {profile.remainingItems}
                    </p>
                    <p className="text-xs text-muted-foreground">Items Remaining</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatTile label="Avg Order Value" value={fmt(profile.avgOrderValue)} />
                  <StatTile label="Completed" value={profile.completedOrders} sub={`of ${profile.totalOrders} orders`} color="text-green-600" />
                  <StatTile label="Cancelled" value={profile.cancelledOrders ?? 0} />
                  <StatTile label="Active Now" value={profile.activeOrders} color={profile.activeOrders > 0 ? "text-blue-600" : ""} />
                </div>
              </div>

              {/* Tags Editor */}
              {editingTags && isOwner && (
                <div className="p-5 border-b bg-muted/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Edit Tags</p>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingTags(false)}>
                      <X className="h-3.5 w-3.5" />Cancel
                    </Button>
                  </div>

                  {/* Preset tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {UNIQUE_PRESET_TAGS.map(pt => {
                      const active = pendingTags.includes(pt);
                      return (
                        <button
                          key={pt}
                          onClick={() => active ? removeTag(pt) : addTag(pt)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                            active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                          }`}
                        >
                          {pt}
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom tag input */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Custom tag…"
                      className="h-8 text-sm"
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); } }}
                    />
                    <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => addTag(tagInput)}>Add</Button>
                  </div>

                  {/* Current tags */}
                  {pendingTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {pendingTags.map(t => (
                        <Badge key={t} variant="secondary" className="gap-1 pr-1">
                          {t}
                          <button onClick={() => removeTag(t)} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></button>
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => updateTagsMutation.mutate({ id: profile.id, tags: pendingTags })}
                      disabled={updateTagsMutation.isPending}
                    >
                      {updateTagsMutation.isPending ? "Saving…" : "Save Tags"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Notes Section */}
              {(isOwner || profile.notes) && (
                <div className="px-5 py-3 border-b">
                  {editingNotes ? (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Private Notes</Label>
                      <Textarea
                        value={notesValue}
                        onChange={e => setNotesValue(e.target.value)}
                        placeholder='e.g. "VIP customer", "Always pays late", "Call before delivery"'
                        className="text-sm min-h-[80px] resize-none"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => updateNotesMutation.mutate({ id: profile.id, notes: notesValue })} disabled={updateNotesMutation.isPending}>
                          {updateNotesMutation.isPending ? "Saving…" : "Save Notes"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingNotes(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : profile.notes ? (
                    <div
                      className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg cursor-pointer group"
                      onClick={() => { if (isOwner) { setNotesValue(profile.notes ?? ""); setEditingNotes(true); } }}
                    >
                      <MessageSquare className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-400 mb-0.5">Notes</p>
                        <p className="text-sm text-amber-900 dark:text-amber-300">{profile.notes}</p>
                      </div>
                      {isOwner && <Pencil className="h-3.5 w-3.5 text-amber-500 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5" />}
                    </div>
                  ) : isOwner ? (
                    <button
                      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors py-1"
                      onClick={() => { setNotesValue(""); setEditingNotes(true); }}
                    >
                      <Plus className="h-3.5 w-3.5" />Add private notes
                    </button>
                  ) : null}
                </div>
              )}

              {/* Tab Navigation */}
              <div className="flex border-b">
                {(["orders", "payments", "statement"] as const).map((tab) => {
                  const labels = { orders: `Orders (${profile.orders.length})`, payments: "Payment History", statement: "Statement" };
                  const icons = { orders: ShoppingBag, payments: CreditCard, statement: FileText };
                  const Icon = icons[tab];
                  const show = tab !== "payments" && tab !== "statement" ? true : hasPermission("canViewCustomerBalances");
                  if (!show) return null;
                  return (
                    <button
                      key={tab}
                      onClick={() => setProfileTab(tab)}
                      className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                        profileTab === tab
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />{labels[tab]}
                    </button>
                  );
                })}
              </div>

              {/* Tab Content */}
              <div className="p-5">

                {/* ── Orders Tab ── */}
                {profileTab === "orders" && (
                  profile.orders.length > 0 ? (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="text-xs">Order #</TableHead>
                              <TableHead className="text-xs">Status</TableHead>
                              <TableHead className="text-xs">Pickup</TableHead>
                              <TableHead className="text-xs">Payment</TableHead>
                              <TableHead className="text-xs">Created</TableHead>
                              <TableHead className="text-xs text-right">Total</TableHead>
                              <TableHead className="text-xs text-right">Balance</TableHead>
                              <TableHead className="text-xs"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {profile.orders.map((o) => {
                              const totalDue = (Number(o.price) || 0) + (Number(o.extraCharge) || 0) - (Number(o.discount) || 0);
                              const balance = Math.max(0, totalDue - Number(o.amountPaid || 0));
                              const pickupDone = o.status === "completed";
                              const pickupPartial = o.status === "partial_pickup";
                              return (
                                <TableRow key={o.id} className="hover:bg-muted/20">
                                  <TableCell className="font-mono text-xs text-primary">{o.orderId}</TableCell>
                                  <TableCell><StatusBadge status={o.status} /></TableCell>
                                  <TableCell>
                                    {pickupDone ? (
                                      <Badge variant="success" className="text-xs gap-1"><PackageCheck className="h-3 w-3" />Done</Badge>
                                    ) : pickupPartial ? (
                                      <Badge variant="warning" className="text-xs">Partial</Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs text-muted-foreground">Pending</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell><PaymentBadge status={o.paymentStatus} /></TableCell>
                                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                    {new Date(o.createdAt).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "2-digit" })}
                                  </TableCell>
                                  <TableCell className="text-xs text-right tabular-nums">{fmt(totalDue)}</TableCell>
                                  <TableCell className="text-xs text-right tabular-nums">
                                    {balance > 0 ? (
                                      <span className="text-red-600 font-medium">{fmt(balance)}</span>
                                    ) : (
                                      <span className="text-green-600 flex items-center justify-end gap-0.5">
                                        <CheckCircle className="h-3 w-3" />Paid
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Button variant="ghost" size="icon" asChild onClick={closeProfile}>
                                      <Link to={`/orders/${o.id}`}><ChevronRight className="h-4 w-4" /></Link>
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No orders linked to this customer yet.
                    </div>
                  )
                )}

                {/* ── Payment History Tab ── */}
                {profileTab === "payments" && hasPermission("canViewCustomerBalances") && (
                  paymentsLoading ? (
                    <div className="divide-y border rounded-lg overflow-hidden">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="flex items-center gap-4 px-4 py-3">
                          <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                          <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                          <div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto" />
                        </div>
                      ))}
                    </div>
                  ) : !customerPaymentsData?.receipts?.length ? (
                    <div className="py-8 text-center text-muted-foreground text-sm">No payments recorded for this customer.</div>
                  ) : (
                    <div className="space-y-2">
                      {/* Summary */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-center">
                          <p className="text-xs text-muted-foreground">Total Paid</p>
                          <p className="font-bold text-green-700 dark:text-green-400">
                            {fmt(customerPaymentsData.receipts.reduce((s, r) => s + Number(r.amount), 0))}
                          </p>
                        </div>
                        <div className="p-3 bg-muted/40 rounded-lg text-center">
                          <p className="text-xs text-muted-foreground">Payments</p>
                          <p className="font-bold">{customerPaymentsData.receipts.length}</p>
                        </div>
                        <div className={`p-3 rounded-lg text-center ${profile.outstandingBalance > 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-muted/40"}`}>
                          <p className="text-xs text-muted-foreground">Outstanding</p>
                          <p className={`font-bold ${profile.outstandingBalance > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                            {fmt(profile.outstandingBalance)}
                          </p>
                        </div>
                      </div>

                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="text-xs">Date</TableHead>
                              <TableHead className="text-xs">Order</TableHead>
                              <TableHead className="text-xs">Method</TableHead>
                              <TableHead className="text-xs">Receipt #</TableHead>
                              <TableHead className="text-xs text-right">Amount</TableHead>
                              <TableHead className="text-xs text-right">Remaining</TableHead>
                              <TableHead className="text-xs"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {customerPaymentsData.receipts.map((r, idx) => (
                              <TableRow key={r.receiptNumber ?? idx}>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                  {new Date(r.recordedAt).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "2-digit" })}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{r.orderId}</TableCell>
                                <TableCell className="text-xs capitalize">{r.method.replace(/_/g, " ")}</TableCell>
                                <TableCell className="font-mono text-xs text-primary">{r.receiptNumber ?? "—"}</TableCell>
                                <TableCell className="text-xs text-right tabular-nums font-semibold text-green-600">
                                  {fmt(Number(r.amount))}
                                </TableCell>
                                <TableCell className="text-xs text-right tabular-nums">
                                  {Number(r.remainingBalance) > 0
                                    ? <span className="text-red-600">{fmt(Number(r.remainingBalance))}</span>
                                    : <span className="text-green-600">Clear</span>}
                                </TableCell>
                                <TableCell>
                                  {r.receiptNumber && (
                                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Print receipt"
                                      onClick={() => window.open(`/receipts/${encodeURIComponent(r.receiptNumber!)}/print`, "_blank")}>
                                      <Printer className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )
                )}

                {/* ── Statement Tab ── */}
                {profileTab === "statement" && hasPermission("canViewCustomerBalances") && (
                  <div className="space-y-3">
                    {/* Period selector */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex rounded-md border overflow-hidden text-xs">
                        {([
                          { id: "today",     label: "Today" },
                          { id: "week",      label: "This Week" },
                          { id: "month",     label: "This Month" },
                          { id: "lastMonth", label: "Last Month" },
                          { id: "custom",    label: "Custom" },
                        ] as const).map(p => (
                          <button
                            key={p.id}
                            onClick={() => setStatementPeriod(p.id)}
                            className={`px-3 py-1.5 font-medium transition-colors ${statementPeriod === p.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      {statementPeriod === "custom" && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Input type="date" className="h-7 text-xs w-36" value={statementFrom} onChange={e => setStatementFrom(e.target.value)} />
                          <span className="text-muted-foreground">to</span>
                          <Input type="date" className="h-7 text-xs w-36" value={statementTo} onChange={e => setStatementTo(e.target.value)} />
                        </div>
                      )}
                      <Button
                        variant="outline" size="sm" className="ml-auto h-7 text-xs gap-1"
                        disabled={!statement}
                        onClick={() => {
                          if (!statement) return;
                          const fmtCur = (v: number) => v.toLocaleString("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 });
                          const balColor = (b: number) => b > 0 ? "color:#dc2626" : "color:#16a34a";
                          const rows = statement.entries.map(e => `
                            <tr style="${e.type === "pickup" || e.type === "cancelled" ? "opacity:0.6" : ""}">
                              <td>${new Date(e.date).toLocaleDateString("en-NG")}</td>
                              <td>${e.orderId}</td>
                              <td style="text-transform:capitalize">${e.type.replace("_", " ")}</td>
                              <td>${e.description}</td>
                              <td style="text-align:right">${e.charge > 0 ? fmtCur(e.charge) : ""}</td>
                              <td style="text-align:right">${e.credit > 0 ? fmtCur(e.credit) : ""}</td>
                              <td style="text-align:right;${balColor(e.balance)}">${fmtCur(Math.abs(e.balance))}${e.balance < 0 ? " CR" : ""}</td>
                            </tr>`).join("");
                          const s = statement.summary;
                          const headerName = brandingSettings?.receiptHeaderName || businessProfile?.businessName || "CleanTrack";
                          const bizAddress = businessProfile?.address ?? "";
                          const bizPhone = businessProfile?.phone ?? "";
                          const bizEmail = businessProfile?.email ?? "";
                          const logoUrl = businessProfile?.logoUrl ?? "";
                          const footerText = brandingSettings?.receiptFooterText ?? "";
                          printWindow?.close();
                          const pw = window.open("", "_blank");
                          if (!pw) return;
                          // Same header/footer/typography language as ReceiptView (receipt-view.tsx)
                          // so every printable CleanTrack document reads as one product.
                          pw.document.write(`<!DOCTYPE html><html><head><title>Statement — ${statement.customer.fullName}</title>
                          <style>
                            @page { size: A4; margin: 15mm; }
                            body{font-family:sans-serif;font-size:12px;padding:0;color:#111}
                            .doc-header{text-align:center;margin-bottom:14px}
                            .doc-header img{max-width:80px;max-height:60px;margin:0 auto 8px;display:block}
                            .doc-header h2{font-size:18px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;margin:0 0 4px}
                            .doc-header p{font-size:11px;color:#555;margin:1px 0}
                            .doc-divider{border:none;border-top:1px dashed #999;margin:10px 0}
                            h1{font-size:16px;letter-spacing:2px;text-transform:uppercase;text-align:center;color:#555;margin:0 0 12px;font-weight:bold}
                            .meta{color:#555;font-size:11px;margin-bottom:16px}
                            table{width:100%;border-collapse:collapse;margin-top:12px}
                            th,td{border:1px solid #e5e7eb;padding:5px 8px;text-align:left;font-size:11px}
                            th{background:#f3f4f6;font-weight:600}
                            .opening-row td{background:#eff6ff;font-weight:600}
                            tfoot td{font-weight:700;background:#f9fafb}
                            .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px}
                            .summary-box{border:1px solid #e5e7eb;padding:8px 12px;border-radius:6px}
                            .summary-box p{margin:0;font-size:10px;color:#6b7280}
                            .summary-box strong{display:block;font-size:13px;margin-top:2px}
                            .doc-footer{text-align:center;font-size:11px;color:#888;font-style:italic;margin:16px 0 4px}
                            .doc-generated{text-align:center;font-size:9px;color:#bbb;margin-top:8px;letter-spacing:0.5px}
                            tr{break-inside:avoid}
                          </style></head><body>
                          <div class="doc-header">
                            ${logoUrl ? `<img src="${logoUrl}" alt="${headerName}" />` : ""}
                            <h2>${headerName}</h2>
                            ${bizAddress ? `<p>${bizAddress}</p>` : ""}
                            ${bizPhone ? `<p>${bizPhone}</p>` : ""}
                            ${bizEmail ? `<p>${bizEmail}</p>` : ""}
                          </div>
                          <div class="doc-divider"></div>
                          <h1>Customer Statement</h1>
                          <div class="meta">
                            <strong>${statement.customer.fullName}</strong> · ${statement.customer.phone}${statement.customer.address ? " · " + statement.customer.address : ""}<br/>
                            Period: ${new Date(statement.period.from).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })} – ${new Date(statement.period.to).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}
                          </div>
                          <table>
                            <thead><tr><th>Date</th><th>Order #</th><th>Type</th><th>Description</th><th style="text-align:right">Charge</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead>
                            <tbody>
                              <tr class="opening-row"><td colspan="6">Opening Balance (brought forward)</td><td style="text-align:right;${balColor(s.openingBalance)}">${fmtCur(Math.abs(s.openingBalance))}${s.openingBalance < 0 ? " CR" : ""}</td></tr>
                              ${rows}
                            </tbody>
                            <tfoot><tr><td colspan="4">Period Total</td><td style="text-align:right">${fmtCur(s.totalCharged)}</td><td style="text-align:right">${fmtCur(s.totalPaid)}</td><td style="text-align:right;${balColor(s.closingBalance)}">${fmtCur(Math.abs(s.closingBalance))}${s.closingBalance < 0 ? " CR" : ""}</td></tr></tfoot>
                          </table>
                          <div class="summary">
                            <div class="summary-box"><p>Orders</p><strong>${s.orderCount}${s.cancelledOrderCount > 0 ? " (+" + s.cancelledOrderCount + " cancelled)" : ""}</strong></div>
                            <div class="summary-box"><p>Total Charges</p><strong>${fmtCur(s.totalBaseCharges)}${s.totalExtraCharges > 0 ? " + " + fmtCur(s.totalExtraCharges) + " extra" : ""}</strong></div>
                            <div class="summary-box"><p>Discounts</p><strong>${s.totalDiscounts > 0 ? fmtCur(s.totalDiscounts) : "—"}</strong></div>
                            <div class="summary-box"><p>Payments Received</p><strong style="color:#16a34a">${fmtCur(s.totalPaid)}</strong></div>
                            <div class="summary-box"><p>Opening Balance</p><strong style="${balColor(s.openingBalance)}">${fmtCur(Math.abs(s.openingBalance))}${s.openingBalance < 0 ? " CR" : ""}</strong></div>
                            <div class="summary-box"><p>Closing Balance</p><strong style="${balColor(s.closingBalance)}">${fmtCur(Math.abs(s.closingBalance))}${s.closingBalance < 0 ? " CR" : ""}</strong></div>
                          </div>
                          ${s.closingBalance > 0 && statement.paymentDetails?.bankName ? `
                          <div class="doc-divider"></div>
                          <div class="summary-box" style="margin-top:6px">
                            <p style="font-weight:600;color:#111;margin-bottom:4px">HOW TO PAY THE BALANCE</p>
                            <p>Bank: <strong>${statement.paymentDetails.bankName}</strong></p>
                            ${statement.paymentDetails.accountName ? `<p>Account Name: <strong>${statement.paymentDetails.accountName}</strong></p>` : ""}
                            ${statement.paymentDetails.accountNumber ? `<p>Account Number: <strong>${statement.paymentDetails.accountNumber}</strong></p>` : ""}
                            ${statement.paymentDetails.instructions ? `<p style="margin-top:4px">${statement.paymentDetails.instructions}</p>` : ""}
                          </div>` : ""}
                          ${footerText ? `<div class="doc-footer">${footerText}</div>` : ""}
                          <p class="doc-generated">Generated by CleanTrack · ${new Date().toLocaleDateString("en-NG")}</p>
                          </body></html>`);
                          pw.document.close();
                          pw.print();
                        }}
                      >
                        <Printer className="h-3.5 w-3.5" />Print / PDF
                      </Button>
                    </div>

                    {stmtLoading ? (
                      <div className="py-8 text-center text-muted-foreground text-sm animate-pulse">Loading statement…</div>
                    ) : !statement ? (
                      <div className="py-6 text-center text-muted-foreground text-sm">No data for this period.</div>
                    ) : (
                      <div className="space-y-3">

                        {/* Summary cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div className="p-2.5 bg-muted/30 rounded-lg">
                            <p className="text-xs text-muted-foreground">Opening Balance</p>
                            <p className={`font-semibold text-sm ${statement.openingBalance > 0 ? "text-amber-600" : statement.openingBalance < 0 ? "text-green-600" : "text-muted-foreground"}`}>
                              {statement.openingBalance === 0 ? "—" : `${fmt(Math.abs(statement.openingBalance))}${statement.openingBalance < 0 ? " CR" : ""}`}
                            </p>
                          </div>
                          <div className="p-2.5 bg-muted/30 rounded-lg">
                            <p className="text-xs text-muted-foreground">Total Charges</p>
                            <p className="font-semibold text-sm">{fmt(statement.summary.totalCharged)}</p>
                            {(statement.summary.totalExtraCharges > 0 || statement.summary.totalDiscounts > 0) && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {statement.summary.totalExtraCharges > 0 && `+${fmt(statement.summary.totalExtraCharges)} extra`}
                                {statement.summary.totalExtraCharges > 0 && statement.summary.totalDiscounts > 0 && " · "}
                                {statement.summary.totalDiscounts > 0 && <span className="text-green-600">−{fmt(statement.summary.totalDiscounts)} disc.</span>}
                              </p>
                            )}
                          </div>
                          <div className="p-2.5 bg-green-50 dark:bg-green-950/20 rounded-lg">
                            <p className="text-xs text-muted-foreground">Total Paid</p>
                            <p className="font-semibold text-sm text-green-700 dark:text-green-400">{fmt(statement.summary.totalPaid)}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{statement.summary.paymentCount} payment{statement.summary.paymentCount !== 1 ? "s" : ""}</p>
                          </div>
                          <div className={`p-2.5 rounded-lg col-span-2 sm:col-span-3 ${statement.summary.closingBalance > 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-green-50 dark:bg-green-950/20"}`}>
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-xs text-muted-foreground">Closing Balance</p>
                                <p className={`font-bold text-base ${statement.summary.closingBalance > 0 ? "text-red-600" : "text-green-600"}`}>
                                  {statement.summary.closingBalance === 0 ? "Settled — no balance due" : `${fmt(Math.abs(statement.summary.closingBalance))}${statement.summary.closingBalance < 0 ? " CR" : " outstanding"}`}
                                </p>
                              </div>
                              <div className="text-right text-xs text-muted-foreground">
                                <p>{statement.summary.orderCount} order{statement.summary.orderCount !== 1 ? "s" : ""}{statement.summary.cancelledOrderCount > 0 ? ` · ${statement.summary.cancelledOrderCount} cancelled` : ""}</p>
                                <p>{new Date(statement.period.from).toLocaleDateString("en-NG", { day: "2-digit", month: "short" })} – {new Date(statement.period.to).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {statement.summary.closingBalance > 0 && statement.paymentDetails?.bankName && (
                          <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 text-sm space-y-1">
                            <p className="font-semibold text-blue-900 dark:text-blue-300">How to pay the balance</p>
                            <p className="text-blue-800 dark:text-blue-400">
                              {statement.paymentDetails.bankName}
                              {statement.paymentDetails.accountName ? ` · ${statement.paymentDetails.accountName}` : ""}
                              {statement.paymentDetails.accountNumber ? ` · ${statement.paymentDetails.accountNumber}` : ""}
                            </p>
                            {statement.paymentDetails.instructions && (
                              <p className="text-xs text-blue-700 dark:text-blue-400/80">{statement.paymentDetails.instructions}</p>
                            )}
                          </div>
                        )}

                        {/* Ledger table */}
                        {statement.entries.length === 0 ? (
                          <div className="py-6 text-center text-muted-foreground text-sm">No transactions in this period.</div>
                        ) : (
                          <div className="border rounded-lg overflow-hidden">
                            <div className="overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/30">
                                    <TableHead className="text-xs">Date</TableHead>
                                    <TableHead className="text-xs">Order #</TableHead>
                                    <TableHead className="text-xs">Type</TableHead>
                                    <TableHead className="text-xs">Description</TableHead>
                                    <TableHead className="text-xs text-right">Charge</TableHead>
                                    <TableHead className="text-xs text-right">Credit</TableHead>
                                    <TableHead className="text-xs text-right">Balance</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {/* Opening balance row */}
                                  {statement.openingBalance !== 0 && (
                                    <TableRow className="bg-blue-50/50 dark:bg-blue-950/10">
                                      <TableCell className="text-xs text-muted-foreground" colSpan={3}>
                                        <span className="italic">Opening balance (b/f)</span>
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground" colSpan={3} />
                                      <TableCell className="text-xs text-right tabular-nums font-medium">
                                        <span className={statement.openingBalance > 0 ? "text-amber-600" : "text-green-600"}>
                                          {fmt(Math.abs(statement.openingBalance))}{statement.openingBalance < 0 ? " CR" : ""}
                                        </span>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                  {statement.entries.map((e, i) => (
                                    <TableRow
                                      key={i}
                                      className={
                                        e.type === "pickup" || e.type === "cancelled"
                                          ? "opacity-60"
                                          : ""
                                      }
                                    >
                                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                        {new Date(e.date).toLocaleDateString("en-NG", { day: "2-digit", month: "short" })}
                                      </TableCell>
                                      <TableCell className="font-mono text-xs text-primary">
                                        <Link to={`/orders/${e.orderDbId}`} className="hover:underline" onClick={closeProfile}>{e.orderId}</Link>
                                      </TableCell>
                                      <TableCell className="text-xs">
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                          e.type === "payment"      ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" :
                                          e.type === "order"        ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" :
                                          e.type === "discount"     ? "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400" :
                                          e.type === "extra_charge" ? "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400" :
                                          e.type === "cancelled"    ? "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400 line-through" :
                                          "bg-muted text-muted-foreground"
                                        }`}>
                                          {e.type === "extra_charge" ? "extra" : e.type}
                                        </span>
                                      </TableCell>
                                      <TableCell className="text-xs max-w-[140px] truncate" title={e.description}>{e.description}</TableCell>
                                      <TableCell className="text-xs text-right tabular-nums">
                                        {e.charge > 0 ? <span className="text-red-600">{fmt(e.charge)}</span> : ""}
                                      </TableCell>
                                      <TableCell className="text-xs text-right tabular-nums">
                                        {e.credit > 0 ? <span className="text-green-600">{fmt(e.credit)}</span> : ""}
                                      </TableCell>
                                      <TableCell className="text-xs text-right tabular-nums font-medium">
                                        {e.type === "pickup" || e.type === "cancelled" ? (
                                          <span className="text-muted-foreground text-xs">—</span>
                                        ) : (
                                          <span className={e.balance > 0 ? "text-red-600" : "text-green-600"}>
                                            {fmt(Math.abs(e.balance))}{e.balance < 0 ? " CR" : ""}
                                          </span>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Profile Footer */}
              <div className="flex justify-between items-center px-5 py-3 border-t bg-muted/10">
                {isOwner && !profile.deletedAt ? (
                  <Button
                    variant="ghost" size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setShowDelete(true)}
                  >
                    <Archive className="h-3.5 w-3.5 mr-1" />Archive Customer
                  </Button>
                ) : <span />}
                <p className="text-xs text-muted-foreground">
                  ID #{profile.id} · Last active: {timeAgo(profile.lastActivityAt)}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Create Dialog ───────────────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Customer</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Full Name *</Label>
              <Input value={createForm.fullName} onChange={e => setCreateForm({ ...createForm, fullName: e.target.value })} placeholder="Customer name" />
            </div>
            <div>
              <Label>Phone *</Label>
              <Input value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} placeholder="+234…" />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={createForm.address ?? ""} onChange={e => setCreateForm({ ...createForm, address: e.target.value })} placeholder="Optional" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={createForm.notes ?? ""}
                onChange={e => setCreateForm({ ...createForm, notes: e.target.value })}
                placeholder='Preferences, delivery instructions, fabric warnings…'
                className="resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!createForm.fullName || !createForm.phone) { toast.error("Name and phone are required"); return; }
                createMutation.mutate(createForm);
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ─────────────────────────────────────────────────────────── */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Customer</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Full Name</Label>
              <Input value={editForm.fullName ?? ""} onChange={e => setEditForm({ ...editForm, fullName: e.target.value })} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={editForm.phone ?? ""} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={editForm.address ?? ""} onChange={e => setEditForm({ ...editForm, address: e.target.value })} placeholder="Optional" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={editForm.notes ?? ""}
                onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                placeholder='Clothing preferences, delivery instructions, warnings…'
                className="resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const { id, ...data } = editForm;
                if (!id) return;
                updateMutation.mutate({ id, data });
              }}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Archive Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Archive Customer</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Archive <strong>{profile?.fullName}</strong>? Their orders and payment history are preserved. You can restore them later.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { if (selectedId) deleteMutation.mutate(selectedId); }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Archiving…" : "Archive Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
