export type UrgencyLevel = "safe" | "attention" | "urgent" | "overdue";

export interface SlaSettings {
  standardTurnaroundHours: number;
  expressTurnaroundHours: number;
  premiumTurnaroundHours: number;
}

export interface UrgencyInfo {
  level: UrgencyLevel;
  hoursRemaining: number;
  dueAt: Date;
  label: string;
  shortLabel: string;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  badgeClass: string;
  dotClass: string;
  rowClass: string;
}

export const DEFAULT_SLA: SlaSettings = {
  standardTurnaroundHours: 72,
  expressTurnaroundHours: 24,
  premiumTurnaroundHours: 48,
};

export function getTurnaroundHours(serviceType: string, sla?: SlaSettings | null): number {
  const settings = sla ?? DEFAULT_SLA;
  if (serviceType === "express") return settings.expressTurnaroundHours;
  if (serviceType === "premium") return settings.premiumTurnaroundHours;
  return settings.standardTurnaroundHours;
}

export function computeDueAt(
  createdAt: string | Date,
  serviceType: string,
  sla?: SlaSettings | null,
  storedDueAt?: string | Date | null
): Date {
  if (storedDueAt) return new Date(storedDueAt);
  const hours = getTurnaroundHours(serviceType, sla);
  return new Date(new Date(createdAt).getTime() + hours * 3600000);
}

export function getUrgency(dueAt: Date): UrgencyInfo {
  const msRemaining = dueAt.getTime() - Date.now();
  const hoursRemaining = msRemaining / 3600000;

  if (hoursRemaining <= 0) {
    const h = Math.abs(Math.floor(hoursRemaining));
    const m = Math.abs(Math.floor((hoursRemaining % 1) * 60));
    const label = h > 0 ? `Overdue by ${h}h` : `Overdue by ${m}m`;
    return {
      level: "overdue",
      hoursRemaining,
      dueAt,
      label,
      shortLabel: h > 0 ? `-${h}h` : `-${m}m`,
      colorClass: "text-red-700 dark:text-red-500",
      bgClass: "bg-red-950/10 dark:bg-red-950/30",
      borderClass: "border-red-300 dark:border-red-900",
      badgeClass: "bg-red-700 text-white",
      dotClass: "bg-red-600",
      rowClass: "bg-red-50/60 dark:bg-red-950/10",
    };
  }

  if (hoursRemaining <= 5) {
    const h = Math.floor(hoursRemaining);
    const m = Math.floor((hoursRemaining - h) * 60);
    const label = h > 0 ? `${h}h ${m}m left` : `${m}m left`;
    return {
      level: "urgent",
      hoursRemaining,
      dueAt,
      label,
      shortLabel: h > 0 ? `${h}h` : `${m}m`,
      colorClass: "text-red-500",
      bgClass: "bg-red-50 dark:bg-red-950/20",
      borderClass: "border-red-200 dark:border-red-900",
      badgeClass: "bg-red-500 text-white",
      dotClass: "bg-red-500",
      rowClass: "bg-red-50/40 dark:bg-red-950/10",
    };
  }

  if (hoursRemaining <= 12) {
    const h = Math.floor(hoursRemaining);
    return {
      level: "attention",
      hoursRemaining,
      dueAt,
      label: `${h}h left`,
      shortLabel: `${h}h`,
      colorClass: "text-amber-600 dark:text-amber-500",
      bgClass: "bg-amber-50 dark:bg-amber-950/20",
      borderClass: "border-amber-200 dark:border-amber-900",
      badgeClass: "bg-amber-500 text-white",
      dotClass: "bg-amber-500",
      rowClass: "bg-amber-50/30 dark:bg-amber-950/10",
    };
  }

  const h = Math.floor(hoursRemaining);
  return {
    level: "safe",
    hoursRemaining,
    dueAt,
    label: `${h}h left`,
    shortLabel: `${h}h`,
    colorClass: "text-green-600 dark:text-green-500",
    bgClass: "bg-green-50 dark:bg-green-950/10",
    borderClass: "border-green-200 dark:border-green-900",
    badgeClass: "bg-green-600 text-white",
    dotClass: "bg-green-500",
    rowClass: "",
  };
}

export function urgencySortValue(info: UrgencyInfo): number {
  return info.hoursRemaining;
}

export function isActiveOrder(status: string): boolean {
  return ["pending", "processing"].includes(status);
}

export function shouldShowTimer(status: string): boolean {
  return ["pending", "processing", "ready"].includes(status);
}
