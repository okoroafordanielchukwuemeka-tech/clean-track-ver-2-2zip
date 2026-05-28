import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface AuthUser {
  type: "owner" | "worker";
  id: number;
  name: string;
  email?: string;
  phone?: string | null;
  role?: "admin" | "worker";
  laundryId?: number;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  laundryId: number | null;
  isAuthenticated: boolean;
  isOwner: boolean;
  isWorker: boolean;
  isAdmin: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  laundryId: null,
  isAuthenticated: false,
  isOwner: false,
  isWorker: false,
  isAdmin: false,
  login: () => {},
  logout: () => {},
});

const TOKEN_KEY = "ct_token";
const USER_KEY = "ct_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const saved = localStorage.getItem(USER_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  const isAuthenticated = !!token && !!user;
  const isOwner = user?.type === "owner";
  const isWorker = user?.type === "worker";
  const isAdmin = isOwner || (isWorker && user?.role === "admin");
  const laundryId = user?.type === "owner" ? user.id : (user?.laundryId ?? null);

  return (
    <AuthContext.Provider value={{
      user, token, laundryId,
      isAuthenticated, isOwner, isWorker, isAdmin,
      login, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
