import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/context/auth-context";
import { CheckCircle, Eye, AlertTriangle, Clock, Zap, ChevronDown, ChevronUp, Plus, ShieldOff, CreditCard } from "lucide-react";
import { Link } from "react-router-dom";
import { PaymentStatusBadge } from "@/lib/order-status";
import { toast } from "sonner";
import { CreateOrderDialog } from "@/components/create-order-dialog";
import { VerifyOrderDialog } from "@/components/verify-order-dialog";
import { CountdownTimer } from "@/components/countdown-timer";
import { computeDueAt, getUrgency, type UrgencyInfo } from "@/lib/urgency";
import { cn } from "@/lib/utils";
import { enqueueOrderStatusUpdate } from "@/lib/queue-service";
import { getIsOnline } from "@/lib/network-state";
import type { WorkerPermissions } from "@/context/auth-context";

function NoPermissionsScreen({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="rounded-full bg-muted p-6 mb-6"><ShieldOff className="h-12 w-12 text-muted-foreground" /></div>
      <h1 className="text-2xl font-bold mb-2">No Permissions Assigned</h1>
      <p className="text-muted-foreground mb-1 font-medium">Welcome, {name}</p>
      <p className="text-muted-foreground max-w-sm mt-3">
        Your account is active but your owner has not assigned any work permissions yet.
      </p>
    </div>
  );
}

