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
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { NotificationCenter } from "@/components/notification-center";
import { api } from "@/lib/api";
import { toast } from "sonner";

const workerNavItems = [
  { to: "/worker-station", label: "Worker Station", icon: WashingMachine },
  { to: "/orders", label: "Orders", icon: ShoppingCart },
  { to: "/customers", label: "Customers", icon: UserCircle },
];

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isOwner, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: pendingCount } = useQuery({
    queryKey: ["discount-approvals", "pending-count"],
    queryFn: () => api.discountApprovals.pendingCount(),
    enabled: isOwner,
    refetchInterval: 30_000,
  });

  const pending = pendingCount?.count ?? 0;

  const ownerNavItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/orders", label: "Orders", icon: ShoppingCart },
    { to: "/customers", label: "Customers", icon: UserCircle },
    { to: "/batches", label: "Batches", icon: Package },
    { to: "/expenditures", label: "Expenditures", icon: Receipt },
    { to: "/discount-approvals", label: "Discounts", icon: Percent, badge: pending > 0 ? pending : undefined },
    { to: "/services", label: "Services", icon: Wrench },
    { to: "/workers", label: "Workers", icon: Users },
    { to: "/worker-station", label: "Worker Station", icon: WashingMachine },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  const navItems = isOwner ? ownerNavItems : workerNavItems;

  const handleLogout = () => {
    logout();
    toast.success("Signed out successfully");
    navigate("/login", { replace: true });
  };

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
              {isOwner ? user?.name : "Clean Track"}
            </h1>
            <p className="text-xs text-sidebar-foreground/60">
              {isOwner ? "Owner Dashboard" : "Worker Station"}
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
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
        </nav>

        <div className="px-3 py-4 border-t border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-sidebar-foreground/60 capitalize">
                {isOwner ? "Owner" : user?.role === "admin" ? "Admin Worker" : "Worker"}
              </p>
            </div>
            <NotificationCenter />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent"
              title="Sign out"
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
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex items-center gap-2 flex-1">
            <WashingMachine className="h-5 w-5 text-primary" />
            <span className="font-bold">Clean Track</span>
          </div>
          <div className="bg-sidebar rounded-lg">
            <NotificationCenter />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
