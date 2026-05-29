import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Notification } from "@/lib/api";
import { Bell, Check, CheckCheck, Trash2, AlertTriangle, Info, Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const SEVERITY_CONFIG = {
  urgent: {
    icon: AlertTriangle,
    iconClass: "text-red-500",
    bg: "bg-red-50 border-red-100",
    dot: "bg-red-500",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-amber-500",
    bg: "bg-amber-50 border-amber-100",
    dot: "bg-amber-500",
  },
  success: {
    icon: CheckCircle2,
    iconClass: "text-green-500",
    bg: "bg-green-50 border-green-100",
    dot: "bg-green-500",
  },
  info: {
    icon: Info,
    iconClass: "text-blue-500",
    bg: "bg-blue-50 border-blue-100",
    dot: "bg-blue-500",
  },
};

function NotificationItem({
  n,
  onRead,
  onDelete,
}: {
  n: Notification;
  onRead: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const cfg = SEVERITY_CONFIG[n.severity];
  const Icon = cfg.icon;
  return (
    <div
      className={cn(
        "flex gap-3 p-3 rounded-lg border text-sm transition-colors",
        n.isRead ? "bg-background border-border opacity-70" : cn(cfg.bg, "border"),
        !n.isRead && "cursor-pointer"
      )}
      onClick={() => !n.isRead && onRead(n.id)}
    >
      <div className={cn("mt-0.5 h-4 w-4 shrink-0", cfg.iconClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("font-medium leading-tight", n.isRead ? "text-muted-foreground" : "text-foreground")}>
            {n.title}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(n.id); }}
            className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">{n.message}</p>
        <p className="text-muted-foreground/60 text-xs mt-1">
          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
        </p>
      </div>
      {!n.isRead && <div className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", cfg.dot)} />}
    </div>
  );
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: countData } = useQuery({
    queryKey: ["notifications", "count"],
    queryFn: () => api.notifications.count(),
    refetchInterval: 30_000,
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications.list(),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => api.notifications.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "count"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "count"] });
    },
  });

  const deleteNotif = useMutation({
    mutationFn: (id: number) => api.notifications.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "count"] });
    },
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const unreadCount = countData?.count ?? 0;
  const unread = notifications.filter(n => !n.isRead);
  const read = notifications.filter(n => n.isRead);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center justify-center h-9 w-9 rounded-lg hover:bg-sidebar-accent transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-sidebar-foreground/70" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[340px] max-w-[calc(100vw-2rem)] bg-background border rounded-xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-bold">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllRead.mutate()}
                className="text-xs h-7 px-2 gap-1"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </Button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No notifications yet</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {unread.length > 0 && (
                  <>
                    <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">New</p>
                    {unread.map(n => (
                      <NotificationItem
                        key={n.id}
                        n={n}
                        onRead={id => markRead.mutate(id)}
                        onDelete={id => deleteNotif.mutate(id)}
                      />
                    ))}
                  </>
                )}
                {read.length > 0 && (
                  <>
                    <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-2">Earlier</p>
                    {read.map(n => (
                      <NotificationItem
                        key={n.id}
                        n={n}
                        onRead={id => markRead.mutate(id)}
                        onDelete={id => deleteNotif.mutate(id)}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
