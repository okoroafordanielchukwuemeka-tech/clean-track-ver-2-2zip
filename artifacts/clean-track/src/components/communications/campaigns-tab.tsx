/**
 * CampaignsTab — full WhatsApp campaign system
 * Professional+ and Enterprise only. Starter sees an upgrade gate.
 */
import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Campaign,
  CampaignInput,
  CampaignType,
  CampaignAudienceType,
  CampaignScheduleType,
  CampaignStatus,
  SubscriptionStatus,
} from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Megaphone, Plus, Send, Clock, CheckCircle2, XCircle, AlertTriangle,
  RotateCcw, Trash2, Pencil, Users, Loader2, Sparkles, Calendar,
  Eye, ChevronRight, BarChart3, Copy, Lock, RefreshCw, Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ─── Constants ────────────────────────────────────────────────────────────────

const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  promotion:        "Promotion",
  reminder:         "Reminder",
  announcement:     "Announcement",
  holiday_greeting: "Holiday Greeting",
  win_back:         "Customer Win-back",
  custom:           "Custom",
};

const AUDIENCE_TYPE_LABELS: Record<CampaignAudienceType, { label: string; description: string }> = {
  all:                 { label: "All Customers",              description: "Every active customer" },
  vip:                 { label: "VIP Customers",              description: "Customers tagged as VIP" },
  repeat:              { label: "Repeat Customers",           description: "Customers with 2+ orders" },
  inactive_30:         { label: "Inactive 30 Days",           description: "No activity in 30 days" },
  inactive_60:         { label: "Inactive 60 Days",           description: "No activity in 60 days" },
  inactive_90:         { label: "Inactive 90 Days",           description: "No activity in 90 days" },
  outstanding_balance: { label: "Outstanding Balance",        description: "Customers with unpaid orders" },
  ready_pickup:        { label: "Ready for Pickup",           description: "Orders waiting for collection" },
  completed_orders:    { label: "Completed Orders",           description: "Customers who completed at least one order" },
  custom_tag:          { label: "Custom Tag",                 description: "Filter by a customer tag" },
  custom_selection:    { label: "Custom Selection",           description: "Specific customer IDs" },
};

