import React, { createContext, useContext, useState, useCallback } from "react";

export interface AdminUser {
  id: number;
  name: string;
  email: string;
}

interface AdminContextType {
  admin: AdminUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, admin: AdminUser) => void;
  logout: () => void;
}

const AdminContext = createContext<AdminContextType>({
  admin: null,
  token: null,
  isAuthenticated: false,
  login: () => {},
  logout: () => {},
});

const ADMIN_TOKEN_KEY = "ct_admin_token";
const ADMIN_USER_KEY = "ct_admin_user";

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(ADMIN_TOKEN_KEY));
  const [admin, setAdmin] = useState<AdminUser | null>(() => {
    const saved = localStorage.getItem(ADMIN_USER_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  const login = useCallback((newToken: string, newAdmin: AdminUser) => {
    setToken(newToken);
    setAdmin(newAdmin);
    localStorage.setItem(ADMIN_TOKEN_KEY, newToken);
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(newAdmin));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setAdmin(null);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
  }, []);

  return (
    <AdminContext.Provider value={{
      admin, token,
      isAuthenticated: !!token && !!admin,
      login, logout,
    }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
