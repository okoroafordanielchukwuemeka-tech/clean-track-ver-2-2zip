import { useEffect, useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useCommandPalette } from "@/context/command-palette-context";
import {
  LayoutDashboard, ShoppingCart, Package, Wrench, Users, UserCircle,
  FileText, Receipt, Percent, GitBranch, WashingMachine, Settings,
  Activity, MessageSquare, ShieldCheck, Megaphone, Plus, Search,
  ArrowRight, Loader2,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";

interface PaletteItem {
  id: string;
  label: string;
  group: string;
  icon: React.ElementType;
  action: () => void;
  keywords?: string[];
}

const RECENT_KEY = "ct-palette-recent";
const MAX_RECENT = 5;

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  const prev = getRecent().filter((r) => r !== id);
  localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...prev].slice(0, MAX_RECENT)));
}

function highlight(text: string, query: string) {
  if (!query.trim()) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-primary rounded-sm">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </span>
  );
}

export function CommandPalette() {
  const { open, query, closePalette, setQuery } = useCommandPalette();
  const navigate = useNavigate();
  const { isOwner } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [debouncedQ, setDebouncedQ] = useState("");

  // Debounce the live search query by 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: liveData, isFetching: liveLoading } = useQuery({
    queryKey: ["palette-search", debouncedQ],
    queryFn: async () => {
      if (debouncedQ.length < 2) return null;
      const [customers, orders] = await Promise.allSettled([
        api.customers.list({ search: debouncedQ, limit: 4 } as any),
        api.orders.list({ search: debouncedQ, limit: 4 } as any),
      ]);
      return {
        customers: customers.status === "fulfilled" ? (Array.isArray(customers.value) ? customers.value : (customers.value as any)?.data ?? []) : [],
        orders: orders.status === "fulfilled" ? (Array.isArray(orders.value) ? orders.value : (orders.value as any)?.data ?? []) : [],
      };
    },
    enabled: debouncedQ.length >= 2,
    staleTime: 15_000,
  });

  const go = useCallback(
    (path: string, id: string) => {
      pushRecent(id);
      closePalette();
      navigate(path);
    },
    [navigate, closePalette]
  );

  // All palette items
  const navItems: PaletteItem[] = [
    { id: "dashboard", label: "Dashboard", group: "Navigation", icon: LayoutDashboard, action: () => go("/dashboard", "dashboard"), keywords: ["home", "overview"] },
    { id: "orders", label: "Orders", group: "Navigation", icon: ShoppingCart, action: () => go("/orders", "orders"), keywords: ["list", "all orders"] },
    { id: "customers", label: "Customers", group: "Navigation", icon: UserCircle, action: () => go("/customers", "customers") },
    { id: "receipts", label: "Receipts", group: "Navigation", icon: FileText, action: () => go("/receipts", "receipts") },
    { id: "batches", label: "Batches", group: "Navigation", icon: Package, action: () => go("/batches", "batches") },
    { id: "expenditures", label: "Expenditures", group: "Navigation", icon: Receipt, action: () => go("/expenditures", "expenditures"), keywords: ["expenses", "spending"] },
    { id: "discount-approvals", label: "Discount Approvals", group: "Navigation", icon: Percent, action: () => go("/discount-approvals", "discount-approvals"), keywords: ["discounts"] },
    { id: "services", label: "Services", group: "Navigation", icon: Wrench, action: () => go("/services", "services") },
    { id: "workers", label: "Workers", group: "Navigation", icon: Users, action: () => go("/workers", "workers"), keywords: ["staff", "employees"] },
    { id: "branches", label: "Branches", group: "Navigation", icon: GitBranch, action: () => go("/branches", "branches"), keywords: ["locations"] },
    { id: "worker-station", label: "Worker Station", group: "Navigation", icon: WashingMachine, action: () => go("/worker-station", "worker-station") },
    { id: "settings", label: "Settings", group: "Navigation", icon: Settings, action: () => go("/settings", "settings") },
    { id: "analytics", label: "Analytics", group: "Navigation", icon: Activity, action: () => go("/dashboard", "analytics"), keywords: ["reports", "stats", "charts"] },
    { id: "marketing", label: "AI Marketing", group: "Navigation", icon: Megaphone, action: () => go("/marketing", "marketing"), keywords: ["campaigns", "whatsapp"] },
    { id: "operations", label: "Operations Center", group: "Navigation", icon: Activity, action: () => go("/operations", "operations"), keywords: ["ops", "sync", "health"] },
    { id: "customer-hub", label: "Customer Hub", group: "Navigation", icon: MessageSquare, action: () => go("/customer-hub", "customer-hub"), keywords: ["inbox", "whatsapp", "messages"] },
    { id: "platform-health", label: "Platform Health", group: "Navigation", icon: ShieldCheck, action: () => go("/platform-health", "platform-health") },
  ];

  const actionItems: PaletteItem[] = [
    {
      id: "create-order",
      label: "Create Order",
      group: "Quick Actions",
      icon: Plus,
      action: () => go("/orders?create=1", "create-order"),
      keywords: ["new order", "add order"],
    },
    {
      id: "create-customer",
      label: "Create Customer",
      group: "Quick Actions",
      icon: Plus,
      action: () => go("/customers?create=1", "create-customer"),
      keywords: ["new customer", "add customer"],
    },
    {
      id: "create-service",
      label: "Create Service",
      group: "Quick Actions",
      icon: Plus,
      action: () => go("/services?create=1", "create-service"),
      keywords: ["new service", "add service"],
    },
    {
      id: "search-orders",
      label: "Search Orders",
      group: "Quick Actions",
      icon: Search,
      action: () => go("/orders", "search-orders"),
    },
    {
      id: "search-customers",
      label: "Search Customers",
      group: "Quick Actions",
      icon: Search,
      action: () => go("/customers", "search-customers"),
    },
  ];

  const allItems = [...actionItems, ...(isOwner ? navItems : navItems.filter(i => ["orders", "customers", "worker-station"].includes(i.id)))];

  const recentIds = getRecent();
  const recentItems = recentIds
    .map((id) => allItems.find((i) => i.id === id))
    .filter(Boolean) as PaletteItem[];

  // Filter based on query
  const q = query.trim().toLowerCase();
  const filteredItems = q
    ? allItems.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.group.toLowerCase().includes(q) ||
          item.keywords?.some((k) => k.includes(q))
      )
    : [];

  // Group filtered results
  const groups = q
    ? Array.from(new Set(filteredItems.map((i) => i.group))).map((group) => ({
        name: group,
        items: filteredItems.filter((i) => i.group === group),
      }))
    : [];

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closePalette()}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden max-w-xl"
        aria-describedby={undefined}
      >
        <Command
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
          shouldFilter={false}
        >
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground mr-2" />
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="Search pages, actions…"
              className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
            <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              Esc
            </kbd>
          </div>

          <Command.List className="max-h-[400px] overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
              No results for &ldquo;{query}&rdquo;
            </Command.Empty>

            {/* Show recent when no query */}
            {!q && recentItems.length > 0 && (
              <Command.Group heading="Recent">
                {recentItems.map((item) => (
                  <PaletteRow key={item.id} item={item} query="" />
                ))}
              </Command.Group>
            )}

            {/* Show quick actions when no query */}
            {!q && (
              <Command.Group heading="Quick Actions">
                {actionItems.map((item) => (
                  <PaletteRow key={item.id} item={item} query="" />
                ))}
              </Command.Group>
            )}

            {/* Show navigation when no query */}
            {!q && (
              <Command.Group heading="Navigation">
                {(isOwner ? navItems : navItems.filter(i => ["orders", "customers", "worker-station"].includes(i.id))).map((item) => (
                  <PaletteRow key={item.id} item={item} query="" />
                ))}
              </Command.Group>
            )}

            {/* Filtered results */}
            {q && groups.map((group) => (
              <Command.Group key={group.name} heading={group.name}>
                {group.items.map((item) => (
                  <PaletteRow key={item.id} item={item} query={query} />
                ))}
              </Command.Group>
            ))}

            {/* Live data search results */}
            {q && debouncedQ.length >= 2 && (
              <>
                {liveLoading && (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Searching...
                  </div>
                )}
                {!liveLoading && liveData && liveData.customers.length > 0 && (
                  <Command.Group heading="Customers">
                    {liveData.customers.map((c: any) => (
                      <Command.Item
                        key={`customer-${c.id}`}
                        value={`customer-${c.id}`}
                        onSelect={() => go(`/customers?id=${c.id}`, `customer-${c.id}`)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground transition-colors"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-background shrink-0">
                          <UserCircle className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{highlight(c.fullName || c.name || "Customer", q)}</p>
                          {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {!liveLoading && liveData && liveData.orders.length > 0 && (
                  <Command.Group heading="Orders">
                    {liveData.orders.map((o: any) => (
                      <Command.Item
                        key={`order-${o.id}`}
                        value={`order-${o.id}`}
                        onSelect={() => go(`/orders?id=${o.id}`, `order-${o.id}`)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground transition-colors"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-background shrink-0">
                          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium font-mono text-xs">{highlight(o.orderId || String(o.id), q)}</p>
                          {o.customerName && <p className="text-xs text-muted-foreground truncate">{o.customerName}</p>}
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </>
            )}
          </Command.List>

          <div className="border-t px-3 py-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">Esc</kbd>
              close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function PaletteRow({ item, query }: { item: PaletteItem; query: string }) {
  const Icon = item.icon;
  return (
    <Command.Item
      value={`${item.group}-${item.id}`}
      onSelect={item.action}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground transition-colors"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-background shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <span className="flex-1 font-medium">{highlight(item.label, query)}</span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-aria-selected:opacity-100" />
    </Command.Item>
  );
}
