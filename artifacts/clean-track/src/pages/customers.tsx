import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/auth-context";
import { api, type CustomerWithMetrics, type CustomerProfile, type CustomerInput, type CustomerUpdateInput, type CustomerStatement } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReceiptView } from "@/components/receipt-view";
import {
  Users, Search, Plus, Eye, Phone, AlertTriangle,
  ShoppingBag, Crown, RefreshCw, ArrowRight, Pencil, Trash2, CheckCircle,
  Printer, FileText, Calendar, TrendingDown, TrendingUp, Download,
} from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/context/branch-context";

function fmt(v: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(v);
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function statusBadge(status: string) {
  const map: Record<string, any> = {
    pending: "warning", processing: "info", ready: "success",
    partial_pickup: "warning", completed: "success",
  };
  const label: Record<string, string> = { partial_pickup: "Partial Pickup" };
  return <Badge variant={map[status] || "outline"} className="text-xs">{label[status] ?? status}</Badge>;
}

function CustomerTags({ c }: { c: CustomerWithMetrics }) {
  return (
    <div className="flex flex-wrap gap-1">
      {c.isVip && <Badge variant="warning" className="text-xs gap-1"><Crown className="h-2.5 w-2.5" />VIP</Badge>}
      {c.isRepeat && <Badge variant="info" className="text-xs gap-1"><RefreshCw className="h-2.5 w-2.5" />Repeat</Badge>}
      {c.hasBalance && <Badge variant="destructive" className="text-xs gap-1"><AlertTriangle className="h-2.5 w-2.5" />Balance</Badge>}
      {c.hasRemainingPickups && <Badge variant="outline" className="text-xs gap-1"><ShoppingBag className="h-2.5 w-2.5" />Pickups</Badge>}
    </div>
  );
}

export default function Customers() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isOwner } = useAuth();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [createForm, setCreateForm] = useState<CustomerInput>({ fullName: "", phone: "" });
  const [editForm, setEditForm] = useState<CustomerUpdateInput & { id?: number }>({});
  const [profileTab, setProfileTab] = useState<"orders" | "receipts" | "statement">("orders");
  const [statementPeriod, setStatementPeriod] = useState<"30d" | "90d" | "custom">("90d");
  const [statementFrom, setStatementFrom] = useState<string>("");
  const [statementTo, setStatementTo] = useState<string>("");

  const { activeBranchId } = useBranch();

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers", search, tag, activeBranchId],
    queryFn: () => api.customers.list({
      search: search || undefined,
      tag: tag !== "all" ? tag : undefined,
      branchId: activeBranchId,
    }),
  });

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["customers", selectedId],
    queryFn: () => api.customers.get(selectedId!),
    enabled: selectedId != null,
  });

  const { data: customerReceiptsData, isLoading: receiptsLoading } = useQuery({
    queryKey: ["customerReceipts", profile?.id],
    queryFn: () => api.receipts.getCustomerReceipts(profile!.id),
    enabled: profile != null && profileTab === "receipts",
  });

  const stmtParams = (() => {
    if (statementPeriod === "30d") {
      const from = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
      return { from, to: new Date().toISOString().split("T")[0] };
    }
    if (statementPeriod === "90d") {
      const from = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
      return { from, to: new Date().toISOString().split("T")[0] };
    }
    return { from: statementFrom || undefined, to: statementTo || undefined };
  })();

  const { data: statement, isLoading: stmtLoading } = useQuery({
    queryKey: ["customerStatement", profile?.id, stmtParams.from, stmtParams.to],
    queryFn: () => api.customers.statement(profile!.id, stmtParams),
    enabled: profile != null && profileTab === "statement",
  });

  const backfillMutation = useMutation({
    mutationFn: () => api.customers.backfill(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success(r.message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMutation = useMutation({
    mutationFn: (data: CustomerInput) => api.customers.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      setShowCreate(false);
      setCreateForm({ fullName: "", phone: "" });
      toast.success("Customer created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerUpdateInput }) => api.customers.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customers", editForm.id] });
      setShowEdit(false);
      toast.success("Customer updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.customers.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      setSelectedId(null);
      setShowDelete(false);
      toast.success("Customer deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totals = {
    total: customers.length,
    withBalance: customers.filter(c => c.hasBalance).length,
    withPickups: customers.filter(c => c.hasRemainingPickups).length,
    vip: customers.filter(c => c.isVip).length,
  };

  const currentCustomer = customers.find(c => c.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" /> Customers
        </h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            title="Link existing orders to customer profiles"
          >
            <RefreshCw className={`h-4 w-4 ${backfillMutation.isPending ? "animate-spin" : ""}`} />
            Sync Orders
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New Customer
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setTag("all")}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Customers</p>
            <p className="text-2xl font-bold">{totals.total}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setTag("has_balance")}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">With Balance</p>
            <p className="text-2xl font-bold text-red-600">{totals.withBalance}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setTag("has_pickups")}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Remaining Pickups</p>
            <p className="text-2xl font-bold text-orange-600">{totals.withPickups}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setTag("vip")}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">VIP Customers</p>
            <p className="text-2xl font-bold text-yellow-600">{totals.vip}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Tabs value={tag} onValueChange={setTag}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="has_balance">Balance</TabsTrigger>
                <TabsTrigger value="has_pickups">Pickups</TabsTrigger>
                <TabsTrigger value="vip">VIP</TabsTrigger>
                <TabsTrigger value="repeat">Repeat</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{customers.length} customer{customers.length !== 1 ? "s" : ""}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading customers...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Total Spent</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Last Order</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedId(c.id)}>
                    <TableCell className="font-medium">{c.fullName}</TableCell>
                    <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                    <TableCell>
                      <span className="font-medium">{c.totalOrders}</span>
                      {c.activeOrders > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">({c.activeOrders} active)</span>
                      )}
                    </TableCell>
                    <TableCell>{fmt(c.totalSpending)}</TableCell>
                    <TableCell>
                      {c.outstandingBalance > 0 ? (
                        <span className="text-red-600 font-medium">{fmt(c.outstandingBalance)}</span>
                      ) : (
                        <span className="text-green-600 text-xs">Clear</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.remainingItems > 0 ? (
                        <span className="text-orange-600 font-medium">{c.remainingItems} item{c.remainingItems !== 1 ? "s" : ""}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.lastOrderDate ? timeAgo(c.lastOrderDate) : "—"}
                    </TableCell>
                    <TableCell><CustomerTags c={c} /></TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" onClick={() => setSelectedId(c.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!customers.length && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                      {search ? "No customers match your search" : "No customers yet. Click \"Sync Orders\" to import from existing orders."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={selectedId != null} onOpenChange={(open) => { if (!open) { setSelectedId(null); setProfileTab("orders"); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {profileLoading || !profile ? (
            <div className="p-8 text-center text-muted-foreground">Loading profile...</div>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <DialogTitle className="text-xl flex items-center gap-2">
                      {profile.isVip && <Crown className="h-5 w-5 text-yellow-500" />}
                      {profile.fullName}
                    </DialogTitle>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <a
                        href={`tel:${profile.phone}`}
                        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {profile.phone}
                      </a>
                      {profile.address && (
                        <span className="text-sm text-muted-foreground">· {profile.address}</span>
                      )}
                    </div>
                    <div className="mt-1.5">
                      <CustomerTags c={profile} />
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {isOwner && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditForm({
                            id: profile.id,
                            fullName: profile.fullName,
                            phone: profile.phone,
                            address: profile.address ?? "",
                            notes: profile.notes ?? "",
                          });
                          setShowEdit(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedId(null);
                        navigate(`/orders?phone=${encodeURIComponent(profile.phone)}`);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New Order
                    </Button>
                  </div>
                </div>
              </DialogHeader>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                <div className="p-3 bg-muted/50 rounded-lg text-center">
                  <p className="text-2xl font-bold">{profile.totalOrders}</p>
                  <p className="text-xs text-muted-foreground">Total Orders</p>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-center">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">{fmt(profile.totalSpending)}</p>
                  <p className="text-xs text-muted-foreground">Total Spent</p>
                </div>
                <div className={`p-3 rounded-lg text-center ${profile.outstandingBalance > 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-muted/50"}`}>
                  <p className={`text-2xl font-bold ${profile.outstandingBalance > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                    {fmt(profile.outstandingBalance)}
                  </p>
                  <p className="text-xs text-muted-foreground">Outstanding</p>
                </div>
                <div className={`p-3 rounded-lg text-center ${profile.remainingItems > 0 ? "bg-orange-50 dark:bg-orange-950/20" : "bg-muted/50"}`}>
                  <p className={`text-2xl font-bold ${profile.remainingItems > 0 ? "text-orange-600" : "text-muted-foreground"}`}>
                    {profile.remainingItems}
                  </p>
                  <p className="text-xs text-muted-foreground">Items Remaining</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="p-2.5 bg-muted/30 rounded-lg">
                  <p className="text-muted-foreground text-xs">Avg Order</p>
                  <p className="font-medium">{fmt(profile.avgOrderValue)}</p>
                </div>
                <div className="p-2.5 bg-muted/30 rounded-lg">
                  <p className="text-muted-foreground text-xs">Completed</p>
                  <p className="font-medium">{profile.completedOrders} / {profile.totalOrders}</p>
                </div>
                <div className="p-2.5 bg-muted/30 rounded-lg">
                  <p className="text-muted-foreground text-xs">Customer Since</p>
                  <p className="font-medium">{new Date(profile.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              {profile.notes && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-400 text-xs mb-1">Notes</p>
                  <p className="text-amber-900 dark:text-amber-300">{profile.notes}</p>
                </div>
              )}

              <Tabs value={profileTab} onValueChange={(v) => setProfileTab(v as "orders" | "receipts" | "statement")}>
                <TabsList className="w-full">
                  <TabsTrigger value="orders" className="flex-1 gap-1.5">
                    <ShoppingBag className="h-3.5 w-3.5" />
                    Orders ({profile.orders.length})
                  </TabsTrigger>
                  <TabsTrigger value="receipts" className="flex-1 gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Receipts
                  </TabsTrigger>
                  <TabsTrigger value="statement" className="flex-1 gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Statement
                  </TabsTrigger>
                </TabsList>

                {/* Orders Tab */}
                <div className={profileTab === "orders" ? "mt-3" : "hidden"}>
                  {profile.orders.length > 0 ? (
                    <div>
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Order ID</TableHead>
                              <TableHead className="text-xs">Service</TableHead>
                              <TableHead className="text-xs">Items</TableHead>
                              <TableHead className="text-xs">Status</TableHead>
                              <TableHead className="text-xs">Price</TableHead>
                              <TableHead className="text-xs">Balance</TableHead>
                              <TableHead className="text-xs">Date</TableHead>
                              <TableHead className="text-xs"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {profile.orders.slice(0, 10).map((o) => {
                              const totalDue = (Number(o.price) || 0) + (Number(o.extraCharge) || 0) - (Number(o.discount) || 0);
                              const balance = Math.max(0, totalDue - Number(o.amountPaid || 0));
                              const remainingS = Math.max(0, o.shirts - (o.shirtsPickedUp || 0));
                              const remainingT = Math.max(0, o.trousers - (o.trousersPickedUp || 0));
                              return (
                                <TableRow key={o.id}>
                                  <TableCell className="font-mono text-xs">{o.orderId}</TableCell>
                                  <TableCell className="text-xs capitalize">{o.serviceType}</TableCell>
                                  <TableCell className="text-xs">
                                    {o.shirts}S / {o.trousers}T
                                    {(remainingS > 0 || remainingT > 0) && (
                                      <span className="text-orange-500 ml-1">({remainingS}S/{remainingT}T left)</span>
                                    )}
                                  </TableCell>
                                  <TableCell>{statusBadge(o.status)}</TableCell>
                                  <TableCell className="text-xs">{fmt(totalDue)}</TableCell>
                                  <TableCell className="text-xs">
                                    {balance > 0 ? (
                                      <span className="text-red-600">{fmt(balance)}</span>
                                    ) : (
                                      <span className="text-green-600 flex items-center gap-0.5">
                                        <CheckCircle className="h-3 w-3" />Paid
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {new Date(o.createdAt).toLocaleDateString()}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      asChild
                                      onClick={() => setSelectedId(null)}
                                    >
                                      <Link to={`/orders/${o.id}`}>
                                        <ArrowRight className="h-3.5 w-3.5" />
                                      </Link>
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                      {profile.orders.length > 10 && (
                        <p className="text-xs text-muted-foreground text-center mt-2">
                          Showing 10 of {profile.orders.length} orders
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                      No orders linked to this customer yet
                    </div>
                  )}
                </div>

                {/* Statement Tab */}
                <div className={profileTab === "statement" ? "mt-3 space-y-3" : "hidden"}>
                  {/* Period selector */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-md border overflow-hidden text-xs">
                      {(["30d", "90d", "custom"] as const).map(p => (
                        <button
                          key={p}
                          onClick={() => setStatementPeriod(p)}
                          className={`px-3 py-1.5 font-medium transition-colors ${statementPeriod === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                        >
                          {p === "30d" ? "30 Days" : p === "90d" ? "90 Days" : "Custom"}
                        </button>
                      ))}
                    </div>
                    {statementPeriod === "custom" && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Input
                          type="date"
                          className="h-7 text-xs w-36"
                          value={statementFrom}
                          onChange={e => setStatementFrom(e.target.value)}
                        />
                        <span className="text-muted-foreground">to</span>
                        <Input
                          type="date"
                          className="h-7 text-xs w-36"
                          value={statementTo}
                          onChange={e => setStatementTo(e.target.value)}
                        />
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 text-xs gap-1"
                      onClick={() => {
                        const printWindow = window.open("", "_blank");
                        if (!printWindow || !statement) return;
                        const rows = statement.entries.map(e => `
                          <tr>
                            <td>${new Date(e.date).toLocaleDateString("en-NG")}</td>
                            <td>${e.orderId}</td>
                            <td>${e.type.replace("_", " ")}</td>
                            <td>${e.description}</td>
                            <td style="text-align:right">${e.charge > 0 ? e.charge.toLocaleString("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }) : ""}</td>
                            <td style="text-align:right">${e.credit > 0 ? e.credit.toLocaleString("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }) : ""}</td>
                            <td style="text-align:right;${e.balance > 0 ? "color:#dc2626" : "color:#16a34a"}">${e.balance.toLocaleString("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 })}</td>
                          </tr>`).join("");
                        printWindow.document.write(`<!DOCTYPE html><html><head><title>Statement — ${statement.customer.fullName}</title>
                        <style>body{font-family:sans-serif;font-size:12px;padding:20px}h1{font-size:18px;margin-bottom:4px}p{color:#666;margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left}th{background:#f9fafb;font-weight:600}tfoot td{font-weight:700;background:#f3f4f6}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px}</style>
                        </head><body>
                        <h1>Customer Statement</h1>
                        <p><strong>${statement.customer.fullName}</strong> · ${statement.customer.phone}</p>
                        <p>Period: ${new Date(statement.period.from).toLocaleDateString("en-NG")} – ${new Date(statement.period.to).toLocaleDateString("en-NG")}</p>
                        <table><thead><tr><th>Date</th><th>Order</th><th>Type</th><th>Description</th><th>Charges</th><th>Credits</th><th>Balance</th></tr></thead>
                        <tbody>${rows}</tbody>
                        <tfoot><tr><td colspan="4">Summary</td><td style="text-align:right">${statement.summary.totalCharged.toLocaleString("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 })}</td><td style="text-align:right">${statement.summary.totalPaid.toLocaleString("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 })}</td><td style="text-align:right;${statement.summary.closingBalance > 0 ? "color:#dc2626" : "color:#16a34a"}">${statement.summary.closingBalance.toLocaleString("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 })}</td></tr></tfoot>
                        </table></body></html>`);
                        printWindow.document.close();
                        printWindow.print();
                      }}
                      disabled={!statement}
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Print / PDF
                    </Button>
                  </div>

                  {stmtLoading ? (
                    <div className="py-8 text-center text-muted-foreground text-sm">Loading statement…</div>
                  ) : !statement ? (
                    <div className="py-8 text-center text-muted-foreground text-sm">Select a period to view the statement</div>
                  ) : (
                    <div className="space-y-3">
                      {/* Summary cards */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2.5 bg-muted/30 rounded-lg text-center">
                          <p className="text-xs text-muted-foreground">Total Charged</p>
                          <p className="font-semibold text-sm">{fmt(statement.summary.totalCharged)}</p>
                        </div>
                        <div className="p-2.5 bg-green-50 dark:bg-green-950/20 rounded-lg text-center">
                          <p className="text-xs text-muted-foreground">Total Paid</p>
                          <p className="font-semibold text-sm text-green-700 dark:text-green-400">{fmt(statement.summary.totalPaid)}</p>
                        </div>
                        <div className={`p-2.5 rounded-lg text-center ${statement.summary.closingBalance > 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-green-50 dark:bg-green-950/20"}`}>
                          <p className="text-xs text-muted-foreground">Balance Due</p>
                          <p className={`font-semibold text-sm ${statement.summary.closingBalance > 0 ? "text-red-600" : "text-green-600"}`}>
                            {fmt(statement.summary.closingBalance)}
                          </p>
                        </div>
                      </div>

                      {statement.entries.length === 0 ? (
                        <div className="py-6 text-center text-muted-foreground text-sm">No activity in this period</div>
                      ) : (
                        <div className="border rounded-lg overflow-hidden">
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-muted/30">
                                  <TableHead className="text-xs">Date</TableHead>
                                  <TableHead className="text-xs">Order</TableHead>
                                  <TableHead className="text-xs">Type</TableHead>
                                  <TableHead className="text-xs">Description</TableHead>
                                  <TableHead className="text-xs text-right">Charge</TableHead>
                                  <TableHead className="text-xs text-right">Credit</TableHead>
                                  <TableHead className="text-xs text-right">Balance</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {statement.entries.map((e, i) => (
                                  <TableRow key={i} className={e.type === "pickup" ? "opacity-60" : ""}>
                                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                      {new Date(e.date).toLocaleDateString("en-NG", { day: "2-digit", month: "short" })}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-primary">
                                      <Link to={`/orders/${e.orderDbId}`} className="hover:underline" onClick={() => setSelectedId(null)}>
                                        {e.orderId}
                                      </Link>
                                    </TableCell>
                                    <TableCell className="text-xs">
                                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                                        e.type === "payment" ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" :
                                        e.type === "order" ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" :
                                        e.type === "discount" ? "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400" :
                                        e.type === "extra_charge" ? "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400" :
                                        "bg-muted text-muted-foreground"
                                      }`}>
                                        {e.type === "extra_charge" ? "extra" : e.type}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-xs max-w-[140px] truncate" title={e.description}>
                                      {e.description}
                                      {e.receiptNumber && (
                                        <button
                                          className="ml-1.5 text-primary hover:underline"
                                          onClick={() => window.open(`/receipts/${encodeURIComponent(e.receiptNumber!)}/print`, "_blank")}
                                          title="View receipt"
                                        >
                                          <Eye className="h-3 w-3 inline" />
                                        </button>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-xs text-right tabular-nums">
                                      {e.charge > 0 ? <span className="text-red-600">{fmt(e.charge)}</span> : ""}
                                    </TableCell>
                                    <TableCell className="text-xs text-right tabular-nums">
                                      {e.credit > 0 ? <span className="text-green-600">{fmt(e.credit)}</span> : ""}
                                    </TableCell>
                                    <TableCell className="text-xs text-right tabular-nums font-medium">
                                      <span className={e.balance > 0 ? "text-red-600" : "text-green-600"}>
                                        {fmt(Math.abs(e.balance))}
                                        {e.balance < 0 ? " CR" : ""}
                                      </span>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground text-right">
                        {statement.summary.orderCount} orders · {statement.summary.paymentCount} payments
                      </p>
                    </div>
                  )}
                </div>

                {/* Receipts Tab — all authenticated users (workers via customer profile, owners via /receipts page) */}
                <div className={profileTab === "receipts" ? "mt-3" : "hidden"}>
                    {receiptsLoading ? (
                      <div className="py-8 text-center text-muted-foreground text-sm">Loading receipts…</div>
                    ) : !customerReceiptsData?.receipts?.length ? (
                      <div className="py-8 text-center text-muted-foreground text-sm">
                        No receipts found for this customer
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="border rounded-lg overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Receipt #</TableHead>
                                <TableHead className="text-xs">Order</TableHead>
                                <TableHead className="text-xs">Amount</TableHead>
                                <TableHead className="text-xs">Method</TableHead>
                                <TableHead className="text-xs">Date</TableHead>
                                <TableHead className="text-xs"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {customerReceiptsData.receipts.map((r) => (
                                <TableRow key={r.receiptNumber}>
                                  <TableCell className="font-mono text-xs text-primary">{r.receiptNumber}</TableCell>
                                  <TableCell className="font-mono text-xs">{r.orderId}</TableCell>
                                  <TableCell className="text-xs font-semibold">{fmt(Number(r.amount))}</TableCell>
                                  <TableCell className="text-xs capitalize">{r.method.replace("_", " ")}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {new Date(r.recordedAt).toLocaleDateString()}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-1">
                                      {r.receiptNumber && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          title="View receipt"
                                          onClick={() => window.open(`/receipts/${encodeURIComponent(r.receiptNumber!)}/print`, "_blank")}
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                        </Button>
                                      )}
                                      {r.receiptNumber && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          title="Print / Download PDF"
                                          onClick={() => window.open(`/receipts/${encodeURIComponent(r.receiptNumber!)}/print`, "_blank")}
                                        >
                                          <Printer className="h-3.5 w-3.5" />
                                        </Button>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        {customerReceiptsData.total > 50 && (
                          <p className="text-xs text-muted-foreground text-center">
                            Showing 50 of {customerReceiptsData.total} receipts
                          </p>
                        )}
                      </div>
                    )}
                  </div>
              </Tabs>

              <div className="flex justify-between items-center pt-2 border-t">
                {isOwner ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setShowDelete(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete Customer
                  </Button>
                ) : (
                  <span />
                )}
                <p className="text-xs text-muted-foreground">
                  Last active: {timeAgo(profile.lastActivityAt)}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Customer</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Full Name *</Label>
              <Input
                value={createForm.fullName}
                onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
                placeholder="Customer name"
              />
            </div>
            <div>
              <Label>Phone *</Label>
              <Input
                value={createForm.phone}
                onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                placeholder="+234..."
              />
            </div>
            <div>
              <Label>Address</Label>
              <Input
                value={createForm.address ?? ""}
                onChange={(e) => setCreateForm({ ...createForm, address: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={createForm.notes ?? ""}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                placeholder="Preferences, instructions, fabric warnings..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!createForm.fullName || !createForm.phone) {
                  toast.error("Name and phone are required");
                  return;
                }
                createMutation.mutate(createForm);
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Customer</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Full Name</Label>
              <Input
                value={editForm.fullName ?? ""}
                onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={editForm.phone ?? ""}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
              />
            </div>
            <div>
              <Label>Address</Label>
              <Input
                value={editForm.address ?? ""}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={editForm.notes ?? ""}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                placeholder="Clothing preferences, delivery instructions, warnings..."
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
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Customer</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <strong>{currentCustomer?.fullName || profile?.fullName}</strong>? Their orders will remain but will no longer be linked to a customer profile.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                const id = selectedId ?? editForm.id;
                if (id) deleteMutation.mutate(id);
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