function OrderSection({
  title,
  orders,
  icon: Icon,
  headerClass,
  iconClass,
  userId,
  onClaim,
  onVerify,
  onReady,
  onOpenVerify,
  sla,
  isPending,
}: {
  title: string;
  orders: any[];
  icon: any;
  headerClass: string;
  iconClass: string;
  userId?: number;
  onClaim: (id: number) => void;
  onVerify: (order: any) => void;
  onReady: (id: number) => void;
  onOpenVerify: (order: any) => void;
  sla: any;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(true);
  if (!orders.length) return null;

  return (
    <div className="rounded-xl border overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className={cn("w-full flex items-center justify-between px-4 py-3 font-semibold text-sm", headerClass)}>
        <span className="flex items-center gap-2"><Icon className={cn("h-4 w-4", iconClass)} />{title}<span className="px-1.5 py-0.5 rounded-full bg-black/10 text-xs">{orders.length}</span></span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="divide-y">
          {orders.map(order => {
            const urg = order._urgency as UrgencyInfo;
            const assignedToMe = order.assignedWorkerId === userId;
            const unassigned = !order.assignedWorkerId;
            const canVerify = assignedToMe && !order.isVerified && ["pending", "processing"].includes(order.status);
            const canReady = assignedToMe && order.status === "processing" && order.isVerified;

            return (
              <div key={order.id} className={cn("p-4 flex flex-col sm:flex-row sm:items-center gap-3", urg.rowClass)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{order.customerName}</span>
                    <span className="font-mono text-xs text-muted-foreground">{order.orderId}</span>
                    <Badge variant={order.serviceType === "express" ? "warning" : order.serviceType === "premium" ? "info" : "outline"} className="text-xs capitalize">{order.serviceType}</Badge>
                    {order.paymentStatus && order.paymentStatus !== "paid" && <PaymentStatusBadge status={order.paymentStatus} />}
                    {order.isVerified && <Badge variant="success" className="text-xs">Verified</Badge>}
                    {order.assignedWorkerId && !assignedToMe && <Badge variant="outline" className="text-xs">Assigned</Badge>}
                  </div>

                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-sm text-muted-foreground">
                      {(order.itemCount ?? 0) > 0
                        ? order.itemSummary ?? `${order.itemCount} item${order.itemCount !== 1 ? "s" : ""}`
                        : `${order.shirts}S / ${order.trousers}T`}
                    </span>
                    {order.branchName && <span className="text-xs text-muted-foreground">· {order.branchName}</span>}
                    <CountdownTimer createdAt={order.createdAt} serviceType={order.serviceType} processingDueAt={order.processingDueAt} status={order.status} slaSettings={sla} />
                  </div>

                  {order.additionalNotes && <p className="text-xs text-muted-foreground mt-1 italic">"{order.additionalNotes}"</p>}
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2.5" asChild>
                    <Link to={`/orders/${order.id}`}><Eye className="h-3.5 w-3.5" /><span className="hidden sm:inline text-xs">Details</span></Link>
                  </Button>

                  {unassigned && ["pending", "processing"].includes(order.status) && (
                    <Button size="sm" variant="outline" onClick={() => onClaim(order.id)} disabled={isPending}>Claim</Button>
                  )}

                  {canVerify && (
                    <Button size="sm" variant="outline" onClick={() => onOpenVerify(order)} disabled={isPending}>
                      <CheckCircle className="h-3.5 w-3.5 mr-1" />Verify
                    </Button>
                  )}

                  {canReady && (
                    <Button size="sm" onClick={() => onReady(order.id)} disabled={isPending}>Mark Ready</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function WorkerStation() {
  usePageTitle("Worker Station");
  const { user } = useAuth();
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();
  const [, setTick] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [verificationOrder, setVerificationOrder] = useState<any | null>(null);

  const hasAnyPermission =
    user?.type === "owner" ||
    (user?.permissions != null && Object.values(user.permissions as WorkerPermissions).some(Boolean));

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data: rawOrders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.orders.list(),
    refetchInterval: 30_000,
  });

  const { data: sla } = useQuery({
    queryKey: ["settings", "sla"],
    queryFn: () => api.settings.getSla(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, any> }) => api.orders.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order updated");
    },
    onError: (e: Error) => toast.error("Could not update order — " + e.message),
  });

  const orders = rawOrders.map(o => ({
    ...o,
    _urgency: getUrgency(computeDueAt(o.createdAt, o.serviceType, sla, o.processingDueAt)),
  }));

  const activeOrders = orders.filter(o => ["pending", "processing"].includes(o.status));
  const myOrders = activeOrders.filter(o => o.assignedWorkerId === user?.id);
  const availableOrders = activeOrders.filter(o => !o.assignedWorkerId);
  const readyOrders = orders.filter(o => ["ready", "partial_pickup"].includes(o.status));

  const sortByUrgency = (items: any[]) =>
    [...items].sort((a, b) => a._urgency.hoursRemaining - b._urgency.hoursRemaining);

  const myOverdue = sortByUrgency(myOrders.filter(o => o._urgency.level === "overdue"));
  const myUrgent = sortByUrgency(myOrders.filter(o => o._urgency.level === "urgent"));
  const myNormal = sortByUrgency(myOrders.filter(o => !["overdue", "urgent"].includes(o._urgency.level)));

  const availableOverdue = sortByUrgency(availableOrders.filter(o => o._urgency.level === "overdue"));
  const availableUrgent = sortByUrgency(availableOrders.filter(o => o._urgency.level === "urgent"));
  const availableNormal = sortByUrgency(availableOrders.filter(o => !["overdue", "urgent"].includes(o._urgency.level)));

  const applyOrderUpdate = async (id: number, changes: Record<string, unknown>) => {
    if (getIsOnline()) {
      updateMutation.mutate({ id, data: changes });
      return;
    }
    try {
      await enqueueOrderStatusUpdate(`srv-${id}`, id, changes);
      qc.setQueryData(["orders"], (old: any[]) => old?.map(o => o.id === id ? { ...o, ...changes } : o) ?? []);
      toast.info("Saved offline — will sync when reconnected");
    } catch {
      toast.error("Failed to save offline");
    }
  };

  const claimOrder = (id: number) => applyOrderUpdate(id, { assignedWorkerId: user?.id });

  const markReady = (id: number) => applyOrderUpdate(id, { status: "ready" });

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayCount = orders.filter(o => new Date(o.createdAt) >= todayStart).length;
  const overdueTotal = orders.filter(o => o._urgency.level === "overdue" && !["completed"].includes(o.status)).length;
  const urgentTotal = orders.filter(o => o._urgency.level === "urgent" && !["completed"].includes(o.status)).length;
  const unpaidTotal = orders.filter(o => ["unpaid", "partial"].includes(o.paymentStatus) && !["completed"].includes(o.status)).length;

  if (user?.type === "worker" && !hasAnyPermission) {
    return <NoPermissionsScreen name={user.name} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Worker Station</h1>
          <p className="text-sm text-muted-foreground">
            {todayCount} order{todayCount !== 1 ? "s" : ""} today · <strong>{user?.name}</strong>
          </p>
        </div>
        {(user?.type === "owner" || user?.permissions?.canRecordPickups) && (
          <Button onClick={() => setShowCreate(true)} className="gap-2 shrink-0"><Plus className="h-4 w-4" />New Order</Button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Card><CardContent className="p-3 text-center"><p className={cn("text-xl font-bold", overdueTotal ? "text-red-600" : "text-muted-foreground")}>{overdueTotal}</p><p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><AlertTriangle className="h-3 w-3" />Overdue</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className={cn("text-xl font-bold", urgentTotal ? "text-orange-500" : "text-muted-foreground")}>{urgentTotal}</p><p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><Zap className="h-3 w-3" />Urgent</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold">{myOrders.length}</p><p className="text-xs text-muted-foreground">My Active</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold">{readyOrders.length}</p><p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><CheckCircle className="h-3 w-3" />Ready</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className={cn("text-xl font-bold", unpaidTotal ? "text-red-600" : "text-muted-foreground")}>{unpaidTotal}</p><p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><CreditCard className="h-3 w-3" />Unpaid</p></CardContent></Card>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" />My Orders ({myOrders.length})</h2>
        <OrderSection title="Overdue" orders={myOverdue} icon={AlertTriangle} iconClass="text-red-700" headerClass="bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400" userId={user?.id} onClaim={claimOrder} onVerify={() => {}} onReady={markReady} onOpenVerify={setVerificationOrder} sla={sla} isPending={updateMutation.isPending} />
        <OrderSection title="Urgent" orders={myUrgent} icon={Zap} iconClass="text-red-500" headerClass="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" userId={user?.id} onClaim={claimOrder} onVerify={() => {}} onReady={markReady} onOpenVerify={setVerificationOrder} sla={sla} isPending={updateMutation.isPending} />
        <OrderSection title="On Track" orders={myNormal} icon={CheckCircle} iconClass="text-green-600" headerClass="bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400" userId={user?.id} onClaim={claimOrder} onVerify={() => {}} onReady={markReady} onOpenVerify={setVerificationOrder} sla={sla} isPending={updateMutation.isPending} />
        {myOrders.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No orders assigned to you yet.</CardContent></Card>}
      </div>

      {availableOrders.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" />Available Orders ({availableOrders.length})</h2>
          <p className="text-xs text-muted-foreground">
            These are unassigned orders you are allowed to work on. There is no processing-branch or handoff queue — claim an order and work it through its normal status flow.
          </p>
          <OrderSection title="Overdue" orders={availableOverdue} icon={AlertTriangle} iconClass="text-red-700" headerClass="bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400" userId={user?.id} onClaim={claimOrder} onVerify={() => {}} onReady={markReady} onOpenVerify={setVerificationOrder} sla={sla} isPending={updateMutation.isPending} />
          <OrderSection title="Urgent" orders={availableUrgent} icon={Zap} iconClass="text-red-500" headerClass="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" userId={user?.id} onClaim={claimOrder} onVerify={() => {}} onReady={markReady} onOpenVerify={setVerificationOrder} sla={sla} isPending={updateMutation.isPending} />
          <OrderSection title="Queue" orders={availableNormal} icon={Clock} iconClass="text-muted-foreground" headerClass="bg-muted/50 text-foreground" userId={user?.id} onClaim={claimOrder} onVerify={() => {}} onReady={markReady} onOpenVerify={setVerificationOrder} sla={sla} isPending={updateMutation.isPending} />
        </div>
      )}

      {readyOrders.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-600" />For Pickup ({readyOrders.length})</h2>
          <div className="rounded-xl border divide-y">
            {readyOrders.map(order => (
              <div key={order.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{order.customerName} <span className="font-mono text-xs text-muted-foreground ml-1">{order.orderId}</span></p>
                  <p className="text-xs text-muted-foreground mt-1">{order.branchName ?? "Branch"} · {order.status === "partial_pickup" ? "Partial pickup" : "Ready"}</p>
                </div>
                <Button variant="ghost" size="sm" asChild><Link to={`/orders/${order.id}`}><Eye className="h-3.5 w-3.5 mr-1" />Details</Link></Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {orders.length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-30" /><p className="font-medium">No orders available</p><p className="text-sm mt-1">Orders you are allowed to access will appear here.</p></CardContent></Card>
      )}

      <CreateOrderDialog open={showCreate} onOpenChange={setShowCreate} />

      <VerifyOrderDialog
        order={verificationOrder}
        open={!!verificationOrder}
        onOpenChange={open => { if (!open) setVerificationOrder(null); }}
        onConfirm={data => {
          const next = { ...data, ...(verificationOrder?.status === "pending" ? { status: "processing" } : {}) };
          applyOrderUpdate(verificationOrder.id, next);
          setVerificationOrder(null);
        }}
        isPending={updateMutation.isPending}
      />
    </div>
  );
}