const STATUS_CONFIG: Record<CampaignStatus, { label: string; icon: React.ElementType; cls: string }> = {
  draft:     { label: "Draft",      icon: Pencil,      cls: "bg-muted/40 text-muted-foreground border-muted" },
  scheduled: { label: "Scheduled",  icon: Calendar,    cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  queued:    { label: "Queued",     icon: Clock,       cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  sending:   { label: "Sending…",   icon: Loader2,     cls: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  sent:      { label: "Sent",       icon: CheckCircle2, cls: "bg-green-500/15 text-green-400 border-green-500/30" },
  failed:    { label: "Failed",     icon: XCircle,     cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  cancelled: { label: "Cancelled",  icon: Ban,         cls: "bg-muted/40 text-muted-foreground border-muted" },
};

const VARIABLES = [
  { key: "{{customerName}}", label: "Customer Name" },
  { key: "{{businessName}}", label: "Business Name" },
  { key: "{{balance}}",      label: "Balance" },
  { key: "{{orderNumber}}", label: "Order Number" },
  { key: "{{pickupDate}}",  label: "Pickup Date" },
];

const SAMPLE_PROMPTS = [
  "Generate a midweek promotion for customers who haven't visited in 45 days.",
  "Write a friendly win-back message for inactive customers with a 10% discount offer.",
  "Create a holiday greeting for all VIP customers.",
  "Draft a reminder to customers with orders ready for pickup.",
  "Write an announcement about our new premium dry-cleaning service.",
];

// ─── Upgrade Gate ─────────────────────────────────────────────────────────────

function UpgradeGate() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-6 max-w-md mx-auto">
      <div className="w-20 h-20 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
        <Lock className="h-8 w-8 text-amber-400" />
      </div>
      <div className="space-y-2">
        <h3 className="text-xl font-semibold">Campaigns — Professional Feature</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Send targeted WhatsApp blasts to your customers — promotions, win-back messages,
          seasonal offers, and loyalty campaigns.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 w-full text-left">
        {[
          "Bulk WhatsApp Messaging",
          "11 Customer Segments",
          "Scheduled Sends",
          "Delivery Analytics",
          "AI Campaign Generator",
          "Campaign History",
        ].map((f) => (
          <div key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            {f}
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300/90 text-left w-full">
        Upgrade to <strong>Professional</strong> to unlock unlimited campaigns.
        Contact us on WhatsApp or email to upgrade.
      </div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CampaignStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium", cfg.cls)}>
      <Icon className={cn("h-3 w-3", status === "sending" && "animate-spin")} />
      {cfg.label}
    </span>
  );
}

// ─── Audience Preview Widget ───────────────────────────────────────────────────

function AudiencePreviewWidget({
  audienceType,
  audienceFilter,
  branchId,
}: {
  audienceType: CampaignAudienceType;
  audienceFilter: any;
  branchId: number | null;
}) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["campaign-audience-preview", audienceType, audienceFilter, branchId],
    queryFn: () => api.campaigns.previewAudience({ audienceType, audienceFilter, branchId }),
    staleTime: 30_000,
    enabled: !!audienceType,
  });

  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/20 bg-muted/10 p-3 flex items-center gap-3 text-sm">
      <Users className="h-4 w-4 text-muted-foreground shrink-0" />
      {isLoading ? (
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Counting recipients…
        </span>
      ) : data ? (
        <span>
          <strong>{data.count.toLocaleString()}</strong>{" "}
          <span className="text-muted-foreground">
            recipient{data.count !== 1 ? "s" : ""} match this audience
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">Select audience to preview count</span>
      )}
      <button
        onClick={() => refetch()}
        className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
        title="Refresh count"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── AI Generator Panel ────────────────────────────────────────────────────────

function AICampaignGenerator({
  onUse,
}: {
  onUse: (text: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const { mutate: generate, isPending } = useMutation({
    mutationFn: () => api.marketing.generate(prompt),
    onSuccess: (data) => {
      setResult(data.content.whatsapp);
    },
    onError: () => toast.error("Failed to generate campaign copy"),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-purple-400">
        <Sparkles className="h-4 w-4" />
        AI Campaign Generator
      </div>
      <div className="flex flex-wrap gap-2">
        {SAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => setPrompt(p)}
            className="text-xs px-2.5 py-1 rounded-full border border-dashed border-muted-foreground/20 text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors"
          >
            {p.slice(0, 45)}…
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the campaign you want to create…"
          className="resize-none h-20 text-sm"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
        onClick={() => generate()}
        disabled={!prompt.trim() || isPending}
      >
        {isPending ? (
          <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating…</>
        ) : (
          <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate Copy</>
        )}
      </Button>

      {result && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Generated WhatsApp copy</span>
            <div className="flex gap-1">
              <button
                onClick={() => { navigator.clipboard.writeText(result); toast.success("Copied!"); }}
                className="hover:text-foreground transition-colors p-1"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => generate()}
                className="hover:text-foreground transition-colors p-1"
                title="Regenerate"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{result}</pre>
          <Button size="sm" onClick={() => onUse(result)} className="w-full">
            Use This Message
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Campaign Form Dialog ──────────────────────────────────────────────────────

const DEFAULT_FORM: CampaignInput = {
  name: "",
  type: "promotion",
  audienceType: "all",
  audienceFilter: null,
  messageTitle: "",
  messageBody: "",
  scheduleType: "now",
  scheduledAt: null,
  timezone: "Africa/Lagos",
  branchId: null,
};

function CampaignFormDialog({
  initial,
  onClose,
}: {
  initial?: Campaign | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!initial;

  const [form, setForm] = useState<CampaignInput>(() => initial
    ? {
        name: initial.name,
        type: initial.type,
        audienceType: initial.audienceType,
        audienceFilter: initial.audienceFilter ? JSON.parse(initial.audienceFilter) : null,
        messageTitle: initial.messageTitle ?? "",
        messageBody: initial.messageBody,
        scheduleType: initial.scheduleType,
        scheduledAt: initial.scheduledAt,
        timezone: initial.timezone ?? "Africa/Lagos",
        branchId: initial.branchId,
      }
    : { ...DEFAULT_FORM }
  );

  const [tab, setTab] = useState<"compose" | "ai">("compose");
  const [customTagInput, setCustomTagInput] = useState(
    (initial?.audienceFilter ? JSON.parse(initial.audienceFilter)?.tag : "") ?? ""
  );

  const set = useCallback(<K extends keyof CampaignInput>(key: K, val: CampaignInput[K]) => {
    setForm((f) => ({ ...f, [key]: val }));
  }, []);

  const insertVariable = (variable: string) => {
    set("messageBody", form.messageBody + variable);
  };

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      isEdit
        ? api.campaigns.update(initial!.id, form)
        : api.campaigns.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success(isEdit ? "Campaign updated" : "Campaign created");
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const audienceFilter =
    form.audienceType === "custom_tag"
      ? { tag: customTagInput }
      : form.audienceType === "custom_selection"
      ? form.audienceFilter
      : null;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Campaign" : "Create Campaign"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Name + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Campaign Name</Label>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Midweek Promotion"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Campaign Type</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v as CampaignType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(CAMPAIGN_TYPE_LABELS) as [CampaignType, string][]).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Audience */}
          <div className="space-y-2">
            <Label>Audience</Label>
            <Select value={form.audienceType} onValueChange={(v) => {
              set("audienceType", v as CampaignAudienceType);
              set("audienceFilter", null);
            }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(AUDIENCE_TYPE_LABELS) as [CampaignAudienceType, { label: string; description: string }][]).map(([v, { label, description }]) => (
                  <SelectItem key={v} value={v}>
                    <span className="flex flex-col">
                      <span>{label}</span>
                      <span className="text-xs text-muted-foreground">{description}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {form.audienceType === "custom_tag" && (
              <Input
                value={customTagInput}
                onChange={(e) => {
                  setCustomTagInput(e.target.value);
                  set("audienceFilter", { tag: e.target.value });
                }}
                placeholder="Tag name (e.g. VIP, Business, Regular)"
              />
            )}

            <AudiencePreviewWidget
              audienceType={form.audienceType}
              audienceFilter={audienceFilter}
              branchId={form.branchId ?? null}
            />
          </div>

          {/* Message Composer */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Message</Label>
              <div className="flex gap-1">
                <button
                  onClick={() => setTab("compose")}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded transition-colors",
                    tab === "compose" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Compose
                </button>
                <button
                  onClick={() => setTab("ai")}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded transition-colors flex items-center gap-1",
                    tab === "ai" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Sparkles className="h-3 w-3" /> AI
                </button>
              </div>
            </div>

            {tab === "compose" ? (
              <div className="space-y-2">
                <Input
                  value={form.messageTitle ?? ""}
                  onChange={(e) => set("messageTitle", e.target.value)}
                  placeholder="Message title (optional)"
                />
                <Textarea
                  value={form.messageBody}
                  onChange={(e) => set("messageBody", e.target.value)}
                  placeholder="Hi {{customerName}}, great news from {{businessName}}! …"
                  className="resize-none h-28"
                />
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground self-center">Variables:</span>
                  {VARIABLES.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => insertVariable(key)}
                      className="text-xs px-2 py-0.5 rounded bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground border border-muted-foreground/20 transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Preview */}
                {form.messageBody && (
                  <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3 text-sm">
                    <div className="text-xs text-green-400 mb-1 flex items-center gap-1">
                      <Eye className="h-3 w-3" /> Preview
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                      {form.messageBody
                        .replace(/\{\{customerName\}\}/gi, "Amaka Obi")
                        .replace(/\{\{businessName\}\}/gi, "Your Laundry")
                        .replace(/\{\{balance\}\}/gi, "₦2,500")
                        .replace(/\{\{orderNumber\}\}/gi, "ORD-001")
                        .replace(/\{\{pickupDate\}\}/gi, "Friday 14th")}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <AICampaignGenerator
                onUse={(text) => {
                  set("messageBody", text);
                  setTab("compose");
                }}
              />
            )}
          </div>

          {/* Scheduling */}
          <div className="space-y-2">
            <Label>Scheduling</Label>
            <Select value={form.scheduleType} onValueChange={(v) => set("scheduleType", v as CampaignScheduleType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="now">Send Now</SelectItem>
                <SelectItem value="scheduled">Schedule for Later</SelectItem>
                <SelectItem value="recurring_weekly">Recurring — Weekly</SelectItem>
                <SelectItem value="recurring_monthly">Recurring — Monthly</SelectItem>
              </SelectContent>
            </Select>
            {(form.scheduleType === "scheduled" || form.scheduleType === "recurring_weekly" || form.scheduleType === "recurring_monthly") && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Date & Time</Label>
                  <Input
                    type="datetime-local"
                    value={form.scheduledAt?.slice(0, 16) ?? ""}
                    onChange={(e) => set("scheduledAt", e.target.value ? new Date(e.target.value).toISOString() : null)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Timezone</Label>
                  <Select value={form.timezone ?? "Africa/Lagos"} onValueChange={(v) => set("timezone", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Africa/Lagos">Africa/Lagos (WAT)</SelectItem>
                      <SelectItem value="Africa/Accra">Africa/Accra (GMT)</SelectItem>
                      <SelectItem value="Africa/Nairobi">Africa/Nairobi (EAT)</SelectItem>
                      <SelectItem value="UTC">UTC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save()} disabled={isPending || !form.name || !form.messageBody}>
            {isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            {isEdit ? "Save Changes" : "Create Campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Campaign Detail Panel ─────────────────────────────────────────────────────

function CampaignDetail({
  campaign,
  onBack,
}: {
  campaign: Campaign;
  onBack: () => void;
}) {
  const qc = useQueryClient();

  const { data: detail, refetch } = useQuery({
    queryKey: ["campaign-detail", campaign.id],
    queryFn: () => api.campaigns.get(campaign.id),
    staleTime: 5_000,
    refetchInterval: ["queued", "sending"].includes(campaign.status) ? 3_000 : false,
  });

  const { data: recipients } = useQuery({
    queryKey: ["campaign-recipients", campaign.id],
    queryFn: () => api.campaigns.recipients(campaign.id, { limit: 100 }),
    staleTime: 10_000,
  });

  const { mutate: sendCampaign, isPending: isSending } = useMutation({
    mutationFn: () => api.campaigns.send(campaign.id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
      toast.success(`${data.message}`);
    },
    onError: (e: Error) => toast.error("Could not send campaign — " + (e.message || "please try again.")),
  });

  const { mutate: cancelCampaign, isPending: isCancelling } = useMutation({
    mutationFn: () => api.campaigns.cancel(campaign.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
      toast.success("Campaign cancelled");
    },
    onError: (e: Error) => toast.error("Could not cancel campaign — " + (e.message || "please try again.")),
  });

  const { mutate: retryCampaign, isPending: isRetrying } = useMutation({
    mutationFn: () => api.campaigns.retry(campaign.id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["campaign-detail", campaign.id] });
      toast.success(`Retrying ${data.recipientsQueued} failed messages`);
    },
    onError: (e: Error) => toast.error("Could not retry campaign — " + (e.message || "please try again.")),
  });

  const c = detail ?? campaign;
  const deliveryRate = c.totalRecipients > 0
    ? Math.round((c.delivered / c.totalRecipients) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          ← Campaigns
        </button>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{c.name}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{c.name}</h2>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <StatusBadge status={c.status} />
            <span className="text-xs text-muted-foreground">{CAMPAIGN_TYPE_LABELS[c.type]}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{AUDIENCE_TYPE_LABELS[c.audienceType]?.label}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">Created {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {["draft", "scheduled"].includes(c.status) && (
            <Button size="sm" onClick={() => sendCampaign()} disabled={isSending}>
              {isSending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
              Send Now
            </Button>
          )}
          {["queued", "sending", "scheduled"].includes(c.status) && (
            <Button size="sm" variant="outline" onClick={() => cancelCampaign()} disabled={isCancelling}>
              <Ban className="h-4 w-4 mr-1.5" /> Cancel
            </Button>
          )}
          {["sent", "failed"].includes(c.status) && c.failed > 0 && (
            <Button size="sm" variant="outline" onClick={() => retryCampaign()} disabled={isRetrying}>
              <RotateCcw className="h-4 w-4 mr-1.5" /> Retry Failed
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Delivery Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Recipients", value: c.totalRecipients, cls: "text-foreground" },
          { label: "Delivered", value: c.delivered, cls: "text-green-400" },
          { label: "Failed", value: c.failed, cls: "text-red-400" },
          { label: "Cancelled", value: c.cancelled, cls: "text-muted-foreground" },
        ].map(({ label, value, cls }) => (
          <Card key={label} className="border-muted/50">
            <CardContent className="p-4">
              <div className={cn("text-2xl font-bold", cls)}>{value.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Delivery progress bar */}
      {c.totalRecipients > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Delivery Rate</span>
            <span>{deliveryRate}%</span>
          </div>
          <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${deliveryRate}%` }}
            />
          </div>
        </div>
      )}

      {/* Message Preview */}
      <Card className="border-muted/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Message</CardTitle>
        </CardHeader>
        <CardContent>
          {c.messageTitle && (
            <div className="text-sm font-medium mb-1">{c.messageTitle}</div>
          )}
          <pre className="text-sm whitespace-pre-wrap font-sans text-muted-foreground leading-relaxed">
            {c.messageBody}
          </pre>
        </CardContent>
      </Card>

      {/* Recipients list */}
      {recipients && recipients.length > 0 && (
        <Card className="border-muted/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recipients ({recipients.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-muted/20 max-h-72 overflow-y-auto">
              {recipients.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <span className="font-medium">{r.customerName}</span>
                    <span className="text-xs text-muted-foreground ml-2">{r.phone}</span>
                  </div>
                  <StatusBadge status={r.status as any} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Campaign Card ─────────────────────────────────────────────────────────────

function CampaignCard({
  campaign,
  onSelect,
  onEdit,
  onDelete,
}: {
  campaign: Campaign;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();

  const { mutate: sendCampaign, isPending: isSending } = useMutation({
    mutationFn: () => api.campaigns.send(campaign.id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success(data.message);
    },
    onError: (e: Error) => toast.error("Could not send campaign — " + (e.message || "please try again.")),
  });

  return (
    <div
      className="flex items-start justify-between gap-3 p-4 rounded-xl border border-muted/50 bg-card hover:bg-muted/10 transition-colors group cursor-pointer"
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{campaign.name}</span>
          <StatusBadge status={campaign.status} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span>{CAMPAIGN_TYPE_LABELS[campaign.type]}</span>
          <span>·</span>
          <span>{AUDIENCE_TYPE_LABELS[campaign.audienceType]?.label}</span>
          {campaign.totalRecipients > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {campaign.totalRecipients.toLocaleString()} recipients
              </span>
            </>
          )}
          {campaign.sentAt && (
            <>
              <span>·</span>
              <span>{formatDistanceToNow(new Date(campaign.sentAt), { addSuffix: true })}</span>
            </>
          )}
        </div>
        {campaign.totalRecipients > 0 && campaign.status !== "draft" && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-green-400">{campaign.delivered} delivered</span>
            {campaign.failed > 0 && <span className="text-red-400">{campaign.failed} failed</span>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        {campaign.status === "draft" && (
          <>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-green-400 hover:text-green-300"
              onClick={() => sendCampaign()}
              disabled={isSending}
            >
              {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-red-400 hover:text-red-300" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Stats Dashboard ───────────────────────────────────────────────────────────

function CampaignStatsRow({ campaigns }: { campaigns: Campaign[] }) {
  const total     = campaigns.length;
  const scheduled = campaigns.filter((c) => c.status === "scheduled").length;
  const sent      = campaigns.filter((c) => c.status === "sent").length;
  const draft     = campaigns.filter((c) => c.status === "draft").length;
  const failed    = campaigns.filter((c) => c.status === "failed").length;

  return (
    <div className="grid grid-cols-5 gap-3">
      {[
        { label: "Total",     value: total,     cls: "text-foreground" },
        { label: "Scheduled", value: scheduled, cls: "text-blue-400" },
        { label: "Sent",      value: sent,      cls: "text-green-400" },
        { label: "Draft",     value: draft,     cls: "text-muted-foreground" },
        { label: "Failed",    value: failed,    cls: "text-red-400" },
      ].map(({ label, value, cls }) => (
        <Card key={label} className="border-muted/50">
          <CardContent className="p-4">
            <div className={cn("text-2xl font-bold tabular-nums", cls)}>{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main CampaignsTab ────────────────────────────────────────────────────────

export function CampaignsTab() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"all" | "history">("all");
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Campaign | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  // Check subscription
  const { data: subscription } = useQuery<SubscriptionStatus>({
    queryKey: ["subscription-status"],
    queryFn: () => api.subscription.getStatus(),
    staleTime: 60_000,
  });

  const hasAccess = subscription?.features?.HAS_WHATSAPP_CAMPAIGNS === true;

  const { data: campaignList = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns", activeTab],
    queryFn: () => activeTab === "history" ? api.campaigns.history() : api.campaigns.list(),
    staleTime: 15_000,
    enabled: hasAccess,
    refetchInterval: 10_000, // poll for status updates
  });

  const { mutate: deleteCampaign, isPending: isDeleting } = useMutation({
    mutationFn: (id: number) => api.campaigns.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign deleted");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error("Could not delete campaign — " + (e.message || "please try again.")),
  });

  // If we have a selected campaign, keep it fresh
  useEffect(() => {
    if (!selectedCampaign) return;
    const fresh = campaignList.find((c) => c.id === selectedCampaign.id);
    if (fresh) setSelectedCampaign(fresh);
  }, [campaignList]);

  // Subscription not loaded yet
  if (!subscription) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Starter: show upgrade gate
  if (!hasAccess) {
    return <UpgradeGate />;
  }

  // Campaign detail view
  if (selectedCampaign) {
    return (
      <CampaignDetail
        campaign={selectedCampaign}
        onBack={() => setSelectedCampaign(null)}
      />
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold">WhatsApp Campaigns</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send targeted bulk messages to customer segments
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditTarget(null); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-1.5" /> New Campaign
        </Button>
      </div>

      {/* Stats */}
      {campaignList.length > 0 && (
        <div className="mb-4">
          <CampaignStatsRow campaigns={campaignList} />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "all" | "history")}>
        <TabsList className="mb-4">
          <TabsTrigger value="all">
            All Campaigns
            {campaignList.length > 0 && (
              <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5">
                {campaignList.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : campaignList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center">
                <Megaphone className="h-7 w-7 text-muted-foreground/30" />
              </div>
              <div className="space-y-1 max-w-xs">
                <h4 className="font-medium">No campaigns yet</h4>
                <p className="text-sm text-muted-foreground">
                  Create your first campaign to send a targeted WhatsApp message to your customers.
                </p>
              </div>
              <Button onClick={() => { setEditTarget(null); setShowForm(true); }}>
                <Plus className="h-4 w-4 mr-1.5" /> Create Campaign
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {campaignList.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onSelect={() => setSelectedCampaign(campaign)}
                  onEdit={() => { setEditTarget(campaign); setShowForm(true); }}
                  onDelete={() => setDeleteTarget(campaign)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : campaignList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <BarChart3 className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No completed campaigns yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {campaignList.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onSelect={() => setSelectedCampaign(campaign)}
                  onEdit={() => {}}
                  onDelete={() => {}}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Form Dialog */}
      {showForm && (
        <CampaignFormDialog
          initial={editTarget}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <AlertDialog open onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteCampaign(deleteTarget.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
