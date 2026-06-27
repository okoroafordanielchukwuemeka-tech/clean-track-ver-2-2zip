/**
 * ActivityTab — Conversation Timeline
 *
 * Shows recent WhatsApp conversation events in a chronological feed.
 * Groups activity by date. Each entry shows what happened, who was involved,
 * and quick-links to the relevant conversation.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  MessageSquare, CheckCircle2, Archive, RotateCcw,
  Loader2, RefreshCw, Circle, UserCircle, Phone,
} from "lucide-react";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import type { ConversationListResponse, Conversation } from "@/lib/api";
import { cn } from "@/lib/utils";

function relTime(ts: string): string {
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); }
  catch { return ""; }
}

function dayLabel(date: Date): string {
  const days = differenceInDays(new Date(), date);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return format(date, "EEEE"); // Monday, Tuesday...
  return format(date, "MMMM d, yyyy");
}

interface ActivityEvent {
  id: string;
  convId: number;
  customerName: string | null;
  customerPhone: string;
  type: "new_message" | "resolved" | "archived" | "reopened" | "unread";
  ts: string;
  assignedWorkerId: number | null;
}

const EVENT_CONFIG = {
  new_message: { icon: MessageSquare, label: "New message", color: "text-green-400", bg: "bg-green-500/10" },
  unread:      { icon: Circle,        label: "Unread messages", color: "text-amber-400", bg: "bg-amber-500/10" },
  resolved:    { icon: CheckCircle2,  label: "Resolved",        color: "text-teal-400",  bg: "bg-teal-500/10" },
  archived:    { icon: Archive,       label: "Archived",        color: "text-muted-foreground", bg: "bg-muted/30" },
  reopened:    { icon: RotateCcw,     label: "Reopened",        color: "text-blue-400",  bg: "bg-blue-500/10" },
};

function buildEvents(conversations: Conversation[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const conv of conversations) {
    const base = {
      convId: conv.id,
      customerName: conv.customerName,
      customerPhone: conv.customerPhone,
      assignedWorkerId: conv.assignedWorkerId,
    };

    // Recent message event (if there's a lastMessageAt)
    if (conv.lastMessageAt) {
      events.push({
        id: `msg-${conv.id}`,
        ...base,
        type: conv.unreadCount > 0 ? "unread" : "new_message",
        ts: conv.lastMessageAt,
      });
    }

    // Status-based events
    if (conv.status === "resolved") {
      events.push({
        id: `resolved-${conv.id}`,
        ...base,
        type: "resolved",
        ts: conv.updatedAt,
      });
    } else if (conv.status === "archived") {
      events.push({
        id: `archived-${conv.id}`,
        ...base,
        type: "archived",
        ts: conv.updatedAt,
      });
    }
  }

  // Sort by most recent first, deduplicate by convId keeping newest
  events.sort((a, b) => (a.ts > b.ts ? -1 : 1));

  // Keep at most 2 events per conversation to avoid clutter
  const countByConv = new Map<number, number>();
  return events.filter(e => {
    const c = (countByConv.get(e.convId) ?? 0);
    if (c >= 2) return false;
    countByConv.set(e.convId, c + 1);
    return true;
  }).slice(0, 60);
}

function groupByDay(events: ActivityEvent[]): Array<{ day: string; date: Date; events: ActivityEvent[] }> {
  const map = new Map<string, { date: Date; events: ActivityEvent[] }>();

  for (const event of events) {
    try {
      const d = new Date(event.ts);
      const key = d.toDateString();
      if (!map.has(key)) {
        map.set(key, { date: d, events: [] });
      }
      map.get(key)!.events.push(event);
    } catch {}
  }

  return Array.from(map.entries()).map(([day, v]) => ({ day, ...v }));
}

export function ActivityTab({ onOpenConversation }: { onOpenConversation: (convId: number) => void }) {
  const { data: allData, isLoading, refetch, isFetching } = useQuery<ConversationListResponse>({
    queryKey: ["conversations-activity"],
    queryFn: () => api.conversations.list({ limit: 100 }),
    refetchInterval: 30_000,
  });

  const allConvs = allData?.conversations ?? [];
  const events = buildEvents(allConvs);
  const grouped = groupByDay(events);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {allConvs.length > 0
            ? <><span className="text-foreground font-semibold">{allConvs.length}</span> conversations · <span className="text-foreground font-semibold">{events.length}</span> recent events</>
            : "No conversation activity yet"
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
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
          <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center">
            <MessageSquare className="h-8 w-8 opacity-25" />
          </div>
          <div className="text-center">
            <p className="font-medium">No activity yet</p>
            <p className="text-sm mt-1">Conversation events will appear here once customers start messaging.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ day, date, events: dayEvents }) => (
            <div key={day}>
              {/* Day header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 border-t border-border/40" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {dayLabel(date)}
                </span>
                <div className="flex-1 border-t border-border/40" />
              </div>

              {/* Events */}
              <div className="space-y-2">
                {dayEvents.map(event => {
                  const cfg = EVENT_CONFIG[event.type];
                  const Icon = cfg.icon;
                  const displayName = event.customerName ?? event.customerPhone;

                  return (
                    <button
                      key={event.id}
                      onClick={() => onOpenConversation(event.convId)}
                      className="w-full flex items-start gap-3 p-3 rounded-xl border border-border/50 hover:bg-muted/20 hover:border-border transition-colors text-left"
                    >
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5", cfg.bg)}>
                        <Icon className={cn("h-4 w-4", cfg.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{displayName}</span>
                          <span className={cn("text-xs font-medium", cfg.color)}>{cfg.label}</span>
                          {event.type === "unread" && (
                            <span className="text-xs text-muted-foreground">
                              via WhatsApp
                            </span>
                          )}
                        </div>
                        {event.customerName && (
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{event.customerPhone}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">{relTime(event.ts)}</p>
                      </div>
                      {event.assignedWorkerId && (
                        <div className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground" title="Assigned">
                          <UserCircle className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
