import { computeDueAt, getUrgency, type UrgencyLevel, type SlaSettings } from "@/lib/urgency";
import { cn } from "@/lib/utils";

const LEVEL_LABELS: Record<UrgencyLevel, string> = {
  safe: "On Track",
  attention: "Due Soon",
  urgent: "Urgent",
  overdue: "Overdue",
};

interface UrgencyBadgeProps {
  createdAt: string;
  serviceType: string;
  processingDueAt?: string | null;
  status: string;
  slaSettings?: SlaSettings | null;
  showLabel?: boolean;
  className?: string;
}

export function UrgencyBadge({
  createdAt,
  serviceType,
  processingDueAt,
  status,
  slaSettings,
  showLabel = true,
  className,
}: UrgencyBadgeProps) {
  if (["completed", "partial_pickup"].includes(status)) return null;

  const dueAt = computeDueAt(createdAt, serviceType, slaSettings, processingDueAt);
  const urgency = getUrgency(dueAt);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide",
        urgency.badgeClass,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full bg-current opacity-80")} />
      {showLabel ? LEVEL_LABELS[urgency.level] : urgency.shortLabel}
    </span>
  );
}

export function UrgencyDot({
  createdAt,
  serviceType,
  processingDueAt,
  status,
  slaSettings,
}: Omit<UrgencyBadgeProps, "showLabel" | "className">) {
  if (["completed", "partial_pickup"].includes(status)) return null;
  const dueAt = computeDueAt(createdAt, serviceType, slaSettings, processingDueAt);
  const urgency = getUrgency(dueAt);
  return <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", urgency.dotClass)} />;
}
