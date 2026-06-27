/**
 * InboxTab — WhatsApp Shared Inbox
 *
 * Two-panel layout: conversation list (left) + message thread (right).
 * - Inbound messages (from customer) shown as left-aligned green bubbles.
 * - Outbound messages (from business) shown as right-aligned blue bubbles.
 * - Auto-marks conversation read when opened.
 * - Polls every 10s for new messages, 15s for conversation list.
 * - Customer context bar links to customer profile and orders.
 * - Status controls: Resolve, Archive, Reopen.
 */

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  MessageSquare,
  Phone,
  User,
  CheckCircle2,
  Archive,
  RefreshCw,
  Loader2,
  ChevronLeft,
  RotateCcw,
  Clock,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { formatDistanceToNow, format, differenceInHours } from "date-fns";
import type {
  ConversationListResponse,
  ConversationDetail,
  Conversation,
  ConversationMessage,
} from "@/lib/api";

type ConvStatus = "open" | "resolved" | "archived";

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: string | Date | null | undefined): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const hours = differenceInHours(new Date(), d);
    if (hours < 24) return format(d, "h:mm a");
    if (hours < 168) return format(d, "EEE h:mm a");
    return format(d, "MMM d");
  } catch {
    return "";
  }
}

function msgTimeLabel(ts: string | Date): string {
  try {
    const d = new Date(ts);
    const hours = differenceInHours(new Date(), d);
    if (hours < 24) return format(d, "h:mm a");
    if (hours < 168) return format(d, "EEE h:mm a");
    return format(d, "MMM d, h:mm a");
  } catch {
    return "";
  }
}

function relativeTime(ts: string | Date | null | undefined): string {
  if (!ts) return "";
  try {
    return formatDistanceToNow(new Date(ts), { addSuffix: true });
  } catch {
    return "";
  }
}

// ── Conversation list item ────────────────────────────────────────────────────

