/**
 * AutomationsTab — WhatsApp Rule-Based Automation Engine
 *
 * Owners and canManageWhatsApp workers can:
 * - Toggle each automation ON/OFF
 * - Edit the message template inline
 * - Preview the message with sample customer data
 *
 * Workers without canManageWhatsApp see a read-only view.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2, ShoppingCart, CreditCard, Package, CheckCircle2,
  Truck, Pencil, Eye, RotateCcw, Zap, Bot, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutomationRule } from "@/lib/api";

// ── Trigger config ─────────────────────────────────────────────────────────────

const TRIGGER_CONFIG: Record<string, {
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
  defaultOff?: boolean;
}> = {
  ORDER_CREATED: {
    label: "Order Received",
    description: "Sent immediately when a new order is placed.",
    icon: ShoppingCart,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  PAYMENT_RECEIVED: {
    label: "Payment Confirmation",
    description: "Sent when any payment is recorded for an order.",
    icon: CreditCard,
    color: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
  },
  ORDER_READY: {
    label: "Ready for Pickup",
    description: "Sent when order status changes to Ready.",
    icon: Package,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  ORDER_COMPLETED: {
    label: "Order Completed",
    description: "Sent when an order is marked as completed.",
    icon: CheckCircle2,
    color: "text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/20",
  },
  ORDER_DELIVERED: {
    label: "Delivery Confirmation",
    description: "Sent when an order is delivered to the customer.",
    icon: Truck,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    defaultOff: true,
  },
};

const CANONICAL_ORDER = [
  "ORDER_CREATED",
  "PAYMENT_RECEIVED",
  "ORDER_READY",
  "ORDER_COMPLETED",
  "ORDER_DELIVERED",
];

const PREVIEW_VARS: Record<string, string> = {
  customerName: "Daniel Adeyemi",
  orderId: "ORD-20240601-0001",
  businessName: "Fresh Wash Laundry",
};

function renderPreview(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => PREVIEW_VARS[key] ?? `{{${key}}}`);
}

// ── Single rule card ─────────────────────────────────────────────────────────

function RuleCard({
  rule,
  canEdit,
}: {
  rule: AutomationRule;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const cfg = TRIGGER_CONFIG[rule.triggerEvent] ?? {
    label: rule.triggerEvent,
    description: "",
    icon: Bot,
    color: "text-muted-foreground",
    bg: "bg-muted/20",
    border: "border-border",
  };
  const Icon = cfg.icon;

  const [showEdit, setShowEdit] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [draft, setDraft] = useState(rule.messageTemplate);

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      api.automationRules.update(rule.id, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-rules"] });
    },
    onError: () => toast.error("Failed to update automation"),
  });

  const save = useMutation({
    mutationFn: () =>
      api.automationRules.update(rule.id, { messageTemplate: draft.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-rules"] });
      setShowEdit(false);
      toast.success("Template saved");
    },
    onError: () => toast.error("Failed to save template"),
  });

  const resetDraft = () => setDraft(rule.messageTemplate);

  return (
    <div className={cn(
      "rounded-xl border bg-card/50 transition-all duration-200",
      rule.enabled ? "border-border" : "border-border/40 opacity-70"
    )}>
      {/* Card header */}
      <div className="flex items-center gap-3 p-4">
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", cfg.bg, `border ${cfg.border}`)}>
          <Icon className={cn("h-5 w-5", cfg.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm">{cfg.label}</p>
            {rule.enabled ? (
              <Badge className="text-[10px] px-1.5 py-0 bg-green-500/15 text-green-400 border-green-500/30">
                ON
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                OFF
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>
        </div>
        {canEdit && (
          <Switch
            checked={rule.enabled}
            onCheckedChange={(v) => toggle.mutate(v)}
            disabled={toggle.isPending}
            className="shrink-0"
          />
        )}
      </div>

      {/* Template preview */}
      <div className="px-4 pb-3">
        {!showEdit ? (
          <div className={cn(
            "rounded-lg p-3 border text-xs font-mono leading-relaxed",
            rule.enabled
              ? "bg-muted/20 border-border/50"
              : "bg-muted/10 border-border/20 text-muted-foreground"
          )}>
            {rule.messageTemplate}
          </div>
        ) : (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="font-mono text-xs resize-none bg-muted/10"
            placeholder="Hi {{customerName}}, ..."
          />
        )}

        {/* Variable hints */}
        {showEdit && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {["{{customerName}}", "{{orderId}}", "{{businessName}}"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setDraft((d) => d + v)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                {v}
              </button>
            ))}
          </div>
        )}

        {/* Preview section */}
        {showPreview && (
          <div className="mt-3 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
            <p className="text-[10px] text-green-400 font-semibold mb-1.5 flex items-center gap-1">
              <Eye className="h-3 w-3" /> Preview with sample data
            </p>
            <p className="text-xs leading-relaxed">
              {renderPreview(showEdit ? draft : rule.messageTemplate)}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3">
          {canEdit && !showEdit && (
            <Button
              variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
              onClick={() => { setDraft(rule.messageTemplate); setShowEdit(true); }}
            >
              <Pencil className="h-3 w-3 mr-1" />Edit template
            </Button>
          )}
          {showEdit && (
            <>
              <Button
                size="sm" className="h-7 text-xs"
                onClick={() => save.mutate()}
                disabled={save.isPending || !draft.trim() || draft.trim() === rule.messageTemplate}
              >
                {save.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Save
              </Button>
              <Button
                variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
                onClick={() => { resetDraft(); setShowEdit(false); }}
              >
                Cancel
              </Button>
              <Button
                variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
                onClick={resetDraft}
                title="Reset to saved template"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            </>
          )}
          <Button
            variant="ghost" size="sm"
            className={cn("h-7 text-xs ml-auto", showPreview ? "text-green-400" : "text-muted-foreground")}
            onClick={() => setShowPreview((v) => !v)}
          >
            <Eye className="h-3 w-3 mr-1" />
            {showPreview ? "Hide preview" : "Preview"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main tab ───────────────────────────────────────────────────────────────────

export function AutomationsTab() {
  const { isOwner, hasPermission } = useAuth();
  const canEdit = isOwner || hasPermission("canManageWhatsApp");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ rules: AutomationRule[] }>({
    queryKey: ["automation-rules"],
    queryFn: () => api.automationRules.list(),
    staleTime: 30_000,
  });

  const initialize = useMutation({
    mutationFn: () => api.automationRules.initialize(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-rules"] });
      toast.success("Automation rules initialized");
    },
    onError: () => toast.error("Failed to initialize rules"),
  });

  const rules = data?.rules ?? [];

  // Sort by canonical order
  const sortedRules = [...rules].sort(
    (a, b) =>
      CANONICAL_ORDER.indexOf(a.triggerEvent) -
      CANONICAL_ORDER.indexOf(b.triggerEvent)
  );

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {rules.length > 0 ? (
              <>
                <span className="text-foreground font-semibold">{enabledCount}</span> of{" "}
                <span className="text-foreground font-semibold">{rules.length}</span> automations active
              </>
            ) : (
              "No automation rules configured yet."
            )}
          </p>
        </div>
        {canEdit && rules.length === 0 && (
          <Button
            size="sm" onClick={() => initialize.mutate()} disabled={initialize.isPending}
            className="gap-1.5"
          >
            {initialize.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Zap className="h-4 w-4" />}
            Initialize Defaults
          </Button>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl border border-blue-500/20 bg-blue-500/5 text-sm">
        <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-medium text-blue-300">How automations work</p>
          <p className="text-xs text-blue-300/70 leading-relaxed">
            When an event occurs (e.g. order ready), CleanTrack checks if an enabled rule exists for
            that event and automatically sends the message via WhatsApp. A WhatsApp provider must be
            connected in Customer Hub → Overview for messages to be delivered.
          </p>
        </div>
      </div>

      {/* Rules */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading automations…
        </div>
      ) : sortedRules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
          <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center">
            <Bot className="h-8 w-8 opacity-25" />
          </div>
          <div className="text-center">
            <p className="font-medium">No automation rules</p>
            <p className="text-sm mt-1 text-muted-foreground/70">
              {canEdit
                ? 'Click "Initialize Defaults" to create the 5 standard automations.'
                : "Ask your owner to set up WhatsApp automations."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedRules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} canEdit={canEdit} />
          ))}
        </div>
      )}

      {/* Reset / reinitialize */}
      {canEdit && rules.length > 0 && (
        <div className="pt-2 border-t border-border/40">
          <Button
            variant="ghost" size="sm"
            className="text-muted-foreground text-xs"
            onClick={() => initialize.mutate()}
            disabled={initialize.isPending}
          >
            <Zap className="h-3 w-3 mr-1.5" />
            Re-initialize defaults (adds any missing rules)
          </Button>
        </div>
      )}
    </div>
  );
}
