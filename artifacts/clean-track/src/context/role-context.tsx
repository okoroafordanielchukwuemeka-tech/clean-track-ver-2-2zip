import React, { createContext, useContext, useState, useEffect } from "react";
import type { Worker } from "@/lib/api";

interface RoleContextType {
  currentWorker: Worker | null;
  role: "admin" | "worker" | null;
  login: (worker: Worker, role: "admin" | "worker") => void;
  logout: () => void;
  isAdmin: boolean;
}

const RoleContext = createContext<RoleContextType>({
  currentWorker: null,
  role: null,
  login: () => {},
  logout: () => {},
  isAdmin: false,
});

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [currentWorker, setCurrentWorker] = useState<Worker | null>(() => {
    const saved = localStorage.getItem("clean-track-worker");
    return saved ? JSON.parse(saved) : null;
  });
  const [role, setRole] = useState<"admin" | "worker" | null>(() => {
    return localStorage.getItem("clean-track-role") as "admin" | "worker" | null;
  });

  const login = (worker: Worker, role: "admin" | "worker") => {
    setCurrentWorker(worker);
    setRole(role);
    localStorage.setItem("clean-track-worker", JSON.stringify(worker));
    localStorage.setItem("clean-track-role", role);
  };

  const logout = () => {
    setCurrentWorker(null);
    setRole(null);
    localStorage.removeItem("clean-track-worker");
    localStorage.removeItem("clean-track-role");
  };

  return (
    <RoleContext.Provider value={{ currentWorker, role, login, logout, isAdmin: role === "admin" }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
