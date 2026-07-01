/**
 * ActivityTab — WhatsApp Worker Activity Audit Log
 *
 * Shows a chronological feed of worker actions inside the WhatsApp inbox.
 * Each entry shows who did what, to whom, and when.
 * Owners see all activity. Workers with canManageWhatsApp see all activity.
 * Workers without that permission see a permission wall.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth-context";
import {
  MessageSquare, CheckCircle2, Archive, RotateCcw,
  Loader2, RefreshCw, StickyNote, UserCircle, Shield,
} from "lucide-react";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import type { WhatsAppActivityLog, WhatsAppActivityResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

function relTime(ts: string): string {
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); }
  catch { return ""; }
}

function dayLabel(date: Date): string {
  const days = differenceInDays(new Date(), date);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return format(date, "EEEE");
  return format(date, "MMMM d, yyyy");
}

function groupByDay(logs: WhatsAppActivityLog[]) {
  const map = new Map<string, { date: Date; logs: WhatsAppActivityLog[] }>();
  for (const log of logs) {
    try {
      const d = new Date(log.createdAt);
      const key = d.toDateString();
      if (!map.has(key)) map.set(key, { date: d, logs: [] });
      map.get(key)!.logs.push(log);
    } catch {}
  }
  return Array.from(map.values());
}

function customerDisplay(l: WhatsAppActivityLog): string {
  return l.customerName ?? l.customerPhone ?? l.metadata?.customerPhone ?? "customer";
}

const ACTION_CONFIG: Record<string, {
  icon: React.ElementType;
  color: string;
  bg: string;
  label: (log: WhatsAppActivityLog) => string;
}> = {
  MESSAGE_SENT: {
    icon: MessageSquare,
    color: "text-green-400",
    bg: "bg-green-500/10",
    label: (l) => `${l.actorName} replied to ${customerDisplay(l)}`,
  },
  NOTE_ADDED: {
    icon: StickyNote,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    label: (l) => `${l.actorName} added a note on ${customerDisplay(l)}`,
  },
  CONVERSATION_RESOLVED: {
    icon: CheckCircle2,
    color: "text-teal-400",
    bg: "bg-teal-500/10",
    label: (l) => `${l.actorName} resolved conversation with ${customerDisplay(l)}`,
  },
  CONVERSATION_ARCHIVED: {
    icon: Archive,
    color: "text-muted-foreground",
    bg: "bg-muted/30",
    label: (l) => `${l.actorName} archived conversation with ${customerDisplay(l)}`,
  },
  CONVERSATION_REOPENED: {
    icon: RotateCcw,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    label: (l) => `${l.actorName} reopened conversation with ${customerDisplay(l)}`,
  },
  CONVERSATION_ASSIGNED: {
    icon: UserCircle,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    label: (l) => {
      const to = l.metadata?.assignedWorkerName
        ? `to ${l.metadata.assignedWorkerName}`
        : `for ${customerDisplay(l)}`;
      return `${l.actorName} assigned ${to}`;
    },
  },
};

function ActivityRow({
  log,
  onOpenConversation,
}: {
  log: WhatsAppActivityLog;
  onOpenConversation?: (convId: number) => void;
}) {
  const cfg = ACTION_CONFIG[log.action] ?? {
    icon: MessageSquare,
    color: "text-muted-foreground",
    bg: "bg-muted/20",
    label: (l: WhatsAppActivityLog) => `${l.actorName} performed ${l.action}`,
  };
  const Icon = cfg.icon;
  const label = cfg.label(log);
  const snippet = log.metadata?.messageSnippet as string | undefined;

  const inner = (
    <>
      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5", cfg.bg)}>
        <Icon className={cn("h-4 w-4", cfg.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">{label}</p>
        {snippet && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate italic">"{snippet}"</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">{relTime(log.createdAt)}</p>
      </div>
      <span className="text-[10px] text-muted-foreground/50 shrink-0 self-start mt-0.5">
        {format(new Date(log.createdAt), "h:mm a")}
      </span>
    </>
  );

  if (log.conversationId && onOpenConversation) {
    return (
      <button
        onClick={() => onOpenConversation(log.conversationId!)}
        className="w-full flex items-start gap-3 p-3 rounded-xl border border-border/50 hover:bg-muted/20 hover:border-border transition-colors text-left"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border/50">
      {inner}
    </div>
  );
}

export function ActivityTab({ onOpenConversation }: { onOpenConversation: (convId: number) => void }) {
  const { isOwner, hasPermission } = useAuth();
  const canView = isOwner || hasPermission("canManageWhatsApp");

  const { data, isLoading, refetch, isFetching } = useQuery<WhatsAppActivityResponse>({
    queryKey: ["whatsapp-activity"],
    queryFn: () => api.conversations.getActivity({ limit: 100 }),
    refetchInterval: 30_000,
    enabled: canView,
  });

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4 text-muted-foreground">
        <div className="w-14 h-14 rounded-full bg-muted/20 flex items-center justify-center">
          <Shield className="h-6 w-6 opacity-30" />
        </div>
        <div>
          <p className="font-semibold text-foreground">Access Restricted</p>
          <p className="text-sm mt-1.5 max-w-xs leading-relaxed">
            Only owners and workers with the <span className="font-medium text-foreground">Manage WhatsApp</span> permission can view activity logs.
          </p>
        </div>
      </div>
    );
  }

  const logs = data?.logs ?? [];
  const grouped = groupByDay(logs);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {logs.length > 0
            ? <><span className="text-foreground font-semibold">{data?.total ?? logs.length}</span> total actions · showing last <span className="text-foreground font-semibold">{logs.length}</span></>
            : "No activity recorded yet"
          }
        </div>
        <Button
          variant="ghost" size="sm" className="h-8 text-muted-foreground"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading activity…
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
          <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center">
            <MessageSquare className="h-8 w-8 opacity-25" />
          </div>
          <div className="text-center">
            <p className="font-medium">No activity yet</p>
            <p className="text-sm mt-1 text-muted-foreground/70">
              Worker actions in the WhatsApp inbox will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ date, logs: dayLogs }) => (
            <div key={date.toDateString()}>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 border-t border-border/40" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {dayLabel(date)}
                </span>
                <div className="flex-1 border-t border-border/40" />
              </div>
              <div className="space-y-2">
                {dayLogs.map(log => (
                  <ActivityRow
                    key={log.id}
                    log={log}
                    onOpenConversation={onOpenConversation}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
