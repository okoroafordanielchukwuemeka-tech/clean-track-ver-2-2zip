/**
 * InboxTab — WhatsApp Communication Center
 *
 * Three-panel layout:
 *   Left   — conversation list with filters, unread badges, assignment indicators
 *   Center — message thread with reply input (send via WhatsApp or save locally)
 *   Right  — customer context: orders, balance, quick actions
 *
 * Mobile: single-panel navigation (list → messages → context)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  MessageSquare, Phone, User, CheckCircle2, Archive, RefreshCw,
  Loader2, ChevronLeft, RotateCcw, Clock, AlertCircle, ExternalLink,
  Send, AlertTriangle, ShoppingCart, CreditCard, ChevronRight,
  UserCircle, BadgeCheck, Circle, Users, X,
} from "lucide-react";
import { formatDistanceToNow, format, differenceInHours, differenceInDays } from "date-fns";
import type {
  Conversation, ConversationMessage, ConversationDetail,
  ConversationListResponse, Worker,
} from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

type ConvStatus = "open" | "resolved" | "archived";
type MobilePanel = "list" | "messages" | "context";

// ── Time helpers ─────────────────────────────────────────────────────────────

function listTime(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const h = differenceInHours(new Date(), d);
    if (h < 24) return format(d, "h:mm a");
    if (h < 168) return format(d, "EEE");
    return format(d, "MMM d");
  } catch { return ""; }
}

function bubbleTime(ts: string): string {
  try {
    const d = new Date(ts);
    const h = differenceInHours(new Date(), d);
    if (h < 24) return format(d, "h:mm a");
    if (h < 168) return format(d, "EEE h:mm a");
    return format(d, "MMM d, h:mm a");
  } catch { return ""; }
}

function separatorLabel(date: Date): string {
  const days = differenceInDays(new Date(), date);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

function relTime(ts: string | null | undefined): string {
  if (!ts) return "";
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); }
  catch { return ""; }
}

function fmtNaira(n: number): string {
  return "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  processing: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  ready:      "bg-green-500/15 text-green-400 border-green-500/20",
  completed:  "bg-muted text-muted-foreground border-border",
};
const PAY_COLORS: Record<string, string> = {
  unpaid:  "bg-red-500/15 text-red-400 border-red-500/20",
  partial: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  paid:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

// ── Conversation list item ────────────────────────────────────────────────────

function ConvItem({
  conv, workers, selected, onClick,
}: {
  conv: Conversation; workers: Worker[];
  selected: boolean; onClick: () => void;
}) {
  const assignedWorker = conv.assignedWorkerId
    ? workers.find(w => w.id === conv.assignedWorkerId)
    : null;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3.5 border-b border-border/40 hover:bg-muted/20 transition-colors",
        selected && "bg-primary/8 border-l-[3px] border-l-primary"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mt-0.5">
          <User className="h-4 w-4 text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={cn(
              "text-sm truncate",
              conv.unreadCount > 0 ? "font-bold text-foreground" : "font-medium text-foreground/90"
            )}>
              {conv.customerName ?? conv.customerPhone}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {conv.unreadCount > 0 && (
                <span className="bg-green-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {conv.unreadCount}
                </span>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">{listTime(conv.lastMessageAt)}</span>
            </div>
          </div>

          {conv.customerName && (
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{conv.customerPhone}</p>
          )}

          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-xs px-1.5 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20 font-medium">
              WhatsApp
            </span>
            {conv.status !== "open" && (
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded border font-medium capitalize",
                conv.status === "resolved"
                  ? "bg-teal-500/10 text-teal-400 border-teal-500/20"
                  : "bg-muted text-muted-foreground border-border"
              )}>
                {conv.status}
              </span>
            )}
            {assignedWorker && (
              <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
                <UserCircle className="h-3 w-3" />
                {assignedWorker.name.split(" ")[0]}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Chat bubble ──────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: ConversationMessage }) {
  const isInbound = msg.direction === "inbound";
  return (
    <div className={cn("flex gap-2 mb-4", isInbound ? "justify-start" : "justify-end")}>
      {isInbound && (
        <div className="shrink-0 w-7 h-7 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mt-1">
          <User className="h-3.5 w-3.5 text-green-400" />
        </div>
      )}
      <div className="max-w-[78%]">
        <div className={cn(
          "rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isInbound
            ? "bg-muted/70 text-foreground rounded-tl-sm border border-border/50"
            : "bg-primary text-primary-foreground rounded-tr-sm"
        )}>
          <p className="whitespace-pre-wrap break-words">{msg.body}</p>
        </div>
        <div className={cn(
          "flex items-center gap-1.5 mt-1 px-1",
          isInbound ? "justify-start" : "justify-end"
        )}>
          <span className="text-[11px] text-muted-foreground/70">
            {isInbound ? (msg.senderName ?? "Customer") : (msg.senderName ?? "CleanTrack")}
          </span>
          <span className="text-[11px] text-muted-foreground/40">·</span>
          <span className="text-[11px] text-muted-foreground/70">{bubbleTime(msg.createdAt)}</span>
          {!isInbound && msg.status && msg.status !== "queued" && (
            <BadgeCheck className={cn(
              "h-3 w-3",
              msg.status === "read" ? "text-blue-400" :
              msg.status === "delivered" ? "text-green-400" : "text-muted-foreground/50"
            )} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Day separator ────────────────────────────────────────────────────────────

function DaySep({ date }: { date: Date }) {
  return (
    <div className="flex items-center gap-3 my-4 px-2">
      <div className="flex-1 border-t border-border/40" />
      <span className="text-xs text-muted-foreground/60 px-2">{separatorLabel(date)}</span>
      <div className="flex-1 border-t border-border/40" />
    </div>
  );
}

// ── Customer Context Panel ────────────────────────────────────────────────────

function CustomerContext({
  detail, convId, onCreateOrder,
}: {
  detail: ConversationDetail; convId: number;
  onCreateOrder?: () => void;
}) {
  const { customer, conversation: conv } = detail;

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-4">
        <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
        </div>
        <div>
          <p className="font-medium text-sm">Unknown Customer</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            No customer profile found for{" "}
            <span className="font-mono text-foreground">{conv.customerPhone}</span>.
            They may not have placed an order yet.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Ask them to mention their name or order number so you can link them.
        </p>
      </div>
    );
  }

  const hasBalance = customer.outstandingBalance > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Customer card */}
      <div className="px-4 pt-4 pb-3 border-b border-border/50">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">{customer.fullName}</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{customer.phone}</p>
            <Link
              to={`/customers/${customer.id}`}
              className="text-xs text-primary hover:underline flex items-center gap-0.5 mt-1"
            >
              View full profile <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 px-3 py-3 border-b border-border/50">
        <div className="bg-muted/30 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold">{customer.totalOrders}</p>
          <p className="text-xs text-muted-foreground">Total Orders</p>
        </div>
        <div className={cn(
          "rounded-lg p-2.5 text-center",
          hasBalance ? "bg-red-500/10" : "bg-muted/30"
        )}>
          <p className={cn("text-lg font-bold", hasBalance ? "text-red-400" : "")}>
            {fmtNaira(customer.outstandingBalance)}
          </p>
          <p className="text-xs text-muted-foreground">Outstanding</p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="px-3 py-3 border-b border-border/50 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Quick Actions
        </p>
        <Link
          to={`/orders/new?customerId=${customer.id}&customerName=${encodeURIComponent(customer.fullName)}&phone=${encodeURIComponent(customer.phone)}`}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <ShoppingCart className="h-4 w-4" />
          Create New Order
        </Link>
        <Link
          to={`/orders?customerId=${customer.id}`}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/30 transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
          View All Orders
        </Link>
        {hasBalance && (
          <Link
            to={`/orders?customerId=${customer.id}&paymentStatus=unpaid`}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/5 transition-colors"
          >
            <CreditCard className="h-4 w-4" />
            Record Payment
          </Link>
        )}
      </div>

      {/* Active orders */}
      {customer.activeOrders.length > 0 && (
        <div className="px-3 py-3 border-b border-border/50">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Active Orders ({customer.activeOrders.length})
          </p>
          <div className="space-y-2">
            {customer.activeOrders.map(order => (
              <Link
                key={order.id}
                to={`/orders/${order.id}`}
                className="block bg-muted/20 hover:bg-muted/40 border border-border/50 rounded-lg p-2.5 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-medium">{order.orderId}</span>
                  <div className="flex gap-1">
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize", STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground")}>
                      {order.status}
                    </span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize", PAY_COLORS[order.paymentStatus] ?? "bg-muted text-muted-foreground")}>
                      {order.paymentStatus}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-muted-foreground capitalize">{order.serviceType}</span>
                  <span className="text-xs font-medium">{fmtNaira(parseFloat(order.price || "0"))}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent orders */}
      {customer.recentOrders.length > 0 && (
        <div className="px-3 py-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Recent Orders
          </p>
          <div className="space-y-1.5">
            {customer.recentOrders.map(order => (
              <Link
                key={order.id}
                to={`/orders/${order.id}`}
                className="flex items-center gap-2 p-2 hover:bg-muted/20 rounded-lg transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono">{order.orderId}</p>
                  <p className="text-xs text-muted-foreground">{relTime(order.createdAt)}</p>
                </div>
                <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">
                  {fmtNaira(parseFloat(order.price || "0"))}
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {customer.totalOrders === 0 && (
        <div className="px-4 py-6 text-center text-muted-foreground">
          <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No orders yet</p>
          <p className="text-xs mt-1">Create their first order using the button above</p>
        </div>
      )}
    </div>
  );
}

// ── Assignment dropdown ───────────────────────────────────────────────────────

function AssignDropdown({
  convId, currentWorkerId, workers, onAssigned,
}: {
  convId: number; currentWorkerId: number | null;
  workers: Worker[]; onAssigned: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const assign = useMutation({
    mutationFn: (wId: number | null) => api.conversations.assign(convId, wId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-detail", convId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setOpen(false);
      onAssigned();
    },
    onError: () => toast.error("Failed to assign conversation"),
  });

  const current = currentWorkerId ? workers.find(w => w.id === currentWorkerId) : null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors border border-transparent hover:border-border"
      >
        <UserCircle className="h-3.5 w-3.5" />
        <span>{current ? current.name.split(" ")[0] : "Unassigned"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
            <button
              onClick={() => assign.mutate(null)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm hover:bg-muted/40 transition-colors",
                !currentWorkerId && "text-primary font-medium"
              )}
            >
              Unassigned
            </button>
            {workers.filter(w => w.isActive).map(w => (
              <button
                key={w.id}
                onClick={() => assign.mutate(w.id)}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm hover:bg-muted/40 transition-colors flex items-center gap-2",
                  w.id === currentWorkerId && "text-primary font-medium"
                )}
              >
                <UserCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{w.name}</span>
                {w.role === "admin" && (
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">admin</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Message panel (center) ────────────────────────────────────────────────────

function MessagesPanel({
  convId, workers, isOwner, onBack, onShowContext, mobile,
}: {
  convId: number; workers: Worker[];
  isOwner: boolean; onBack: () => void;
  onShowContext: () => void; mobile: boolean;
}) {
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const markedRead = useRef(false);
  const [replyText, setReplyText] = useState("");

  const { data, isLoading } = useQuery<ConversationDetail>({
    queryKey: ["conversation-detail", convId],
    queryFn: () => api.conversations.get(convId),
    refetchInterval: 10_000,
  });

  const markRead = useMutation({
    mutationFn: () => api.conversations.markRead(convId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversations-unread"] });
    },
  });

  const updateStatus = useMutation({
    mutationFn: (status: ConvStatus) => api.conversations.updateStatus(convId, status),
    onSuccess: (_, s) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation-detail", convId] });
      toast.success(s === "resolved" ? "Conversation resolved" : s === "archived" ? "Archived" : "Reopened");
    },
    onError: () => toast.error("Failed to update conversation"),
  });

  const reply = useMutation({
    mutationFn: (body: string) => api.conversations.reply(convId, body),
    onSuccess: (data) => {
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["conversation-detail", convId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (!data.delivered) {
        toast.info("Message saved — WhatsApp not connected yet");
      }
    },
    onError: () => toast.error("Failed to send reply"),
  });

  // Auto-mark read on open
  useEffect(() => { markedRead.current = false; }, [convId]);
  useEffect(() => {
    if (!markedRead.current && data?.conversation?.unreadCount && data.conversation.unreadCount > 0) {
      markedRead.current = true;
      markRead.mutate();
    }
  }, [data?.conversation?.unreadCount]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (data?.messages?.length) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [data?.messages?.length]);

  const handleSend = useCallback(() => {
    const body = replyText.trim();
    if (!body || reply.isPending) return;
    reply.mutate(body);
  }, [replyText, reply]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;

  const { conversation: conv, messages } = data;

  // Group messages with day separators
  const rendered: Array<{ type: "separator"; date: Date } | { type: "msg"; msg: ConversationMessage }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const date = new Date(msg.createdAt);
    const prev = i > 0 ? new Date(messages[i - 1].createdAt) : null;
    if (!prev || date.toDateString() !== prev.toDateString()) {
      rendered.push({ type: "separator", date });
    }
    rendered.push({ type: "msg", msg });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-card/40 shrink-0">
        {mobile && (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
          <User className="h-3.5 w-3.5 text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight truncate">
            {conv.customerName ?? conv.customerPhone}
          </p>
          <p className="text-xs text-muted-foreground font-mono">{conv.customerPhone}</p>
        </div>

        {/* Assignment (owner only) */}
        {isOwner && (
          <AssignDropdown
            convId={convId}
            currentWorkerId={conv.assignedWorkerId}
            workers={workers}
            onAssigned={() => {}}
          />
        )}

        {/* Status actions */}
        <div className="flex items-center gap-1 shrink-0">
          {conv.status === "open" && (
            <>
              <Button
                size="sm" variant="outline"
                className="h-7 text-xs border-teal-500/30 text-teal-400 hover:bg-teal-500/10 hidden sm:flex"
                onClick={() => updateStatus.mutate("resolved")}
                disabled={updateStatus.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Resolve
              </Button>
              <Button
                size="sm" variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground sm:hidden"
                onClick={() => updateStatus.mutate("resolved")}
                title="Resolve"
              >
                <CheckCircle2 className="h-4 w-4 text-teal-400" />
              </Button>
              <Button
                size="sm" variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground"
                onClick={() => updateStatus.mutate("archived")}
                title="Archive"
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {conv.status !== "open" && (
            <Button
              size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => updateStatus.mutate("open")}
              disabled={updateStatus.isPending}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reopen
            </Button>
          )}
          {mobile && (
            <Button
              size="sm" variant="ghost" className="h-7 text-xs ml-1"
              onClick={onShowContext}
              title="Customer info"
            >
              <Users className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Customer context bar */}
      {data.customer ? (
        <div className="px-4 py-1.5 bg-green-500/5 border-b border-green-500/10 flex items-center gap-3 text-xs text-muted-foreground shrink-0 flex-wrap">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3 text-green-400" />
            <span className="font-medium text-foreground">{data.customer.fullName}</span>
          </span>
          <span className="hidden sm:flex items-center gap-1">
            <ShoppingCart className="h-3 w-3" />
            {data.customer.totalOrders} orders
          </span>
          {data.customer.outstandingBalance > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <CreditCard className="h-3 w-3" />
              {fmtNaira(data.customer.outstandingBalance)} outstanding
            </span>
          )}
          {data.assignedWorker && (
            <span className="flex items-center gap-1 ml-auto">
              <UserCircle className="h-3 w-3" />
              {data.assignedWorker.name}
            </span>
          )}
        </div>
      ) : (
        <div className="px-4 py-1.5 bg-amber-500/5 border-b border-amber-500/10 flex items-center gap-2 text-xs text-amber-400/80 shrink-0">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Unknown customer · no profile for{" "}
          <span className="font-mono">{conv.customerPhone}</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <MessageSquare className="h-8 w-8 opacity-20" />
            <p className="text-sm">No messages yet</p>
          </div>
        ) : (
          rendered.map((item, i) =>
            item.type === "separator"
              ? <DaySep key={`sep-${i}`} date={item.date} />
              : <ChatBubble key={item.msg.id} msg={item.msg} />
          )
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      <div className="border-t bg-card/30 p-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={conv.status !== "open" ? "Conversation is closed — reopen to reply" : "Type a message… (⌘↩ to send)"}
            disabled={conv.status !== "open" || reply.isPending}
            rows={2}
            className={cn(
              "flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm",
              "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30",
              "disabled:opacity-50 disabled:cursor-not-allowed max-h-32"
            )}
          />
          <Button
            size="icon"
            className="h-10 w-10 rounded-xl shrink-0"
            onClick={handleSend}
            disabled={!replyText.trim() || reply.isPending || conv.status !== "open"}
          >
            {reply.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {replyText.length > 0 && (
          <p className="text-xs text-muted-foreground/50 mt-1.5 text-right">
            {replyText.length}/4096
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main InboxTab ─────────────────────────────────────────────────────────────

export function InboxTab({ isOwner = true }: { isOwner?: boolean }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ConvStatus>("open");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("list");
  const [isFetchingRefresh, setIsFetchingRefresh] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery<ConversationListResponse>({
    queryKey: ["conversations", statusFilter],
    queryFn: () => api.conversations.list({ status: statusFilter, limit: 100 }),
    refetchInterval: 15_000,
  });

  const { data: workersData } = useQuery<Worker[]>({
    queryKey: ["workers-list"],
    queryFn: () => api.workers.list(),
    enabled: isOwner,
    staleTime: 60_000,
  });

  const workers = workersData ?? [];
  const conversations = data?.conversations ?? [];
  const totalUnread = data?.totalUnread ?? 0;

  const handleSelect = (id: number) => {
    setSelectedId(id);
    setMobilePanel("messages");
  };

  const handleRefresh = async () => {
    setIsFetchingRefresh(true);
    await refetch();
    if (selectedId) qc.invalidateQueries({ queryKey: ["conversation-detail", selectedId] });
    setIsFetchingRefresh(false);
  };

  // Auto-select first conversation on desktop (initial load)
  useEffect(() => {
    if (!selectedId && conversations.length > 0 && window.innerWidth >= 768) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations.length]);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 290px)", minHeight: "520px" }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between pb-3 gap-3 flex-wrap shrink-0">
        <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
          {(["open", "resolved", "archived"] as ConvStatus[]).map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setSelectedId(null); setMobilePanel("list"); }}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                statusFilter === s
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s === "open" && totalUnread > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center bg-green-500 text-white text-[10px] font-bold rounded-full min-w-[15px] h-[15px] px-1">
                  {totalUnread}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button
          variant="ghost" size="sm" className="text-muted-foreground h-8"
          onClick={handleRefresh}
          disabled={isFetching || isFetchingRefresh}
        >
          {isFetching || isFetchingRefresh
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1.5 hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Three-panel container */}
      <div className="flex-1 rounded-xl border overflow-hidden flex min-h-0">
        {/* ── Left: Conversation list ── */}
        <div className={cn(
          "flex flex-col border-r bg-card/20",
          // Mobile: show only when on "list" panel
          mobilePanel !== "list" ? "hidden md:flex md:w-64 lg:w-72 shrink-0" : "flex w-full md:w-64 lg:w-72 shrink-0"
        )}>
          <div className="px-4 py-2.5 border-b bg-muted/10 shrink-0">
            <p className="text-xs text-muted-foreground">
              {isLoading ? "Loading…" : `${conversations.length} conversation${conversations.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-3 px-6">
                <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center">
                  <MessageSquare className="h-5 w-5 opacity-40" />
                </div>
                <div>
                  <p className="text-sm font-medium">No {statusFilter} conversations</p>
                  <p className="text-xs mt-1 leading-relaxed">
                    {statusFilter === "open"
                      ? "When customers send WhatsApp messages, they'll appear here automatically."
                      : `No ${statusFilter} conversations yet.`}
                  </p>
                </div>
              </div>
            ) : (
              conversations.map(conv => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  workers={workers}
                  selected={conv.id === selectedId}
                  onClick={() => handleSelect(conv.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Center: Message thread ── */}
        <div className={cn(
          "flex flex-col min-w-0 min-h-0",
          // Desktop: always flex-1; Mobile: show only when on "messages"
          mobilePanel === "list" && "hidden md:flex md:flex-1",
          mobilePanel === "messages" && "flex flex-1",
          mobilePanel === "context" && "hidden md:flex md:flex-1"
        )}>
          {selectedId ? (
            <MessagesPanel
              key={selectedId}
              convId={selectedId}
              workers={workers}
              isOwner={isOwner}
              onBack={() => setMobilePanel("list")}
              onShowContext={() => setMobilePanel("context")}
              mobile={window.innerWidth < 768}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4 p-6">
              <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center">
                <MessageSquare className="h-8 w-8 opacity-20" />
              </div>
              <div className="text-center">
                <p className="font-medium">Select a conversation</p>
                <p className="text-sm mt-1 text-muted-foreground/70">
                  Choose a conversation from the list to view messages and reply
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Customer context ── */}
        <div className={cn(
          "border-l bg-card/10",
          // Desktop: fixed width, always visible when something selected
          "hidden lg:flex lg:w-72 xl:w-80 shrink-0 flex-col",
          // Mobile: full width when context panel selected
          mobilePanel === "context" && "flex flex-1 lg:w-72 xl:w-80"
        )}>
          {mobilePanel === "context" && (
            <div className="flex items-center gap-2 px-4 py-3 border-b bg-card/40 shrink-0 lg:hidden">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobilePanel("messages")}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold">Customer Info</span>
            </div>
          )}
          {selectedId ? (
            <CustomerContextWrapper convId={selectedId} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/50 gap-3 p-6 text-center">
              <Users className="h-8 w-8 opacity-20" />
              <p className="text-sm">Select a conversation to see customer details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Customer context wrapper (loads detail data for right panel) ──────────────

function CustomerContextWrapper({ convId }: { convId: number }) {
  const { data, isLoading } = useQuery<ConversationDetail>({
    queryKey: ["conversation-detail", convId],
    queryFn: () => api.conversations.get(convId),
    staleTime: 5_000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 border-b bg-muted/10 shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Customer Info
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <CustomerContext detail={data} convId={convId} />
      </div>
    </div>
  );
}
