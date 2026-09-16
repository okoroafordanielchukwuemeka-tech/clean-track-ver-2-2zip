export type BranchType = "PROCESSING" | "PICKUP" | "HYBRID";

export function canCollect(type: BranchType): boolean {
  return type === "PICKUP" || type === "HYBRID";
}

export function canProcess(type: BranchType): boolean {
  return type === "PROCESSING" || type === "HYBRID";
}

export function canReturn(type: BranchType): boolean {
  return type === "PICKUP" || type === "HYBRID";
}

export function branchTypeLabel(type: BranchType): string {
  switch (type) {
    case "PROCESSING": return "Processing";
    case "PICKUP": return "Pickup";
    case "HYBRID": return "Hybrid";
  }
}
