import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBranch } from "@/context/branch-context";
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
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock,
  XCircle,
  MailCheck,
  Eye,
  Zap,
  Send,
  AlertCircle,
  Loader2,
} from "lucide-react";
import type {
  NotifTemplate,
  NotifMessage,
  NotifStats,
  NotifTemplateInput,
} from "@/lib/api";

// ─── Trigger / channel labels ────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  order_received: "Order Received",
  order_ready: "Order Ready for Pickup",
  order_delivered: "Order Delivered",
  pickup_reminder: "Pickup Reminder",
  payment_reminder: "Payment Reminder",
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  push: "Push",
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "bg-green-500/15 text-green-400 border-green-500/30",
  sms: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  email: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  push: "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; cls: string }
> = {
  queued: { label: "Queued", icon: Clock, cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  sent: { label: "Sent", icon: Send, cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  delivered: { label: "Delivered", icon: MailCheck, cls: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
  read: { label: "Read", icon: Eye, cls: "bg-green-500/15 text-green-400 border-green-500/30" },
  failed: { label: "Failed", icon: XCircle, cls: "bg-red-500/15 text-red-400 border-red-500/30" },
};

const VARIABLES_HELP = [
  "{{customer_name}}",
  "{{order_number}}",
  "{{branch_name}}",
  "{{business_name}}",
  "{{balance}}",
  "{{amount_paid}}",
  "{{total_due}}",
  "{{service_type}}",
];

// ─── Template form ───────────────────────────────────────────────────────────

interface TemplateFormProps {
  initial?: NotifTemplate | null;
  onClose: () => void;
}

function TemplateForm({ initial, onClose }: TemplateFormProps) {
  const qc = useQueryClient();
  const isEdit = !!initial;

  const [form, setForm] = useState<NotifTemplateInput>({
    name: initial?.name ?? "",
    eventTrigger: initial?.eventTrigger ?? "order_ready",
    channel: initial?.channel ?? "whatsapp",
    body: initial?.body ?? "",
    isActive: initial?.isActive ?? true,
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

  const insertVar = (v: string) => {
    setForm((f) => ({ ...f, body: f.body + v }));
  };

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
          <Select
            value={form.eventTrigger}
            onValueChange={(v) => set("eventTrigger", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Channel</Label>
          <Select
            value={form.channel}
            onValueChange={(v) => set("channel", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
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
              onClick={() => insertVar(v)}
              className="text-xs px-2 py-0.5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Click a variable to insert it at the end of your message.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          checked={form.isActive}
          onCheckedChange={(v) => set("isActive", v)}
          id="is-active"
        />
        <Label htmlFor="is-active">Active (will be used when triggered)</Label>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CommunicationsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("templates");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NotifTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<NotifTemplate | null>(null);
  const [filterTrigger, setFilterTrigger] = useState("all");
  const [filterChannel, setFilterChannel] = useState("all");
  const [msgStatus, setMsgStatus] = useState("all");

  const { data: stats } = useQuery({
    queryKey: ["comm-stats"],
    queryFn: () => api.communication.stats(),
  });

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ["comm-templates", filterTrigger, filterChannel],
    queryFn: () =>
      api.communication.listTemplates({
        trigger: filterTrigger !== "all" ? filterTrigger : undefined,
        channel: filterChannel !== "all" ? filterChannel : undefined,
      }),
  });

  const { data: messagesData, isLoading: loadingMessages } = useQuery({
    queryKey: ["comm-messages", msgStatus],
    queryFn: () =>
      api.communication.listMessages({
        status: msgStatus !== "all" ? msgStatus : undefined,
        limit: 100,
      }),
    enabled: tab === "messages",
  });

  const seedDefaults = useMutation({
    mutationFn: () => api.communication.seedDefaults(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["comm-templates"] });
      qc.invalidateQueries({ queryKey: ["comm-stats"] });
      if (data.seeded > 0) {
        toast.success(`Seeded ${data.seeded} default templates`);
      } else {
        toast.info(data.message ?? "Defaults already loaded");
      }
    },
    onError: () => toast.error("Failed to seed templates"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.communication.updateTemplate(id, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comm-templates"] });
      toast.success("Template updated");
    },
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

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (t: NotifTemplate) => {
    setEditing(t);
    setFormOpen(true);
  };

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
            Notification templates and message history for customer communications.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => seedDefaults.mutate()}
            disabled={seedDefaults.isPending}
          >
            {seedDefaults.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            Load Defaults
          </Button>
          <Button size="sm" onClick={openCreate}>
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
              <p className="text-xs text-muted-foreground">Total Templates</p>
              <p className="text-2xl font-bold">{stats.templates.total}</p>
              <p className="text-xs text-muted-foreground">{stats.templates.active} active</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Messages Queued</p>
              <p className="text-2xl font-bold text-yellow-400">{stats.byStatus.queued ?? 0}</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Messages Sent</p>
              <p className="text-2xl font-bold text-blue-400">{stats.byStatus.sent ?? 0}</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Failed</p>
              <p className="text-2xl font-bold text-red-400">{stats.byStatus.failed ?? 0}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Provider notice */}
      <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
        <AlertCircle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-yellow-300">No provider connected</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Templates and message logs are ready. Messages will be queued but not sent until a WhatsApp,
            SMS, or email provider is connected. Contact your administrator to set up a provider.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="templates">
            Templates
            {stats && (
              <span className="ml-2 text-xs bg-muted rounded-full px-1.5">
                {stats.templates.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="messages">
            Message Log
            {stats && stats.total > 0 && (
              <span className="ml-2 text-xs bg-muted rounded-full px-1.5">
                {stats.total}
              </span>
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
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading templates…
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
              <MessageSquare className="h-10 w-10 opacity-30" />
              <div>
                <p className="font-medium">No templates yet</p>
                <p className="text-sm">Click "Load Defaults" to get 5 ready-made templates, or create your own.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((t) => (
                <Card
                  key={t.id}
                  className={`transition-opacity ${!t.isActive ? "opacity-60" : ""}`}
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
                          className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                            CHANNEL_COLORS[t.channel] ??
                            "bg-muted text-muted-foreground"
                          }`}
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
                          onCheckedChange={(v) =>
                            toggleActive.mutate({ id: t.id, isActive: v })
                          }
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
                          onClick={() => openEdit(t)}
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

        {/* ── Message log tab ── */}
        <TabsContent value="messages" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={msgStatus} onValueChange={setMsgStatus}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loadingMessages ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading messages…
            </div>
          ) : !messagesData || messagesData.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
              <Send className="h-10 w-10 opacity-30" />
              <div>
                <p className="font-medium">No messages yet</p>
                <p className="text-sm">
                  Messages will appear here once customers trigger notifications (e.g. new orders, ready for pickup).
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {messagesData.messages.map((m) => {
                const sc = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.queued;
                const StatusIcon = sc.icon;
                return (
                  <div
                    key={m.id}
                    className="flex items-start gap-3 rounded-lg border bg-card/50 p-3"
                  >
                    <div className="shrink-0 mt-0.5">
                      <StatusIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">
                          {m.recipientName ?? m.recipientPhone}
                        </span>
                        {m.recipientName && (
                          <span className="text-xs text-muted-foreground">
                            {m.recipientPhone}
                          </span>
                        )}
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                            CHANNEL_COLORS[m.channel] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {CHANNEL_LABELS[m.channel] ?? m.channel}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border font-medium ${sc.cls}`}
                        >
                          {sc.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 font-mono">
                        {m.renderedBody}
                      </p>
                      {m.errorMessage && (
                        <p className="text-xs text-red-400 mt-1">
                          Error: {m.errorMessage}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {new Date(m.queuedAt).toLocaleString()}
                        {m.sentAt && ` · Sent ${new Date(m.sentAt).toLocaleString()}`}
                      </p>
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
            <DialogTitle>
              {editing ? "Edit Template" : "New Notification Template"}
            </DialogTitle>
          </DialogHeader>
          <TemplateForm
            initial={editing}
            onClose={() => setFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
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
                  className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                    CHANNEL_COLORS[previewTemplate.channel]
                  }`}
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
                openEdit(previewTemplate!);
                setPreviewTemplate(null);
              }}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
