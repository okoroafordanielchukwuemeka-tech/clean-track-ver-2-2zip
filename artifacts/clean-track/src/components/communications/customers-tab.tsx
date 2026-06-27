/**
 * CustomersTab — WhatsApp Contacts
 *
 * Shows all customers who have WhatsApp conversation history.
 * Clicking a customer opens their conversation in the Inbox tab.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  User, MessageSquare, Phone, Loader2, ExternalLink,
  Circle, CheckCircle2, Archive,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Conversation, ConversationListResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

function relTime(ts: string | null | undefined): string {
  if (!ts) return "";
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); }
  catch { return ""; }
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  open:     <Circle className="h-3 w-3 text-green-400" />,
  resolved: <CheckCircle2 className="h-3 w-3 text-teal-400" />,
  archived: <Archive className="h-3 w-3 text-muted-foreground" />,
};

interface CustomerEntry {
  customerId: number | null;
  customerName: string | null;
  customerPhone: string;
  convCount: number;
  unreadCount: number;
  lastMessageAt: string | null;
  latestConvId: number;
  statuses: string[];
}

export function CustomersTab({ onOpenConversation }: { onOpenConversation: (convId: number) => void }) {
  // Load all conversations (all statuses) to build the customer list
  const { data: openData, isLoading: loadingOpen } = useQuery<ConversationListResponse>({
    queryKey: ["conversations", undefined],
    queryFn: () => api.conversations.list({ limit: 200 }),
    staleTime: 15_000,
  });

  const isLoading = loadingOpen;

  const allConvs: Conversation[] = [
    ...(openData?.conversations ?? []),
  ];

  // Deduplicate by customer (phone number)
  const byPhone = new Map<string, CustomerEntry>();
  for (const conv of allConvs) {
    const key = conv.customerPhone;
    const existing = byPhone.get(key);
    if (!existing) {
      byPhone.set(key, {
        customerId: conv.customerId,
        customerName: conv.customerName,
        customerPhone: conv.customerPhone,
        convCount: 1,
        unreadCount: conv.unreadCount,
        lastMessageAt: conv.lastMessageAt,
        latestConvId: conv.id,
        statuses: [conv.status],
      });
    } else {
      existing.convCount++;
      existing.unreadCount += conv.unreadCount;
      existing.statuses.push(conv.status);
      if (conv.lastMessageAt && (!existing.lastMessageAt || conv.lastMessageAt > existing.lastMessageAt)) {
        existing.lastMessageAt = conv.lastMessageAt;
        existing.latestConvId = conv.id;
      }
    }
  }

  const customers = Array.from(byPhone.values())
    .sort((a, b) => {
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return a.lastMessageAt > b.lastMessageAt ? -1 : 1;
    });

  const totalUnread = customers.reduce((s, c) => s + c.unreadCount, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading contacts…
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
        <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center">
          <MessageSquare className="h-8 w-8 opacity-25" />
        </div>
        <div className="text-center">
          <p className="font-medium">No WhatsApp contacts yet</p>
          <p className="text-sm mt-1">
            When customers send messages to your WhatsApp number, they'll appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="text-sm text-muted-foreground">
          <span className="text-foreground font-semibold">{customers.length}</span> WhatsApp contacts
          {totalUnread > 0 && (
            <span className="ml-2 text-green-400 font-medium">· {totalUnread} unread</span>
          )}
        </div>
      </div>

      {/* Customer grid */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {customers.map(c => {
          const hasOpen = c.statuses.includes("open");
          const hasUnread = c.unreadCount > 0;

          return (
            <div
              key={c.customerPhone}
              className={cn(
                "rounded-xl border bg-card/50 p-4 hover:bg-card/80 transition-colors",
                hasUnread && "border-green-500/30"
              )}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                  <User className="h-4.5 w-4.5 text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn(
                      "text-sm truncate",
                      hasUnread ? "font-bold" : "font-semibold"
                    )}>
                      {c.customerName ?? c.customerPhone}
                    </p>
                    {hasUnread && (
                      <span className="bg-green-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 shrink-0">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                  {c.customerName && (
                    <p className="text-xs text-muted-foreground font-mono">{c.customerPhone}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">{relTime(c.lastMessageAt)}</p>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {c.convCount} conversation{c.convCount !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  {Array.from(new Set(c.statuses)).map(s => (
                    <span key={s} title={s}>{STATUS_ICON[s]}</span>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={hasUnread ? "default" : "outline"}
                  className="flex-1 h-8 text-xs"
                  onClick={() => onOpenConversation(c.latestConvId)}
                >
                  <MessageSquare className="h-3.5 w-3.5 mr-1" />
                  {hasUnread ? "Reply" : "View"}
                </Button>
                {c.customerId && (
                  <Link to={`/customers/${c.customerId}`}>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="View profile">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
