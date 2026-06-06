import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MessageSquare, Plus, Pencil, Trash2, CheckCircle2, Clock, XCircle,
  MailCheck, Eye, Zap, Send, AlertCircle, Loader2, Wifi, WifiOff,
  Copy, RefreshCw, FlaskConical, ChevronDown, ChevronUp, ShieldCheck,
  Phone,
} from "lucide-react";
import type {
  NotifTemplate, NotifMessage, NotifStats, NotifTemplateInput,
  WaProviderConfig, WaConfigInput,
} from "@/lib/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  order_received:  "Order Received",
  order_ready:     "Order Ready for Pickup",
  order_delivered: "Order Delivered",
  pickup_reminder: "Pickup Reminder",
  payment_reminder:"Payment Reminder",
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp", sms: "SMS", email: "Email", push: "Push",
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "bg-green-500/15 text-green-400 border-green-500/30",
  sms:      "bg-blue-500/15 text-blue-400 border-blue-500/30",
  email:    "bg-purple-500/15 text-purple-400 border-purple-500/30",
  push:     "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
  queued:    { label: "Queued",    icon: Clock,    cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  sent:      { label: "Sent",      icon: Send,     cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  delivered: { label: "Delivered", icon: MailCheck, cls: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
  read:      { label: "Read",      icon: Eye,      cls: "bg-green-500/15 text-green-400 border-green-500/30" },
  failed:    { label: "Failed",    icon: XCircle,  cls: "bg-red-500/15 text-red-400 border-red-500/30" },
};

const VARIABLES_HELP = [
  "{{customer_name}}", "{{order_number}}", "{{branch_name}}",
  "{{business_name}}", "{{balance}}", "{{amount_paid}}",
  "{{total_due}}", "{{service_type}}",
];

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ─── Template form ────────────────────────────────────────────────────────────

function TemplateForm({ initial, onClose }: { initial?: NotifTemplate | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!initial;

  const [form, setForm] = useState<NotifTemplateInput>({
    name:         initial?.name ?? "",
    eventTrigger: initial?.eventTrigger ?? "order_ready",
    channel:      initial?.channel ?? "whatsapp",
    body:         initial?.body ?? "",
    isActive:     initial?.isActive ?? true,
  });

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? api.communication.updateTemplate(initial!.id, form)
        : api.communication.createTemplate(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comm-templates"] });
      qc.invalidateQueries({ queryKey: ["comm-stats"] });
      toast.success(isEdit ? "Template updated" : "Template created");
      onClose();
    },
    onError: () => toast.error("Failed to save template"),
  });

  const set = (field: keyof NotifTemplateInput, val: unknown) =>
    setForm((f) => ({ ...f, [field]: val }));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Template Name</Label>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Order Ready WhatsApp" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Trigger Event</Label>
          <Select value={form.eventTrigger} onValueChange={(v) => set("eventTrigger", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Channel</Label>
          <Select value={form.channel} onValueChange={(v) => set("channel", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Message Body</Label>
        <Textarea
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
          rows={6}
          placeholder="Hi {{customer_name}}, your order #{{order_number}} is ready..."
          className="font-mono text-sm resize-none"
        />
        <div className="flex flex-wrap gap-1.5 pt-1">
          {VARIABLES_HELP.map((v) => (
            <button
              key={v} type="button"
              onClick={() => setForm((f) => ({ ...f, body: f.body + v }))}
              className="text-xs px-2 py-0.5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Click a variable to insert it at the end.</p>
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} id="is-active" />
        <Label htmlFor="is-active">Active (will be used when triggered)</Label>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name || !form.body}>
          {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isEdit ? "Save Changes" : "Create Template"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── WhatsApp Setup Card ──────────────────────────────────────────────────────

function WhatsAppSetupCard() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<WaConfigInput>({
    phoneNumberId: "", accessToken: "", businessAccountId: "", webhookVerifyToken: "",
  });
  const [tokenTouched, setTokenTouched] = useState(false);

  const { data: cfg, isLoading } = useQuery<WaProviderConfig>({
    queryKey: ["wa-config"],
    queryFn: () => api.communication.getWhatsAppConfig(),
  });

  useEffect(() => {
    if (cfg?.isConfigured) {
      setForm({
        phoneNumberId:      cfg.phoneNumberId ?? "",
        accessToken:        cfg.accessTokenMasked ?? "",
        businessAccountId:  cfg.businessAccountId ?? "",
        webhookVerifyToken: cfg.webhookVerifyToken ?? "",
        apiVersion:         cfg.apiVersion ?? "v21.0",
      });
    }
  }, [cfg]);

  const save = useMutation({
    mutationFn: () => api.communication.saveWhatsAppConfig({
      ...form,
      accessToken: tokenTouched ? form.accessToken : (form.accessToken || "saved"),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-config"] });
      setTokenTouched(false);
      toast.success("WhatsApp configuration saved");
    },
    onError: () => toast.error("Failed to save configuration"),
  });

  const validate = useMutation({
    mutationFn: () => api.communication.validateWhatsAppConfig(),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["wa-config"] });
      if (result.valid) {
        toast.success(`Connected! ${result.verifiedName ?? ""} (${result.displayPhoneNumber ?? ""})`);
      } else {
        toast.error(`Validation failed: ${result.error}`);
      }
    },
    onError: () => toast.error("Validation request failed"),
  });

  const remove = useMutation({
    mutationFn: () => api.communication.deleteWhatsAppConfig(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-config"] });
      setForm({ phoneNumberId: "", accessToken: "", businessAccountId: "", webhookVerifyToken: "" });
      setTokenTouched(false);
      toast.success("WhatsApp configuration removed");
    },
  });

  const webhookUrl = `${window.location.origin}/api/webhooks/whatsapp`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success("Webhook URL copied");
  };

  const isConnected = cfg?.isConfigured && cfg?.isVerified;
  const isSaved     = cfg?.isConfigured && !cfg?.isVerified;

  const statusBadge = isLoading ? null : isConnected ? (
    <span className="flex items-center gap-1.5 text-xs font-medium text-green-400">
      <Wifi className="h-3.5 w-3.5" />
      Connected
      {cfg?.verifiedName && <span className="text-muted-foreground">· {cfg.verifiedName}</span>}
      {cfg?.displayPhoneNumber && <span className="text-muted-foreground">({cfg.displayPhoneNumber})</span>}
    </span>
  ) : isSaved ? (
    <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-400">
      <WifiOff className="h-3.5 w-3.5" />
      Saved — not verified
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <WifiOff className="h-3.5 w-3.5" />
      Not configured
    </span>
  );

  return (
    <Card className={`transition-all ${isConnected ? "border-green-500/30 bg-green-500/5" : isSaved ? "border-yellow-500/30 bg-yellow-500/5" : "border-muted"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isConnected ? "bg-green-500/15" : "bg-muted"}`}>
              <MessageSquare className={`h-5 w-5 ${isConnected ? "text-green-400" : "text-muted-foreground"}`} />
            </div>
            <div>
              <CardTitle className="text-sm">WhatsApp Business (Meta Cloud API)</CardTitle>
              <div className="mt-0.5">{statusBadge}</div>
            </div>
          </div>
          <Button
            variant="ghost" size="sm"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {expanded ? "Collapse" : "Configure"}
          </Button>
        </div>
        {isConnected && cfg?.lastTestedAt && (
          <p className="text-xs text-muted-foreground mt-1">
            Last verified: {new Date(cfg.lastTestedAt).toLocaleString()}
            {cfg.qualityRating && ` · Quality: ${cfg.qualityRating}`}
          </p>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-5 border-t border-border/50 mt-0 pt-4">
          {/* Credentials form */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Phone Number ID <span className="text-red-400">*</span></Label>
              <Input
                value={form.phoneNumberId}
                onChange={(e) => setForm((f) => ({ ...f, phoneNumberId: e.target.value }))}
                placeholder="e.g. 123456789012345"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">From Meta Business → WhatsApp → Phone Numbers</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Business Account ID <span className="text-red-400">*</span></Label>
              <Input
                value={form.businessAccountId}
                onChange={(e) => setForm((f) => ({ ...f, businessAccountId: e.target.value }))}
                placeholder="e.g. 987654321098765"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">From Meta Business → Business Settings</p>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">
                Permanent Access Token <span className="text-red-400">*</span>
                {cfg?.accessTokenSaved && !tokenTouched && (
                  <span className="ml-2 text-green-400 text-xs">(saved)</span>
                )}
              </Label>
              <Input
                type="password"
                value={form.accessToken}
                onChange={(e) => {
                  setTokenTouched(true);
                  setForm((f) => ({ ...f, accessToken: e.target.value }));
                }}
                placeholder={cfg?.accessTokenSaved && !tokenTouched ? "••••••••••••••••" : "EAAxx..."}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Generate a System User token in Meta Business Manager (never expires)</p>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Webhook Verify Token <span className="text-red-400">*</span></Label>
              <div className="flex gap-2">
                <Input
                  value={form.webhookVerifyToken}
                  onChange={(e) => setForm((f) => ({ ...f, webhookVerifyToken: e.target.value }))}
                  placeholder="A random secret string you choose"
                  className="font-mono text-sm"
                />
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => setForm((f) => ({ ...f, webhookVerifyToken: generateToken() }))}
                  className="shrink-0"
                >
                  Generate
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Enter this exact value in Meta's webhook configuration</p>
            </div>
          </div>

          {/* Webhook URL */}
          <div className="space-y-1.5">
            <Label className="text-xs">Webhook Callback URL</Label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="font-mono text-xs bg-muted/40" />
              <Button type="button" variant="outline" size="sm" onClick={copyWebhookUrl} className="shrink-0">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste this URL in Meta Developers → WhatsApp → Configuration → Webhook. Subscribe to the <code className="text-primary">messages</code> field.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.phoneNumberId || !form.businessAccountId || !form.webhookVerifyToken || (!cfg?.accessTokenSaved && !form.accessToken)}
            >
              {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Configuration
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={() => validate.mutate()}
              disabled={validate.isPending || !cfg?.isConfigured}
              title={!cfg?.isConfigured ? "Save configuration first" : ""}
            >
              {validate.isPending
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <ShieldCheck className="h-4 w-4 mr-2" />}
              Validate Connection
            </Button>
            {cfg?.isConfigured && (
              <Button
                size="sm" variant="ghost"
                className="text-destructive hover:text-destructive ml-auto"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                Remove
              </Button>
            )}
          </div>

          {/* Last test result */}
          {cfg?.lastTestResult && (
            <div className={`flex items-start gap-2 rounded p-2.5 text-xs ${
              cfg.isVerified
                ? "bg-green-500/10 text-green-300 border border-green-500/20"
                : "bg-red-500/10 text-red-300 border border-red-500/20"
            }`}>
              {cfg.isVerified
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                : <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              {cfg.lastTestResult}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Send Test Message Dialog ─────────────────────────────────────────────────

function TestMessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [body, setBody] = useState("Hello! This is a test message from CleanTrack. 🧺");
  const [result, setResult] = useState<{ success: boolean; error?: string; wamid?: string } | null>(null);

  const send = useMutation({
    mutationFn: () => api.communication.sendTestMessage({ phone, body }),
    onSuccess: (data) => {
      setResult({
        success: data.success,
        error: data.error,
        wamid: data.providerMessageId,
      });
      if (data.success) {
        qc.invalidateQueries({ queryKey: ["comm-messages"] });
        qc.invalidateQueries({ queryKey: ["comm-stats"] });
      }
    },
    onError: () => setResult({ success: false, error: "Request failed" }),
  });

  const handleClose = () => {
    setResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-green-500" />
            Send Test Message
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Recipient Phone</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+2348012345678"
                className="pl-9 font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground">Enter in international format. Nigerian local format (08xx) also works.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Message Body</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="resize-none text-sm"
            />
            <p className="text-xs text-muted-foreground">{body.length} / 4096 characters</p>
          </div>

          {result && (
            <div className={`flex items-start gap-2 rounded-lg p-3 text-sm border ${
              result.success
                ? "bg-green-500/10 border-green-500/20 text-green-300"
                : "bg-red-500/10 border-red-500/20 text-red-300"
            }`}>
              {result.success
                ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
              <div>
                {result.success ? (
                  <>
                    <p className="font-medium">Message sent!</p>
                    {result.wamid && (
                      <p className="text-xs mt-0.5 opacity-70 font-mono">{result.wamid}</p>
                    )}
                  </>
                ) : (
                  <p>{result.error ?? "Failed to send"}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Close</Button>
          <Button
            onClick={() => { setResult(null); send.mutate(); }}
            disabled={send.isPending || !phone.trim() || !body.trim()}
          >
            {send.isPending
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <Send className="h-4 w-4 mr-2" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delivery timeline ────────────────────────────────────────────────────────

function DeliveryTimeline({ msg }: { msg: NotifMessage }) {
  const steps: { key: string; label: string; time: string | null }[] = [
    { key: "queued",    label: "Queued",    time: msg.queuedAt },
    { key: "sent",      label: "Sent",      time: msg.sentAt },
    { key: "delivered", label: "Delivered", time: msg.deliveredAt },
    { key: "read",      label: "Read",      time: msg.readAt },
  ];

  const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  const currentRank = RANK[msg.status] ?? 0;

  return (
    <div className="flex items-center gap-1 mt-1.5">
      {steps.map((step, i) => {
        const rank = RANK[step.key] ?? 0;
        const done = rank <= currentRank && msg.status !== "failed";
        const current = step.key === msg.status;
        return (
          <div key={step.key} className="flex items-center gap-1">
            <div
              title={step.time ? new Date(step.time).toLocaleString() : step.label}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                done ? "bg-green-400" : current ? "bg-blue-400" : "bg-muted-foreground/20"
              }`}
            />
            {i < steps.length - 1 && (
              <div className={`h-px w-4 ${rank < currentRank ? "bg-green-400/40" : "bg-muted-foreground/10"}`} />
            )}
          </div>
        );
      })}
      <span className="text-xs text-muted-foreground ml-1">
        {msg.readAt
          ? "Read"
          : msg.deliveredAt
          ? "Delivered"
          : msg.sentAt
          ? "Sent"
          : msg.status === "failed"
          ? "Failed"
          : "Queued"}
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CommunicationsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("templates");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NotifTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<NotifTemplate | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [filterTrigger, setFilterTrigger] = useState("all");
  const [filterChannel, setFilterChannel] = useState("all");
  const [msgStatus, setMsgStatus] = useState("all");
  const [msgChannel, setMsgChannel] = useState("all");

  const { data: stats } = useQuery({
    queryKey: ["comm-stats"],
    queryFn: () => api.communication.stats(),
  });

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ["comm-templates", filterTrigger, filterChannel],
    queryFn: () =>
      api.communication.listTemplates({
        trigger:  filterTrigger  !== "all" ? filterTrigger  : undefined,
        channel:  filterChannel  !== "all" ? filterChannel  : undefined,
      }),
  });

  const { data: messagesData, isLoading: loadingMessages } = useQuery({
    queryKey: ["comm-messages", msgStatus, msgChannel],
    queryFn: () =>
      api.communication.listMessages({
        status:  msgStatus  !== "all" ? msgStatus  : undefined,
        channel: msgChannel !== "all" ? msgChannel : undefined,
        limit: 100,
      }),
    enabled: tab === "messages",
    refetchInterval: tab === "messages" ? 10_000 : false,
  });

  const seedDefaults = useMutation({
    mutationFn: () => api.communication.seedDefaults(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["comm-templates"] });
      qc.invalidateQueries({ queryKey: ["comm-stats"] });
      if (data.seeded > 0) toast.success(`Seeded ${data.seeded} default templates`);
      else toast.info(data.message ?? "Defaults already loaded");
    },
    onError: () => toast.error("Failed to seed templates"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.communication.updateTemplate(id, { isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["comm-templates"] }); },
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: number) => api.communication.deleteTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comm-templates"] });
      qc.invalidateQueries({ queryKey: ["comm-stats"] });
      toast.success("Template deleted");
    },
    onError: () => toast.error("Failed to delete template"),
  });

  const retryMessage = useMutation({
    mutationFn: (id: number) => api.communication.retryMessage(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["comm-messages"] });
      qc.invalidateQueries({ queryKey: ["comm-stats"] });
      if (data.success) toast.success("Message re-sent successfully");
      else toast.error(data.error ?? "Retry failed");
    },
    onError: () => toast.error("Retry request failed"),
  });

  const failedCount = stats?.byStatus.failed ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-green-500" />
            Communications
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            WhatsApp provider, notification templates, and delivery tracking.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTestDialogOpen(true)}>
            <FlaskConical className="h-4 w-4 mr-2" />
            Send Test
          </Button>
          <Button variant="outline" size="sm" onClick={() => seedDefaults.mutate()} disabled={seedDefaults.isPending}>
            {seedDefaults.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
            Load Defaults
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Templates</p>
              <p className="text-2xl font-bold">{stats.templates.total}</p>
              <p className="text-xs text-muted-foreground">{stats.templates.active} active</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Queued</p>
              <p className="text-2xl font-bold text-yellow-400">{stats.byStatus.queued ?? 0}</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Delivered</p>
              <p className="text-2xl font-bold text-teal-400">
                {(stats.byStatus.delivered ?? 0) + (stats.byStatus.read ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground">{stats.byStatus.read ?? 0} read</p>
            </CardContent>
          </Card>
          <Card className={`bg-card/50 ${failedCount > 0 ? "border-red-500/30" : ""}`}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Failed</p>
              <p className={`text-2xl font-bold ${failedCount > 0 ? "text-red-400" : ""}`}>{failedCount}</p>
              {failedCount > 0 && (
                <button
                  onClick={() => { setMsgStatus("failed"); setTab("messages"); }}
                  className="text-xs text-red-400 hover:underline"
                >
                  View failed →
                </button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* WhatsApp Setup Card */}
      <WhatsAppSetupCard />

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="templates">
            Templates
            {stats && (
              <span className="ml-2 text-xs bg-muted rounded-full px-1.5">{stats.templates.total}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="messages">
            Message Log
            {stats && stats.total > 0 && (
              <span className="ml-2 text-xs bg-muted rounded-full px-1.5">{stats.total}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Templates tab ── */}
        <TabsContent value="templates" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={filterTrigger} onValueChange={setFilterTrigger}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Triggers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Triggers</SelectItem>
                {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterChannel} onValueChange={setFilterChannel}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All Channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loadingTemplates ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading templates…
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
              <MessageSquare className="h-10 w-10 opacity-30" />
              <div>
                <p className="font-medium">No templates yet</p>
                <p className="text-sm">Click "Load Defaults" to get 5 ready-made templates.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((t) => (
                <Card key={t.id} className={`transition-opacity ${!t.isActive ? "opacity-60" : ""}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-sm truncate">{t.name}</CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {TRIGGER_LABELS[t.eventTrigger] ?? t.eventTrigger}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${CHANNEL_COLORS[t.channel] ?? "bg-muted text-muted-foreground"}`}>
                          {CHANNEL_LABELS[t.channel] ?? t.channel}
                        </span>
                        {t.isDefault && <Badge variant="outline" className="text-xs">Default</Badge>}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <p className="text-xs text-muted-foreground line-clamp-2 font-mono bg-muted/40 rounded p-2">
                      {t.body}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={t.isActive}
                          onCheckedChange={(v) => toggleActive.mutate({ id: t.id, isActive: v })}
                          className="scale-90"
                        />
                        <span className="text-xs text-muted-foreground">
                          {t.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPreviewTemplate(t)} title="Preview">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(t); setFormOpen(true); }} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteTemplate.mutate(t.id)} title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Message Log tab ── */}
        <TabsContent value="messages" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={msgStatus} onValueChange={setMsgStatus}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={msgChannel} onValueChange={setMsgChannel}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Channels" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost" size="sm" className="ml-auto text-muted-foreground"
              onClick={() => { qc.invalidateQueries({ queryKey: ["comm-messages"] }); qc.invalidateQueries({ queryKey: ["comm-stats"] }); }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          {loadingMessages ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading messages…
            </div>
          ) : !messagesData || messagesData.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
              <Send className="h-10 w-10 opacity-30" />
              <div>
                <p className="font-medium">No messages yet</p>
                <p className="text-sm">Messages appear here once orders trigger notifications, or when you send a test.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{messagesData.total} total messages</p>
              {messagesData.messages.map((m) => {
                const sc = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.queued;
                const StatusIcon = sc.icon;
                const isTest = (m as any).metadata?.isTest;
                return (
                  <div key={m.id} className={`rounded-lg border bg-card/50 p-3 ${m.status === "failed" ? "border-red-500/20" : ""}`}>
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">
                        <StatusIcon className={`h-4 w-4 ${m.status === "failed" ? "text-red-400" : m.status === "read" ? "text-green-400" : m.status === "delivered" ? "text-teal-400" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">
                            {m.recipientName ?? m.recipientPhone}
                          </span>
                          {m.recipientName && (
                            <span className="text-xs text-muted-foreground font-mono">{m.recipientPhone}</span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${CHANNEL_COLORS[m.channel] ?? "bg-muted text-muted-foreground"}`}>
                            {CHANNEL_LABELS[m.channel] ?? m.channel}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${sc.cls}`}>
                            {sc.label}
                          </span>
                          {isTest && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/30 font-medium">Test</span>
                          )}
                          {m.retryCount > 0 && (
                            <span className="text-xs text-muted-foreground">retry ×{m.retryCount}</span>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 font-mono bg-muted/30 rounded px-2 py-1">
                          {m.renderedBody}
                        </p>

                        <DeliveryTimeline msg={m} />

                        {m.errorMessage && (
                          <div className="flex items-start gap-1.5 mt-1.5 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            {m.errorMessage}
                          </div>
                        )}

                        {m.providerMessageId && (
                          <p className="text-xs text-muted-foreground/40 mt-1 font-mono truncate">{m.providerMessageId}</p>
                        )}

                        <p className="text-xs text-muted-foreground/60 mt-1">
                          {new Date(m.queuedAt).toLocaleString()}
                        </p>
                      </div>

                      {/* Retry button */}
                      {(m.status === "failed" || m.status === "queued") && (
                        <Button
                          size="sm" variant="outline"
                          className="shrink-0 h-7 text-xs"
                          onClick={() => retryMessage.mutate(m.id)}
                          disabled={retryMessage.isPending}
                          title="Retry sending"
                        >
                          {retryMessage.isPending
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <RefreshCw className="h-3 w-3" />}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Template" : "New Notification Template"}</DialogTitle>
          </DialogHeader>
          <TemplateForm initial={editing} onClose={() => setFormOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!previewTemplate} onOpenChange={(v) => !v && setPreviewTemplate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Preview: {previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          {previewTemplate && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${CHANNEL_COLORS[previewTemplate.channel]}`}>
                  {CHANNEL_LABELS[previewTemplate.channel]}
                </span>
                <span className="text-xs text-muted-foreground">
                  Trigger: {TRIGGER_LABELS[previewTemplate.eventTrigger]}
                </span>
              </div>
              <div className="rounded-lg bg-muted/40 border p-4">
                <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{previewTemplate.body}</pre>
              </div>
              {previewTemplate.variables && previewTemplate.variables.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Variables used:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {previewTemplate.variables.map((v) => (
                      <span key={v} className="text-xs px-2 py-0.5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground">
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {previewTemplate.isDefault && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Default template (can be edited)
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setPreviewTemplate(null)}>Close</Button>
            <Button variant="outline" onClick={() => { setEditing(previewTemplate!); setFormOpen(true); setPreviewTemplate(null); }}>
              <Pencil className="h-4 w-4 mr-2" />Edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Message dialog */}
      <TestMessageDialog open={testDialogOpen} onOpenChange={setTestDialogOpen} />
    </div>
  );
}
