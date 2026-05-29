import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type SlaSettings } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Zap, Clock, Crown, Save } from "lucide-react";
import { toast } from "sonner";

const SERVICE_CONFIG = [
  {
    key: "expressTurnaroundHours" as keyof SlaSettings,
    label: "Express",
    description: "Fast-track service turnaround",
    icon: Zap,
    color: "text-amber-500",
    bgColor: "bg-amber-50 dark:bg-amber-950/20",
    hint: "Recommended: 12–24h",
  },
  {
    key: "standardTurnaroundHours" as keyof SlaSettings,
    label: "Standard",
    description: "Regular service turnaround",
    icon: Clock,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-950/20",
    hint: "Recommended: 48–72h",
  },
  {
    key: "premiumTurnaroundHours" as keyof SlaSettings,
    label: "Premium",
    description: "Special care / premium items",
    icon: Crown,
    color: "text-purple-500",
    bgColor: "bg-purple-50 dark:bg-purple-950/20",
    hint: "Recommended: 48–96h",
  },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const { data: sla, isLoading } = useQuery({
    queryKey: ["settings", "sla"],
    queryFn: () => api.settings.getSla(),
  });

  const [form, setForm] = useState<SlaSettings | null>(null);
  const current = form ?? sla;

  const mutation = useMutation({
    mutationFn: (data: Partial<SlaSettings>) => api.settings.updateSla(data),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "sla"], updated);
      setForm(null);
      toast.success("SLA settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleChange = (key: keyof SlaSettings, raw: string) => {
    const value = parseInt(raw);
    if (isNaN(value)) return;
    setForm(prev => ({ ...(prev ?? sla ?? { standardTurnaroundHours: 72, expressTurnaroundHours: 24, premiumTurnaroundHours: 48 }), [key]: value }));
  };

  const handleSave = () => {
    if (!form) return;
    mutation.mutate(form);
  };

  const isDirty = !!form;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6 text-primary" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Configure operational defaults for your laundry</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            SLA Turnaround Times
          </CardTitle>
          <CardDescription>
            These determine the operational deadline for each service type. Timers and urgency alerts are calculated from these values.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {SERVICE_CONFIG.map(({ key, label, description, icon: Icon, color, bgColor, hint }) => (
                <div key={key} className={`flex items-center gap-4 p-4 rounded-xl border ${bgColor}`}>
                  <div className={`h-10 w-10 rounded-xl bg-background flex items-center justify-center shrink-0`}>
                    <Icon className={`h-5 w-5 ${color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Label className="text-sm font-semibold">{label}</Label>
                    <p className="text-xs text-muted-foreground">{description}</p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">{hint}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input
                      type="number"
                      min="1"
                      max="336"
                      value={current?.[key] ?? ""}
                      onChange={e => handleChange(key, e.target.value)}
                      className="w-20 text-center font-mono text-base"
                    />
                    <span className="text-sm text-muted-foreground">hours</span>
                  </div>
                </div>
              ))}

              <div className="pt-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Urgency alerts: Urgent ≤5h · Attention ≤12h · Due Soon ≤24h
                </p>
                <Button
                  onClick={handleSave}
                  disabled={!isDirty || mutation.isPending}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  {mutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Urgency Color Reference</CardTitle>
          <CardDescription>Visual hierarchy used across orders, worker station, and notifications</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Safe", sub: ">24h remaining", dot: "bg-green-500", bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-400" },
              { label: "Attention", sub: "≤12h remaining", dot: "bg-amber-500", bg: "bg-amber-50 dark:bg-amber-950/20", text: "text-amber-700 dark:text-amber-400" },
              { label: "Urgent", sub: "≤5h remaining", dot: "bg-red-500", bg: "bg-red-50 dark:bg-red-950/20", text: "text-red-700 dark:text-red-400" },
              { label: "Overdue", sub: "Past deadline", dot: "bg-red-700", bg: "bg-red-950/10 dark:bg-red-950/30", text: "text-red-800 dark:text-red-500 font-bold" },
            ].map(({ label, sub, dot, bg, text }) => (
              <div key={label} className={`p-3 rounded-lg border ${bg} flex items-start gap-2`}>
                <span className={`h-2.5 w-2.5 rounded-full ${dot} mt-0.5 shrink-0`} />
                <div>
                  <p className={`text-sm font-semibold ${text}`}>{label}</p>
                  <p className="text-xs text-muted-foreground">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
