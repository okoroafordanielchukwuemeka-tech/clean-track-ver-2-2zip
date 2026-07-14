import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { CachedDataBadge } from "@/components/cached-data-badge";
import { useNetworkStatus } from "@/hooks/use-network-status";
import {
  api,
  type BusinessProfile,
  type BrandingSettings,
  type OperationalSettings,
  type AutomationSettings,
  type DashboardPreferences,
  type DiscountSettings,
  type WorkerPermission,
  type MessageTemplate,
  type SubscriptionUsage,
  type SubscriptionStatus,
  type SubscriptionLog,
  type PlanPricingConfig,
  type SubscriptionPricing,
  type WaConnectionStatus,
} from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Building2, Palette, Clock, Shield, Bell, MessageSquare, Tag,
  LayoutDashboard, Save, ImageIcon, Plus, Trash2, AlertCircle,
  RefreshCw, ChevronRight, Percent, CreditCard, Check, Zap,
  MessageCircle, Mail, X, Smartphone, CheckCircle2, Loader2, Link, } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "profile", label: "Business Profile", icon: Building2 },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "operational", label: "Operational", icon: Clock },
  { id: "permissions", label: "Worker Permissions", icon: Shield },
  { id: "discounts", label: "Discount Rules", icon: Percent },
  { id: "automation", label: "Automation Alerts", icon: Bell },
  { id: "templates", label: "Message Templates", icon: MessageSquare },
  { id: "whatsapp", label: "WhatsApp Business", icon: Smartphone },
  { id: "categories", label: "Expense Categories", icon: Tag },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "billing", label: "Billing & Usage", icon: CreditCard },
];

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
    </div>
  );
}

function SaveRow({ onSave, isPending, isDirty }: { onSave: () => void; isPending: boolean; isDirty: boolean }) {
  return (
    <div className="flex justify-end pt-4 border-t mt-6">
      <Button onClick={onSave} disabled={!isDirty || isPending} className="gap-2">
        <Save className="h-4 w-4" />
        {isPending ? "Saving…" : "Save Changes"}
      </Button>
    </div>
  );
}

function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-muted animate-pulse rounded-md" />
      ))}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-none">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

