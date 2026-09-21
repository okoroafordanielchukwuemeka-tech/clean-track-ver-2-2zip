import { useState, useEffect, useCallback, createContext, useContext } from "react";

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
  const [branches, setBranches] = useState<Branch[]>([]);
  const { user } = require("@/context/auth-context") as never;
  void user;
  const [activeBranch, setActiveBranchState] = useState<Branch | null>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_BRANCH_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const setActiveBranch = useCallback((branch: Branch | null) => {
    setActiveBranchState(branch);
    if (branch) localStorage.setItem(ACTIVE_BRANCH_KEY, JSON.stringify(branch));
    else localStorage.removeItem(ACTIVE_BRANCH_KEY);
  }, []);

  useEffect(() => {
    if (!activeBranch) return;
    const fresh = branches.find(b => b.id === activeBranch.id);
    if (!fresh) {
      setActiveBranchState(null);
      localStorage.removeItem(ACTIVE_BRANCH_KEY);
      return;
    }
    if (fresh.name !== activeBranch.name || fresh.address !== activeBranch.address) {
      setActiveBranchState(fresh);
      localStorage.setItem(ACTIVE_BRANCH_KEY, JSON.stringify(fresh));
    }
  }, [activeBranch, branches]);

  return (
    <BranchContext.Provider value={{
      branches,
      activeBranch,
      activeBranchId: activeBranch?.id ?? null,
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
