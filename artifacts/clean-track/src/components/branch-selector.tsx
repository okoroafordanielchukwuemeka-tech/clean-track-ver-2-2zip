import { useEffect } from "react";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { api } from "@/lib/api";
import { useBranch } from "@/context/branch-context";
import { useAuth } from "@/context/auth-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitBranch, WifiOff } from "lucide-react";

export function BranchSelector() {
  const { isOwner } = useAuth();
  const { activeBranch, setActiveBranch, setBranches } = useBranch();

  const { data: branchList = [], isViewingCache } = useCachedQuery({
    queryKey: ["branches"],
    queryFn: () => api.branches.list(),
    enabled: isOwner,
    staleTime: 60_000,
  });

  useEffect(() => {
    setBranches(branchList);
  }, [branchList, setBranches]);

  if (!isOwner || branchList.length === 0) return null;

  const value = activeBranch?.id?.toString() ?? "all";

  const handleChange = (val: string) => {
    if (val === "all") {
      setActiveBranch(null);
    } else {
      const branch = branchList.find(b => b.id.toString() === val) ?? null;
      setActiveBranch(branch);
    }
  };

  return (
    <div className="px-3 mb-2">
      <div className="flex items-center gap-1.5 mb-1 px-1">
        <GitBranch className="h-3 w-3 text-sidebar-foreground/50" />
        <span className="text-xs text-sidebar-foreground/50 uppercase tracking-wider font-medium">Branch</span>
        {isViewingCache && (
          <span
            className="ml-auto shrink-0"
            title="Showing branches from cache — you appear to be offline"
          >
            <WifiOff className="h-3 w-3 text-amber-400" />
          </span>
        )}
      </div>
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger className="h-8 text-xs bg-sidebar-accent border-sidebar-border text-sidebar-foreground w-full">
          <SelectValue placeholder="All branches" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            <span className="text-xs">All Branches</span>
          </SelectItem>
          {branchList.map(b => (
            <SelectItem key={b.id} value={b.id.toString()}>
              <span className="text-xs">{b.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
