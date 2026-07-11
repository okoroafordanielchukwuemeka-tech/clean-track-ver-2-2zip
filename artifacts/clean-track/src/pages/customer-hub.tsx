import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { InboxTab } from "@/components/inbox-tab";
import { ActivityTab } from "@/components/communications/activity-tab";
import { AutomationsTab } from "@/components/communications/automations-tab";
import { api } from "@/lib/api";
import type {
  WaConnectionStatus,
  WaMetaConfig,
  WaMetaCallbackInput,
  NotifTemplate,
  NotifTemplateInput,
  NotifStats,
} from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  MessageSquare,
  CheckCircle2,
  WifiOff,
  Loader2,
  Link,
  Unlink,
  Calendar,
  Plus,
  Pencil,
  Trash2,
  Eye,
  Send,
  RefreshCw,
  FlaskConical,
  Phone,
  Clock,
  MailCheck,
  XCircle,
  BarChart3,
  Megaphone,
  Zap,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  order_received:   "Order Received",
  order_ready:      "Order Ready for Pickup",
  order_delivered:  "Order Delivered",
  pickup_reminder:  "Pickup Reminder",
  payment_reminder: "Payment Reminder",
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

// ─── TemplateForm ─────────────────────────────────────────────────────────────

function TemplateForm({
  initial,
  onClose,
}: {
  initial?: NotifTemplate | null;
  onClose: () => void;
}) {
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
        <Input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Order Ready WhatsApp"
        />
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
              key={v}
              type="button"
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
        <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} id="tpl-is-active" />
        <Label htmlFor="tpl-is-active">Active (will be used when triggered)</Label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !form.name || !form.body}
        >
          {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isEdit ? "Save Changes" : "Create Template"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── TestMessageDialog ────────────────────────────────────────────────────────

function TestMessageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [body, setBody] = useState("Hello! This is a test message from CleanTrack. 🧺");
  const [result, setResult] = useState<{
    success: boolean;
    error?: string;
    wamid?: string;
  } | null>(null);

  const send = useMutation({
    mutationFn: () => api.communication.sendTestMessage({ phone, body }),
    onSuccess: (data) => {
      setResult({ success: data.success, error: data.error, wamid: data.providerMessageId });
      if (data.success) qc.invalidateQueries({ queryKey: ["comm-stats"] });
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
            <p className="text-xs text-muted-foreground">Nigerian local format (08xx) also works.</p>
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
            <div
              className={cn(
                "flex items-start gap-2 rounded-lg p-3 text-sm border",
                result.success
                  ? "bg-green-500/10 border-green-500/20 text-green-300"
                  : "bg-red-500/10 border-red-500/20 text-red-300"
              )}
            >
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

// ─── OverviewTab ──────────────────────────────────────────────────────────────

function OverviewTab({ onNavigateToTab }: { onNavigateToTab: (tab: string) => void }) {
  const qc = useQueryClient();
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const pendingWabaRef = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: status, isLoading: loadingStatus } = useQuery<WaConnectionStatus>({
    queryKey: ["whatsapp-status"],
    queryFn: () => api.whatsapp.status(),
    staleTime: 30_000,
  });

  const { data: metaConfig, isLoading: loadingMeta } = useQuery<WaMetaConfig>({
    queryKey: ["whatsapp-meta-config"],
    queryFn: () => api.whatsapp.metaConfig(),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: "always",
  });

  const { data: unreadData } = useQuery({
    queryKey: ["conversations-unread"],
    queryFn: () => api.conversations.getUnreadCount(),
    refetchInterval: 30_000,
  });

  const { data: automationData } = useQuery({
    queryKey: ["automation-rules"],
    queryFn: () => api.automationRules.list(),
    staleTime: 60_000,
  });

  const { data: commStats } = useQuery({
    queryKey: ["comm-stats"],
    queryFn: () => api.communication.stats(),
    staleTime: 60_000,
  });

  // ── Derived state ─────────────────────────────────────────────────────────
  const useEmbeddedSignup = metaConfig?.available === true;
  const isConnected = status?.connected === true;
  const connectedStatus = isConnected
    ? (status as Extract<WaConnectionStatus, { connected: true }>)
    : null;

  const unreadCount = unreadData?.unreadCount ?? 0;
  const automationRules = automationData?.rules ?? [];
  const enabledAutomations = automationRules.filter((r) => r.enabled).length;
  const totalMessages = commStats
    ? (commStats.byStatus.sent ?? 0) +
      (commStats.byStatus.delivered ?? 0) +
      (commStats.byStatus.read ?? 0)
    : 0;

  // ── Load Facebook SDK ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!useEmbeddedSignup || !metaConfig) return;
    if (document.getElementById("facebook-jssdk")) return;
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      (window as any).FB?.init({
        appId: (metaConfig as Extract<WaMetaConfig, { available: true }>).appId,
        version: "v21.0",
        cookie: true,
      });
    };
    document.body.appendChild(script);
  }, [useEmbeddedSignup, metaConfig]);

  // ── Listen for Meta Embedded Signup window messages ───────────────────────
  useEffect(() => {
    if (!useEmbeddedSignup) return;

    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      ) return;

      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;

        if (data.event === "FINISH") {
          pendingWabaRef.current = {
            wabaId: data.data.waba_id,
            phoneNumberId: data.data.phone_number_id,
          };
        } else if (data.event === "CANCEL") {
          setIsConnecting(false);
          toast.info("WhatsApp connection was cancelled.");
        } else if (data.event === "ERROR") {
          setIsConnecting(false);
          toast.error("WhatsApp connection encountered an error. Please try again.");
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [useEmbeddedSignup]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const metaCallbackMutation = useMutation({
    mutationFn: (data: WaMetaCallbackInput) => api.whatsapp.metaCallback(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-meta-config"] });
      setIsConnecting(false);
      toast.success("WhatsApp Business connected successfully");
    },
    onError: () => {
      setIsConnecting(false);
      toast.error("Your WhatsApp connection was not completed. Please try again.");
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.whatsapp.disconnect(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-meta-config"] });
      toast.success("WhatsApp Business disconnected");
      setShowDisconnectDialog(false);
    },
    onError: () => toast.error("Failed to disconnect"),
  });

  // ── Embedded Signup launcher ──────────────────────────────────────────────
  const launchEmbeddedSignup = () => {
    const fb = (window as any).FB;
    if (!fb) {
      toast.error("WhatsApp signup is still loading. Please try again in a moment.");
      return;
    }
    const cfg = metaConfig as Extract<WaMetaConfig, { available: true }>;
    pendingWabaRef.current = null;
    setIsConnecting(true);
    api.whatsapp.metaStart().catch(() => {});

    fb.login(
      (response: any) => {
        const code: string | undefined = response?.authResponse?.code;

        if (!code) {
          if (!pendingWabaRef.current) {
            setIsConnecting(false);
            if (response?.status !== "connected") {
              toast.info("WhatsApp connection was not completed. Please try again.");
            }
          }
          return;
        }

        // The WABA/phone IDs arrive via a separate `window.postMessage` FINISH
        // event from the Meta popup, which is NOT guaranteed to be processed
        // before this fb.login callback fires (Meta does not order the two).
        // If it hasn't landed yet, poll briefly instead of failing immediately.
        const proceedWithWaba = (waba: { wabaId: string; phoneNumberId: string }) => {
          metaCallbackMutation.mutate({
            code,
            wabaId: waba.wabaId,
            phoneNumberId: waba.phoneNumberId,
          });
        };

        if (pendingWabaRef.current) {
          proceedWithWaba(pendingWabaRef.current);
          return;
        }

        console.log("[whatsapp] fb.login callback fired before FINISH message — polling for WABA data");
        const pollIntervalMs = 100;
        const maxWaitMs = 4000;
        let waitedMs = 0;
        const poll = setInterval(() => {
          if (pendingWabaRef.current) {
            clearInterval(poll);
            console.log("[whatsapp] FINISH message arrived after", waitedMs, "ms — proceeding");
            proceedWithWaba(pendingWabaRef.current);
            return;
          }
          waitedMs += pollIntervalMs;
          if (waitedMs >= maxWaitMs) {
            clearInterval(poll);
            console.error("[whatsapp] FINISH message never arrived after", maxWaitMs, "ms — giving up");
            setIsConnecting(false);
            toast.error("Could not retrieve your WhatsApp account details. Please try again.");
          }
        }, pollIntervalMs);
      },
      {
        config_id: cfg.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      }
    );
  };

  const isLoading = loadingStatus || loadingMeta;

  return (
    <div className="space-y-6">
      {/* ── WhatsApp Connection Card ── */}
      <div
        className={cn(
          "rounded-xl border p-5 transition-colors",
          isConnected
            ? "border-green-500/30 bg-green-500/5"
            : "border-border bg-muted/30"
        )}
      >
        {isLoading ? (
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Checking WhatsApp status…</span>
          </div>
        ) : isConnected && connectedStatus ? (
          /* ─ Connected state ─ */
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="font-semibold">WhatsApp Connected</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {connectedStatus.businessName ?? "WhatsApp Business Account"}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0"
                onClick={() => setShowDisconnectDialog(true)}
              >
                <Unlink className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-background/60 border border-border/60 px-3 py-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">Business Name</p>
                <p className="text-sm font-medium">{connectedStatus.businessName ?? "—"}</p>
              </div>
              <div className="rounded-lg bg-background/60 border border-border/60 px-3 py-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">Phone Number</p>
                <p className="text-sm font-medium">{connectedStatus.displayPhoneNumber ?? "—"}</p>
              </div>
              <div className="rounded-lg bg-background/60 border border-border/60 px-3 py-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">Connected On</p>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {new Date(connectedStatus.connectedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>

            {connectedStatus.stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/40">
                <div className="rounded-lg bg-background/40 px-3 py-2 text-center">
                  <p className="text-lg font-bold">{connectedStatus.stats.totalMessages.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Messages</p>
                </div>
                <div className="rounded-lg bg-background/40 px-3 py-2 text-center">
                  <p className="text-lg font-bold">{connectedStatus.stats.totalConversations.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Conversations</p>
                </div>
                <div className="rounded-lg bg-background/40 px-3 py-2 text-center">
                  <p className="text-lg font-bold">{connectedStatus.stats.uniqueCustomers.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Customers</p>
                </div>
                <div className="rounded-lg bg-background/40 px-3 py-2 text-center">
                  <p className="text-sm font-medium">
                    {connectedStatus.stats.lastActivityAt
                      ? new Date(connectedStatus.stats.lastActivityAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })
                      : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Last Activity</p>
                </div>
              </div>
            )}
          </div>
        ) : useEmbeddedSignup ? (
          /* ─ Not connected, Embedded Signup available ─ */
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center shrink-0">
                <WifiOff className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold">Not Connected</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Connect your WhatsApp Business account in one click.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={launchEmbeddedSignup}
              disabled={isConnecting || metaCallbackMutation.isPending}
            >
              {isConnecting || metaCallbackMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link className="h-3.5 w-3.5" />
              )}
              {isConnecting
                ? "Connecting…"
                : metaCallbackMutation.isPending
                ? "Saving…"
                : "Connect WhatsApp"}
            </Button>
          </div>
        ) : (
          /* ─ Embedded Signup unavailable ─ */
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center shrink-0">
              <WifiOff className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-sm">WhatsApp Business is currently unavailable.</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Contact your platform administrator to enable WhatsApp Business.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => onNavigateToTab("inbox")}
          className="rounded-xl border bg-card/50 p-4 text-left hover:bg-card/80 transition-colors group"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Unread</p>
            <MessageSquare className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className={cn("text-2xl font-bold", unreadCount > 0 ? "text-green-400" : "")}>
            {unreadCount}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Open Inbox →</p>
        </button>

        <div className="rounded-xl border bg-card/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Messages Sent</p>
            <Send className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold">{totalMessages.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-0.5">All time</p>
        </div>

        <button
          onClick={() => onNavigateToTab("automations")}
          className="rounded-xl border bg-card/50 p-4 text-left hover:bg-card/80 transition-colors group"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Automations</p>
            <Bot className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-2xl font-bold">{enabledAutomations}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            of {automationRules.length} active →
          </p>
        </button>

        <button
          onClick={() => onNavigateToTab("campaigns")}
          className="rounded-xl border bg-card/50 p-4 text-left hover:bg-card/80 transition-colors group opacity-60 cursor-default"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Campaigns</p>
            <Megaphone className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold">—</p>
          <p className="text-xs text-muted-foreground mt-0.5">Coming soon</p>
        </button>
      </div>

      {/* Embedded Signup hint */}
      {!isConnected && useEmbeddedSignup && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm space-y-1">
          <p className="font-medium text-green-200">One-click setup via Meta</p>
          <p className="text-xs text-green-300/80">
            You'll be guided through a secure Meta signup flow. CleanTrack never sees your Meta
            password — only the WhatsApp Business access needed to send notifications.
          </p>
        </div>
      )}

      {/* Disconnect confirmation */}
      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              Customers will no longer receive WhatsApp notifications for their orders. You can
              reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnectMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── CampaignsTab ─────────────────────────────────────────────────────────────

function CampaignsTab() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-5">
      <div className="w-20 h-20 rounded-2xl bg-muted/30 flex items-center justify-center">
        <Megaphone className="h-9 w-9 text-muted-foreground/30" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h3 className="text-lg font-semibold">Campaigns Coming Soon</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Send targeted WhatsApp blasts to your customers — promotions, re-engagement
          messages, seasonal offers, and loyalty campaigns.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 mt-2">
        {[
          "Bulk Messaging",
          "Customer Segments",
          "Scheduled Sends",
          "Delivery Analytics",
        ].map((tag) => (
          <span
            key={tag}
            className="text-xs text-muted-foreground/60 px-2.5 py-1 rounded-full border border-dashed border-muted-foreground/20"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── AnalyticsTab ─────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const { data: stats } = useQuery({
    queryKey: ["comm-stats"],
    queryFn: () => api.communication.stats(),
    staleTime: 60_000,
  });

  const { data: waStatus } = useQuery<WaConnectionStatus>({
    queryKey: ["whatsapp-status"],
    queryFn: () => api.whatsapp.status(),
    staleTime: 30_000,
  });

  const { data: automationData } = useQuery({
    queryKey: ["automation-rules"],
    queryFn: () => api.automationRules.list(),
    staleTime: 60_000,
  });

  const isConnected = waStatus?.connected === true;
  const waStats = isConnected
    ? (waStatus as Extract<WaConnectionStatus, { connected: true }>).stats
    : null;

  const rules = automationData?.rules ?? [];
  const enabledRules = rules.filter((r) => r.enabled).length;

  const sent =
    (stats?.byStatus.sent ?? 0) +
    (stats?.byStatus.delivered ?? 0) +
    (stats?.byStatus.read ?? 0);
  const delivered = (stats?.byStatus.delivered ?? 0) + (stats?.byStatus.read ?? 0);
  const read = stats?.byStatus.read ?? 0;
  const readRate = sent > 0 ? Math.round((read / sent) * 100) : 0;
  const deliveryRate = sent > 0 ? Math.round((delivered / sent) * 100) : 0;

  const metrics: {
    label: string;
    value: string;
    sub: string;
    icon: React.ElementType;
    color: string;
    bg: string;
  }[] = [
    {
      label: "Messages Sent",
      value: sent.toLocaleString(),
      sub: "Total outbound messages",
      icon: Send,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      label: "Messages Delivered",
      value: delivered.toLocaleString(),
      sub: sent > 0 ? `${deliveryRate}% delivery rate` : "—",
      icon: MailCheck,
      color: "text-teal-400",
      bg: "bg-teal-500/10",
    },
    {
      label: "Read Rate",
      value: sent > 0 ? `${readRate}%` : "—",
      sub: `${read.toLocaleString()} messages read`,
      icon: Eye,
      color: "text-green-400",
      bg: "bg-green-500/10",
    },
    {
      label: "Response Time",
      value: "N/A",
      sub: "Tracking coming soon",
      icon: Clock,
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
    },
    {
      label: "Automation Success",
      value: enabledRules > 0 ? `${enabledRules} active` : "None",
      sub: `of ${rules.length} rules enabled`,
      icon: Bot,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
    {
      label: "Customer Engagement",
      value: waStats ? waStats.uniqueCustomers.toLocaleString() : "—",
      sub: "Unique WhatsApp contacts",
      icon: Users,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Performance overview for your WhatsApp Business channel.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="rounded-xl border bg-card/50 p-5">
              <div className="mb-3">
                <div
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center",
                    m.bg
                  )}
                >
                  <Icon className={cn("h-4 w-4", m.color)} />
                </div>
              </div>
              <p className="text-2xl font-bold">{m.value}</p>
              <p className="text-sm font-medium mt-1">{m.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{m.sub}</p>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center pb-2">
        More detailed analytics — response time, per-template performance, and hourly
        breakdowns — are coming in a future update.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CustomerHubPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NotifTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<NotifTemplate | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [filterTrigger, setFilterTrigger] = useState("all");
  const [filterChannel, setFilterChannel] = useState("all");

  const { data: stats } = useQuery<NotifStats>({
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
    enabled: tab === "templates",
  });

  const { data: unreadData } = useQuery({
    queryKey: ["conversations-unread"],
    queryFn: () => api.conversations.getUnreadCount(),
    refetchInterval: 30_000,
  });
  const inboxUnread = unreadData?.unreadCount ?? 0;

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

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <Users className="h-6 w-6 text-green-500" />
            Customer Hub
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            WhatsApp, messaging, automations, and customer engagement.
          </p>
        </div>

        {/* Templates-tab header actions */}
        {tab === "templates" && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setTestDialogOpen(true)}>
              <FlaskConical className="h-4 w-4 mr-2" />
              Send Test
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => seedDefaults.mutate()}
              disabled={seedDefaults.isPending}
            >
              {seedDefaults.isPending
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Zap className="h-4 w-4 mr-2" />}
              Load Defaults
            </Button>
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto gap-0.5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="inbox" className="gap-1.5">
            Inbox
            {inboxUnread > 0 && (
              <span className="bg-green-500 text-white text-xs font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {inboxUnread}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="templates">
            Templates
            {stats && (
              <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5">
                {stats.templates.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-5">
          <OverviewTab onNavigateToTab={setTab} />
        </TabsContent>

        {/* Inbox */}
        <TabsContent value="inbox" className="mt-4">
          <InboxTab />
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates" className="space-y-4 mt-4">
          {/* Filters */}
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
                <Card
                  key={t.id}
                  className={cn("transition-opacity", !t.isActive && "opacity-60")}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-sm truncate">{t.name}</CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {TRIGGER_LABELS[t.eventTrigger] ?? t.eventTrigger}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded-full border font-medium",
                            CHANNEL_COLORS[t.channel] ?? "bg-muted text-muted-foreground"
                          )}
                        >
                          {CHANNEL_LABELS[t.channel] ?? t.channel}
                        </span>
                        {t.isDefault && (
                          <Badge variant="outline" className="text-xs">Default</Badge>
                        )}
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
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setPreviewTemplate(t)}
                          title="Preview"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => { setEditing(t); setFormOpen(true); }}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => deleteTemplate.mutate(t.id)}
                          title="Delete"
                        >
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

        {/* Automations */}
        <TabsContent value="automations" className="mt-4">
          <AutomationsTab />
        </TabsContent>

        {/* Campaigns */}
        <TabsContent value="campaigns" className="mt-4">
          <CampaignsTab />
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="mt-4">
          <AnalyticsTab />
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity" className="mt-4">
          <ActivityTab onOpenConversation={() => setTab("inbox")} />
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ── */}

      {/* Create / Edit Template */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Template" : "New Notification Template"}
            </DialogTitle>
          </DialogHeader>
          <TemplateForm initial={editing} onClose={() => setFormOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Preview Template */}
      <Dialog
        open={!!previewTemplate}
        onOpenChange={(v) => !v && setPreviewTemplate(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Preview: {previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          {previewTemplate && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full border font-medium",
                    CHANNEL_COLORS[previewTemplate.channel]
                  )}
                >
                  {CHANNEL_LABELS[previewTemplate.channel]}
                </span>
                <span className="text-xs text-muted-foreground">
                  Trigger: {TRIGGER_LABELS[previewTemplate.eventTrigger]}
                </span>
              </div>
              <div className="rounded-lg bg-muted/40 border p-4">
                <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
                  {previewTemplate.body}
                </pre>
              </div>
              {previewTemplate.variables && previewTemplate.variables.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Variables used:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {previewTemplate.variables.map((v) => (
                      <span
                        key={v}
                        className="text-xs px-2 py-0.5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground"
                      >
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
            <Button
              variant="outline"
              onClick={() => {
                setEditing(previewTemplate!);
                setFormOpen(true);
                setPreviewTemplate(null);
              }}
            >
              <Pencil className="h-4 w-4 mr-2" />Edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Message */}
      <TestMessageDialog open={testDialogOpen} onOpenChange={setTestDialogOpen} />
    </div>
  );
}
