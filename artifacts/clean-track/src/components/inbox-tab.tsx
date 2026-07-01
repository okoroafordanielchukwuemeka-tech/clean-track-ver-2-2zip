/**
 * InboxTab — WhatsApp Communication Center
 *
 * Three-panel layout:
 *   Left   — conversation list with search, filters, unread badges, assignment indicators
 *   Center — message thread with reply/note composer, retry, Create Order
 *   Right  — customer context: stats, orders, balance, quick actions
 *
 * Mobile: single-panel navigation (list → messages → context)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  MessageSquare, Phone, User, CheckCircle2, Archive, RefreshCw,
  Loader2, ChevronLeft, RotateCcw, Clock, AlertCircle, ExternalLink,
  Send, AlertTriangle, ShoppingCart, CreditCard, ChevronRight,
  UserCircle, BadgeCheck, Users, X, Search, StickyNote, Plus,
  TrendingUp, Calendar, MoreHorizontal, RotateCw,
} from "lucide-react";
import { formatDistanceToNow, format, differenceInHours, differenceInDays } from "date-fns";
import type {
  Conversation, ConversationMessage, ConversationDetail,
  ConversationListResponse, Worker,
} from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

type ConvStatus = "open" | "resolved" | "archived";
type MobilePanel = "list" | "messages" | "context";
type ComposerMode = "reply" | "note";

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

function getInitials(name: string | null | undefined, phone: string): string {
  if (name) {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  return phone.slice(-2);
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

  const initials = getInitials(conv.customerName, conv.customerPhone);
  const isUnread = conv.unreadCount > 0;
  const lastMsg = conv.lastMessageBody;
  const lastMsgDir = conv.lastMessageDirection;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-3 border-b border-border/30 hover:bg-muted/20 transition-colors",
        selected && "bg-primary/8 border-l-2 border-l-primary"
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Avatar with initials */}
        <div className={cn(
          "shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold mt-0.5",
          isUnread
            ? "bg-green-500/20 border border-green-500/40 text-green-400"
            : "bg-muted/60 border border-border/50 text-muted-foreground"
        )}>
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={cn(
              "text-sm truncate",
              isUnread ? "font-bold text-foreground" : "font-medium text-foreground/90"
            )}>
              {conv.customerName ?? conv.customerPhone}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {isUnread && (
                <span className="bg-green-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {conv.unreadCount}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground/60 tabular-nums">{listTime(conv.lastMessageAt)}</span>
            </div>
          </div>

          {/* Last message preview */}
          {lastMsg && (
            <p className={cn(
              "text-xs mt-0.5 truncate leading-relaxed",
              isUnread ? "text-foreground/80" : "text-muted-foreground/60"
            )}>
              {lastMsgDir === "outbound" && (
                <span className="text-primary/60 font-medium mr-0.5">You: </span>
              )}
              {lastMsg}
            </p>
          )}

          {/* Tags row */}
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-green-500/8 text-green-400 border-green-500/20 font-medium">
              WA
            </span>
            {conv.status !== "open" && (
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize",
                conv.status === "resolved"
                  ? "bg-teal-500/10 text-teal-400 border-teal-500/20"
                  : "bg-muted text-muted-foreground border-border"
              )}>
                {conv.status}
              </span>
            )}
            {assignedWorker && (
              <span className="ml-auto text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
                <UserCircle className="h-2.5 w-2.5" />
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

function ChatBubble({
  msg, onRetry, retrying,
}: {
  msg: ConversationMessage;
  onRetry?: (msgId: number) => void;
  retrying?: boolean;
}) {
  const isInbound = msg.direction === "inbound";
  const isNote = msg.metadata?.note === true;
  const isFailed = msg.status === "failed";
  const isQueued = msg.status === "queued";

  // Internal note — amber sticky note style
  if (isNote) {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[80%]">
          <div className="rounded-xl px-3.5 py-2.5 text-sm bg-amber-500/10 border border-amber-500/20 text-amber-100">
            <div className="flex items-center gap-1.5 mb-1.5">
              <StickyNote className="h-3 w-3 text-amber-400 shrink-0" />
              <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Internal Note</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-amber-50/90 leading-relaxed">{msg.body}</p>
          </div>
          <div className="flex items-center gap-1.5 mt-1 px-1 justify-end">
            <span className="text-[11px] text-amber-400/60">{msg.senderName ?? "You"}</span>
            <span className="text-[11px] text-muted-foreground/30">·</span>
            <span className="text-[11px] text-muted-foreground/50">{bubbleTime(msg.createdAt)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2 mb-3", isInbound ? "justify-start" : "justify-end")}>
      {isInbound && (
        <div className="shrink-0 w-7 h-7 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mt-1">
          <User className="h-3.5 w-3.5 text-green-400" />
        </div>
      )}
      <div className="max-w-[78%]">
        <div className={cn(
          "rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isInbound
            ? "bg-muted/60 text-foreground rounded-tl-sm border border-border/40"
            : isFailed
            ? "bg-red-500/15 text-red-200 border border-red-500/25 rounded-tr-sm"
            : "bg-primary text-primary-foreground rounded-tr-sm"
        )}>
          <p className="whitespace-pre-wrap break-words">{msg.body}</p>
          {isFailed && (
            <p className="text-[11px] text-red-400 mt-1">Failed to send</p>
          )}
        </div>
        <div className={cn(
          "flex items-center gap-1.5 mt-1 px-1",
          isInbound ? "justify-start" : "justify-end"
        )}>
          <span className="text-[11px] text-muted-foreground/60">
            {isInbound ? (msg.senderName ?? "Customer") : (msg.senderName ?? "You")}
          </span>
          <span className="text-[11px] text-muted-foreground/30">·</span>
          <span className="text-[11px] text-muted-foreground/60">{bubbleTime(msg.createdAt)}</span>
          {!isInbound && msg.status && (
            <>
              {isQueued && <Clock className="h-3 w-3 text-muted-foreground/40" />}
              {msg.status === "sent" && <BadgeCheck className="h-3 w-3 text-muted-foreground/50" />}
              {msg.status === "delivered" && <BadgeCheck className="h-3 w-3 text-green-400" />}
              {msg.status === "read" && <BadgeCheck className="h-3 w-3 text-blue-400" />}
              {isFailed && onRetry && (
                <button
                  onClick={() => onRetry(msg.id)}
                  disabled={retrying}
                  className="flex items-center gap-0.5 text-[11px] text-red-400 hover:text-red-300 transition-colors"
                >
                  <RotateCw className="h-2.5 w-2.5" />
                  {retrying ? "Retrying…" : "Retry"}
                </button>
              )}
            </>
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
      <div className="flex-1 border-t border-border/30" />
      <span className="text-xs text-muted-foreground/50 px-2">{separatorLabel(date)}</span>
      <div className="flex-1 border-t border-border/30" />
    </div>
  );
}

// ── Customer Context Panel ────────────────────────────────────────────────────

function CustomerContext({
  detail, convId,
}: {
  detail: ConversationDetail; convId: number;
}) {
  const qc = useQueryClient();
  const { customer, conversation: conv } = detail;

  const addNote = useMutation({
    mutationFn: (body: string) => api.conversations.addNote(convId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-detail", convId] });
      toast.success("Note added");
    },
    onError: () => toast.error("Failed to add note"),
  });

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-5 text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <p className="font-medium text-sm">Unknown Customer</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            No profile found for{" "}
            <span className="font-mono text-foreground">{conv.customerPhone}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Ask them to mention their name or order number.
          </p>
        </div>
      </div>
    );
  }

  const hasBalance = customer.outstandingBalance > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Customer card */}
      <div className="px-4 pt-4 pb-3 border-b border-border/40">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
            {getInitials(customer.fullName, customer.phone)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">{customer.fullName}</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{customer.phone}</p>
            <Link
              to={`/customers/${customer.id}`}
              className="text-xs text-primary hover:underline flex items-center gap-0.5 mt-1"
            >
              Full profile <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 px-3 py-3 border-b border-border/40">
        <div className="bg-muted/25 rounded-lg p-2.5 text-center">
          <p className="text-base font-bold">{customer.totalOrders}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Orders</p>
        </div>
        <div className={cn(
          "rounded-lg p-2.5 text-center",
          hasBalance ? "bg-red-500/10" : "bg-muted/25"
        )}>
          <p className={cn("text-base font-bold tabular-nums", hasBalance ? "text-red-400" : "")}>
            {fmtNaira(customer.outstandingBalance)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Outstanding</p>
        </div>
        {customer.totalSpent !== undefined && customer.totalSpent > 0 && (
          <div className="bg-muted/25 rounded-lg p-2.5 text-center col-span-2">
            <div className="flex items-center justify-center gap-1.5">
              <TrendingUp className="h-3 w-3 text-emerald-400" />
              <p className="text-sm font-bold text-emerald-400 tabular-nums">{fmtNaira(customer.totalSpent)}</p>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Total Spent</p>
          </div>
        )}
        {customer.lastOrderAt && (
          <div className="bg-muted/25 rounded-lg p-2.5 text-center col-span-2">
            <div className="flex items-center justify-center gap-1.5">
              <Calendar className="h-3 w-3 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{relTime(customer.lastOrderAt)}</p>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Last Order</p>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="px-3 py-3 border-b border-border/40 space-y-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Quick Actions
        </p>
        <Link
          to={`/orders/new?customerId=${customer.id}&customerName=${encodeURIComponent(customer.fullName)}&phone=${encodeURIComponent(customer.phone)}`}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          Create Order
        </Link>
        <Link
          to={`/orders?customerId=${customer.id}`}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted/30 transition-colors"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
          View All Orders
        </Link>
        {hasBalance && (
          <Link
            to={`/orders?customerId=${customer.id}&paymentStatus=unpaid`}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/5 transition-colors"
          >
            <CreditCard className="h-3.5 w-3.5" />
            Record Payment ({fmtNaira(customer.outstandingBalance)})
          </Link>
        )}
        <button
          onClick={() => {
            const note = window.prompt("Add internal note (only visible to your team):");
            if (note?.trim()) addNote.mutate(note.trim());
          }}
          disabled={addNote.isPending}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted/30 transition-colors text-left"
        >
          <StickyNote className="h-3.5 w-3.5 text-amber-400" />
          Add Internal Note
        </button>
      </div>

      {/* Active orders */}
      {customer.activeOrders.length > 0 && (
        <div className="px-3 py-3 border-b border-border/40">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Active Orders ({customer.activeOrders.length})
          </p>
          <div className="space-y-1.5">
            {customer.activeOrders.map(order => (
              <Link
                key={order.id}
                to={`/orders/${order.id}`}
                className="block bg-muted/15 hover:bg-muted/30 border border-border/40 rounded-lg p-2.5 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-medium">{order.orderId}</span>
                  <div className="flex gap-1">
                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded border font-medium capitalize", STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground")}>
                      {order.status}
                    </span>
                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded border font-medium capitalize", PAY_COLORS[order.paymentStatus] ?? "bg-muted text-muted-foreground")}>
                      {order.paymentStatus}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[11px] text-muted-foreground capitalize">{order.serviceType}</span>
                  <span className="text-[11px] font-medium">{fmtNaira(parseFloat(order.price || "0"))}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent orders */}
      {customer.recentOrders.length > 0 && (
        <div className="px-3 py-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Recent History
          </p>
          <div className="space-y-1">
            {customer.recentOrders.map(order => (
              <Link
                key={order.id}
                to={`/orders/${order.id}`}
                className="flex items-center gap-2 p-2 hover:bg-muted/15 rounded-lg transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-mono">{order.orderId}</p>
                  <p className="text-[10px] text-muted-foreground">{relTime(order.createdAt)}</p>
                </div>
                <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
                  {fmtNaira(parseFloat(order.price || "0"))}
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {customer.totalOrders === 0 && (
        <div className="px-4 py-6 text-center text-muted-foreground">
          <ShoppingCart className="h-7 w-7 mx-auto mb-2 opacity-25" />
          <p className="text-sm">No orders yet</p>
          <p className="text-xs mt-1 text-muted-foreground/60">Use the button above to create their first</p>
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
        <span>{current ? current.name.split(" ")[0] : "Assign"}</span>
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
  convId, workers, isOwner, canReply, canManage, onBack, onShowContext, mobile,
}: {
  convId: number; workers: Worker[];
  isOwner: boolean; canReply: boolean; canManage: boolean;
  onBack: () => void; onShowContext: () => void; mobile: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const markedRead = useRef(false);
  const [composerText, setComposerText] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("reply");
  const [retryingId, setRetryingId] = useState<number | null>(null);

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
      toast.success(
        s === "resolved" ? "Conversation resolved" :
        s === "archived" ? "Archived" : "Reopened"
      );
    },
    onError: () => toast.error("Failed to update conversation"),
  });

  const reply = useMutation({
    mutationFn: (body: string) => api.conversations.reply(convId, body),
    onSuccess: (data) => {
      setComposerText("");
      qc.invalidateQueries({ queryKey: ["conversation-detail", convId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (!data.delivered) {
        toast.info("Message saved — WhatsApp not connected yet");
      }
    },
    onError: () => toast.error("Failed to send reply"),
  });

  const addNote = useMutation({
    mutationFn: (body: string) => api.conversations.addNote(convId, body),
    onSuccess: () => {
      setComposerText("");
      qc.invalidateQueries({ queryKey: ["conversation-detail", convId] });
      toast.success("Internal note added");
    },
    onError: () => toast.error("Failed to add note"),
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

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [composerText]);

  const isSending = composerMode === "reply" ? reply.isPending : addNote.isPending;

  const handleSend = useCallback(() => {
    const body = composerText.trim();
    if (!body || isSending) return;
    if (composerMode === "reply") {
      reply.mutate(body);
    } else {
      addNote.mutate(body);
    }
  }, [composerText, composerMode, isSending, reply, addNote]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const handleRetry = useCallback(async (msgId: number) => {
    if (!data) return;
    const msg = data.messages.find(m => m.id === msgId);
    if (!msg) return;
    setRetryingId(msgId);
    try {
      await reply.mutateAsync(msg.body);
      toast.success("Message re-sent");
    } catch {
      toast.error("Retry failed");
    } finally {
      setRetryingId(null);
    }
  }, [data, reply]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;

  const { conversation: conv, messages } = data;
  const isOpen = conv.status === "open";

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
      <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-card/40 shrink-0">
        {mobile && (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0 text-xs font-bold text-green-400">
          {getInitials(conv.customerName, conv.customerPhone)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight truncate">
            {conv.customerName ?? conv.customerPhone}
          </p>
          {conv.customerName && (
            <p className="text-xs text-muted-foreground font-mono leading-tight">{conv.customerPhone}</p>
          )}
        </div>

        {/* Create Order quick action */}
        {data.customer && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs hidden sm:flex items-center gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            onClick={() =>
              navigate(
                `/orders/new?customerId=${data.customer!.id}&customerName=${encodeURIComponent(data.customer!.fullName)}&phone=${encodeURIComponent(data.customer!.phone)}`
              )
            }
          >
            <Plus className="h-3 w-3" />
            Order
          </Button>
        )}

        {/* Assignment (owner only) */}
        {isOwner && (
          <AssignDropdown
            convId={convId}
            currentWorkerId={conv.assignedWorkerId}
            workers={workers}
            onAssigned={() => {}}
          />
        )}

        {/* Status actions — owner or workers with manage permission */}
        <div className="flex items-center gap-1 shrink-0">
          {canManage && isOpen && (
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
          {canManage && !isOpen && (
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
        <div className="px-3 py-1.5 bg-green-500/5 border-b border-green-500/10 flex items-center gap-3 text-xs text-muted-foreground shrink-0 flex-wrap">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3 text-green-400" />
            <span className="font-medium text-foreground">{data.customer.fullName}</span>
          </span>
          <span className="hidden sm:flex items-center gap-1">
            <ShoppingCart className="h-3 w-3" />
            {data.customer.totalOrders} orders
          </span>
          {data.customer.totalSpent !== undefined && data.customer.totalSpent > 0 && (
            <span className="hidden md:flex items-center gap-1 text-emerald-400">
              <TrendingUp className="h-3 w-3" />
              {fmtNaira(data.customer.totalSpent)} spent
            </span>
          )}
          {data.customer.outstandingBalance > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <CreditCard className="h-3 w-3" />
              {fmtNaira(data.customer.outstandingBalance)} owed
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
        <div className="px-3 py-1.5 bg-amber-500/5 border-b border-amber-500/10 flex items-center gap-2 text-xs text-amber-400/80 shrink-0">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Unknown customer ·{" "}
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
              : (
                <ChatBubble
                  key={item.msg.id}
                  msg={item.msg}
                  onRetry={handleRetry}
                  retrying={retryingId === item.msg.id}
                />
              )
          )
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer — only for users who can reply */}
      {!canReply && (
        <div className="border-t px-4 py-3 bg-muted/20 shrink-0 flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          You have read-only access to this conversation.
        </div>
      )}
      {canReply && (
      <div className={cn(
        "border-t p-3 shrink-0 transition-colors",
        composerMode === "note" ? "bg-amber-500/5 border-amber-500/15" : "bg-card/30"
      )}>
        {/* Mode toggle */}
        {isOpen && (
          <div className="flex items-center gap-1 mb-2">
            <button
              onClick={() => setComposerMode("reply")}
              className={cn(
                "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-all",
                composerMode === "reply"
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              )}
            >
              <Send className="h-3 w-3" />
              Reply to customer
            </button>
            <button
              onClick={() => setComposerMode("note")}
              className={cn(
                "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-all",
                composerMode === "note"
                  ? "bg-amber-500/20 text-amber-400 font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              )}
            >
              <StickyNote className="h-3 w-3" />
              Internal note
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={composerText}
            onChange={e => setComposerText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !isOpen
                ? "Conversation is closed — reopen to reply"
                : composerMode === "note"
                ? "Write an internal note (not sent to customer)… ⌘↩ to save"
                : "Type a message… ⌘↩ to send"
            }
            disabled={!isOpen || isSending}
            rows={1}
            className={cn(
              "flex-1 resize-none rounded-xl border px-3 py-2.5 text-sm",
              "placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2",
              "disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden",
              "transition-colors",
              composerMode === "note"
                ? "border-amber-500/30 bg-amber-500/5 focus:ring-amber-500/20"
                : "border-border bg-background focus:ring-primary/30"
            )}
            style={{ minHeight: "40px", maxHeight: "120px" }}
          />
          <Button
            size="icon"
            className={cn(
              "h-10 w-10 rounded-xl shrink-0 transition-colors",
              composerMode === "note" && "bg-amber-500 hover:bg-amber-500/90 text-white"
            )}
            onClick={handleSend}
            disabled={!composerText.trim() || isSending || !isOpen}
            title={composerMode === "note" ? "Save note" : "Send message"}
          >
            {isSending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : composerMode === "note"
              ? <StickyNote className="h-4 w-4" />
              : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          {composerMode === "note" && (
            <span className="text-[10px] text-amber-400/70">Not sent to customer</span>
          )}
          {composerText.length > 0 && (
            <span className="text-[10px] text-muted-foreground/40 ml-auto">{composerText.length}/4096</span>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// ── Main InboxTab ─────────────────────────────────────────────────────────────

export function InboxTab() {
  const { isOwner, hasPermission } = useAuth();
  const canView   = isOwner || hasPermission("canViewWhatsApp");
  const canReply  = isOwner || hasPermission("canReplyWhatsApp");
  const canManage = isOwner || hasPermission("canManageWhatsApp");

  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ConvStatus>("open");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("list");
  const [isFetchingRefresh, setIsFetchingRefresh] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, isFetching, refetch } = useQuery<ConversationListResponse>({
    queryKey: ["conversations", statusFilter],
    queryFn: () => api.conversations.list({ status: statusFilter, limit: 100 }),
    refetchInterval: 15_000,
    enabled: canView,
  });

  const { data: workersData } = useQuery<Worker[]>({
    queryKey: ["workers-list"],
    queryFn: () => api.workers.list(),
    enabled: isOwner,
    staleTime: 60_000,
  });

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4 text-muted-foreground">
        <div className="w-14 h-14 rounded-full bg-muted/30 flex items-center justify-center">
          <MessageSquare className="h-6 w-6 opacity-30" />
        </div>
        <div>
          <p className="font-semibold text-foreground">WhatsApp Access Required</p>
          <p className="text-sm mt-1.5 max-w-xs leading-relaxed">
            You do not have permission to view WhatsApp conversations.
            Ask your owner to grant the <span className="font-medium text-foreground">View Conversations</span> permission.
          </p>
        </div>
      </div>
    );
  }

  const workers = workersData ?? [];
  const allConversations = data?.conversations ?? [];
  const totalUnread = data?.totalUnread ?? 0;

  // Client-side search filter
  const conversations = searchQuery.trim()
    ? allConversations.filter(c => {
        const q = searchQuery.toLowerCase();
        return (
          (c.customerName ?? "").toLowerCase().includes(q) ||
          c.customerPhone.includes(q)
        );
      })
    : allConversations;

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
    if (!selectedId && allConversations.length > 0 && window.innerWidth >= 768) {
      setSelectedId(allConversations[0].id);
    }
  }, [allConversations.length]);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 290px)", minHeight: "520px" }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between pb-3 gap-3 flex-wrap shrink-0">
        <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
          {(["open", "resolved", "archived"] as ConvStatus[]).map(s => (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                setSelectedId(null);
                setMobilePanel("list");
                setSearchQuery("");
              }}
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
          mobilePanel !== "list" ? "hidden md:flex md:w-64 lg:w-72 shrink-0" : "flex w-full md:w-64 lg:w-72 shrink-0"
        )}>
          {/* Search */}
          <div className="px-3 py-2 border-b bg-muted/10 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name or phone…"
                className="w-full bg-muted/30 border border-border/50 rounded-lg pl-8 pr-3 py-1.5 text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-1.5">
              {isLoading ? "Loading…" : `${conversations.length}${searchQuery ? " found" : ""} conversation${conversations.length !== 1 ? "s" : ""}`}
            </p>
          </div>

          {/* List */}
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
                  <p className="text-sm font-medium">
                    {searchQuery ? "No results" : `No ${statusFilter} conversations`}
                  </p>
                  <p className="text-xs mt-1 leading-relaxed">
                    {searchQuery
                      ? "Try a different name or phone number"
                      : statusFilter === "open"
                      ? "Customer WhatsApp messages will appear here automatically."
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
              canReply={canReply}
              canManage={canManage}
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
                  Choose from the list to view messages and reply
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Customer context ── */}
        <div className={cn(
          "border-l bg-card/10",
          "hidden lg:flex lg:w-72 xl:w-80 shrink-0 flex-col",
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

// ── Customer context wrapper ───────────────────────────────────────────────────

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
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Customer Info
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <CustomerContext detail={data} convId={convId} />
      </div>
    </div>
  );
}
