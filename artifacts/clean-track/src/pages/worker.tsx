import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/auth-context";
import { useBranch } from "@/context/branch-context";
import { CheckCircle, Eye, AlertTriangle, Clock, Zap, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CreateOrderDialog } from "@/components/create-order-dialog";
import { CountdownTimer } from "@/components/countdown-timer";
import { computeDueAt, getUrgency, type UrgencyInfo } from "@/lib/urgency";
import { cn } from "@/lib/utils";
import { enqueueOrderStatusUpdate } from "@/lib/queue-service";
import { getIsOnline } from "@/lib/network-state";

type OrderWithUrgency = ReturnType<typeof useQuery<any[]>>["data"] extends Array<infer T> ? T & { _urgency: UrgencyInfo } : never;

function UrgencySection({
  title,
  orders,
  icon: Icon,
  iconClass,
  headerClass,
  onClaim,
  onVerify,
  onMarkReady,
  sla,
  userId,
  isPending,
  defaultOpen = true,
}: {
  title: string;
  orders: any[];
  icon: any;
  iconClass: string;
  headerClass: string;
  onClaim?: (id: number) => void;
  onVerify?: (id: number, o: any) => void;
  onMarkReady?: (id: number) => void;
  sla: any;
  userId?: number;
  isPending: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (orders.length === 0) return null;

  return (
    <div className="rounded-xl border overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn("w-full flex items-center justify-between px-4 py-3 font-semibold text-sm transition-colors", headerClass)}
      >
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", iconClass)} />
          <span>{title}</span>
          <span className="px-1.5 py-0.5 rounded-full bg-black/10 text-xs font-bold">{orders.length}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="divide-y">
          {orders.map((order) => {
            const urg = order._urgency as UrgencyInfo;
            return (
              <div key={order.id} className={cn("p-4 flex flex-col sm:flex-row sm:items-center gap-3", urg.rowClass)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{order.customerName}</span>
                    <span className="font-mono text-xs text-muted-foreground">{order.orderId}</span>
                    <Badge variant={order.serviceType === "express" ? "warning" : order.serviceType === "premium" ? "info" : "outline"} className="text-xs capitalize">
                      {order.serviceType}
                    </Badge>
                    {order.isVerified && (
                      <Badge variant="success" className="text-xs">Verified</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-sm text-muted-foreground">
                      {(order.itemCount ?? 0) > 0
                        ? order.itemSummary
                          ? order.itemSummary
                          : `${order.itemCount} item${order.itemCount !== 1 ? "s" : ""}`
                        : `${order.shirts}S / ${order.trousers}T`}
                    </span>
                    <CountdownTimer
                      createdAt={order.createdAt}
                      serviceType={order.serviceType}
                      processingDueAt={order.processingDueAt}
                      status={order.status}
                      slaSettings={sla}
                    />
                  </div>
                  {order.additionalNotes && (
                    <p className="text-xs text-muted-foreground mt-1 italic">"{order.additionalNotes}"</p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                    <Link to={`/orders/${order.id}`}><Eye className="h-4 w-4" /></Link>
                  </Button>
                  {order.status === "pending" && onClaim && (
                    <Button size="sm" variant="outline" onClick={() => onClaim(order.id)} disabled={isPending}>
                      Claim
                    </Button>
                  )}
                  {order.status === "processing" && !order.isVerified && onVerify && (
                    <Button size="sm" variant="outline" onClick={() => onVerify(order.id, order)} disabled={isPending}>
                      <CheckCircle className="h-3.5 w-3.5 mr-1" />
                      Verify
                    </Button>
                  )}
                  {order.status === "processing" && order.isVerified && onMarkReady && (
                    <Button size="sm" onClick={() => onMarkReady(order.id)} disabled={isPending}>
                      Mark Ready
                    </Button>
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
  const { user } = useAuth();
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();
  const [, setTick] = useState(0);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data: rawOrders = [] } = useQuery({
    queryKey: ["orders", activeBranchId],
    queryFn: () => api.orders.list(activeBranchId ? { branchId: String(activeBranchId) } : undefined),
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
    onError: (e: Error) => toast.error(e.message),
  });

  const orders = rawOrders.map(o => {
    const dueAt = computeDueAt(o.createdAt, o.serviceType, sla, o.processingDueAt);
    return { ...o, _urgency: getUrgency(dueAt) };
  });

  const activeOrders = orders.filter(o => !["completed", "ready"].includes(o.status));

  const myOrders = activeOrders.filter(o => o.assignedWorkerId === user?.id);
  const sharedQueue = orders.filter(o => o.status === "pending" && !o.assignedWorkerId);
  const readyOrders = orders.filter(o => o.status === "ready");

  const sortByUrgency = (arr: typeof orders) =>
    [...arr].sort((a, b) => a._urgency.hoursRemaining - b._urgency.hoursRemaining);

  const myOverdue = sortByUrgency(myOrders.filter(o => o._urgency.level === "overdue"));
  const myUrgent = sortByUrgency(myOrders.filter(o => o._urgency.level === "urgent"));
  const myAttention = sortByUrgency(myOrders.filter(o => o._urgency.level === "attention"));
  const mySafe = sortByUrgency(myOrders.filter(o => o._urgency.level === "safe"));

  const queueOverdue = sortByUrgency(sharedQueue.filter(o => o._urgency.level === "overdue"));
  const queueUrgent = sortByUrgency(sharedQueue.filter(o => o._urgency.level === "urgent"));
  const queueNormal = sortByUrgency(sharedQueue.filter(o => !["overdue", "urgent"].includes(o._urgency.level)));

  const applyOrderUpdate = async (id: number, changes: Record<string, unknown>) => {
    if (getIsOnline()) {
      updateMutation.mutate({ id, data: changes });
    } else {
      try {
        await enqueueOrderStatusUpdate(`srv-${id}`, id, changes);
        qc.setQueryData(
          ["orders", activeBranchId],
          (old: any[]) => old?.map(o => o.id === id ? { ...o, ...changes } : o) ?? []
        );
        toast.info("Saved offline — will sync when reconnected");
      } catch (err) {
        toast.error("Failed to save offline");
        console.error("[Worker] enqueueOrderStatusUpdate failed:", err);
      }
    }
  };

  const claimOrder = (id: number) =>
    applyOrderUpdate(id, { assignedWorkerId: user?.id, status: "processing" });

  const markVerified = (id: number, o: any) => {
    const isItemBased = (o.itemCount ?? 0) > 0;
    const verifyData: Record<string, unknown> = { isVerified: true };
    if (!isItemBased) {
      verifyData.verifiedShirts = o.shirts;
      verifyData.verifiedTrousers = o.trousers;
    }
    applyOrderUpdate(id, verifyData);
  };

  const markReady = (id: number) =>
    applyOrderUpdate(id, { status: "ready" });

  const overdueTotal = orders.filter(o => o._urgency.level === "overdue" && !["completed"].includes(o.status)).length;
  const urgentTotal = orders.filter(o => o._urgency.level === "urgent" && !["completed"].includes(o.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Worker Station</h1>
          <p className="text-sm text-muted-foreground">
            Logged in as <strong>{user?.name}</strong>
            {user?.role && <span className="ml-1 capitalize">({user.role})</span>}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          New Order
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className={cn(overdueTotal > 0 ? "border-red-300 dark:border-red-900" : "")}>
          <CardContent className="p-4 text-center">
            <p className={cn("text-2xl font-bold", overdueTotal > 0 ? "text-red-600" : "text-muted-foreground")}>{overdueTotal}</p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              {overdueTotal > 0 && <AlertTriangle className="h-3 w-3 text-red-500" />}
              Overdue
            </p>
          </CardContent>
        </Card>
        <Card className={cn(urgentTotal > 0 ? "border-red-200 dark:border-red-900" : "")}>
          <CardContent className="p-4 text-center">
            <p className={cn("text-2xl font-bold", urgentTotal > 0 ? "text-red-500" : "text-muted-foreground")}>{urgentTotal}</p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              {urgentTotal > 0 && <Zap className="h-3 w-3 text-red-400" />}
              Urgent
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{myOrders.length}</p>
            <p className="text-xs text-muted-foreground">My Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{readyOrders.length}</p>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <CheckCircle className="h-3 w-3" />
              Ready
            </p>
          </CardContent>
        </Card>
      </div>

      {overdueTotal > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800 dark:text-red-400 text-sm">
              {overdueTotal} order{overdueTotal > 1 ? "s" : ""} past deadline
            </p>
            <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
              These orders have exceeded the operational SLA. Prioritise them immediately.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="font-semibold text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          My Orders ({myOrders.length})
        </h2>

        {myOrders.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              No orders assigned to you. Pick from the shared queue below.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            <UrgencySection
              title="Overdue"
              orders={myOverdue}
              icon={AlertTriangle}
              iconClass="text-red-700"
              headerClass="bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-950/60"
              onVerify={markVerified}
              onMarkReady={markReady}
              sla={sla}
              userId={user?.id}
              isPending={updateMutation.isPending}
            />
            <UrgencySection
              title="Urgent — act now"
              orders={myUrgent}
              icon={Zap}
              iconClass="text-red-500"
              headerClass="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50"
              onVerify={markVerified}
              onMarkReady={markReady}
              sla={sla}
              userId={user?.id}
              isPending={updateMutation.isPending}
            />
            <UrgencySection
              title="Attention"
              orders={myAttention}
              icon={AlertTriangle}
              iconClass="text-amber-500"
              headerClass="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/50"
              onVerify={markVerified}
              onMarkReady={markReady}
              sla={sla}
              userId={user?.id}
              isPending={updateMutation.isPending}
            />
            <UrgencySection
              title="On Track"
              orders={mySafe}
              icon={CheckCircle}
              iconClass="text-green-600"
              headerClass="bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-950/30"
              onVerify={markVerified}
              onMarkReady={markReady}
              sla={sla}
              userId={user?.id}
              isPending={updateMutation.isPending}
              defaultOpen={myOverdue.length + myUrgent.length + myAttention.length === 0}
            />
          </div>
        )}
      </div>

      {sharedQueue.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Shared Queue ({sharedQueue.length})
          </h2>
          <div className="space-y-2">
            <UrgencySection
              title="Overdue — claim immediately"
              orders={queueOverdue}
              icon={AlertTriangle}
              iconClass="text-red-700"
              headerClass="bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-950/60"
              onClaim={claimOrder}
              sla={sla}
              isPending={updateMutation.isPending}
            />
            <UrgencySection
              title="Urgent"
              orders={queueUrgent}
              icon={Zap}
              iconClass="text-red-500"
              headerClass="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50"
              onClaim={claimOrder}
              sla={sla}
              isPending={updateMutation.isPending}
            />
            <UrgencySection
              title="Queue"
              orders={queueNormal}
              icon={Clock}
              iconClass="text-muted-foreground"
              headerClass="bg-muted/50 hover:bg-muted/80 text-foreground"
              onClaim={claimOrder}
              sla={sla}
              isPending={updateMutation.isPending}
            />
          </div>
        </div>
      )}

      {readyOrders.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            Ready for Pickup ({readyOrders.length})
          </h2>
          <div className="rounded-xl border overflow-hidden">
            <div className="divide-y">
              {sortByUrgency(readyOrders).map(order => {
                const isPaid = order.paymentStatus === "paid";
                const isUnpaid = order.paymentStatus === "unpaid";
                return (
                  <div key={order.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{order.customerName}</span>
                        <span className="font-mono text-xs text-muted-foreground">{order.orderId}</span>
                        <Badge variant="success" className="text-xs">Ready</Badge>
                        {isPaid
                          ? <Badge variant="success" className="text-xs">Paid</Badge>
                          : isUnpaid
                          ? <Badge variant="destructive" className="text-xs">Unpaid</Badge>
                          : <Badge variant="warning" className="text-xs">Partial</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {(order.itemCount ?? 0) > 0
                          ? `${order.itemCount} item${order.itemCount !== 1 ? "s" : ""}`
                          : `${order.shirts}S / ${order.trousers}T`} · {order.serviceType}
                        {!isPaid && order.amountPaid != null && order.price != null && (
                          <span className="ml-1 text-red-500 font-medium">
                            · ₦{Math.max(0, Number(order.price) - Number(order.amountPaid)).toLocaleString()} outstanding
                          </span>
                        )}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
                      <Link to={`/orders/${order.id}`}><Eye className="h-4 w-4" /></Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {myOrders.length === 0 && sharedQueue.length === 0 && readyOrders.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">All clear</p>
            <p className="text-sm mt-1">No active orders in queue</p>
          </CardContent>
        </Card>
      )}

      <CreateOrderDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
