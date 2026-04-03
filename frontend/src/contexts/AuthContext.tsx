import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import apiService from "@/lib/api";
import { useSocket } from "@/hooks/use-socket";
import type { User } from "@/types";

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, role?: string) => Promise<void>;
  register: (userData: Parameters<typeof apiService.register>[0]) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (userData: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser]     = useState<User | null>(null);
  const [token, setToken]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Stable ref so event listeners always call the latest logout without re-subscribing
  const logoutRef = useRef<() => Promise<void>>(async () => {});

  const { socket } = useSocket();

  // Force-logout on auth-expired event (fired by api.ts on 401/403)
  useEffect(() => {
    const handle = () => logoutRef.current();
    window.addEventListener("auth-expired", handle);
    return () => window.removeEventListener("auth-expired", handle);
  }, []);

  // Real-time: kick suspended users instantly via socket
  useEffect(() => {
    if (!socket) return;
    const onSuspended = () => logoutRef.current();
    socket.on("account_suspended", onSuspended);
    return () => { socket.off("account_suspended", onSuspended); };
  }, [socket]);

  // Polling fallback: re-verify session every 60 s even without a socket
  useEffect(() => {
    const id = setInterval(async () => {
      if (!localStorage.getItem("token")) return;
      try {
        await apiService.getCurrentUser();
      } catch {
        logoutRef.current();
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Bootstrap from localStorage on mount
  useEffect(() => {
    const init = async () => {
      try {
        const savedToken = localStorage.getItem("token");
        const savedUser  = localStorage.getItem("user");
        if (savedToken && savedUser) {
          apiService.setToken(savedToken);
          setToken(savedToken);
          setUser(JSON.parse(savedUser) as User);
          // Verify token is still valid and refresh user data
          try {
            const { user: currentUser } = await apiService.getCurrentUser();
            setUser(currentUser);
          } catch {
            await logout();
          }
        }
      } catch {
        await logout();
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (email: string, password: string, role?: string) => {
    const response = await apiService.login(email, password, role);
    setUser(response.user);
    setToken(response.token);
  };

  const register = async (userData: Parameters<typeof apiService.register>[0]) => {
    const response = await apiService.register(userData);
    setUser(response.user);
    setToken(response.token);
  };

  const logout = async () => {
    try {
      await apiService.logout();
    } finally {
      setUser(null);
      setToken(null);
    }
  };
  logoutRef.current = logout;

  const updateUser = (userData: User) => {
    setUser(userData);
    localStorage.setItem("user", JSON.stringify(userData));
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};
