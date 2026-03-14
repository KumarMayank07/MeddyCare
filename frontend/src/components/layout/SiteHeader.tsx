import { Link, NavLink, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { LogOut, User, Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

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
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2 px-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-[hsl(var(--primary-variant))] shadow-[var(--shadow-glow)]" />
          <span className="font-semibold">MeddyCare</span>
        </Link>

        {user && (
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {navLinks.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    "transition-colors hover:text-foreground/80",
                    isActive ? "text-foreground font-medium" : "text-foreground/60"
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={toggle}
            className="rounded-full w-9 h-9 p-0 border-border"
            aria-label="Toggle theme"
          >
            {isDark ? <Sun className="h-4 w-4 text-yellow-400" /> : <Moon className="h-4 w-4 text-slate-600" />}
          </Button>
          {user ? (
            <>
              <div className="hidden md:flex items-center gap-1 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span className="font-medium text-foreground">
                  {user.firstName} {user.lastName}
                </span>
                <span className="ml-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full capitalize">
                  {user.role}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1">
                <LogOut className="h-4 w-4" />
                <span className="hidden md:inline">Sign out</span>
              </Button>
            </>
          ) : (
            <Button asChild>
              <Link to="/auth">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