function ConvItem({
  conv,
  selected,
  onClick,
}: {
  conv: Conversation;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors",
        selected && "bg-primary/10 border-l-[3px] border-l-primary"
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 w-9 h-9 rounded-full bg-green-500/15 flex items-center justify-center mt-0.5">
          <User className="h-4 w-4 text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={cn("text-sm truncate", conv.unreadCount > 0 ? "font-bold" : "font-medium")}>
              {conv.customerName ?? conv.customerPhone}
            </span>
            <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
              {timeAgo(conv.lastMessageAt)}
            </span>
          </div>
          {conv.customerName && (
            <p className="text-xs text-muted-foreground font-mono truncate">{conv.customerPhone}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-medium border border-green-500/20">
              WhatsApp
            </span>
            {conv.status !== "open" && (
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded font-medium border",
                conv.status === "resolved"
                  ? "bg-teal-500/10 text-teal-400 border-teal-500/20"
                  : "bg-muted text-muted-foreground border-border"
              )}>
                {conv.status}
              </span>
            )}
            {conv.unreadCount > 0 && (
              <span className="ml-auto bg-green-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {conv.unreadCount}
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
    <div className={cn("flex gap-2 mb-3", isInbound ? "justify-start" : "justify-end")}>
      {isInbound && (
        <div className="shrink-0 w-7 h-7 rounded-full bg-green-500/15 flex items-center justify-center mt-1 border border-green-500/20">
          <User className="h-3.5 w-3.5 text-green-400" />
        </div>
      )}
      <div className="max-w-[75%]">
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
            isInbound
              ? "bg-muted/80 text-foreground rounded-tl-sm border border-border/50"
              : "bg-primary text-primary-foreground rounded-tr-sm"
          )}
        >
          <p className="whitespace-pre-wrap break-words">{msg.body}</p>
        </div>
        <div className={cn("flex items-center gap-1 mt-0.5 px-1", isInbound ? "justify-start" : "justify-end")}>
          <span className="text-xs text-muted-foreground/70">
            {isInbound
              ? (msg.senderName ?? "Customer")
              : (msg.senderName ?? "CleanTrack")}
          </span>
          <span className="text-xs text-muted-foreground/50">·</span>
          <span className="text-xs text-muted-foreground/70">{msgTimeLabel(msg.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Day separator ────────────────────────────────────────────────────────────

function DaySeparator({ date }: { date: Date }) {
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  const label =
    diffDays === 0 ? "Today" :
    diffDays === 1 ? "Yesterday" :
    format(date, "MMMM d, yyyy");

  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 border-t border-border/50" />
      <span className="text-xs text-muted-foreground px-2">{label}</span>
      <div className="flex-1 border-t border-border/50" />
    </div>
  );
}

// ── Conversation detail panel ────────────────────────────────────────────────

function ConvDetail({
  convId,
  onBack,
}: {
  convId: number;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const markedRead = useRef(false);

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
    mutationFn: (status: ConvStatus) =>
      api.conversations.updateStatus(convId, status),
    onSuccess: (_, status) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation-detail", convId] });
      toast.success(
        status === "resolved"
          ? "Conversation resolved"
          : status === "archived"
          ? "Conversation archived"
          : "Conversation reopened"
      );
    },
    onError: () => toast.error("Failed to update conversation"),
  });

  // Auto-mark-read once when conversation opens with unread messages
  useEffect(() => {
    markedRead.current = false;
  }, [convId]);

  useEffect(() => {
    if (
      !markedRead.current &&
      data?.conversation?.unreadCount &&
      data.conversation.unreadCount > 0
    ) {
      markedRead.current = true;
      markRead.mutate();
    }
  }, [data?.conversation?.unreadCount]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (data?.messages?.length) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [data?.messages?.length]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const { conversation: conv, messages, customer } = data;

  // Group messages by day for separators
  const messagesWithDates = messages.map((msg, i) => {
    const date = new Date(msg.createdAt);
    const prevDate = i > 0 ? new Date(messages[i - 1].createdAt) : null;
    const showSeparator =
      !prevDate ||
      date.toDateString() !== prevDate.toDateString();
    return { msg, showSeparator, date };
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card/50 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-8 w-8 shrink-0"
          onClick={onBack}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="w-9 h-9 rounded-full bg-green-500/15 flex items-center justify-center shrink-0 border border-green-500/20">
          <User className="h-4 w-4 text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">
              {conv.customerName ?? conv.customerPhone}
            </p>
            {customer && (
              <Link
                to={`/customers/${customer.id}`}
                className="text-xs text-primary hover:underline flex items-center gap-0.5"
              >
                View profile
                <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">{conv.customerPhone}</p>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {conv.status === "open" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-teal-500/30 text-teal-400 hover:bg-teal-500/10 hover:text-teal-300"
                onClick={() => updateStatus.mutate("resolved")}
                disabled={updateStatus.isPending}
              >
                {updateStatus.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                )}
                Resolve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => updateStatus.mutate("archived")}
                disabled={updateStatus.isPending}
                title="Archive"
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {conv.status !== "open" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => updateStatus.mutate("open")}
              disabled={updateStatus.isPending}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reopen
            </Button>
          )}
        </div>
      </div>

      {/* Customer context bar */}
      {customer ? (
        <div className="px-4 py-2 bg-green-500/5 border-b border-green-500/10 flex items-center gap-4 text-xs text-muted-foreground shrink-0">
          <span className="flex items-center gap-1.5">
            <User className="h-3 w-3 text-green-400" />
            <span className="text-foreground font-medium">{customer.fullName}</span>
            <span className="text-muted-foreground">linked</span>
          </span>
          <span className="flex items-center gap-1">
            <Phone className="h-3 w-3" />
            {customer.phone}
          </span>
          <Link
            to={`/orders?customerId=${customer.id}`}
            className="text-primary hover:underline flex items-center gap-0.5"
          >
            View orders
            <ExternalLink className="h-2.5 w-2.5 ml-0.5" />
          </Link>
        </div>
      ) : (
        <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/10 flex items-center gap-2 text-xs text-amber-400/80 shrink-0">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Unknown customer — no profile found for{" "}
          <span className="font-mono text-amber-300">{conv.customerPhone}</span>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <MessageSquare className="h-8 w-8 opacity-25" />
            <p className="text-sm">No messages yet</p>
          </div>
        ) : (
          <>
            {messagesWithDates.map(({ msg, showSeparator, date }) => (
              <div key={msg.id}>
                {showSeparator && <DaySeparator date={date} />}
                <ChatBubble msg={msg} />
              </div>
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer metadata */}
      <div className="px-4 py-2 border-t bg-card/30 flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>Started {relativeTime(conv.createdAt)}</span>
        <span>·</span>
        <span>
          {messages.length} message{messages.length !== 1 ? "s" : ""}
        </span>
        {conv.assignedWorkerId && (
          <>
            <span>·</span>
            <span>Assigned</span>
          </>
        )}
        {conv.status !== "open" && (
          <span
            className={cn(
              "ml-auto px-2 py-0.5 rounded capitalize font-medium",
              conv.status === "resolved"
                ? "bg-teal-500/10 text-teal-400"
                : "bg-muted text-muted-foreground"
            )}
          >
            {conv.status}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main InboxTab export ──────────────────────────────────────────────────────

export function InboxTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ConvStatus>("open");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const {
    data,
    isLoading,
    refetch,
    isFetching,
  } = useQuery<ConversationListResponse>({
    queryKey: ["conversations", statusFilter],
    queryFn: () =>
      api.conversations.list({ status: statusFilter, limit: 100 }),
    refetchInterval: 15_000,
  });

  const conversations = data?.conversations ?? [];
  const totalUnread = data?.totalUnread ?? 0;

  const handleSelect = (id: number) => {
    setSelectedId(id);
    setShowDetail(true);
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 300px)", minHeight: "520px" }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between pb-3 gap-3 flex-wrap">
        <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
          {(["open", "resolved", "archived"] as ConvStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                setSelectedId(null);
                setShowDetail(false);
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
                <span className="ml-1.5 inline-flex items-center justify-center bg-green-500 text-white text-xs font-bold rounded-full min-w-[16px] h-4 px-1">
                  {totalUnread}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-8"
          onClick={() => {
            refetch();
            if (selectedId) {
              qc.invalidateQueries({
                queryKey: ["conversation-detail", selectedId],
              });
            }
          }}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {/* Two-panel layout */}
      <div className="flex-1 rounded-lg border overflow-hidden flex min-h-0">
        {/* ── Left: Conversation list ── */}
        <div
          className={cn(
            "flex flex-col border-r bg-card/30",
            showDetail
              ? "hidden md:flex md:w-72 lg:w-80 shrink-0"
              : "flex w-full md:w-72 lg:w-80 shrink-0"
          )}
        >
          <div className="px-4 py-2.5 border-b bg-muted/20 shrink-0">
            <p className="text-xs text-muted-foreground">
              {isLoading
                ? "Loading…"
                : `${conversations.length} conversation${conversations.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading…
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-3 px-6">
                <div className="w-12 h-12 rounded-full bg-muted/40 flex items-center justify-center">
                  <MessageSquare className="h-6 w-6 opacity-40" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    No {statusFilter} conversations
                  </p>
                  <p className="text-xs mt-1 leading-relaxed">
                    {statusFilter === "open"
                      ? "When customers send WhatsApp messages, they'll appear here automatically."
                      : `No ${statusFilter} conversations yet.`}
                  </p>
                </div>
              </div>
            ) : (
              conversations.map((conv) => (
                <ConvItem
                  key={conv.id}
                  conv={conv as Conversation}
                  selected={conv.id === selectedId}
                  onClick={() => handleSelect(conv.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Right: Message detail ── */}
        <div
          className={cn(
            "flex-1 flex flex-col min-w-0 min-h-0",
            !showDetail && "hidden md:flex"
          )}
        >
          {selectedId ? (
            <ConvDetail
              convId={selectedId}
              onBack={() => setShowDetail(false)}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
              <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center">
                <MessageSquare className="h-8 w-8 opacity-25" />
              </div>
              <div className="text-center">
                <p className="font-medium text-base">Select a conversation</p>
                <p className="text-sm mt-1 text-muted-foreground/70">
                  Choose a conversation from the list to view the message thread
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
