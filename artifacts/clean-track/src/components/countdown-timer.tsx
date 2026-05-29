import { useState, useEffect } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { computeDueAt, getUrgency, shouldShowTimer, type SlaSettings } from "@/lib/urgency";
import { cn } from "@/lib/utils";

interface CountdownTimerProps {
  createdAt: string;
  serviceType: string;
  processingDueAt?: string | null;
  status: string;
  slaSettings?: SlaSettings | null;
  compact?: boolean;
  className?: string;
}

export function CountdownTimer({
  createdAt,
  serviceType,
  processingDueAt,
  status,
  slaSettings,
  compact = false,
  className,
}: CountdownTimerProps) {
  const [, setTick] = useState(0);

  if (!shouldShowTimer(status)) return null;

  const dueAt = computeDueAt(createdAt, serviceType, slaSettings, processingDueAt);
  const urgency = getUrgency(dueAt);

  const intervalMs = urgency.level === "overdue" || urgency.level === "urgent" ? 10_000 : 60_000;

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const Icon = urgency.level === "overdue" || urgency.level === "urgent" ? AlertTriangle : Clock;

  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium", urgency.colorClass, className)}>
        <Icon className="h-3 w-3" />
        {urgency.shortLabel}
      </span>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full", urgency.bgClass, urgency.colorClass, className)}>
      <Icon className="h-3.5 w-3.5" />
      <span>{urgency.label}</span>
    </div>
  );
}
