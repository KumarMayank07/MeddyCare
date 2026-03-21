import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import apiService from "@/lib/api";
import { useSocket } from "@/hooks/use-socket";

interface User {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "user" | "admin" | "doctor";
  profileImage?: string;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, role?: string) => Promise<any>;
  register: (userData: any) => Promise<any>;
  logout: () => Promise<void>;
  updateUser: (userData: any) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const logoutRef = useRef<() => Promise<void>>(async () => {});
  const { socket } = useSocket();

  // Listen for session expiry dispatched by the API service after a failed token refresh
  useEffect(() => {
    const handleExpired = () => { logoutRef.current(); };
    window.addEventListener("auth-expired", handleExpired);
    return () => window.removeEventListener("auth-expired", handleExpired);
  }, []);

  // Real-time: instantly kick suspended users via socket
  useEffect(() => {
    if (!socket) return;
    const onSuspended = () => { logoutRef.current(); };
    socket.on("account_suspended", onSuspended);
    return () => { socket.off("account_suspended", onSuspended); };
  }, [socket]);

  // Polling fallback: re-verify session every 60s so suspension takes effect even without socket
  useEffect(() => {
    const id = setInterval(async () => {
      if (!localStorage.getItem("token")) return;
      try {
        await apiService.getCurrentUser();
      } catch {
        // 401 (expired) or 403 (suspended) — both mean force-logout
        logoutRef.current();
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const savedToken = localStorage.getItem("token");
        const savedUser = localStorage.getItem("user");

        if (savedToken && savedUser) {
          apiService.setToken(savedToken);
          setToken(savedToken);
          setUser(JSON.parse(savedUser));

          // Verify token is still valid
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

    initializeAuth();
  }, []);

  const login = async (email: string, password: string, role?: string) => {
    try {
      const response = await apiService.login(email, password, role);
      setUser(response.user);
      setToken(response.token || localStorage.getItem("token"));
      return response;
    } catch (error) {
      throw error;
    }
  };

  const register = async (userData: any) => {
    try {
      const response = await apiService.register(userData);
      setUser(response.user);
      setToken(response.token || localStorage.getItem("token"));
      return response;
    } catch (error) {
      throw error;
    }
  };

  const logout = async () => {
    try {
      await apiService.logout();
    } catch {
      // logout is best-effort
    } finally {
      setUser(null);
      setToken(null);
    }
  };
  logoutRef.current = logout;

  const updateUser = (userData: any) => {
    setUser(userData);
    localStorage.setItem("user", JSON.stringify(userData));
  };

  const value: AuthContextType = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};