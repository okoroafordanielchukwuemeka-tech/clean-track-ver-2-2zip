import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import {
  api,
  type BusinessProfile,
  type BrandingSettings,
  type OperationalSettings,
  type AutomationSettings,
  type DashboardPreferences,
  type WorkerPermission,
  type MessageTemplate,
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
  RefreshCw, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "profile", label: "Business Profile", icon: Building2 },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "operational", label: "Operational", icon: Clock },
  { id: "permissions", label: "Worker Permissions", icon: Shield },
  { id: "automation", label: "Automation Alerts", icon: Bell },
  { id: "templates", label: "Message Templates", icon: MessageSquare },
  { id: "categories", label: "Expense Categories", icon: Tag },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
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
  const { data, isLoading } = useQuery({
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

  if (isLoading) return <SkeletonRows rows={6} />;

  return (
    <div>
      <SectionHeader title="Business Profile" description="Your laundry's public identity and contact information." />
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
  const { data, isLoading } = useQuery({
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

  if (isLoading) return <SkeletonRows rows={3} />;

  return (
    <div>
      <SectionHeader title="Branding" description="Customize how your laundry appears on receipts and documents." />
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
  const { data, isLoading } = useQuery({
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

  if (isLoading) return <SkeletonRows rows={8} />;

  return (
    <div>
      <SectionHeader title="Operational Settings" description="Configure turnaround times, working schedule, and operational rules." />

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

const PERMISSION_KEYS: { key: keyof WorkerPermission; label: string }[] = [
  { key: "canViewOrders", label: "View Orders" },
  { key: "canProcessOrders", label: "Process Orders" },
  { key: "canAssignOrders", label: "Assign Orders" },
  { key: "canViewCustomers", label: "View Customers" },
  { key: "canCreateCustomers", label: "Create Customers" },
  { key: "canViewCustomerBalances", label: "View Balances" },
  { key: "canRecordPayments", label: "Record Payments" },
  { key: "canRecordPickups", label: "Record Pickups" },
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
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 bg-muted animate-pulse rounded" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            {PERMISSION_KEYS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={!!form[key]}
                  onCheckedChange={() => toggle(key)}
                />
                <span className="text-xs">{label}</span>
              </label>
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
  const { data: categories, isLoading } = useQuery({
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
      <SectionHeader
        title="Expense Categories"
        description="Manage categories available when recording expenditures. Default categories cannot be deleted."
      />
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

export default function SettingsPage() {
  const { isOwner } = useAuth();
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
        <h1 className="text-2xl font-bold">Settings</h1>
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
              {activeSection === "automation" && <AutomationSection />}
              {activeSection === "templates" && <MessageTemplatesSection />}
              {activeSection === "categories" && <ExpenseCategoriesSection />}
              {activeSection === "dashboard" && <DashboardPreferencesSection />}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
