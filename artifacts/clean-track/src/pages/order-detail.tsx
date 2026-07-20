import { useParams, useNavigate, Link } from "react-router-dom";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { api, type PaymentInput, type OrderItem, type PriceAdjustment, type AuditLogEntry, type OrderMessage, type DuplicatePaymentWarning, HttpError } from "@/lib/api";
import { enqueueOrderStatusUpdate, enqueuePayment, enqueuePickup, type OfflinePaymentPayload, type OfflinePickupPayload } from "@/lib/queue-service";
import { syncEngine } from "@/lib/sync-engine";
import { getIsOnline } from "@/lib/network-state";
import { type LocalPayment, type LocalPickup } from "@/lib/local-db";
import { usePendingLocalPayments, usePendingLocalPickups, useConflictLocalPayments, useConflictLocalPickups, useConflictStatusSyncEntries } from "@/hooks/use-pending-local";
import { PendingSyncBadge, ConflictSyncBadge } from "@/components/pending-sync-badge";
import { CountdownTimer } from "@/components/countdown-timer";
import { computeDueAt, getUrgency, shouldShowTimer } from "@/lib/urgency";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OrderStatusBadge, PaymentStatusBadge } from "@/lib/order-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReceiptView } from "@/components/receipt-view";
import {
  ArrowLeft, Trash2, Plus, CheckCircle, ShoppingBag, Package, Minus,
  TrendingDown, TrendingUp, Activity, User, CreditCard, Percent, Clock,
  Receipt, Printer, Eye, MessageSquare, Send, RotateCcw, RefreshCw,
  ChevronDown, ChevronUp, Zap, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Action config for timeline ───────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  order_created:        { label: "Order Created",        icon: CheckCircle,  color: "text-green-600",  bg: "bg-green-100 dark:bg-green-950/40"   },
  order_updated:        { label: "Order Updated",        icon: Activity,     color: "text-blue-600",   bg: "bg-blue-100 dark:bg-blue-950/40"     },
  order_deleted:        { label: "Order Deleted",        icon: Trash2,       color: "text-red-600",    bg: "bg-red-100 dark:bg-red-950/40"       },
  order_items_updated:  { label: "Items Updated",        icon: Package,      color: "text-purple-600", bg: "bg-purple-100 dark:bg-purple-950/40" },
  payment_recorded:     { label: "Payment Recorded",     icon: CreditCard,   color: "text-green-600",  bg: "bg-green-100 dark:bg-green-950/40"   },
  payment_deleted:      { label: "Payment Deleted",      icon: Trash2,       color: "text-red-600",    bg: "bg-red-100 dark:bg-red-950/40"       },
  discount_requested:   { label: "Discount Requested",   icon: Percent,      color: "text-amber-600",  bg: "bg-amber-100 dark:bg-amber-950/40"   },
  discount_approved:    { label: "Discount Approved",    icon: CheckCircle,  color: "text-green-600",  bg: "bg-green-100 dark:bg-green-950/40"   },
  discount_rejected:    { label: "Discount Rejected",    icon: Trash2,       color: "text-red-600",    bg: "bg-red-100 dark:bg-red-950/40"       },
  discount_auto_applied:{ label: "Discount Auto-Applied",icon: Percent,      color: "text-blue-600",   bg: "bg-blue-100 dark:bg-blue-950/40"     },
  discount_applied:     { label: "Discount Applied",     icon: Percent,      color: "text-green-600",  bg: "bg-green-100 dark:bg-green-950/40"   },
  surcharge_applied:    { label: "Surcharge Applied",    icon: TrendingUp,   color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-950/40" },
  pickup_recorded:      { label: "Pickup Recorded",      icon: ShoppingBag,  color: "text-blue-600",   bg: "bg-blue-100 dark:bg-blue-950/40"     },
  pickup_completed:     { label: "Pickup Completed",     icon: ShoppingBag,  color: "text-green-600",  bg: "bg-green-100 dark:bg-green-950/40"   },
  pickup_partial:       { label: "Partial Pickup",       icon: ShoppingBag,  color: "text-amber-600",  bg: "bg-amber-100 dark:bg-amber-950/40"   },
  order_processing:     { label: "Order Processing",     icon: Activity,     color: "text-blue-600",   bg: "bg-blue-100 dark:bg-blue-950/40"     },
};

function getActionConfig(action: string) {
  return ACTION_CONFIG[action] ?? {
    label: action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    icon: Activity,
    color: "text-muted-foreground",
    bg: "bg-muted",
  };
}

function buildTimelineDetail(entry: AuditLogEntry): string | null {
  const m = entry.metadata ?? {};
  switch (entry.action) {
    case "payment_recorded":
      return `₦${Number(m.amount ?? 0).toLocaleString()} via ${m.method ?? ""}${m.remainingBalance !== undefined ? ` · Balance: ₦${Number(m.remainingBalance).toLocaleString()}` : ""}`;
    case "payment_deleted":
      return `₦${Number(m.amount ?? 0).toLocaleString()} removed`;
    case "discount_requested":
      return `₦${Number(m.amount ?? 0).toLocaleString()} · "${m.reason ?? ""}"`;
    case "discount_approved":
      return `₦${Number(m.discountAmount ?? 0).toLocaleString()} approved · requested by ${m.requestedBy ?? ""}`;
    case "discount_rejected":
      return `₦${Number(m.requestedDiscount ?? 0).toLocaleString()} rejected · requested by ${m.requestedBy ?? ""}`;
    case "discount_auto_applied":
      return `₦${Number(m.amount ?? 0).toLocaleString()} auto-applied · "${m.reason ?? ""}"`;
    case "discount_applied":
    case "surcharge_applied":
      return `₦${Number(m.amount ?? 0).toLocaleString()} · "${m.reason ?? ""}"`;
    case "order_updated": {
      const changes = m.changes as Record<string, unknown> | undefined;
      if (!changes) return null;
      const parts: string[] = [];
      if (changes.status) parts.push(`Status → ${String(changes.status)}`);
      if (changes.assignedWorkerId !== undefined) parts.push(`Worker assigned`);
      if (changes.price !== undefined) parts.push(`Price → ₦${Number(changes.price).toLocaleString()}`);
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    case "order_items_updated":
      return `${m.itemCount ?? 0} item type${Number(m.itemCount) !== 1 ? "s" : ""} · Total: ₦${Number(m.newTotal ?? 0).toLocaleString()}`;
    case "order_created":
      return `${m.customerName ?? ""} · ${m.serviceType ?? ""} · ₦${Number(m.price ?? 0).toLocaleString()}`;
    case "pickup_completed":
      return `All items picked up`;
    case "pickup_partial": {
      const items = m.itemPickups as { name: string; quantity: number }[] | undefined;
      if (items && items.length > 0) return items.map(i => `${i.quantity}× ${i.name}`).join(", ");
      const s = Number(m.shirtsPickedUp ?? 0);
      const t = Number(m.trousersPickedUp ?? 0);
      return `${s} shirt${s !== 1 ? "s" : ""}, ${t} trouser${t !== 1 ? "s" : ""}`;
    }
    default:
      return null;
  }
}

function formatCurrency(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(Number(v));
}

// ── Status pipeline config ────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { key: "pending",        label: "Pending"    },
  { key: "processing",     label: "Processing" },
  { key: "ready",          label: "Ready"      },
  { key: "completed",      label: "Completed"  },
];

function getStepIndex(status: string): number {
  if (status === "partial_pickup") return 2; // same visual position as "ready"
  return PIPELINE_STEPS.findIndex(s => s.key === status);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isOwner, laundryId: authLaundryId, hasPermission } = useAuth();

  // Dialog / form state
  const [showPayment, setShowPayment]             = useState(false);
  const [showDelete, setShowDelete]               = useState(false);
  const [showPickup, setShowPickup]               = useState(false);
  const [pickupMode, setPickupMode]               = useState<"full" | "partial">("partial");
  const [showAddAdj, setShowAddAdj]               = useState(false);
  const [showReceipt, setShowReceipt]             = useState(false);
  const [deletePaymentId, setDeletePaymentId]     = useState<number | null>(null);
  const [paymentForm, setPaymentForm]             = useState<PaymentInput>({ amount: 0, method: "cash" });
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning]   = useState<DuplicatePaymentWarning | null>(null);
  const [isPickupSubmitting, setIsPickupSubmitting] = useState(false);
  const [pickupForm, setPickupForm]               = useState({ shirtsPickedUp: 0, trousersPickedUp: 0, notes: "" });
  const [itemPickupQtys, setItemPickupQtys]       = useState<Map<number, number>>(new Map());
  const [pickupNotes, setPickupNotes]             = useState("");
  const [adjForm, setAdjForm]                     = useState<{ type: "discount" | "extra_charge"; amount: number; reason: string }>({ type: "discount", amount: 0, reason: "" });
  const [updateForm, setUpdateForm]               = useState<Record<string, any>>({});
  const [showMessages, setShowMessages]           = useState(false);
  const [showPaymentHistory, setShowPaymentHistory] = useState(true);
  const [showFullTimeline, setShowFullTimeline]   = useState(false);

  const orderId = parseInt(id!);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: order, isLoading } = useQuery({
    queryKey: ["orders", orderId],
    queryFn: () => api.orders.get(orderId),
  });

  usePageTitle(order ? `Order #${order.orderId}` : "Order");

  const { data: payments = [] } = useQuery({
    queryKey: ["orders", orderId, "payments"],
    queryFn: () => api.orders.payments(orderId),
    enabled: !!orderId,
  });

  const { data: pickups = [] } = useQuery({
    queryKey: ["orders", orderId, "pickups"],
    queryFn: () => api.pickups.list(orderId),
    enabled: !!orderId,
  });

  const { data: auditEntries = [] } = useQuery({
    queryKey: ["orders", orderId, "audit-log"],
    queryFn: () => api.orders.auditLog(orderId),
    enabled: !!orderId,
  });

  const { data: sla } = useQuery({
    queryKey: ["settings", "sla"],
    queryFn: () => api.settings.getSla(),
  });

  const { data: messagesData, isLoading: messagesLoading, refetch: refetchMessages } = useQuery({
    queryKey: ["orders", orderId, "messages"],
    queryFn: () => api.orders.getMessages(orderId),
    enabled: !!orderId && showMessages,
    refetchInterval: showMessages ? 15000 : false,
  });
  const messages: OrderMessage[] = messagesData?.messages ?? [];

  const { data: receiptData, isLoading: receiptLoading } = useQuery({
    queryKey: ["orders", orderId, "receipt"],
    queryFn: () => api.receipts.getForOrder(orderId),
    enabled: !!orderId && showReceipt,
  });

  // ── Offline / sync state ─────────────────────────────────────────────────

  const orderLocalId = orderId ? `srv-${orderId}` : null;
  const pendingPayments       = usePendingLocalPayments(orderLocalId);
  const pendingPickups        = usePendingLocalPickups(orderLocalId);
  const conflictPayments      = useConflictLocalPayments(orderLocalId);
  const conflictPickups       = useConflictLocalPickups(orderLocalId);
  const conflictStatusUpdates = useConflictStatusSyncEntries(orderLocalId);

  useEffect(() => {
    if (!orderId) return;
    return syncEngine.subscribe((event) => {
      if (event.type !== "item_synced") return;
      const p = event.payload as { operation?: string; serverOrderId?: number } | undefined;
      if (p?.serverOrderId !== orderId) return;
      if (p?.operation === "record_payment") {
        qc.invalidateQueries({ queryKey: ["orders", orderId] });
        qc.invalidateQueries({ queryKey: ["orders", orderId, "payments"] });
      }
      if (p?.operation === "record_pickup") {
        qc.invalidateQueries({ queryKey: ["orders", orderId] });
        qc.invalidateQueries({ queryKey: ["orders", orderId, "pickups"] });
      }
    });
  }, [orderId, qc]);

  // ── Mutations ────────────────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => api.orders.update(orderId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", orderId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order updated");
    },
    onError: (e: Error) => toast.error("Could not update order — " + (e.message || "please try again.")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.orders.delete(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      navigate("/orders");
      toast.success("Order deleted");
    },
    onError: (e: Error) => toast.error("Could not delete order — " + (e.message || "please try again.")),
  });

  const paymentMutation = useMutation({
    mutationFn: (data: PaymentInput) => api.orders.recordPayment(orderId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", orderId] });
      qc.invalidateQueries({ queryKey: ["orders", orderId, "payments"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      setShowPayment(false);
      setPaymentForm({ amount: 0, method: "cash" });
      setDuplicateWarning(null);
      toast.success("Payment recorded");
    },
    onError: (e: Error) => {
      if (e instanceof HttpError && e.status === 409 && (e.data as DuplicatePaymentWarning)?.duplicateWarning) {
        setDuplicateWarning(e.data as DuplicatePaymentWarning);
        return;
      }
      toast.error("Could not record payment — " + (e.message || "please try again."));
    },
  });

  const handlePaymentSubmit = async (formData: PaymentInput) => {
    if (!formData.amount || formData.amount <= 0) {
      toast.error("Payment amount must be greater than zero.");
      return;
    }
    if (getIsOnline()) {
      paymentMutation.mutate(formData);
      return;
    }
    if (!authLaundryId || !order) {
      toast.error("Cannot record payment — please refresh and try again");
      return;
    }
    setIsPaymentSubmitting(true);
    try {
      const localId = crypto.randomUUID();
      const now = new Date().toISOString();
      const orderLocalIdSrv = `srv-${orderId}`;
      const record: LocalPayment = {
        localId,
        orderLocalId: orderLocalIdSrv,
        orderId,
        laundryId: authLaundryId,
        branchId: (order as any).branchId ?? null,
        amount: formData.amount,
        method: formData.method,
        notes: formData.notes ?? null,
        receiptNumber: null,
        syncStatus: "pending_create",
        createdAt: now,
      };
      const payload: OfflinePaymentPayload = {
        orderLocalId: orderLocalIdSrv,
        serverId: orderId,
        amount: formData.amount,
        method: formData.method,
        notes: formData.notes ?? null,
        laundryId: authLaundryId,
        branchId: (order as any).branchId ?? null,
        timestamp: now,
      };
      await enqueuePayment(localId, record, payload);
      qc.setQueryData(["orders", orderId], (old: any) => {
        if (!old) return old;
        const newAmountPaid = Number(old.amountPaid ?? 0) + formData.amount;
        const totalDue = Number(old.price ?? 0) + Number(old.extraCharge ?? 0) - Number(old.discount ?? 0);
        const remainingBalance = Math.max(0, totalDue - newAmountPaid);
        const newPaymentStatus = remainingBalance <= 0 ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid";
        return { ...old, amountPaid: newAmountPaid, paymentStatus: newPaymentStatus };
      });
      setShowPayment(false);
      setPaymentForm({ amount: 0, method: "cash" });
      toast.info("Payment saved offline — will sync when reconnected");
    } catch (err) {
      toast.error("Failed to save payment offline");
    } finally {
      setIsPaymentSubmitting(false);
    }
  };

  const deletePaymentMutation = useMutation({
    mutationFn: (pid: number) => api.orders.deletePayment(orderId, pid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", orderId, "payments"] });
      qc.invalidateQueries({ queryKey: ["orders", orderId] });
      setDeletePaymentId(null);
      toast.success("Payment deleted");
    },
    onError: (e: Error) => toast.error("Could not delete payment — " + (e.message || "please try again.")),
  });

  const pickupMutation = useMutation({
    mutationFn: (data: any) => api.pickups.record(orderId, data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["orders", orderId] });
      qc.invalidateQueries({ queryKey: ["orders", orderId, "pickups"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      setShowPickup(false);
      setPickupForm({ shirtsPickedUp: 0, trousersPickedUp: 0, notes: "" });
      setItemPickupQtys(new Map());
      setPickupNotes("");
      if (res.order.allPickedUp && res.order.fullyPaid) {
        toast.success("Order completed — all items picked up and fully paid!");
      } else if (res.order.allPickedUp) {
        toast.success("All items picked up! Outstanding balance remains.");
      } else if (res.order.items) {
        const remaining = res.order.items.reduce((s: number, i: any) => s + i.remaining, 0);
        toast.success(`Pickup recorded — ${remaining} item${remaining !== 1 ? "s" : ""} remaining`);
      } else {
        toast.success(`Pickup recorded — ${res.order.remainingShirts}S / ${res.order.remainingTrousers}T remaining`);
      }
    },
    onError: (e: Error) => toast.error("Could not record pickup — " + (e.message || "please try again.")),
  });

  const adjMutation = useMutation({
    mutationFn: () => api.orders.addPriceAdjustment(orderId, adjForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", orderId] });
      setShowAddAdj(false);
      setAdjForm({ type: "discount", amount: 0, reason: "" });
      toast.success("Price adjustment added");
    },
    onError: (e: Error) => toast.error("Could not add adjustment — " + (e.message || "please try again.")),
  });

  const sendNotificationMutation = useMutation({
    mutationFn: (type: "ready" | "reminder") => api.orders.sendNotification(orderId, type),
    onSuccess: (_, type) => {
      toast.success(type === "ready" ? "Ready for pickup notification sent!" : "Pickup reminder sent!");
      setShowMessages(true);
      setTimeout(() => refetchMessages(), 1500);
    },
    onError: (e: Error) => toast.error("Could not send notification — " + (e.message || "please try again.")),
  });

  const retryMessageMutation = useMutation({
    mutationFn: (msgId: number) => api.orders.retryMessage(orderId, msgId),
    onSuccess: (res) => {
      if (res.success) toast.success("Message queued for retry");
      else toast.error(res.error ?? "Could not retry message.");
      refetchMessages();
    },
    onError: (e: Error) => toast.error("Could not retry message — " + (e.message || "please try again.")),
  });

  // ── Loading / not-found ──────────────────────────────────────────────────

  if (isLoading) return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 bg-muted animate-pulse rounded" />
        <div className="space-y-1">
          <div className="h-7 w-40 bg-muted animate-pulse rounded" />
          <div className="h-4 w-24 bg-muted animate-pulse rounded" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-2">
            <div className="h-3 w-20 bg-muted animate-pulse rounded" />
            <div className="h-6 w-28 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border p-6 space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            <div className="h-4 w-40 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  );
  if (!order) return <div className="p-8 text-center text-muted-foreground">Order not found</div>;

  // ── Derived values ───────────────────────────────────────────────────────

  const totalDue   = (Number(order.price) || 0) + (Number(order.extraCharge) || 0) - (Number(order.discount) || 0);
  const amountPaid = Number(order.amountPaid) || 0;
  const balance    = totalDue - amountPaid;

  const isItemBased = order.items && order.items.length > 0;
  const itemsWithRemaining = (order.items ?? []).map(item => ({
    ...item,
    remaining: Math.max(0, item.quantity - item.quantityPickedUp),
  }));
  const totalItemsRemaining = itemsWithRemaining.reduce((s, i) => s + i.remaining, 0);
  const allItemsPickedUp    = isItemBased && totalItemsRemaining === 0;

  const shirtsPickedUp    = order.shirtsPickedUp ?? 0;
  const trousersPickedUp  = order.trousersPickedUp ?? 0;
  const remainingShirts   = Math.max(0, order.shirts - shirtsPickedUp);
  const remainingTrousers = Math.max(0, order.trousers - trousersPickedUp);
  const legacyHasRemaining = remainingShirts > 0 || remainingTrousers > 0;

  const canRecordPickup = (order.status === "ready" || order.status === "partial_pickup") &&
    (isItemBased ? totalItemsRemaining > 0 : legacyHasRemaining) &&
    hasPermission("canRecordPickups");

  const totalItemPickupQty = Array.from(itemPickupQtys.values()).reduce((s, v) => s + v, 0);

  const currentStepIdx = getStepIndex(order.status);
  const isCancelled = (order.status as string) === "cancelled";

  // Next status for the "advance" button
  const NEXT_STATUS: Record<string, { value: string; label: string }> = {
    pending:    { value: "processing", label: "Start Processing" },
    processing: { value: "ready",      label: "Mark as Ready"    },
  };
  const nextStatus = NEXT_STATUS[order.status];
  const canAdvanceStatus = !!nextStatus && (isOwner || hasPermission("canProcessOrders"));

  function setItemQty(itemId: number, qty: number, max: number) {
    const map = new Map(itemPickupQtys);
    const clamped = Math.min(Math.max(0, qty), max);
    if (clamped === 0) map.delete(itemId);
    else map.set(itemId, clamped);
    setItemPickupQtys(map);
  }

  async function handlePickupSubmit() {
    if (isItemBased) {
      const items = Array.from(itemPickupQtys.entries())
        .filter(([, qty]) => qty > 0)
        .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
      if (items.length === 0) { toast.error("Select at least one item to pick up"); return; }
      if (getIsOnline()) {
        pickupMutation.mutate({ items, notes: pickupNotes || undefined });
      } else {
        setIsPickupSubmitting(true);
        try {
          const localId = crypto.randomUUID();
          const orderLocalIdSrv = `srv-${orderId}`;
          const payloadItems = items.map(({ orderItemId, quantity }) => ({
            orderItemId,
            quantity,
            name: order!.items!.find((i) => i.id === orderItemId)?.name ?? "",
          }));
          const record: LocalPickup = {
            localId,
            orderLocalId: orderLocalIdSrv,
            orderId,
            syncStatus: "pending_create",
            shirtsPickedUp: 0,
            trousersPickedUp: 0,
            items: payloadItems.map((i) => ({
              orderItemLocalId: String(i.orderItemId),
              quantity: i.quantity,
              name: i.name,
            })),
            notes: pickupNotes || null,
            laundryId: authLaundryId!,
            createdAt: new Date().toISOString(),
          };
          const payload: OfflinePickupPayload = {
            orderLocalId: orderLocalIdSrv,
            serverId: orderId,
            items: payloadItems,
            shirtsPickedUp: 0,
            trousersPickedUp: 0,
            notes: pickupNotes || null,
            laundryId: authLaundryId!,
            timestamp: record.createdAt,
          };
          await enqueuePickup(localId, record, payload);
          qc.setQueryData(["orders", orderId], (old: any) => {
            if (!old) return old;
            const updatedItems = (old.items ?? []).map((item: any) => {
              const picked = payloadItems.find((p) => p.orderItemId === item.id);
              return picked ? { ...item, quantityPickedUp: item.quantityPickedUp + picked.quantity } : item;
            });
            const allDone  = updatedItems.every((i: any) => i.quantityPickedUp >= i.quantity);
            const fullyPaid = old.paymentStatus === "paid";
            return { ...old, status: allDone && fullyPaid ? "completed" : "partial_pickup", items: updatedItems };
          });
          setShowPickup(false);
          setItemPickupQtys(new Map());
          setPickupNotes("");
          toast.info("Pickup saved offline — will sync when reconnected");
        } catch {
          toast.error("Failed to save pickup offline");
        } finally {
          setIsPickupSubmitting(false);
        }
      }
    } else {
      if (pickupForm.shirtsPickedUp === 0 && pickupForm.trousersPickedUp === 0) {
        toast.error("Enter at least one item to pick up"); return;
      }
      if (getIsOnline()) {
        pickupMutation.mutate(pickupForm);
      } else {
        setIsPickupSubmitting(true);
        try {
          const localId = crypto.randomUUID();
          const orderLocalIdSrv = `srv-${orderId}`;
          const record: LocalPickup = {
            localId,
            orderLocalId: orderLocalIdSrv,
            orderId,
            syncStatus: "pending_create",
            shirtsPickedUp: pickupForm.shirtsPickedUp,
            trousersPickedUp: pickupForm.trousersPickedUp,
            items: [],
            notes: pickupForm.notes || null,
            laundryId: authLaundryId!,
            createdAt: new Date().toISOString(),
          };
          const payload: OfflinePickupPayload = {
            orderLocalId: orderLocalIdSrv,
            serverId: orderId,
            items: null,
            shirtsPickedUp: pickupForm.shirtsPickedUp,
            trousersPickedUp: pickupForm.trousersPickedUp,
            notes: pickupForm.notes || null,
            laundryId: authLaundryId!,
            timestamp: record.createdAt,
          };
          await enqueuePickup(localId, record, payload);
          qc.setQueryData(["orders", orderId], (old: any) => {
            if (!old) return old;
            const newShirts   = Math.min(old.shirtsPickedUp + pickupForm.shirtsPickedUp, old.shirts);
            const newTrousers = Math.min(old.trousersPickedUp + pickupForm.trousersPickedUp, old.trousers);
            const allDone   = newShirts >= old.shirts && newTrousers >= old.trousers;
            const fullyPaid = old.paymentStatus === "paid";
            return {
              ...old,
              status: allDone && fullyPaid ? "completed" : "partial_pickup",
              shirtsPickedUp: newShirts,
              trousersPickedUp: newTrousers,
            };
          });
          setShowPickup(false);
          setPickupForm({ shirtsPickedUp: 0, trousersPickedUp: 0, notes: "" });
          toast.info("Pickup saved offline — will sync when reconnected");
        } catch {
          toast.error("Failed to save pickup offline");
        } finally {
          setIsPickupSubmitting(false);
        }
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-5xl pb-10">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild className="shrink-0">
              <Link to="/orders"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Order {order.orderId}</h1>
              <p className="text-sm text-muted-foreground">
                {new Date(order.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                {" · "}<span className="capitalize">{order.serviceType}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:ml-auto pl-12 sm:pl-0">
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
            {order.isVerified && (
              <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Verified</Badge>
            )}
          </div>
        </div>
        {/* Customer quick-link */}
        <div className="flex items-center gap-3 mt-2 pl-12">
          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Link
            to={`/customers?phone=${encodeURIComponent(order.phone ?? "")}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {order.customerName}
          </Link>
          {order.phone && (
            <span className="text-xs text-muted-foreground font-mono">{order.phone}</span>
          )}
        </div>
      </div>

      {/* ── Status Pipeline ───────────────────────────────────────────────── */}
      {!isCancelled && (
        <Card>
          <CardContent className="p-4">
            {/* Step indicators */}
            <div className="flex items-center gap-0 mb-4 overflow-x-auto">
              {PIPELINE_STEPS.map((step, idx) => {
                const isDone    = currentStepIdx > idx;
                const isCurrent = currentStepIdx === idx;
                const isPartialHere = order.status === "partial_pickup" && idx === 2;
                return (
                  <div key={step.key} className="flex items-center flex-1 min-w-0">
                    <div className="flex flex-col items-center flex-1 min-w-0">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold transition-all",
                        isDone    ? "bg-primary text-primary-foreground" :
                        isCurrent ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2" :
                        "bg-muted text-muted-foreground"
                      )}>
                        {isDone ? <CheckCircle className="h-4 w-4" /> : idx + 1}
                      </div>
                      <p className={cn(
                        "text-xs mt-1 font-medium whitespace-nowrap",
                        isCurrent ? "text-primary" : isDone ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {isPartialHere ? "Partial Pickup" : step.label}
                      </p>
                    </div>
                    {idx < PIPELINE_STEPS.length - 1 && (
                      <div className={cn("h-0.5 flex-1 max-w-16 mx-1 shrink-0 transition-colors", idx < currentStepIdx ? "bg-primary" : "bg-border")} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Next action button */}
            {canAdvanceStatus && nextStatus && (
              <div className="flex items-center gap-3">
                <Button
                  className="flex-1 sm:flex-none gap-2"
                  onClick={async () => {
                    if (getIsOnline()) {
                      updateMutation.mutate({ status: nextStatus.value });
                    } else {
                      try {
                        await enqueueOrderStatusUpdate(`srv-${orderId}`, orderId, { status: nextStatus.value });
                        qc.setQueryData(["orders", orderId], (old: any) => old ? { ...old, status: nextStatus.value } : old);
                        qc.setQueryData(["orders"], (old: any[]) => old?.map(o => o.id === orderId ? { ...o, status: nextStatus.value } : o) ?? []);
                        toast.info("Status saved offline — syncs when reconnected");
                      } catch {
                        toast.error("Failed to save status offline");
                      }
                    }
                  }}
                  disabled={updateMutation.isPending}
                >
                  <Zap className="h-4 w-4" />
                  {nextStatus.label}
                </Button>
                {!getIsOnline() && <span className="text-xs text-amber-600">(offline — will sync)</span>}
                {conflictStatusUpdates.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600">
                    <ConflictSyncBadge />
                    <span>A status change was rejected — invalid transition</span>
                  </div>
                )}
              </div>
            )}

            {/* Terminal status info */}
            {!canAdvanceStatus && (order.status === "completed" || order.status === "partial_pickup") && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {order.status === "completed"
                  ? <><CheckCircle className="h-4 w-4 text-green-600" /><span className="text-green-700 dark:text-green-400 font-medium">Order completed</span></>
                  : <><ShoppingBag className="h-4 w-4 text-amber-600" /><span className="text-amber-700 dark:text-amber-400 font-medium">Partially picked up — awaiting remaining items</span></>
                }
              </div>
            )}

            {/* SLA timer */}
            {shouldShowTimer(order.status) && (() => {
              const dueAt   = computeDueAt(order.createdAt, order.serviceType, sla, order.processingDueAt);
              const urgency = getUrgency(dueAt);
              return (
                <div className={cn(
                  "flex items-center justify-between gap-3 mt-3 pt-3 border-t",
                )}>
                  <div className="flex items-center gap-2">
                    <Clock className={cn(
                      "h-4 w-4",
                      urgency.level === "overdue" ? "text-red-600" :
                      urgency.level === "urgent"  ? "text-orange-600" :
                      urgency.level === "attention" ? "text-yellow-600" : "text-muted-foreground"
                    )} />
                    <span className="text-sm text-muted-foreground">SLA Timer</span>
                  </div>
                  <CountdownTimer
                    createdAt={order.createdAt}
                    serviceType={order.serviceType}
                    processingDueAt={order.processingDueAt}
                    status={order.status}
                    slaSettings={sla}
                  />
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* ── Sync conflict warning ─────────────────────────────────────────── */}
      {(conflictPayments.length > 0 || conflictPickups.length > 0 || conflictStatusUpdates.length > 0) && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
          <ConflictSyncBadge />
          <p className="text-xs text-red-700 dark:text-red-400 leading-snug">
            One or more offline changes could not be synced and need attention. Check the history below for details.
          </p>
        </div>
      )}

      {/* ── Section: Payment ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Payment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Balance summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-lg bg-muted/40">
              <p className="text-xs text-muted-foreground mb-1">Total Due</p>
              <p className="text-lg font-bold tabular-nums">{formatCurrency(totalDue)}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950/20">
              <p className="text-xs text-muted-foreground mb-1">Paid</p>
              <p className="text-lg font-bold text-green-600 tabular-nums">{formatCurrency(amountPaid)}</p>
            </div>
            <div className={cn(
              "text-center p-3 rounded-lg",
              balance > 0 ? "bg-red-50 dark:bg-red-950/20" : "bg-green-50 dark:bg-green-950/20"
            )}>
              <p className="text-xs text-muted-foreground mb-1">Balance</p>
              <p className={cn("text-lg font-bold tabular-nums", balance > 0 ? "text-red-600" : "text-green-600")}>
                {balance > 0 ? formatCurrency(balance) : "Paid ✓"}
              </p>
            </div>
          </div>

          {/* Payment actions */}
          {hasPermission("canRecordPayments") && balance > 0 && (
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                onClick={() => {
                  setPaymentForm({ amount: balance, method: "cash" });
                  setShowPayment(true);
                }}
              >
                <Zap className="h-4 w-4" />
                Pay Full Balance ({formatCurrency(balance)})
              </Button>
              <Button
                variant="outline"
                className="flex-1 sm:flex-none gap-2"
                onClick={() => {
                  setPaymentForm({ amount: 0, method: "cash" });
                  setShowPayment(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Record Partial Payment
              </Button>
            </div>
          )}

          {pendingPayments.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <PendingSyncBadge />
              <span>{pendingPayments.length} payment{pendingPayments.length !== 1 ? "s" : ""} pending sync</span>
            </div>
          )}

          {/* Receipt actions */}
          {payments.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
              <p className="text-xs text-muted-foreground mr-1">Receipts:</p>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setShowReceipt(true)}
              >
                <Eye className="h-3.5 w-3.5" />
                View Receipt
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => {
                  const rn = payments[payments.length - 1]?.receiptNumber;
                  if (rn) window.open(`/receipts/${encodeURIComponent(rn)}/print`, "_blank");
                }}
              >
                <Printer className="h-3.5 w-3.5" />
                Print / PDF
              </Button>
            </div>
          )}

          {/* Payment history */}
          <div className="border-t pt-3">
            <button
              className="flex items-center gap-2 w-full text-left text-sm font-medium mb-2 hover:text-primary transition-colors"
              onClick={() => setShowPaymentHistory(v => !v)}
            >
              Payment History ({payments.length + pendingPayments.length})
              {showPaymentHistory ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
            </button>
            {showPaymentHistory && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Receipt #</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="hidden sm:table-cell">By</TableHead>
                      <TableHead className="hidden sm:table-cell">Balance After</TableHead>
                      <TableHead className="hidden md:table-cell">Date</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conflictPayments.map((p) => (
                      <TableRow key={p.localId} className="bg-red-50/50 dark:bg-red-950/20">
                        <TableCell><ConflictSyncBadge /></TableCell>
                        <TableCell className="font-medium">{formatCurrency(p.amount)}</TableCell>
                        <TableCell className="capitalize">{p.method}</TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">You (offline)</TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">—</TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell />
                      </TableRow>
                    ))}
                    {pendingPayments.map((p) => (
                      <TableRow key={p.localId} className="bg-blue-50/50 dark:bg-blue-950/20">
                        <TableCell><PendingSyncBadge /></TableCell>
                        <TableCell className="font-medium">{formatCurrency(p.amount)}</TableCell>
                        <TableCell className="capitalize">{p.method}</TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">You (offline)</TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">—</TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell />
                      </TableRow>
                    ))}
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{p.receiptNumber ?? "—"}</TableCell>
                        <TableCell className="font-medium">{formatCurrency(Number(p.amount))}</TableCell>
                        <TableCell className="capitalize">{p.method}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {p.recordedBy
                            ? <span className="flex items-center gap-1 text-sm"><User className="h-3 w-3 text-muted-foreground" />{p.recordedBy}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{formatCurrency(Number(p.remainingBalance))}</TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {new Date(p.recordedAt).toLocaleDateString("en-NG")}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {p.receiptNumber && (
                              <Button variant="ghost" size="icon" title="Print receipt"
                                onClick={() => window.open(`/receipts/${encodeURIComponent(p.receiptNumber!)}/print`, "_blank")}>
                                <Printer className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {isOwner && (
                              <Button variant="ghost" size="icon" onClick={() => setDeletePaymentId(p.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!payments.length && !pendingPayments.length && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-6 text-muted-foreground text-sm">No payments recorded yet</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Section: Pickup ──────────────────────────────────────────────── */}
      {(canRecordPickup || order.status === "partial_pickup" || order.status === "ready") && (
        <Card className={cn(
          "border-2",
          canRecordPickup ? "border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/10" : "border-border"
        )}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingBag className={cn("h-4 w-4", canRecordPickup ? "text-blue-600" : "text-muted-foreground")} />
                Pickup
              </CardTitle>
              {canRecordPickup && (
                <Badge variant="info" className="text-xs">
                  {isItemBased
                    ? `${totalItemsRemaining} item${totalItemsRemaining !== 1 ? "s" : ""} remaining`
                    : `${remainingShirts}S / ${remainingTrousers}T remaining`}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Pickup action buttons — always visible when applicable */}
            {canRecordPickup && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => {
                      if (isItemBased) {
                        const map = new Map<number, number>();
                        itemsWithRemaining.filter(i => i.remaining > 0).forEach(i => map.set(i.id, i.remaining));
                        setItemPickupQtys(map);
                      } else {
                        setPickupForm(f => ({ ...f, shirtsPickedUp: remainingShirts, trousersPickedUp: remainingTrousers }));
                      }
                      setPickupMode("full");
                      setShowPickup(true);
                    }}
                  >
                    <CheckCircle className="h-4 w-4" />
                    Full Pickup
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1.5 text-center leading-snug">
                    Customer takes all remaining items
                  </p>
                </div>
                <div>
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => { setPickupMode("partial"); setShowPickup(true); }}
                  >
                    <Package className="h-4 w-4" />
                    Partial Pickup
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1.5 text-center leading-snug">
                    Customer takes some items, will return for the rest
                  </p>
                </div>
              </div>
            )}

            {/* Item progress */}
            {isItemBased && (
              <div className="space-y-2">
                {itemsWithRemaining.map(item => (
                  <div key={item.id} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 font-medium">{item.name}</span>
                    <span className="text-muted-foreground tabular-nums">{item.quantityPickedUp}/{item.quantity} picked up</span>
                    {item.remaining > 0
                      ? <Badge variant="warning" className="text-xs shrink-0">{item.remaining} left</Badge>
                      : <Badge variant="success" className="text-xs shrink-0">Done</Badge>}
                  </div>
                ))}
              </div>
            )}

            {/* Legacy shirt/trouser progress */}
            {!isItemBased && (shirtsPickedUp > 0 || trousersPickedUp > 0) && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="text-center p-2 bg-background rounded-lg border">
                  <p className="text-2xl font-bold">{order.shirts}</p>
                  <p className="text-xs text-muted-foreground">Shirts Received</p>
                </div>
                <div className="text-center p-2 bg-background rounded-lg border">
                  <p className="text-2xl font-bold text-green-600">{shirtsPickedUp}</p>
                  <p className="text-xs text-muted-foreground">Shirts Picked Up</p>
                </div>
                <div className="text-center p-2 bg-background rounded-lg border">
                  <p className="text-2xl font-bold">{order.trousers}</p>
                  <p className="text-xs text-muted-foreground">Trousers Received</p>
                </div>
                <div className="text-center p-2 bg-background rounded-lg border">
                  <p className="text-2xl font-bold text-green-600">{trousersPickedUp}</p>
                  <p className="text-xs text-muted-foreground">Trousers Picked Up</p>
                </div>
              </div>
            )}

            {/* Pickup history (compact) */}
            {pickups.length > 0 && (
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Pickup History ({pickups.length})</p>
                <div className="space-y-2">
                  {pickups.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                      <div className="flex-1 min-w-0">
                        {p.itemPickups && p.itemPickups.length > 0
                          ? <span>{p.itemPickups.map(i => `${i.quantity}× ${i.name}`).join(", ")}</span>
                          : <span>{p.shirtsPickedUp}S / {p.trousersPickedUp}T</span>}
                        {p.recordedBy && <span className="text-muted-foreground ml-2 text-xs">by {p.recordedBy}</span>}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(p.createdAt).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1 shrink-0"
                        onClick={() => window.open(`/orders/${orderId}/pickups/${p.id}/print`, "_blank")}
                      >
                        <Printer className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pendingPickups.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <PendingSyncBadge />
                <span>{pendingPickups.length} pickup{pendingPickups.length !== 1 ? "s" : ""} pending sync</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Section: Notifications ────────────────────────────────────────── */}
      {(hasPermission("canProcessOrders") || hasPermission("canViewOrders")) && order.phone && (
        (order.status === "ready" || order.status === "partial_pickup") && (
          <Card className="border-purple-200 dark:border-purple-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-purple-600" />
                WhatsApp Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {order.status === "ready" && (
                  <Button
                    size="sm"
                    className="gap-2 bg-green-600 hover:bg-green-700"
                    disabled={sendNotificationMutation.isPending}
                    onClick={() => sendNotificationMutation.mutate("ready")}
                  >
                    <Send className="h-3.5 w-3.5" />
                    Notify Ready for Pickup
                  </Button>
                )}
                {(order.status === "ready" || order.status === "partial_pickup") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={sendNotificationMutation.isPending}
                    onClick={() => sendNotificationMutation.mutate("reminder")}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Send Pickup Reminder
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-2 ml-auto"
                  disabled={messagesLoading}
                  onClick={() => { setShowMessages(true); refetchMessages(); }}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${messagesLoading ? "animate-spin" : ""}`} />
                  {showMessages ? "Refresh Messages" : "View Messages"}
                </Button>
              </div>
              {showMessages && (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {messagesLoading ? (
                    <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
                  ) : messages.length === 0 ? (
                    <div className="py-4 text-center text-sm text-muted-foreground">No messages sent yet</div>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className={`rounded-lg p-3 text-sm border ${
                        msg.status === "delivered" || msg.status === "read"
                          ? "bg-green-50 dark:bg-green-950/20 border-green-200"
                          : msg.status === "failed"
                          ? "bg-red-50 dark:bg-red-950/20 border-red-200"
                          : "bg-muted/40 border-border"
                      }`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm leading-snug flex-1">{msg.renderedBody}</p>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <Badge variant={
                              msg.status === "delivered" || msg.status === "read" ? "success" :
                              msg.status === "failed" ? "destructive" : "outline"
                            } className="text-[10px]">
                              {msg.status}
                            </Badge>
                            {msg.status === "failed" && (
                              <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                                disabled={retryMessageMutation.isPending}
                                onClick={() => retryMessageMutation.mutate(msg.id)}>
                                <RotateCcw className="h-3 w-3 mr-1" />Retry
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {new Date(msg.sentAt ?? msg.queuedAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )
      )}

      {/* ── Section: Customer + Order Summary ────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card>
          <CardHeader><CardTitle className="text-base">Customer</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{order.customerName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{order.phone}</span></div>
            {order.address && <div className="flex justify-between"><span className="text-muted-foreground">Address</span><span className="text-right max-w-[60%]">{order.address}</span></div>}
            {order.additionalNotes && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Notes</span>
                <span className="text-right max-w-[60%] italic text-muted-foreground">"{order.additionalNotes}"</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Order Summary</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Service Type</span>
              <span className="capitalize font-medium">{order.serviceType}</span>
            </div>
            {!isItemBased && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shirts</span>
                  <span>{order.shirts}{shirtsPickedUp > 0 ? ` (${remainingShirts} remaining)` : ""}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trousers</span>
                  <span>{order.trousers}{trousersPickedUp > 0 ? ` (${remainingTrousers} remaining)` : ""}</span>
                </div>
              </>
            )}
            {isItemBased && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Items</span>
                <span className="font-medium">{order.items!.reduce((s, i) => s + i.quantity, 0)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Base Price</span>
              <span>{formatCurrency(order.price as any)}</span>
            </div>
            {Number(order.extraCharge) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Extra Charge</span>
                <span className="text-orange-600">+{formatCurrency(order.extraCharge as any)}</span>
              </div>
            )}
            {Number(order.discount) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span className="text-green-600">-{formatCurrency(order.discount as any)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t pt-2">
              <span>Total Due</span>
              <span>{formatCurrency(totalDue)}</span>
            </div>
            {order.batchId && (
              <div className="flex justify-between pt-1 border-t">
                <span className="text-muted-foreground">Batch</span>
                <Link to={`/batches/${order.batchId}`} className="text-primary hover:underline">{order.batchId}</Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Section: Items table (item-based orders) ─────────────────────── */}
      {isItemBased && order.items && order.items.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Order Items ({order.items.length})
              </CardTitle>
              {isOwner && (
                <Button variant="outline" size="sm" onClick={() => setShowAddAdj(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />Adjustment
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[520px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead>Unit Price</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead className="text-center">Picked Up</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map(item => {
                    const remaining = Math.max(0, item.quantity - item.quantityPickedUp);
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-center">{item.quantity}</TableCell>
                        <TableCell>{formatCurrency(Number(item.unitPrice))}</TableCell>
                        <TableCell className="font-medium">{formatCurrency(Number(item.totalPrice))}</TableCell>
                        <TableCell className="text-center">
                          <span className={item.quantityPickedUp > 0 ? "text-green-600 font-semibold" : "text-muted-foreground"}>
                            {item.quantityPickedUp}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {remaining > 0
                            ? <Badge variant="warning">{remaining} left</Badge>
                            : <Badge variant="success">Done</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-center font-semibold">{order.items.reduce((s, i) => s + i.quantity, 0)}</TableCell>
                    <TableCell />
                    <TableCell className="font-semibold">{formatCurrency(order.items.reduce((s, i) => s + Number(i.totalPrice), 0))}</TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pricing adjustments (owner only) */}
      {isOwner && (
        <div className="space-y-5">
          {/* Price adjustment history */}
          {order.priceAdjustments && order.priceAdjustments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" />
                  Price Adjustment History
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="hidden sm:table-cell">Applied By</TableHead>
                      <TableHead className="hidden sm:table-cell">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.priceAdjustments.map((adj: PriceAdjustment) => (
                      <TableRow key={adj.id}>
                        <TableCell>
                          {adj.type === "discount"
                            ? <Badge variant="success" className="gap-1"><TrendingDown className="h-3 w-3" />Discount</Badge>
                            : <Badge variant="warning" className="gap-1"><TrendingUp className="h-3 w-3" />Extra Charge</Badge>}
                        </TableCell>
                        <TableCell className={adj.type === "discount" ? "text-green-600 font-medium" : "text-orange-600 font-medium"}>
                          {adj.type === "discount" ? "-" : "+"}{formatCurrency(Number(adj.amount))}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{adj.reason}</TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">{adj.appliedBy}</TableCell>
                        <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{new Date(adj.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Edit pricing */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Edit Pricing</CardTitle>
                {!isItemBased && (
                  <Button variant="outline" size="sm" onClick={() => setShowAddAdj(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Adjustment
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Price (₦)</Label>
                  <Input
                    type="number"
                    defaultValue={order.price as any}
                    onChange={(e) => setUpdateForm({ ...updateForm, price: parseFloat(e.target.value) })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label className="text-xs">Extra Charge (₦)</Label>
                  <Input
                    type="number"
                    defaultValue={order.extraCharge as any}
                    onChange={(e) => setUpdateForm({ ...updateForm, extraCharge: parseFloat(e.target.value) })}
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Discount (₦)</Label>
                <Input
                  type="number"
                  defaultValue={order.discount as any}
                  onChange={(e) => setUpdateForm({ ...updateForm, discount: parseFloat(e.target.value) })}
                  placeholder="0"
                />
              </div>
              {Object.keys(updateForm).length > 0 && (
                <Button
                  size="sm"
                  onClick={() => { updateMutation.mutate(updateForm); setUpdateForm({}); }}
                  disabled={updateMutation.isPending}
                >
                  Save Changes
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Section: Activity History ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {auditEntries.length === 0 ? (
            <p className="text-center py-6 text-muted-foreground text-sm">No activity recorded yet.</p>
          ) : (
            <>
              <div className="relative">
                <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
                <div className="space-y-4">
                  {(showFullTimeline ? auditEntries : auditEntries.slice(0, 5)).map((entry, idx) => {
                    const cfg    = getActionConfig(entry.action);
                    const Icon   = cfg.icon;
                    const detail = buildTimelineDetail(entry);
                    return (
                      <div key={entry.id} className="relative flex gap-4">
                        <div className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${cfg.bg}`}>
                          <Icon className={`h-4 w-4 ${cfg.color}`} />
                        </div>
                        <div className="flex-1 min-w-0 pt-1.5">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div>
                              <p className="text-sm font-semibold">{cfg.label}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <User className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground">{entry.actorName}</span>
                                  {" "}
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 capitalize">{entry.actorType}</Badge>
                                </span>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {new Date(entry.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
                            </span>
                          </div>
                          {detail && (
                            <p className="mt-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">{detail}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {auditEntries.length > 5 && (
                <button
                  className="mt-4 text-sm text-primary hover:underline flex items-center gap-1"
                  onClick={() => setShowFullTimeline(v => !v)}
                >
                  {showFullTimeline
                    ? <><ChevronUp className="h-3.5 w-3.5" />Show less</>
                    : <><ChevronDown className="h-3.5 w-3.5" />Show all {auditEntries.length} events</>}
                </button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Delete order (owner only) ─────────────────────────────────────── */}
      {isOwner && (
        <div className="flex justify-end pt-2">
          <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete Order
          </Button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          DIALOGS
          ══════════════════════════════════════════════════════════════════════ */}

      {/* Receipt viewer */}
      <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          <div className="flex items-center justify-between gap-2 p-4 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              <p className="font-semibold">Order Receipt — {order.orderId}</p>
            </div>
            <div className="flex gap-2">
              {receiptData?.allPayments && receiptData.allPayments.length > 0 && receiptData.allPayments[receiptData.allPayments.length - 1].receiptNumber && (
                <Button size="sm" variant="outline" onClick={() => {
                  const rn = receiptData.allPayments[receiptData.allPayments.length - 1].receiptNumber!;
                  window.open(`/receipts/${encodeURIComponent(rn)}/print`, "_blank");
                }}>
                  <Printer className="h-4 w-4 mr-1" />
                  Print / PDF
                </Button>
              )}
            </div>
          </div>
          <div className="p-4">
            {receiptLoading ? (
              <div className="py-12 text-center text-muted-foreground">Loading receipt…</div>
            ) : receiptData ? (
              <ReceiptView data={receiptData} showAllPayments />
            ) : (
              <div className="py-12 text-center text-muted-foreground">No payment data available.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Pickup dialog */}
      <Dialog open={showPickup} onOpenChange={(v) => {
        if (!v) {
          setItemPickupQtys(new Map());
          setPickupNotes("");
          setPickupForm({ shirtsPickedUp: 0, trousersPickedUp: 0, notes: "" });
          setPickupMode("partial");
        }
        setShowPickup(v);
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              {pickupMode === "full" ? "Full Pickup" : "Partial Pickup"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {pickupMode === "partial" && (
              <p className="text-sm text-muted-foreground -mt-1">
                Enter how many of each item the customer is taking now. The remainder stays pending.
              </p>
            )}
            {isItemBased ? (
              <>
                <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1.5">
                  {balance > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Outstanding balance</span>
                      <span className="font-semibold text-red-600">{formatCurrency(balance)}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground font-medium">{totalItemsRemaining} item{totalItemsRemaining !== 1 ? "s" : ""} remaining</p>
                </div>
                <div className="space-y-2">
                  {itemsWithRemaining.filter(i => i.remaining > 0).map(item => {
                    const qty = itemPickupQtys.get(item.id) ?? 0;
                    return (
                      <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg border">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.remaining} remaining</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button variant="outline" size="icon" className="h-7 w-7"
                            onClick={() => setItemQty(item.id, qty - 1, item.remaining)} disabled={qty === 0}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-6 text-center text-sm font-bold tabular-nums">{qty}</span>
                          <Button variant="outline" size="icon" className="h-7 w-7"
                            onClick={() => setItemQty(item.id, qty + 1, item.remaining)} disabled={qty >= item.remaining}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {totalItemPickupQty > 0 && (
                  <div className="p-2.5 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-xs border border-blue-200 dark:border-blue-800">
                    <p className="font-semibold text-blue-700 dark:text-blue-400">
                      {totalItemPickupQty} item{totalItemPickupQty !== 1 ? "s" : ""} selected — {totalItemsRemaining - totalItemPickupQty} will remain
                    </p>
                  </div>
                )}
                <div>
                  <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input value={pickupNotes} onChange={(e) => setPickupNotes(e.target.value)} placeholder="e.g. customer collected 3 shirts only" />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 p-3 bg-muted/50 rounded-lg text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Shirts remaining</p>
                    <p className="font-semibold text-lg">{remainingShirts}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Trousers remaining</p>
                    <p className="font-semibold text-lg">{remainingTrousers}</p>
                  </div>
                  {balance > 0 && (
                    <div className="col-span-2 border-t pt-2">
                      <p className="text-muted-foreground text-xs mb-1">Outstanding balance</p>
                      <p className="font-semibold text-red-600">{formatCurrency(balance)}</p>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Shirts picking up</Label>
                    <Input
                      type="number" min={0} max={remainingShirts}
                      value={pickupForm.shirtsPickedUp}
                      onChange={(e) => setPickupForm({ ...pickupForm, shirtsPickedUp: Math.min(parseInt(e.target.value) || 0, remainingShirts) })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Max: {remainingShirts}</p>
                  </div>
                  <div>
                    <Label>Trousers picking up</Label>
                    <Input
                      type="number" min={0} max={remainingTrousers}
                      value={pickupForm.trousersPickedUp}
                      onChange={(e) => setPickupForm({ ...pickupForm, trousersPickedUp: Math.min(parseInt(e.target.value) || 0, remainingTrousers) })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Max: {remainingTrousers}</p>
                  </div>
                </div>
                <div>
                  <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    value={pickupForm.notes ?? ""}
                    onChange={(e) => setPickupForm({ ...pickupForm, notes: e.target.value })}
                    placeholder="e.g. customer collected 3 shirts only"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPickup(false)}>Cancel</Button>
            <Button onClick={handlePickupSubmit} disabled={pickupMutation.isPending || isPickupSubmitting}>
              {pickupMutation.isPending || isPickupSubmitting
                ? (getIsOnline() ? "Recording…" : "Saving offline…")
                : "Confirm Pickup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Price adjustment dialog */}
      <Dialog open={showAddAdj} onOpenChange={setShowAddAdj}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Price Adjustment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Type</Label>
              <Select value={adjForm.type} onValueChange={(v) => setAdjForm({ ...adjForm, type: v as any })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="discount">Discount</SelectItem>
                  <SelectItem value="extra_charge">Extra Charge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (₦) *</Label>
              <Input
                className="mt-1" type="number" min={0.01}
                value={adjForm.amount || ""}
                onChange={(e) => setAdjForm({ ...adjForm, amount: parseFloat(e.target.value) || 0 })}
                placeholder="Enter amount"
              />
            </div>
            <div>
              <Label>Reason *</Label>
              <Input
                className="mt-1"
                value={adjForm.reason}
                onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                placeholder={adjForm.type === "discount" ? "e.g. loyalty discount" : "e.g. delivery fee"}
              />
            </div>
            <div className="p-3 bg-muted/30 rounded-lg text-sm flex justify-between">
              <span className="text-muted-foreground">New Total Due</span>
              <span className="font-semibold">
                {formatCurrency(totalDue + (adjForm.type === "extra_charge" ? adjForm.amount : -adjForm.amount))}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddAdj(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!adjForm.amount || adjForm.amount <= 0) { toast.error("Enter a valid amount"); return; }
                if (!adjForm.reason.trim()) { toast.error("Reason is required"); return; }
                adjMutation.mutate();
              }}
              disabled={adjMutation.isPending}
            >
              {adjMutation.isPending ? "Saving…" : "Add Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={showPayment} onOpenChange={(v) => { setShowPayment(v); if (!v) setDuplicateWarning(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {balance > 0 && (
              <div className="p-3 bg-muted/50 rounded-lg text-sm flex justify-between items-center">
                <span className="text-muted-foreground">Outstanding balance</span>
                <span className="font-semibold text-red-600">{formatCurrency(balance)}</span>
              </div>
            )}
            {duplicateWarning && (
              <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-300 dark:border-yellow-800 rounded-lg text-sm space-y-1.5">
                <p className="font-medium text-yellow-800 dark:text-yellow-300">Possible duplicate payment</p>
                <p className="text-yellow-700 dark:text-yellow-400">{duplicateWarning.message}</p>
                <p className="text-xs text-muted-foreground">
                  Previous: {formatCurrency(Number(duplicateWarning.existingPayment.amount))} via {duplicateWarning.existingPayment.method}
                  {duplicateWarning.existingPayment.recordedBy ? ` by ${duplicateWarning.existingPayment.recordedBy}` : ""}
                  {" "}at {new Date(duplicateWarning.existingPayment.recordedAt).toLocaleTimeString()}
                </p>
              </div>
            )}
            <div>
              <Label>Amount (₦) *</Label>
              <Input
                type="number" min={0}
                value={paymentForm.amount || ""}
                onChange={(e) => { setPaymentForm({ ...paymentForm, amount: parseFloat(e.target.value) || 0 }); setDuplicateWarning(null); }}
                placeholder="Enter amount"
                autoFocus
              />
              {balance > 0 && paymentForm.amount !== balance && (
                <button
                  type="button"
                  className="mt-1 text-xs text-primary hover:underline"
                  onClick={() => setPaymentForm(f => ({ ...f, amount: balance }))}
                >
                  Use full balance ({formatCurrency(balance)})
                </button>
              )}
            </div>
            <div>
              <Label>Method</Label>
              <Select value={paymentForm.method} onValueChange={(v) => { setPaymentForm({ ...paymentForm, method: v as any }); setDuplicateWarning(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="pos">POS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <Input
                value={paymentForm.reference ?? ""}
                onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                placeholder={`Defaults to order #${order.orderId}`}
              />
            </div>
            <div>
              <Label>Notes <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <Input
                value={paymentForm.notes ?? ""}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowPayment(false); setDuplicateWarning(null); }}>Cancel</Button>
            <Button
              variant={duplicateWarning ? "destructive" : "default"}
              onClick={() => handlePaymentSubmit(duplicateWarning ? { ...paymentForm, confirmDuplicate: true } : paymentForm)}
              disabled={paymentMutation.isPending || isPaymentSubmitting}
            >
              {paymentMutation.isPending || isPaymentSubmitting ? "Recording…" : duplicateWarning ? "Record Anyway" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete order dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Order</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete order <strong>{order.orderId}</strong>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete payment dialog */}
      <AlertDialog open={deletePaymentId !== null} onOpenChange={(v) => { if (!v) setDeletePaymentId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the payment record and update the order balance. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletePaymentId !== null && deletePaymentMutation.mutate(deletePaymentId)}
            >
              {deletePaymentMutation.isPending ? "Deleting…" : "Delete Payment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
