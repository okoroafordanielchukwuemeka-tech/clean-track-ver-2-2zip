import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useAuth } from "./auth-context";

export interface Branch {
  id: number;
  laundryId: number;
  name: string;
  address?: string | null;
  createdAt: string;
}

interface BranchContextType {
  branches: Branch[];
  activeBranch: Branch | null;
  activeBranchId: number | null;
  setBranches: (branches: Branch[]) => void;
  setActiveBranch: (branch: Branch | null) => void;
}

const BranchContext = createContext<BranchContextType>({
  branches: [],
  activeBranch: null,
  activeBranchId: null,
  setBranches: () => {},
  setActiveBranch: () => {},
});

const ACTIVE_BRANCH_KEY = "ct_active_branch";

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { isOwner, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranch, setActiveBranchState] = useState<Branch | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem(ACTIVE_BRANCH_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  const setActiveBranch = useCallback((branch: Branch | null) => {
    setActiveBranchState(branch);
    if (branch) {
      localStorage.setItem(ACTIVE_BRANCH_KEY, JSON.stringify(branch));
    } else {
      localStorage.removeItem(ACTIVE_BRANCH_KEY);
    }
  }, []);

  // Clear active branch when user logs out or changes
  useEffect(() => {
    if (!isOwner) {
      setActiveBranchState(null);
    }
  }, [isOwner, user?.id]);

  const activeBranchId = activeBranch?.id ?? null;

  return (
    <BranchContext.Provider value={{
      branches,
      activeBranch,
      activeBranchId,
      setBranches,
      setActiveBranch,
    }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  return useContext(BranchContext);
}