function BusinessProfileSection() {
  const qc = useQueryClient();
  const { data, isLoading, isViewingCache } = useCachedQuery({
    queryKey: ["settings", "business-profile"],
    queryFn: () => api.settings.getBusinessProfile(),
  });

  const [form, setForm] = useState<BusinessProfile>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (data) { setForm(data); setIsDirty(false); }
  }, [data]);

  const update = (key: keyof BusinessProfile, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const mutation = useMutation({
    mutationFn: () => api.settings.updateBusinessProfile(form),
    onSuccess: (updated) => {
      qc.setQueryData(["settings", "business-profile"], updated);
      setIsDirty(false);
      toast.success("Business profile saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading && !isViewingCache) return <SkeletonRows rows={6} />;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-semibold">Business Profile</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Your laundry's public identity and contact information.</p>
        </div>
        <CachedDataBadge show={isViewingCache} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Business Name</Label>
          <Input value={form.businessName ?? ""} onChange={e => update("businessName", e.target.value)} placeholder="e.g. Sparkle Laundry" />
        </div>
        <div className="space-y-1.5">
          <Label>Phone Number</Label>
          <Input value={form.phone ?? ""} onChange={e => update("phone", e.target.value)} placeholder="+234 800 000 0000" />
        </div>
        <div className="space-y-1.5">
          <Label>WhatsApp Number</Label>
          <Input value={form.whatsapp ?? ""} onChange={e => update("whatsapp", e.target.value)} placeholder="+234 800 000 0000" />
        </div>
        <div className="space-y-1.5">
          <Label>Email Address</Label>
          <Input type="email" value={form.email ?? ""} onChange={e => update("email", e.target.value)} placeholder="info@business.com" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <Label>Address</Label>
          <Input value={form.address ?? ""} onChange={e => update("address", e.target.value)} placeholder="Shop address" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <Label>Business Notes</Label>
          <Textarea
            value={form.notes ?? ""}
            onChange={e => update("notes", e.target.value)}
            placeholder="Internal notes about this laundry"
            rows={3}
          />
        </div>
      </div>
      <div className="mt-4 border-2 border-dashed border-muted-foreground/20 rounded-xl p-6 text-center flex flex-col items-center gap-2">
        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">Logo Upload</p>
        <p className="text-xs text-muted-foreground/70">Coming soon — file hosting will be enabled in a future update</p>
      </div>
      <SaveRow onSave={() => mutation.mutate()} isPending={mutation.isPending} isDirty={isDirty} />
    </div>
  );
}

function BrandingSection() {
  const qc = useQueryClient();
  const { data, isLoading, isViewingCache } = useCachedQuery({
    queryKey: ["settings", "branding"],
    queryFn: () => api.settings.getBranding(),
  });

  const [form, setForm] = useState<BrandingSettings>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (data) { setForm(data); setIsDirty(false); }
  }, [data]);

  const update = (key: keyof BrandingSettings, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const mutation = useMutation({
    mutationFn: () => api.settings.updateBranding(form),
    onSuccess: (updated) => {
      qc.setQueryData(["settings", "branding"], updated);
      setIsDirty(false);
      toast.success("Branding settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading && !isViewingCache) return <SkeletonRows rows={3} />;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-semibold">Branding</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Customize how your laundry appears on receipts and documents.</p>
        </div>
        <CachedDataBadge show={isViewingCache} />
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Brand Color</Label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.brandColor ?? "#6366f1"}
              onChange={e => update("brandColor", e.target.value)}
              className="h-10 w-16 rounded border border-input cursor-pointer bg-background p-0.5"
            />
            <Input
              value={form.brandColor ?? "#6366f1"}
              onChange={e => update("brandColor", e.target.value)}
              placeholder="#6366f1"
              className="font-mono w-32"
            />
            <p className="text-xs text-muted-foreground">Used on receipts and badges</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Receipt Header Name</Label>
          <Input
            value={form.receiptHeaderName ?? ""}
            onChange={e => update("receiptHeaderName", e.target.value)}
            placeholder="e.g. SPARKLE LAUNDRY SERVICES"
          />
          <p className="text-xs text-muted-foreground">Printed at the top of customer receipts</p>
        </div>
        <div className="space-y-1.5">
          <Label>Receipt Footer Text</Label>
          <Textarea
            value={form.receiptFooterText ?? ""}
            onChange={e => update("receiptFooterText", e.target.value)}
            placeholder="e.g. Thank you for choosing us! Items not collected within 30 days will be donated."
            rows={2}
          />
          <p className="text-xs text-muted-foreground">Shown at the bottom of every receipt</p>
        </div>
      </div>
      <SaveRow onSave={() => mutation.mutate()} isPending={mutation.isPending} isDirty={isDirty} />
    </div>
  );
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const OPERATIONAL_TOGGLES: { key: keyof OperationalSettings; label: string; description: string }[] = [
  { key: "requireItemVerification", label: "Require Item Verification", description: "Workers must verify shirt/trouser counts before processing orders" },
  { key: "autoAssignOrders", label: "Auto-Assign Orders", description: "Automatically assign new orders to available workers" },
  { key: "allowPartialPickup", label: "Allow Partial Pickup", description: "Customers can pick up part of their order before it's fully ready" },
  { key: "allowWorkersCreateCustomers", label: "Workers Can Create Customers", description: "Allow workers (non-admin) to register new customers" },
  { key: "allowWorkersRecordPayments", label: "Workers Can Record Payments", description: "Allow workers to record cash and transfer payments" },
];

function OperationalSection() {
  const qc = useQueryClient();
  const { data, isLoading, isViewingCache } = useCachedQuery({
    queryKey: ["settings", "operational"],
    queryFn: () => api.settings.getOperational(),
  });

  const [form, setForm] = useState<OperationalSettings>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (data) { setForm(data); setIsDirty(false); }
  }, [data]);

  const update = <K extends keyof OperationalSettings>(key: K, value: OperationalSettings[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const toggleDay = (day: string) => {
    const days = form.workingDays ?? [];
    const next = days.includes(day) ? days.filter(d => d !== day) : [...days, day];
    update("workingDays", next);
  };

  const mutation = useMutation({
    mutationFn: () => api.settings.updateOperational(form),
    onSuccess: (updated) => {
      qc.setQueryData(["settings", "operational"], updated);
      setIsDirty(false);
      toast.success("Operational settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading && !isViewingCache) return <SkeletonRows rows={8} />;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-semibold">Operational Settings</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Configure turnaround times, working schedule, and operational rules.</p>
        </div>
        <CachedDataBadge show={isViewingCache} />
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">SLA Turnaround Times</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              { key: "standardTurnaroundHours" as const, label: "Standard", hint: "Recommended 48–72h", color: "text-blue-500" },
              { key: "expressTurnaroundHours" as const, label: "Express", hint: "Recommended 12–24h", color: "text-amber-500" },
              { key: "premiumTurnaroundHours" as const, label: "Premium", hint: "Recommended 48–96h", color: "text-purple-500" },
            ]).map(({ key, label, hint, color }) => (
              <div key={key} className="p-3 border rounded-lg space-y-2">
                <Label className={cn("text-xs font-semibold uppercase tracking-wide", color)}>{label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    max="336"
                    value={form[key] ?? ""}
                    onChange={e => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v)) update(key, v);
                    }}
                    className="w-20 text-center font-mono"
                  />
                  <span className="text-sm text-muted-foreground">hours</span>
                </div>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Working Schedule</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-xs mb-2 block">Working Days</Label>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map(day => {
                  const checked = (form.workingDays ?? []).includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                        checked
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-input hover:border-primary/50"
                      )}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="space-y-1.5 flex-1">
                <Label className="text-xs">Opening Time</Label>
                <Input
                  type="time"
                  value={form.workingHoursStart ?? "08:00"}
                  onChange={e => update("workingHoursStart", e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5 flex-1">
                <Label className="text-xs">Closing Time</Label>
                <Input
                  type="time"
                  value={form.workingHoursEnd ?? "18:00"}
                  onChange={e => update("workingHoursEnd", e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">Operational Rules</h3>
          <div className="divide-y rounded-lg border px-4 py-1">
            {OPERATIONAL_TOGGLES.map(({ key, label, description }) => (
              <ToggleRow
                key={key}
                label={label}
                description={description}
                checked={!!form[key]}
                onCheckedChange={v => update(key, v)}
              />
            ))}
          </div>
        </div>
      </div>

      <SaveRow onSave={() => mutation.mutate()} isPending={mutation.isPending} isDirty={isDirty} />
    </div>
  );
}

const PERMISSION_GROUPS: { heading: string; keys: { key: keyof WorkerPermission; label: string }[] }[] = [
  {
    heading: "Orders & Customers",
    keys: [
      { key: "canViewOrders", label: "View Orders" },
      { key: "canProcessOrders", label: "Process Orders" },
      { key: "canAssignOrders", label: "Assign Orders" },
      { key: "canViewCustomers", label: "View Customers" },
      { key: "canCreateCustomers", label: "Create Customers" },
      { key: "canViewCustomerBalances", label: "View Balances" },
      { key: "canRecordPayments", label: "Record Payments" },
      { key: "canRecordPickups", label: "Record Pickups" },
    ],
  },
  {
    heading: "WhatsApp Access",
    keys: [
      { key: "canViewWhatsApp", label: "View customer conversations" },
      { key: "canReplyWhatsApp", label: "Reply to customers" },
      { key: "canManageWhatsApp", label: "Manage WhatsApp settings" },
    ],
  },
];

function WorkerPermissionCard({
  worker,
  permissions,
  isLoading,
}: {
  worker: { id: number; name: string; role: string; isActive: boolean };
  permissions?: WorkerPermission;
  isLoading: boolean;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<WorkerPermission>>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (permissions) { setForm(permissions); setIsDirty(false); }
  }, [permissions]);

  const toggle = (key: keyof WorkerPermission) => {
    setForm(prev => ({ ...prev, [key]: !prev[key] }));
    setIsDirty(true);
  };

  const mutation = useMutation({
    mutationFn: () => api.workerPermissions.update(worker.id, form),
    onSuccess: (updated) => {
      qc.setQueryData(["worker-permissions", worker.id], updated);
      setIsDirty(false);
      toast.success(`Permissions saved for ${worker.name}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">{worker.name}</CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={worker.role === "admin" ? "default" : "secondary"} className="text-xs">
                {worker.role}
              </Badge>
              {!worker.isActive && <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => mutation.mutate()}
            disabled={!isDirty || mutation.isPending || isLoading}
            className="gap-1.5 shrink-0"
          >
            <Save className="h-3.5 w-3.5" />
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Array.from({ length: 11 }).map((_, i) => (
              <div key={i} className="h-8 bg-muted animate-pulse rounded" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {PERMISSION_GROUPS.map(group => (
              <div key={group.heading}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {group.heading}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                  {group.keys.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                      <Checkbox
                        checked={!!form[key]}
                        onCheckedChange={() => toggle(key)}
                      />
                      <span className="text-xs">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WorkerPermissionsSection() {
  const { data: workers, isLoading: workersLoading } = useQuery({
    queryKey: ["workers"],
    queryFn: () => api.workers.list(),
  });

  const permissionQueries = useQueries({
    queries: (workers ?? []).map(w => ({
      queryKey: ["worker-permissions", w.id],
      queryFn: () => api.workerPermissions.get(w.id),
      enabled: (workers ?? []).length > 0,
    })),
  });

  if (workersLoading) {
    return (
      <div>
        <SectionHeader title="Worker Permissions" description="Configure what each worker can do in Clean Track." />
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (!workers || workers.length === 0) {
    return (
      <div>
        <SectionHeader title="Worker Permissions" description="Configure what each worker can do in Clean Track." />
        <div className="text-center py-12 text-muted-foreground">
          <Shield className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No workers yet. Add workers first to manage permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        title="Worker Permissions"
        description="Configure what each worker can access and do. Save changes per worker."
      />
      <div className="space-y-4">
        {workers.map((worker, idx) => (
          <WorkerPermissionCard
            key={worker.id}
            worker={worker}
            permissions={permissionQueries[idx]?.data}
            isLoading={permissionQueries[idx]?.isLoading ?? true}
          />
        ))}
      </div>
    </div>
  );
}

const AUTOMATION_TOGGLES: { key: keyof AutomationSettings; label: string; description: string }[] = [
  { key: "orderReadyAlerts", label: "Order Ready", description: "Notify customer when their order is ready for pickup" },
  { key: "paymentReminderAlerts", label: "Payment Reminder", description: "Send reminders to customers with outstanding balances" },
  { key: "pickupReminderAlerts", label: "Pickup Reminder", description: "Remind customers who haven't collected their orders" },
  { key: "overdueAlerts", label: "Overdue Alerts", description: "Alert owner when orders exceed their SLA deadline" },
  { key: "dueSoonAlerts", label: "Due Soon Alerts", description: "Alert owner when orders are approaching their deadline" },
];

function AutomationSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "automation"],
    queryFn: () => api.settings.getAutomation(),
  });

  const [form, setForm] = useState<AutomationSettings>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (data) { setForm(data); setIsDirty(false); }
  }, [data]);

  const update = (key: keyof AutomationSettings, value: boolean) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const mutation = useMutation({
    mutationFn: () => api.settings.updateAutomation(form),
    onSuccess: (updated) => {
      qc.setQueryData(["settings", "automation"], updated);
      setIsDirty(false);
      toast.success("Automation settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <SkeletonRows rows={5} />;

  return (
    <div>
      <SectionHeader title="Automation Alerts" description="Control which events trigger alerts and future automated messages." />
      <div className="mb-4 flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Not yet active — WhatsApp message delivery is coming in a future update. Alerts saved here will activate automatically once the integration is live.
        </p>
      </div>
      <div className="rounded-lg border px-4 py-1 divide-y">
        {AUTOMATION_TOGGLES.map(({ key, label, description }) => (
          <ToggleRow
            key={key}
            label={label}
            description={description}
            checked={!!form[key]}
            onCheckedChange={v => update(key, v)}
          />
        ))}
      </div>
      <SaveRow onSave={() => mutation.mutate()} isPending={mutation.isPending} isDirty={isDirty} />
    </div>
  );
}

const TEMPLATE_VARIABLE_HINTS: Record<string, string[]> = {
  "Order Ready": ["{{customer_name}}", "{{order_id}}", "{{business_name}}"],
  "Payment Reminder": ["{{customer_name}}", "{{amount_owed}}", "{{order_id}}"],
  "Pickup Reminder": ["{{customer_name}}", "{{order_id}}", "{{days_waiting}}"],
  "Overdue Alert": ["{{order_id}}", "{{customer_name}}", "{{hours_overdue}}"],
  "Due Soon Alert": ["{{order_id}}", "{{customer_name}}", "{{hours_remaining}}"],
};

function MessageTemplateCard({ template }: { template: MessageTemplate }) {
  const qc = useQueryClient();
  const [body, setBody] = useState(template.body);
  const [subject, setSubject] = useState(template.subject ?? "");
  const isDirty = body !== template.body || subject !== (template.subject ?? "");

  const mutation = useMutation({
    mutationFn: () => api.messageTemplates.update(template.id, { body, subject }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["message-templates"] });
      toast.success(`"${template.name}" saved`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hints = Object.entries(TEMPLATE_VARIABLE_HINTS).find(([k]) => template.name.includes(k))?.[1] ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-semibold flex-1">{template.name}</CardTitle>
          {template.isDefault && (
            <Badge variant="outline" className="text-xs text-muted-foreground shrink-0">Default</Badge>
          )}
        </div>
        {hints.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {hints.map(v => (
              <code key={v} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">{v}</code>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Subject</Label>
          <Input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Message subject line"
            className="text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Message Body</Label>
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={3}
            className="text-sm font-mono"
          />
        </div>
        <div className="flex items-center gap-2 justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs gap-1.5"
            onClick={() => { setBody(template.body); setSubject(template.subject ?? ""); }}
            disabled={!isDirty}
          >
            <RefreshCw className="h-3 w-3" />
            Discard
          </Button>
          <Button
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={!isDirty || mutation.isPending}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MessageTemplatesSection() {
  const { data: templates, isLoading } = useQuery({
    queryKey: ["message-templates"],
    queryFn: () => api.messageTemplates.list(),
  });

  if (isLoading) {
    return (
      <div>
        <SectionHeader title="Message Templates" description="Edit the content of automated messages." />
        <SkeletonRows rows={5} />
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        title="Message Templates"
        description="Edit the content of automated messages. Use {{variable}} placeholders shown below each template name."
      />
      <div className="space-y-4">
        {(templates ?? []).map(t => (
          <MessageTemplateCard key={t.id} template={t} />
        ))}
        {(!templates || templates.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-8">No message templates found.</p>
        )}
      </div>
    </div>
  );
}

function ExpenseCategoriesSection() {
  const qc = useQueryClient();
  const { data: categories, isLoading, isViewingCache } = useCachedQuery({
    queryKey: ["expense-categories"],
    queryFn: () => api.expenseCategories.list(),
  });

  const [newName, setNewName] = useState("");

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.expenseCategories.update(id, { isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense-categories"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMutation = useMutation({
    mutationFn: () => api.expenseCategories.create({ name: newName.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      setNewName("");
      toast.success("Category added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.expenseCategories.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      toast.success("Category deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-semibold">Expense Categories</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage categories available when recording expenditures. Default categories cannot be deleted.</p>
        </div>
        <CachedDataBadge show={isViewingCache} />
      </div>
      {isLoading ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="space-y-2 mb-6">
          {(categories ?? []).map(cat => (
            <div key={cat.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <Switch
                checked={cat.isActive}
                onCheckedChange={v => toggleMutation.mutate({ id: cat.id, isActive: v })}
                disabled={toggleMutation.isPending}
              />
              <span className={cn("flex-1 text-sm capitalize", !cat.isActive && "text-muted-foreground line-through")}>
                {cat.name}
              </span>
              {cat.isDefault ? (
                <Badge variant="outline" className="text-xs text-muted-foreground">Default</Badge>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Category</AlertDialogTitle>
                      <AlertDialogDescription>
                        Delete <strong>"{cat.name}"</strong>? Existing expenditures using this category won't be affected, but it will no longer be available for new ones.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate(cat.id)}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
        <p className="text-sm font-medium">Add New Category</p>
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="e.g. Internet, Fuel, Rent…"
            onKeyDown={e => { if (e.key === "Enter" && newName.trim()) createMutation.mutate(); }}
          />
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!newName.trim() || createMutation.isPending}
            className="gap-1.5 shrink-0"
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function DiscountSettingsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "discount-settings"],
    queryFn: () => api.settings.getDiscountSettings(),
  });

  const [form, setForm] = useState<DiscountSettings>({
    autoApprovalThreshold: 0,
    maxDiscountPerOrder: 0,
    maxDiscountPercentage: 0,
  });
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        autoApprovalThreshold: data.autoApprovalThreshold ?? 0,
        maxDiscountPerOrder: data.maxDiscountPerOrder ?? 0,
        maxDiscountPercentage: data.maxDiscountPercentage ?? 0,
      });
      setIsDirty(false);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => api.settings.updateDiscountSettings(form),
    onSuccess: (updated) => {
      qc.setQueryData(["settings", "discount-settings"], updated);
      setIsDirty(false);
      toast.success("Discount rules saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = (key: keyof DiscountSettings, value: number) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  if (isLoading) return <SkeletonRows rows={3} />;

  const threshold = form.autoApprovalThreshold ?? 0;
  const maxAbs = form.maxDiscountPerOrder ?? 0;
  const maxPct = form.maxDiscountPercentage ?? 0;

  return (
    <div>
      <SectionHeader
        title="Discount Rules"
        description="Control how worker discounts are handled — what gets auto-applied and what needs your approval."
      />

      {/* How it works callout */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-4 text-sm space-y-1">
        <p className="font-semibold text-blue-900 dark:text-blue-300 flex items-center gap-2">
          <Percent className="h-4 w-4" />
          How it works
        </p>
        <p className="text-blue-800 dark:text-blue-400">
          When a worker requests a discount on an order:
        </p>
        <ul className="list-disc list-inside space-y-0.5 text-blue-800 dark:text-blue-400 ml-1">
          <li>
            If the discount is <strong>₦{threshold.toLocaleString()} or below</strong> → it is <strong>auto-applied instantly</strong>, no approval needed.
          </li>
          <li>
            If the discount is <strong>above ₦{threshold.toLocaleString()}</strong> → it goes to your <strong>Discounts approval queue</strong> for you to approve or reject.
          </li>
          {maxAbs > 0 && (
            <li>Hard cap: no single discount can exceed <strong>₦{maxAbs.toLocaleString()}</strong> regardless of approval.</li>
          )}
          {maxPct > 0 && (
            <li>Percentage cap: no discount can exceed <strong>{maxPct}%</strong> of the order price.</li>
          )}
        </ul>
      </div>

      <div className="space-y-5">
        {/* Auto-approval threshold */}
        <div className="rounded-lg border p-4 space-y-3">
          <div>
            <p className="font-medium text-sm">Auto-Approval Threshold</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Discounts at or below this amount are applied immediately without approval.
              Set to <strong>₦0</strong> to require approval on every discount.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground shrink-0">₦</span>
            <Input
              type="number"
              min={0}
              step={50}
              value={form.autoApprovalThreshold ?? 0}
              onChange={e => update("autoApprovalThreshold", Math.max(0, Number(e.target.value)))}
              className="w-40"
              placeholder="0"
            />
            <span className="text-xs text-muted-foreground">
              {threshold === 0
                ? "All discounts will need your approval"
                : `Discounts ≤ ₦${threshold.toLocaleString()} auto-apply`}
            </span>
          </div>
          {/* Quick presets */}
          <div className="flex flex-wrap gap-2">
            {[0, 200, 500, 1000, 2000, 5000].map(v => (
              <button
                key={v}
                type="button"
                onClick={() => update("autoApprovalThreshold", v)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  form.autoApprovalThreshold === v
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                )}
              >
                {v === 0 ? "No auto-approve" : `₦${v.toLocaleString()}`}
              </button>
            ))}
          </div>
        </div>

        {/* Max discount per order */}
        <div className="rounded-lg border p-4 space-y-3">
          <div>
            <p className="font-medium text-sm">Maximum Discount Per Order</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Absolute ceiling — no discount can exceed this amount. Set to <strong>₦0</strong> to disable this limit.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground shrink-0">₦</span>
            <Input
              type="number"
              min={0}
              step={100}
              value={form.maxDiscountPerOrder ?? 0}
              onChange={e => update("maxDiscountPerOrder", Math.max(0, Number(e.target.value)))}
              className="w-40"
              placeholder="0"
            />
            <span className="text-xs text-muted-foreground">
              {maxAbs === 0 ? "No hard cap set" : `Cap: ₦${maxAbs.toLocaleString()}`}
            </span>
          </div>
        </div>

        {/* Max discount percentage */}
        <div className="rounded-lg border p-4 space-y-3">
          <div>
            <p className="font-medium text-sm">Maximum Discount Percentage</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Workers cannot discount more than this percentage of the order price. Set to <strong>0</strong> to disable.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={100}
              step={5}
              value={form.maxDiscountPercentage ?? 0}
              onChange={e => update("maxDiscountPercentage", Math.min(100, Math.max(0, Number(e.target.value))))}
              className="w-40"
              placeholder="0"
            />
            <span className="text-sm font-medium text-muted-foreground shrink-0">%</span>
            <span className="text-xs text-muted-foreground">
              {maxPct === 0 ? "No percentage cap set" : `Cap: ${maxPct}% of order price`}
            </span>
          </div>
          {/* Quick presets */}
          <div className="flex flex-wrap gap-2">
            {[0, 10, 20, 30, 50].map(v => (
              <button
                key={v}
                type="button"
                onClick={() => update("maxDiscountPercentage", v)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  form.maxDiscountPercentage === v
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                )}
              >
                {v === 0 ? "No cap" : `${v}%`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <SaveRow onSave={() => mutation.mutate()} isPending={mutation.isPending} isDirty={isDirty} />
    </div>
  );
}

const DASHBOARD_TOGGLES: { key: keyof DashboardPreferences; label: string; description: string }[] = [
  { key: "showRevenue", label: "Revenue Card", description: "Show total and collected revenue on the dashboard" },
  { key: "showExpenses", label: "Expenses Card", description: "Show total expenses widget" },
  { key: "showProfit", label: "Profit Card", description: "Show estimated profit card" },
  { key: "showWorkerPerformance", label: "Worker Performance", description: "Show the worker analytics section" },
  { key: "showNotifications", label: "Notifications Panel", description: "Show the recent notifications widget" },
  { key: "showOperationalInsights", label: "Operational Insights", description: "Show SLA compliance and order flow metrics" },
];

function DashboardPreferencesSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "dashboard-preferences"],
    queryFn: () => api.settings.getDashboardPreferences(),
  });

  const [form, setForm] = useState<DashboardPreferences>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (data) { setForm(data); setIsDirty(false); }
  }, [data]);

  const update = (key: keyof DashboardPreferences, value: boolean) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const mutation = useMutation({
    mutationFn: () => api.settings.updateDashboardPreferences(form),
    onSuccess: (updated) => {
      qc.setQueryData(["settings", "dashboard-preferences"], updated);
      setIsDirty(false);
      toast.success("Dashboard preferences saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <SkeletonRows rows={6} />;

  return (
    <div>
      <SectionHeader
        title="Dashboard Preferences"
        description="Choose which widgets and sections appear on your main dashboard."
      />
      <div className="rounded-lg border px-4 py-1 divide-y">
        {DASHBOARD_TOGGLES.map(({ key, label, description }) => (
          <ToggleRow
            key={key}
            label={label}
            description={description}
            checked={form[key] !== false}
            onCheckedChange={v => update(key, v)}
          />
        ))}
      </div>
      <SaveRow onSave={() => mutation.mutate()} isPending={mutation.isPending} isDirty={isDirty} />
    </div>
  );
}

// ── Billing & Usage Section ──────────────────────────────────────────────────

function UsageBar({ label, used, limit, pct, warnLevel, suffix = "" }: {
  label: string; used: number | string; limit: number; pct: number; warnLevel: string; suffix?: string;
}) {
  const unlimited = !isFinite(limit);
  const barColor =
    warnLevel === "critical_100" ? "bg-red-500" :
    warnLevel === "warning_85" ? "bg-amber-500" :
    warnLevel === "warning_70" ? "bg-amber-400" :
    "bg-primary";
  const textColor =
    warnLevel === "critical_100" ? "text-red-600 dark:text-red-400 font-semibold" :
    warnLevel === "warning_85" ? "text-amber-600 dark:text-amber-400" :
    "text-muted-foreground";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-foreground font-medium">{label}</span>
        <span className={textColor}>
          {unlimited ? `${used}${suffix} / Unlimited` : `${used}${suffix} / ${limit}${suffix}${!unlimited && pct > 0 ? ` (${pct}%)` : ""}`}
        </span>
      </div>
      {!unlimited && (
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all duration-300", barColor)} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
      {unlimited && <div className="h-2 bg-muted rounded-full" />}
    </div>
  );
}

function WarnBadge({ level }: { level: string }) {
  if (level === "safe") return null;
  const cfg: Record<string, { cls: string; label: string }> = {
    warning_70: { cls: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700", label: "70% used" },
    warning_85: { cls: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700", label: "85% used" },
    critical_100: { cls: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700", label: "Limit reached" },
  };
  const c = cfg[level] ?? cfg.warning_70;
  return <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-xs border font-medium", c.cls)}>{c.label}</span>;
}

function UpgradeModal({
  plan,
  pricing,
  onClose,
}: {
  plan: PlanPricingConfig;
  pricing: SubscriptionPricing;
  onClose: () => void;
}) {
  const upgradeIntent = useMutation({
    mutationFn: () => api.subscription.logUpgradeIntent(plan.tier, "billing_settings"),
  });

  function handleOpen() {
    upgradeIntent.mutate();
  }

  const { paymentInstructions } = pricing;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-500" />
            Upgrade to {plan.displayName}
          </DialogTitle>
          <DialogDescription>
            ₦{plan.price.monthly.toLocaleString("en-NG")}/month — contact us to activate your plan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg bg-muted/50 px-4 py-3 space-y-2 text-sm">
            <p className="font-semibold text-foreground">How to upgrade:</p>
            <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
              {paymentInstructions.instructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="space-y-2">
            {paymentInstructions.contactWhatsApp && (
              <a
                href={`https://wa.me/${paymentInstructions.contactWhatsApp.replace(/\D/g, "")}?text=Hi, I'd like to upgrade to the ${plan.displayName} plan (₦${plan.price.monthly.toLocaleString("en-NG")}/month).`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleOpen}
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 px-4 transition-colors"
              >
                <MessageCircle className="h-4 w-4" />
                Contact via WhatsApp
              </a>
            )}
            <a
              href={`mailto:${paymentInstructions.contactEmail}?subject=Upgrade to ${plan.displayName} Plan&body=Hi, I'd like to upgrade to the ${plan.displayName} plan (₦${plan.price.monthly.toLocaleString("en-NG")}/month).`}
              onClick={handleOpen}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-input bg-background hover:bg-muted text-sm font-medium py-2.5 px-4 transition-colors"
            >
              <Mail className="h-4 w-4" />
              Email {paymentInstructions.contactEmail}
            </a>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Your plan will be activated within 24 hours of payment confirmation.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanCard({
  plan,
  currentTier,
  onUpgrade,
}: {
  plan: PlanPricingConfig;
  currentTier: string;
  onUpgrade: (plan: PlanPricingConfig) => void;
}) {
  const isCurrent = plan.tier === currentTier;
  const isHigher = ["starter", "pro", "business"].indexOf(plan.tier) >
    ["free", "starter", "pro", "business"].indexOf(currentTier);

  return (
    <div className={cn(
      "relative rounded-xl border p-5 flex flex-col gap-4 transition-shadow",
      plan.highlighted
        ? "border-blue-500 dark:border-blue-400 shadow-md shadow-blue-100 dark:shadow-blue-900/20"
        : "border-border",
      isCurrent && "ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-background"
    )}>
      {plan.highlighted && !isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-blue-600 text-white text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
            Most Popular
          </span>
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-emerald-600 text-white text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
            Current Plan
          </span>
        </div>
      )}

      <div>
        <h3 className="font-bold text-base">{plan.displayName}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{plan.tagline}</p>
      </div>

      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-extrabold">
          ₦{plan.price.monthly.toLocaleString("en-NG")}
        </span>
        <span className="text-sm text-muted-foreground">/month</span>
      </div>

      <ul className="space-y-1.5 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Button
        className={cn(
          "w-full mt-2",
          plan.highlighted && !isCurrent
            ? "bg-blue-600 hover:bg-blue-700 text-white"
            : ""
        )}
        variant={isCurrent ? "outline" : "default"}
        disabled={isCurrent}
        onClick={() => !isCurrent && isHigher && onUpgrade(plan)}
      >
        {isCurrent ? "Current Plan" : isHigher ? "Upgrade" : "Downgrade"}
      </Button>
    </div>
  );
}

function BillingSection() {
  const [upgradeTarget, setUpgradeTarget] = useState<PlanPricingConfig | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ["subscription", "status"],
    queryFn: () => api.subscription.getStatus(),
    staleTime: 30_000,
  });

  const { data: usage, isLoading: usageLoading, refetch: refetchUsage } = useQuery({
    queryKey: ["subscription", "usage"],
    queryFn: () => api.subscription.getUsage(),
    staleTime: 30_000,
  });

  const { data: pricing } = useQuery({
    queryKey: ["subscription", "pricing"],
    queryFn: () => api.subscription.getPricing(),
    staleTime: 60_000 * 30,
  });

  const { data: history } = useQuery({
    queryKey: ["subscription", "history"],
    queryFn: () => api.subscription.getHistory(),
    enabled: showHistory,
    staleTime: 60_000,
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.subscription.cancel(),
    onSuccess: () => {
      toast.success("Subscription cancelled. Your data is preserved.");
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Failed to cancel subscription. Please contact support.");
    },
  });

  const isLoading = statusLoading || usageLoading;

  function handleRefresh() {
    refetchStatus();
    refetchUsage();
  }

  const planColors: Record<string, string> = {
    free: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600",
    starter: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700",
    pro: "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700",
    business: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700",
  };

  const statusColors: Record<string, string> = {
    trial: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700",
    active: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700",
    past_due: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700",
    suspended: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700",
    cancelled: "bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-600",
  };

  const canCancel = status && !["cancelled", "trial"].includes(status.status);

  return (
    <div className="space-y-6">
      <SectionHeader title="Billing & Subscription" description="Manage your plan, view usage, and upgrade your account." />

      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {status && (
            <>
              <span className={cn("inline-flex items-center px-2 py-0.5 rounded border text-xs font-semibold capitalize", planColors[status.plan] ?? planColors.free)}>
                {status.planDisplayName}
              </span>
              <span className={cn("inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium capitalize", statusColors[status.status] ?? statusColors.active)}>
                {status.status.replace("_", " ")}
              </span>
              {status.subscriptionRenewsAt && status.status === "active" && (
                <span className="text-xs text-muted-foreground">
                  Renews {new Date(status.subscriptionRenewsAt).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isLoading}>
          <RefreshCw className={cn("h-4 w-4 mr-1.5", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Trial banner */}
      {status?.status === "trial" && status.trialEndsAt && (
        <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 px-4 py-4 text-sm text-blue-700 dark:text-blue-300 space-y-2">
          <div>
            <span className="font-semibold">14-Day Trial — </span>
            {(status.trialDaysRemaining ?? 0) <= 0
              ? "Your trial has expired. Upgrade below to continue using CleanTrack."
              : (status.trialDaysRemaining ?? 0) <= 3
              ? <span className="text-amber-600 dark:text-amber-400 font-semibold">{status.trialDaysRemaining} day{status.trialDaysRemaining === 1 ? "" : "s"} remaining — upgrade soon to keep your data and access.</span>
              : `${status.trialDaysRemaining} day${status.trialDaysRemaining === 1 ? "" : "s"} remaining.`}
            {" "}Ends {new Date(status.trialEndsAt).toLocaleDateString("en-NG", { month: "long", day: "numeric", year: "numeric" })}.
          </div>
          {(status.trialDaysRemaining ?? 0) > 0 && (
            <p className="text-xs text-blue-600 dark:text-blue-400">
              During your trial you have full access to all Enterprise features.
              Choose a paid plan below to keep access after your trial ends.
            </p>
          )}
        </div>
      )}

      {/* Past due banner */}
      {status?.status === "past_due" && (
        <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 inline mr-1.5" />
          <span className="font-semibold">Payment Required — </span>
          {status.graceDaysRemaining != null && status.graceDaysRemaining > 0
            ? `${status.graceDaysRemaining} day${status.graceDaysRemaining === 1 ? "" : "s"} remaining in your grace period before account suspension.`
            : "Your grace period has ended. Upgrade immediately to restore access."}
          {" "}Choose a plan below to continue.
        </div>
      )}

      {/* Suspended banner */}
      {status?.status === "suspended" && (
        <div className="rounded-lg border bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4 inline mr-1.5" />
          <span className="font-semibold">Account Suspended — </span>
          New orders, workers, and branches are blocked. Choose a plan below or contact support to resume.
        </div>
      )}

      {/* Cancelled banner */}
      {status?.status === "cancelled" && (
        <div className="rounded-lg border bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
          <AlertCircle className="h-4 w-4 inline mr-1.5" />
          <span className="font-semibold">Subscription Cancelled — </span>
          Your data is preserved. Choose a plan below to reactivate your account instantly.
        </div>
      )}

      {/* Usage bars */}
      {isLoading && !usage && (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {usage && (
        <div className="rounded-lg border divide-y">
          <div className="px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Usage</p>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Orders this month</h3>
              <WarnBadge level={usage.warnings.orders} />
            </div>
            <UsageBar
              label="Resets on the 1st of each month"
              used={usage.monthlyOrderCount}
              limit={usage.limits.maxOrdersPerMonth}
              pct={usage.percentages.orders}
              warnLevel={usage.warnings.orders}
            />
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Active customers</h3>
              <WarnBadge level={usage.warnings.customers} />
            </div>
            <UsageBar
              label="Total active customers in your account"
              used={usage.activeCustomerCount}
              limit={usage.limits.maxCustomers}
              pct={usage.percentages.customers}
              warnLevel={usage.warnings.customers}
            />
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Workers</h3>
              <WarnBadge level={usage.warnings.workers} />
            </div>
            <UsageBar
              label="Active workers"
              used={usage.activeWorkerCount}
              limit={usage.limits.maxWorkers}
              pct={usage.percentages.workers}
              warnLevel={usage.warnings.workers}
            />
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Branches</h3>
              <WarnBadge level={usage.warnings.branches} />
            </div>
            <UsageBar
              label="Active branches"
              used={usage.activeBranchCount}
              limit={usage.limits.maxBranches}
              pct={usage.percentages.branches}
              warnLevel={usage.warnings.branches}
            />
          </div>
        </div>
      )}

      {/* Pricing cards */}
      <div>
        <h3 className="text-sm font-semibold mb-1">Available Plans</h3>
        <p className="text-xs text-muted-foreground mb-4">
          All prices in Nigerian Naira (NGN). Contact us to upgrade or downgrade.
        </p>
        {pricing ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {pricing.plans.map((plan) => (
              <PlanCard
                key={plan.tier}
                plan={plan}
                currentTier={status?.plan ?? "free"}
                onUpgrade={setUpgradeTarget}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {["Starter", "Professional", "Enterprise"].map((name) => (
              <div key={name} className="rounded-xl border p-5 animate-pulse h-64 bg-muted/30" />
            ))}
          </div>
        )}
      </div>

      {/* Billing history */}
      <div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", showHistory && "rotate-90")} />
          Subscription history
        </button>
        {showHistory && (
          <div className="mt-3 rounded-lg border overflow-hidden">
            {!history ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
                Loading history…
              </div>
            ) : history.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No subscription history yet.</div>
            ) : (
              <div className="divide-y">
                {(history as SubscriptionLog[]).map((entry) => (
                  <div key={entry.id} className="px-4 py-3 flex items-start justify-between gap-4 text-sm">
                    <div>
                      <p className="font-medium capitalize">
                        {entry.reason?.replace(/_/g, " ") ?? "Status change"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {entry.fromStatus && entry.toStatus && entry.fromStatus !== entry.toStatus
                          ? `${entry.fromStatus.replace("_", " ")} → ${entry.toStatus.replace("_", " ")}`
                          : entry.toStatus?.replace("_", " ")}
                        {entry.fromPlan && entry.toPlan && entry.fromPlan !== entry.toPlan
                          ? ` · ${entry.fromPlan} → ${entry.toPlan}`
                          : ""}
                        {" "}· by {entry.changedBy ?? "system"}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Danger zone — cancel subscription */}
      {canCancel && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4">
          <h3 className="text-sm font-semibold text-destructive mb-1">Cancel Subscription</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Cancelling will block new orders, workers, and branches after your current period ends.
            All existing data is preserved and access can be restored at any time.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={cancelMutation.isPending}>
                {cancelMutation.isPending ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Cancelling…</> : "Cancel subscription"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will cancel your CleanTrack subscription. New orders, workers, and branches will be blocked after cancellation.
                  Your existing data — customers, orders, and history — is permanently preserved and can be restored by reactivating.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => cancelMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Yes, cancel subscription
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Upgrade modal */}
      {upgradeTarget && pricing && (
        <UpgradeModal
          plan={upgradeTarget}
          pricing={pricing}
          onClose={() => setUpgradeTarget(null)}
        />
      )}
    </div>
  );
}

// ─── WhatsApp Business Section ────────────────────────────────────────────────

function WhatsAppBusinessSection() {
  const navigate = useNavigate();

  const { data: status, isLoading } = useQuery<WaConnectionStatus>({
    queryKey: ["whatsapp-status"],
    queryFn: () => api.whatsapp.status(),
    staleTime: 30_000,
  });

  const isConnected = status?.connected === true;
  const connectedStatus = isConnected
    ? (status as Extract<WaConnectionStatus, { connected: true }>)
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">WhatsApp Business</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect your WhatsApp Business account to reach customers directly.
        </p>
      </div>

      <div className={cn(
        "rounded-xl border p-5 transition-colors",
        isConnected ? "border-green-500/30 bg-green-500/5" : "border-border bg-muted/30"
      )}>
        {isLoading ? (
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Checking connection…</span>
          </div>
        ) : isConnected && connectedStatus ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">WhatsApp Connected</p>
                <p className="text-xs text-muted-foreground">
                  {connectedStatus.businessName ?? "WhatsApp Business Account"}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-background/60 border border-border/60 px-3 py-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">Business Name</p>
                <p className="text-sm font-medium">{connectedStatus.businessName ?? "—"}</p>
              </div>
              <div className="rounded-lg bg-background/60 border border-border/60 px-3 py-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">Phone Number</p>
                <p className="text-sm font-medium">{connectedStatus.displayPhoneNumber ?? "—"}</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => navigate("/customer-hub")}
            >
              Manage Customer Hub
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Smartphone className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-sm">Not Connected</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set up your WhatsApp Business account in Customer Hub.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => navigate("/customer-hub")}
            >
              Connect WhatsApp
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}


export default function SettingsPage() {
  const { isOwner } = useAuth();
  const { isOnline } = useNetworkStatus();
  const [activeSection, setActiveSection] = useState("profile");

  if (!isOwner) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Shield className="h-10 w-10 text-muted-foreground mb-3" />
        <h2 className="text-lg font-semibold">Owner Access Only</h2>
        <p className="text-sm text-muted-foreground mt-1">Settings are restricted to the business owner.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Settings</h1>
          <CachedDataBadge show={!isOnline} />
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your laundry's configuration and preferences</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <nav className="w-full md:w-52 shrink-0">
          <div className="md:hidden mb-3">
            <select
              value={activeSection}
              onChange={e => setActiveSection(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {SECTIONS.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="hidden md:flex flex-col gap-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium w-full text-left transition-colors",
                  id === activeSection
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {id === activeSection && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        </nav>

        <div className="flex-1 min-w-0">
          <Card>
            <CardContent className="pt-6">
              {activeSection === "profile" && <BusinessProfileSection />}
              {activeSection === "branding" && <BrandingSection />}
              {activeSection === "operational" && <OperationalSection />}
              {activeSection === "permissions" && <WorkerPermissionsSection />}
              {activeSection === "discounts" && <DiscountSettingsSection />}
              {activeSection === "automation" && <AutomationSection />}
              {activeSection === "templates" && <MessageTemplatesSection />}
              {activeSection === "whatsapp" && <WhatsAppBusinessSection />}
              {activeSection === "categories" && <ExpenseCategoriesSection />}
              {activeSection === "dashboard" && <DashboardPreferencesSection />}
              {activeSection === "billing" && <BillingSection />}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
