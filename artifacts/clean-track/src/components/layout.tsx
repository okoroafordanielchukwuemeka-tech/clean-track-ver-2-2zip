import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Wrench,
  Users,
  LogOut,
  WashingMachine,
  Menu,
  X,
  UserCircle,
  Receipt,
  Settings,
  Percent,
  FileText,
  GitBranch,
  Activity,
  MessageSquare,
  ShieldCheck,
  ChevronDown,
  Sun,
  Moon,
  Megaphone,
  Lock,
  Keyboard,
  Search,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/context/theme-context";
import { useQuery } from "@tanstack/react-query";
import { useAuth, type WorkerPermissions } from "@/context/auth-context";
import { useBranch } from "@/context/branch-context";
import { Button } from "@/components/ui/button";
import { NotificationCenter } from "@/components/notification-center";
import { BranchSelector } from "@/components/branch-selector";
import { NetworkStatusBadge } from "@/components/network-status-badge";
import { OfflineBanner } from "@/components/offline-banner";
import { SyncFailedPanel } from "@/components/sync-failed-panel";
import { OutdatedClientBanner } from "@/components/outdated-client-banner";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { SyncProgressBar } from "@/components/sync-progress-bar";
import { FeedbackButton } from "@/components/feedback-button";
import { CommandPalette } from "@/components/command-palette";
import { KeyboardShortcutsHelp } from "@/components/keyboard-shortcuts-help";
import { CommandPaletteProvider, useCommandPalette } from "@/context/command-palette-context";
import { api } from "@/lib/api";
import { toast } from "sonner";

function LayoutInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isOwner, logout } = useAuth();
  const { activeBranch } = useBranch();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    const advancedPaths = ["/operations", "/customer-hub", "/platform-health"];
    return advancedPaths.some((p) => location.pathname.startsWith(p));
  });

  const { openPalette } = useCommandPalette();

  const { data: pendingCount } = useQuery({
    queryKey: ["discount-approvals", "pending-count"],
    queryFn: () => api.discountApprovals.pendingCount(),
    enabled: isOwner,
    refetchInterval: 30_000,
  });

  const { data: subStatus } = useQuery({
    queryKey: ["subscription", "status"],
    queryFn: () => api.subscription.getStatus(),
    enabled: isOwner,
    staleTime: 5 * 60_000,
  });
  const isProOrAbove =
    !subStatus ||
    subStatus.status === "trial" ||
    subStatus.plan === "pro" ||
    subStatus.plan === "business";

  const workerPerms = user?.permissions as WorkerPermissions | undefined;
  const workerCanWhatsApp = isOwner || workerPerms?.canViewWhatsApp === true;

  const { data: unreadConvData } = useQuery({
    queryKey: ["conversations-unread"],
    queryFn: () => api.conversations.getUnreadCount(),
    enabled: workerCanWhatsApp,
    refetchInterval: 30_000,
  });

  const pending = pendingCount?.count ?? 0;
  const unreadConversations = unreadConvData?.unreadCount ?? 0;

  // Worker nav is permission-aware: only show items the worker can actually use
  const workerNavItems = [
    { to: "/worker-station", label: "Worker Station", icon: WashingMachine },
    { to: "/orders", label: "Orders", icon: ShoppingCart },
    { to: "/customers", label: "Customers", icon: UserCircle },
    ...(workerPerms?.canViewOrders ? [{ to: "/receipts", label: "Receipts", icon: FileText }] : []),
    ...(workerPerms?.canViewOrders || workerPerms?.canProcessOrders ? [{ to: "/batches", label: "Batches", icon: Package }] : []),
    ...(workerPerms?.canViewWhatsApp ? [{ to: "/customer-hub", label: "Customer Hub", icon: MessageSquare, badge: unreadConversations > 0 ? unreadConversations : undefined }] : []),
  ];

  const ownerNavItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/orders", label: "Orders", icon: ShoppingCart },
    { to: "/customers", label: "Customers", icon: UserCircle },
    { to: "/receipts", label: "Receipts", icon: FileText },
    { to: "/batches", label: "Batches", icon: Package },
    { to: "/expenditures", label: "Expenditures", icon: Receipt },
    { to: "/discount-approvals", label: "Discounts", icon: Percent, badge: pending > 0 ? pending : undefined },
    { to: "/services", label: "Services", icon: Wrench },
    { to: "/workers", label: "Workers", icon: Users },
    { to: "/branches", label: "Branches", icon: GitBranch },
    { to: "/worker-station", label: "Worker Station", icon: WashingMachine },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  const advancedNavItems = [
    { to: "/marketing", label: "AI Marketing", icon: Megaphone, badge: undefined as number | undefined },
    { to: "/operations", label: "Operations", icon: Activity, badge: undefined as number | undefined },
    { to: "/customer-hub", label: "Customer Hub", icon: MessageSquare, badge: unreadConversations > 0 ? unreadConversations : undefined },
    { to: "/platform-health", label: "Platform Health", icon: ShieldCheck, badge: undefined as number | undefined },
  ];

  const navItems = isOwner ? ownerNavItems : workerNavItems;

  const handleLogout = () => {
    logout();
    toast.success("Signed out successfully");
    navigate("/login", { replace: true });
  };

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      const mod = e.metaKey || e.ctrlKey;

      // Ctrl/⌘ + K — command palette
      if (mod && e.key === "k") {
        e.preventDefault();
        openPalette();
        return;
      }

      // Ctrl/⌘ + N — create order
      if (mod && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        navigate("/orders?create=1");
        return;
      }

      // Ctrl/⌘ + Shift + C — create customer
      if (mod && e.shiftKey && e.key === "C") {
        e.preventDefault();
        navigate("/customers?create=1");
        return;
      }

      // Skip remaining shortcuts when inside a text input
      if (inInput) return;

      // ? — keyboard shortcut help
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // / — open command palette (search intent)
      if (e.key === "/") {
        e.preventDefault();
        openPalette();
        return;
      }
    },
    [navigate, openPalette]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-screen bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 w-64 bg-sidebar text-sidebar-foreground flex flex-col transition-transform duration-300 md:relative md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
          <WashingMachine className="h-7 w-7 text-sidebar-primary" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white truncate">
              {isOwner ? user?.name : "CleanTrack"}
            </h1>
            <p className="text-xs text-sidebar-foreground/60">
              {isOwner
                ? activeBranch ? activeBranch.name : "All Branches"
                : "Worker Station"}
            </p>
          </div>
        </div>

        {/* Search / command palette trigger */}
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={() => openPalette()}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-sidebar-accent/40 text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/70 text-sm transition-colors"
            aria-label="Open command palette"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left text-xs">Search…</span>
            <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-sidebar-border/40 bg-sidebar/40 px-1.5 font-mono text-[10px] text-sidebar-foreground/40">
              ⌘K
            </kbd>
          </button>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          <BranchSelector />
          {navItems.map(({ to, label, icon: Icon, badge }: any) => (
            <Link
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                location.pathname === to || location.pathname.startsWith(to + "/")
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {badge != null && (
                <span className="bg-amber-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {badge}
                </span>
              )}
            </Link>
          ))}

          {isOwner && (
            <div className="pt-1">
              <button
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40 hover:text-sidebar-foreground/60 transition-colors"
              >
                <span className="flex-1 text-left">Advanced</span>
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")} />
              </button>
              {advancedOpen && advancedNavItems.map(({ to, label, icon: Icon, badge }) => {
                const isPremium = (to === "/marketing" || to === "/customer-hub") && !isProOrAbove;
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                      location.pathname === to || location.pathname.startsWith(to + "/")
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{label}</span>
                    {isPremium && (
                      <Lock className="h-3 w-3 text-sidebar-foreground/40 shrink-0" aria-label="Requires Professional plan" />
                    )}
                    {badge != null && !isPremium && (
                      <span className="bg-green-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        <NetworkStatusBadge />

        <div className="px-3 pb-1 border-t border-sidebar-border pt-3">
          <FeedbackButton />
        </div>

        <div className="px-3 py-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-sidebar-foreground/60 capitalize">
                {isOwner ? "Owner" : user?.role === "admin" ? "Admin Worker" : "Worker"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShortcutsOpen(true)}
              className="text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent"
              title="Keyboard shortcuts (?)"
              aria-label="View keyboard shortcuts"
            >
              <Keyboard className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent"
              title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <NotificationCenter />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b bg-background">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? "Close menu" : "Open menu"}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex items-center gap-2 flex-1">
            <WashingMachine className="h-5 w-5 text-primary" />
            <span className="font-bold">CleanTrack</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openPalette()}
            aria-label="Open command palette"
            className="text-muted-foreground"
          >
            <Search className="h-4 w-4" />
          </Button>
          <div className="bg-sidebar rounded-lg">
            <NotificationCenter />
          </div>
        </header>

        <ImpersonationBanner />
        <OutdatedClientBanner />
        <SyncProgressBar />
        <OfflineBanner />
        <SyncFailedPanel />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <CommandPalette />
      <KeyboardShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

export function Layout() {
  return (
    <CommandPaletteProvider>
      <LayoutInner />
    </CommandPaletteProvider>
  );
}
