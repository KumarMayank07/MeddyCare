import { useState, useRef, useEffect } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { LogOut, User, Sun, Moon, Bell, X, Calendar, Stethoscope, CheckCheck } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import ProfileModal from "@/components/ProfileModal";
import { useNotifications } from "@/contexts/NotificationContext";

const userNav = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/reports", label: "Reports" },
  { to: "/doctors", label: "Doctors" },
  { to: "/chat", label: "Chat" },
  { to: "/reminders", label: "Reminders" },
];

const adminNav = [
  { to: "/admin", label: "Dashboard" },
  { to: "/doctors", label: "Doctors" },
  { to: "/chat", label: "Chat" },
];

const doctorNav = [
  { to: "/doctor", label: "My Dashboard" },
  { to: "/reminders", label: "Reminders" },
  { to: "/chat", label: "Chat" },
];

export default function SiteHeader() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isDark, toggle } = useTheme();
  const [showProfile, setShowProfile] = useState(false);
  const { notifications, unreadCount, markAllRead, dismiss, clearAll } = useNotifications();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!notifOpen) return;
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notifOpen]);

  // AuthContext is the source of truth — reactive to profile saves via updateUser()
  const profileImage: string | null = user?.profileImage ?? null;

  const navLinks =
    user?.role === "admin"
      ? adminNav
      : user?.role === "doctor"
      ? doctorNav
      : userNav;

  const handleLogout = async () => {
    try {
      await logout();
      toast({ title: "Logged out", description: "See you soon!" });
      navigate("/");
    } catch {
      toast({ title: "Error", description: "Logout failed", variant: "destructive" });
    }
  };

  return (
    <>
    <ProfileModal isOpen={showProfile} onClose={() => setShowProfile(false)} />
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/85 shadow-sm">
      <div
        className="container h-16 items-center"
        style={{ display: "flex", justifyContent: "space-between" }}
      >
        <Link to="/" className="flex items-center gap-3 px-1 group">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-[hsl(var(--primary-variant))] shadow-[var(--shadow-glow)] group-hover:scale-105 transition-transform duration-200 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              {/* Medical cross */}
              <rect x="9" y="3" width="6" height="18" rx="1.5" fill="white" />
              <rect x="3" y="9" width="18" height="6" rx="1.5" fill="white" />
              {/* Heart accent */}
              <path d="M12 19.5l-0.5-0.5C8 16 6 14 6 11.5 6 9.5 7.5 8 9.5 8c1.1 0 2.1.5 2.5 1.3C12.4 8.5 13.4 8 14.5 8 16.5 8 18 9.5 18 11.5c0 2.5-2 4.5-5.5 7.5l-.5.5z" fill="white" opacity="0.3" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">MeddyCare</span>
        </Link>

        {user && (
          <nav className={cn(
            "hidden md:flex items-center justify-center gap-10"
          )}>
            {navLinks.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    "relative text-base font-medium transition-all duration-200 hover:text-foreground pb-0.5",
                    isActive
                      ? "text-foreground after:absolute after:bottom-[-28px] after:left-0 after:right-0 after:h-0.5 after:bg-primary after:rounded-full"
                      : "text-foreground/55 hover:text-foreground/90"
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={toggle}
            className="rounded-full w-9 h-9 p-0 flex items-center justify-center border border-border/70 bg-muted/50 hover:bg-muted transition-colors"
            aria-label="Toggle theme"
          >
            {isDark ? <Sun className="h-4 w-4 text-yellow-400" /> : <Moon className="h-4 w-4 text-slate-500" />}
          </button>

          {/* ── Notification bell ── */}
          {user && (
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => { setNotifOpen(o => !o); if (!notifOpen) markAllRead(); }}
                className="relative rounded-full w-9 h-9 flex items-center justify-center border border-border/70 bg-muted/50 hover:bg-muted transition-colors"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4 text-foreground/70" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold shadow">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-11 w-80 max-h-[420px] flex flex-col bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
                    <span className="font-semibold text-sm text-foreground">Notifications</span>
                    <div className="flex gap-2">
                      {notifications.length > 0 && (
                        <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                          <CheckCheck className="h-3 w-3" /> Clear all
                        </button>
                      )}
                    </div>
                  </div>

                  {/* List */}
                  <div className="overflow-y-auto flex-1">
                    {notifications.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                        <Bell className="h-8 w-8 text-muted-foreground opacity-30" />
                        <p className="text-sm text-muted-foreground">No notifications yet</p>
                      </div>
                    ) : (
                      notifications.map(n => (
                        <div key={n.id} className="flex items-start gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors group">
                          <div className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${n.type === "appointment" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-violet-100 dark:bg-violet-900/30"}`}>
                            {n.type === "appointment"
                              ? <Calendar className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                              : <Stethoscope className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground leading-snug">{n.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-1">
                              {n.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          <button
                            onClick={() => dismiss(n.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-muted shrink-0"
                            aria-label="Dismiss"
                          >
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {user ? (
            <>
              <button
                onClick={() => setShowProfile(true)}
                className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/60 border border-border/50 hover:bg-muted transition-colors cursor-pointer"
              >
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
                  {profileImage
                    ? <img src={profileImage} alt="avatar" className="w-full h-full object-cover" />
                    : <User className="h-3.5 w-3.5 text-primary" />
                  }
                </div>
                <span className="text-sm font-semibold text-foreground">
                  {user.firstName} {user.lastName}
                </span>
                <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full capitalize font-medium border border-primary/20">
                  {user.role}
                </span>
              </button>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/70">
                <LogOut className="h-4 w-4" />
                <span className="hidden md:inline font-medium">Sign out</span>
              </Button>
            </>
          ) : (
            <Button asChild className="rounded-full px-5">
              <Link to="/auth">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
    </>
  );
}
