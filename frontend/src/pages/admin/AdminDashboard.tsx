import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, LineChart, Line, PieChart, Pie, Legend,
} from "recharts";
import {
  Users, FileText, Stethoscope, CheckCircle, XCircle, Loader2,
  ShieldCheck, Clock, ClipboardList, TrendingUp, Search,
  AlertTriangle, Eye, ChevronLeft, ChevronRight,
  CalendarCheck, UserX, UserCheck, Activity, Star, Heart, UserPlus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/use-socket";
import apiService from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "overview" | "doctors" | "users" | "analytics" | "audit";

const STAGE_COLORS = ["#10b981", "#3b82f6", "#eab308", "#f97316", "#ef4444"];

const ACTION_LABELS: Record<string, string> = {
  DOCTOR_VERIFIED:   "Doctor Verified",
  DOCTOR_UNVERIFIED: "Doctor Unverified",
  USER_SUSPENDED:    "User Suspended",
  USER_UNSUSPENDED:  "User Unsuspended",
  ADMIN_CREATED:     "Admin Created",
};

const ACTION_COLORS: Record<string, string> = {
  DOCTOR_VERIFIED:   "bg-green-100 text-green-800 border-green-200",
  DOCTOR_UNVERIFIED: "bg-red-100 text-red-800 border-red-200",
  USER_SUSPENDED:    "bg-red-100 text-red-800 border-red-200",
  USER_UNSUSPENDED:  "bg-blue-100 text-blue-800 border-blue-200",
  ADMIN_CREATED:     "bg-purple-100 text-purple-800 border-purple-200",
};

// ─── Pagination bar ───────────────────────────────────────────────────────────

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-end mt-4">
      <Button size="icon" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
      <Button size="icon" variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

type PendingAction =
  | { type: "verify"; doctorId: string; isVerified: boolean }
  | { type: "suspend"; userId: string; isSuspended: boolean }
  | null;

export default function AdminDashboard() {
  const { toast } = useToast();
  const { socket } = useSocket();
  const [tab, setTab] = useState<Tab>("overview");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const tabRef = useRef(tab);

  // ── Overview ──────────────────────────────────────────────────────────────
  const [stats, setStats]         = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await apiService.getAdminStats();
      setStats(data);
    } catch (err: unknown) {
      toast({ title: "Failed to load stats", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setStatsLoading(false); }
  }, []);

  useEffect(() => { loadStats(); }, []);

  // Keep tabRef in sync so the socket handler can read current tab without stale closure
  useEffect(() => { tabRef.current = tab; }, [tab]);

  // Re-fetch stats when switching back to overview
  useEffect(() => { if (tab === "overview") loadStats(); }, [tab]);

  // 30-second polling fallback
  useEffect(() => {
    const id = setInterval(loadStats, 30_000);
    return () => clearInterval(id);
  }, [loadStats]);

  // Real-time: backend emits admin_stats_updated when new user/doctor registers
  useEffect(() => {
    if (!socket) return;
    const onUpdate = () => {
      loadStats();
      if (tabRef.current === "doctors") loadDoctors();
      if (tabRef.current === "users") loadUsers();
    };
    socket.on("admin_stats_updated", onUpdate);
    return () => { socket.off("admin_stats_updated", onUpdate); };
  }, [socket]);

  // ── Doctors ───────────────────────────────────────────────────────────────
  const [doctors, setDoctors]         = useState<any[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [doctorSearch, setDoctorSearch]     = useState("");
  const [verifyingId, setVerifyingId]       = useState<string | null>(null);

  const loadDoctors = useCallback(async (search?: string) => {
    setDoctorsLoading(true);
    try {
      const { doctors: data } = await apiService.getAdminDoctors(search);
      setDoctors(data);
    } catch (err: unknown) {
      toast({ title: "Failed to load doctors", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setDoctorsLoading(false); }
  }, []);

  useEffect(() => { if (tab === "doctors") loadDoctors(); }, [tab]);

  const handleVerify = (doctorId: string, isVerified: boolean) => {
    setPendingAction({ type: "verify", doctorId, isVerified });
  };

  const confirmVerify = async (doctorId: string, isVerified: boolean) => {
    setVerifyingId(doctorId);
    try {
      await apiService.verifyDoctor(doctorId, isVerified);
      toast({ title: `Doctor ${isVerified ? "verified" : "unverified"}` });
      setDoctors(prev => prev.map(d => d._id === doctorId ? { ...d, isVerified } : d));
    } catch (err: unknown) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setVerifyingId(null); }
  };

  // ── Users ─────────────────────────────────────────────────────────────────
  const [users, setUsers]               = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch]     = useState("");
  const [userRole, setUserRole]         = useState("all");
  const [userPage, setUserPage]         = useState(1);
  const [userPages, setUserPages]       = useState(1);
  const [suspendingId, setSuspendingId] = useState<string | null>(null);

  const loadUsers = useCallback(async (page = 1, search = "", role = "all") => {
    setUsersLoading(true);
    try {
      const data = await apiService.getAdminUsers({
        page,
        limit: 20,
        role: role === "all" ? undefined : role,
        search: search || undefined,
      });
      setUsers(data.users);
      setUserPages(data.pages || 1);
    } catch (err: unknown) {
      toast({ title: "Failed to load users", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setUsersLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === "users") loadUsers(userPage, userSearch, userRole);
  }, [tab, userPage]);

  const handleSuspend = (userId: string, isSuspended: boolean) => {
    setPendingAction({ type: "suspend", userId, isSuspended });
  };

  const confirmSuspend = async (userId: string, isSuspended: boolean) => {
    setSuspendingId(userId);
    try {
      await apiService.suspendUser(userId, isSuspended);
      toast({ title: `User ${isSuspended ? "suspended" : "unsuspended"}` });
      setUsers(prev => prev.map(u => u._id === userId ? { ...u, isSuspended } : u));
    } catch (err: unknown) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSuspendingId(null); }
  };

  // ── Analytics ─────────────────────────────────────────────────────────────
  const [analytics, setAnalytics]             = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const data = await apiService.getAdminAnalytics();
      setAnalytics(data);
    } catch (err: unknown) {
      toast({ title: "Failed to load analytics", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setAnalyticsLoading(false); }
  }, []);

  useEffect(() => { if (tab === "analytics") loadAnalytics(); }, [tab]);

  // ── Audit log ─────────────────────────────────────────────────────────────
  const [logs, setLogs]                 = useState<any[]>([]);
  const [logsLoading, setLogsLoading]   = useState(false);
  const [logAction, setLogAction]       = useState("all");
  const [logPage, setLogPage]           = useState(1);
  const [logPages, setLogPages]         = useState(1);

  // ── Create Admin ──────────────────────────────────────────────────────────
  const [createAdminOpen, setCreateAdminOpen] = useState(false);
  const [createAdminForm, setCreateAdminForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [createAdminLoading, setCreateAdminLoading] = useState(false);

  const handleCreateAdmin = async () => {
    const { firstName, lastName, email, password } = createAdminForm;
    if (!firstName || !lastName || !email || !password) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    setCreateAdminLoading(true);
    try {
      await apiService.createAdmin({ firstName, lastName, email, password });
      toast({ title: "Admin account created", description: `${email} can now log in as admin.` });
      setCreateAdminOpen(false);
      setCreateAdminForm({ firstName: "", lastName: "", email: "", password: "" });
    } catch (err: unknown) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "Could not create admin", variant: "destructive" });
    } finally {
      setCreateAdminLoading(false);
    }
  };

  const loadLogs = useCallback(async (page = 1, action = "all") => {
    setLogsLoading(true);
    try {
      const data = await apiService.getAuditLogs({
        page,
        limit: 25,
        action: action === "all" ? undefined : action,
      });
      setLogs(data.logs);
      setLogPages(data.pages || 1);
    } catch (err: unknown) {
      toast({ title: "Failed to load audit logs", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setLogsLoading(false); }
  }, []);

  useEffect(() => { if (tab === "audit") loadLogs(logPage, logAction); }, [tab, logPage]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: "overview",  label: "Overview" },
    { key: "doctors",   label: "Doctors", badge: stats?.pendingDoctors || 0 },
    { key: "users",     label: "Users" },
    { key: "analytics", label: "Analytics" },
    { key: "audit",     label: "Audit Log" },
  ];

  return (
    <div className="container py-8 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-indigo-600 flex items-center justify-center shadow-lg">
          <ShieldCheck className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">Platform management and monitoring</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg bg-muted p-1 w-fit gap-0.5">
        {TABS.map(({ key, label, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`relative px-4 py-2 text-sm font-medium rounded-md transition-all ${
              tab === key
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {badge ? (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-yellow-500 text-white">
                {badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {statsLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {/* Primary KPIs */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Platform Overview</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Total Users",        value: stats?.totalUsers,          icon: Users,         color: "text-blue-500",    iconBg: "bg-blue-500/10",    border: "border-l-blue-500",    desc: "Patients & doctors" },
                    { label: "DR Screenings",      value: stats?.totalReports,        icon: FileText,      color: "text-indigo-500",  iconBg: "bg-indigo-500/10",  border: "border-l-indigo-500",  desc: "Total retinal reports" },
                    { label: "Active Doctors",     value: stats?.totalDoctors,        icon: Stethoscope,   color: "text-green-500",   iconBg: "bg-green-500/10",   border: "border-l-green-500",   desc: "Verified specialists" },
                    { label: "Pending Approval",   value: stats?.pendingDoctors,      icon: Clock,         color: "text-yellow-500",  iconBg: "bg-yellow-500/10",  border: "border-l-yellow-500",  desc: "Awaiting verification" },
                  ].map(({ label, value, icon: Icon, color, iconBg, border, desc }) => (
                    <Card key={label} className={`p-6 hover:shadow-lg transition-shadow duration-200 border-l-4 ${border}`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className={`p-3 ${iconBg} rounded-xl`}><Icon className={`w-6 h-6 ${color}`} /></div>
                        <span className="text-3xl font-bold text-foreground">{value ?? "—"}</span>
                      </div>
                      <h3 className="font-semibold text-foreground mb-1">{label}</h3>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Secondary KPIs */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Activity & Health</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Appointments",       value: stats?.totalAppointments,   icon: CalendarCheck, color: "text-cyan-500",    iconBg: "bg-cyan-500/10",    border: "border-l-cyan-500",    desc: "All-time bookings" },
                    { label: "Consultations",      value: stats?.totalConsultations,  icon: Activity,      color: "text-violet-500",  iconBg: "bg-violet-500/10",  border: "border-l-violet-500",  desc: "Doctor reviews requested" },
                    { label: "High-Risk Patients", value: stats?.highRiskPatients,    icon: Heart,         color: "text-red-500",     iconBg: "bg-red-500/10",     border: "border-l-red-500",     desc: "Stage ≥ 3 detected" },
                    { label: "New This Month",     value: stats?.newUsersThisMonth,   icon: TrendingUp,    color: "text-emerald-500", iconBg: "bg-emerald-500/10", border: "border-l-emerald-500", desc: "New registrations" },
                  ].map(({ label, value, icon: Icon, color, iconBg, border, desc }) => (
                    <Card key={label} className={`p-6 hover:shadow-lg transition-shadow duration-200 border-l-4 ${border}`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className={`p-3 ${iconBg} rounded-xl`}><Icon className={`w-6 h-6 ${color}`} /></div>
                        <span className="text-3xl font-bold text-foreground">{value ?? "—"}</span>
                      </div>
                      <h3 className="font-semibold text-foreground mb-1">{label}</h3>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </Card>
                  ))}
                </div>
              </div>

              {/* User health + DR Stage side by side */}
              <div className="grid md:grid-cols-2 gap-4">
                {/* User health breakdown */}
                <Card className="shadow-lg border-t-4 border-t-green-500">
                  <CardHeader><CardTitle className="text-base font-bold">User Account Health</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    {/* Active vs Suspended */}
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5 text-green-500" /> Active</span>
                        <span className="font-bold">{stats?.activeUsers ?? 0}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-green-500 h-2 rounded-full transition-all"
                          style={{ width: stats?.totalUsers ? `${(stats.activeUsers / stats.totalUsers) * 100}%` : "0%" }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="flex items-center gap-1.5"><UserX className="w-3.5 h-3.5 text-red-500" /> Suspended</span>
                        <span className="font-bold">{stats?.suspendedUsers ?? 0}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-red-500 h-2 rounded-full transition-all"
                          style={{ width: stats?.totalUsers ? `${(stats.suspendedUsers / stats.totalUsers) * 100}%` : "0%" }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5 text-blue-500" /> Verified Doctors</span>
                        <span className="font-bold">{stats?.totalDoctors ?? 0}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: stats?.totalUsers ? `${(stats.totalDoctors / stats.totalUsers) * 100}%` : "0%" }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground pt-1">Percentages relative to total platform accounts</p>
                  </CardContent>
                </Card>

                {/* DR Stage Distribution */}
                {stats?.stageDistribution && (
                  <Card className="shadow-lg border-t-4 border-t-blue-500">
                    <CardHeader><CardTitle className="text-base font-bold">DR Stage Distribution</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stats.stageDistribution} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip formatter={(v: any) => [`${v} reports`, "Count"]} contentStyle={{ borderRadius: 8 }} />
                            <Bar dataKey="count" radius={[5, 5, 0, 0]} maxBarSize={48}>
                              {stats.stageDistribution.map((_: any, i: number) => (
                                <Cell key={i} fill={STAGE_COLORS[i]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Recent Screenings */}
              {(stats?.recentReports?.length ?? 0) > 0 && (
                <Card className="shadow-lg border-t-4 border-t-indigo-500">
                  <CardHeader><CardTitle className="text-base font-bold">Recent Screenings</CardTitle></CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground text-xs">
                            <th className="pb-2 pr-4 font-medium">Patient</th>
                            <th className="pb-2 pr-4 font-medium">Stage</th>
                            <th className="pb-2 pr-4 font-medium">Classification</th>
                            <th className="pb-2 font-medium">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.recentReports.map((r: any) => (
                            <tr key={r._id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                              <td className="py-2 pr-4 font-medium">
                                {r.user ? `${r.user.firstName} ${r.user.lastName}` : "Unknown"}
                              </td>
                              <td className="py-2 pr-4">
                                <span
                                  className="px-2 py-0.5 rounded-full text-xs font-semibold text-white"
                                  style={{ backgroundColor: STAGE_COLORS[r.stage] || "#888" }}
                                >
                                  Stage {r.stage}
                                </span>
                              </td>
                              <td className="py-2 pr-4 text-muted-foreground">{r.stageLabel}</td>
                              <td className="py-2 text-muted-foreground">
                                {new Date(r.createdAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Doctors ── */}
      {tab === "doctors" && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by specialization or license…"
                value={doctorSearch}
                onChange={e => setDoctorSearch(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") loadDoctors(doctorSearch); }}
              />
            </div>
            <Button variant="outline" onClick={() => loadDoctors(doctorSearch)}>Search</Button>
            <Button variant="ghost" onClick={() => { setDoctorSearch(""); loadDoctors(); }}>Clear</Button>
          </div>

          {doctorsLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : doctors.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Stethoscope className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>No doctors found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {doctors.map(doc => (
                <Card key={doc._id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
                          {doc.user?.firstName?.[0] ?? "D"}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">
                              Dr. {doc.user?.firstName} {doc.user?.lastName}
                            </span>
                            <Badge
                              variant={doc.isVerified ? "default" : "secondary"}
                              className={doc.isVerified ? "bg-green-600 hover:bg-green-600 text-white" : "text-yellow-700 border-yellow-400"}
                            >
                              {doc.isVerified ? "Verified" : "Pending"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {doc.specialization} · {doc.experience} yrs ·{" "}
                            <span className="font-mono">{doc.licenseNumber}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">{doc.user?.email}</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={doc.isVerified ? "destructive" : "default"}
                        disabled={verifyingId === doc._id}
                        onClick={() => handleVerify(doc._id, !doc.isVerified)}
                        className="shrink-0 gap-1"
                      >
                        {verifyingId === doc._id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : doc.isVerified ? (
                          <><XCircle className="w-3.5 h-3.5" /> Unverify</>
                        ) : (
                          <><CheckCircle className="w-3.5 h-3.5" /> Verify</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Users ── */}
      {tab === "users" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search name or email…"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { setUserPage(1); loadUsers(1, userSearch, userRole); } }}
              />
            </div>
            <Select value={userRole} onValueChange={v => { setUserRole(v); setUserPage(1); loadUsers(1, userSearch, v); }}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="user">Patients</SelectItem>
                <SelectItem value="doctor">Doctors</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => { setUserPage(1); loadUsers(1, userSearch, userRole); }}>Search</Button>
            <Button onClick={() => setCreateAdminOpen(true)} className="ml-auto gap-1.5">
              <UserPlus className="w-4 h-4" /> Create Admin
            </Button>
          </div>

          {usersLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : users.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>No users found.</p>
            </div>
          ) : (
            <Card className="shadow-lg overflow-hidden">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="p-3 font-medium">User</th>
                      <th className="p-3 font-medium">Role</th>
                      <th className="p-3 font-medium">Joined</th>
                      <th className="p-3 font-medium">Status</th>
                      <th className="p-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u._id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="p-3">
                          <p className="font-medium">{u.firstName} {u.lastName}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className="capitalize text-xs">{u.role}</Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="p-3">
                          {u.isSuspended ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 font-medium">Suspended</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 font-medium">Active</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {u.role !== "admin" && (
                            <Button
                              size="sm"
                              variant={u.isSuspended ? "outline" : "ghost"}
                              disabled={suspendingId === u._id}
                              onClick={() => handleSuspend(u._id, !u.isSuspended)}
                              className={`text-xs gap-1 ${!u.isSuspended ? "text-destructive hover:text-destructive" : ""}`}
                            >
                              {suspendingId === u._id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : u.isSuspended ? (
                                <><Eye className="w-3 h-3" /> Unsuspend</>
                              ) : (
                                <><AlertTriangle className="w-3 h-3" /> Suspend</>
                              )}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
          <Pagination page={userPage} pages={userPages} onChange={p => setUserPage(p)} />
        </div>
      )}

      {/* ── Analytics ── */}
      {tab === "analytics" && (
        <div className="space-y-6">
          {analyticsLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : analytics ? (
            <>
              {/* Consultation + Appointment KPIs */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Consultation breakdown */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Consultations</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { key: "total",     label: "Total",     icon: ClipboardList, color: "text-primary",    iconBg: "bg-primary/10",    border: "border-l-primary" },
                      { key: "pending",   label: "Pending",   icon: Clock,         color: "text-yellow-500", iconBg: "bg-yellow-500/10", border: "border-l-yellow-500" },
                      { key: "in_review", label: "In Review", icon: TrendingUp,    color: "text-blue-500",   iconBg: "bg-blue-500/10",   border: "border-l-blue-500" },
                      { key: "completed", label: "Completed", icon: CheckCircle,   color: "text-green-500",  iconBg: "bg-green-500/10",  border: "border-l-green-500" },
                    ].map(({ key, label, icon: Icon, color, iconBg, border }) => (
                      <Card key={key} className={`p-4 hover:shadow-md transition-shadow border-l-4 ${border}`}>
                        <div className="flex items-start justify-between mb-1.5">
                          <div className={`p-2 ${iconBg} rounded-lg`}><Icon className={`w-4 h-4 ${color}`} /></div>
                          <span className="text-2xl font-bold text-foreground">{analytics.consultations?.[key] ?? "—"}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground">{label}</p>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Appointment breakdown */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Appointments</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { key: "total",     label: "Total",     icon: CalendarCheck, color: "text-cyan-500",   iconBg: "bg-cyan-500/10",   border: "border-l-cyan-500" },
                      { key: "pending",   label: "Pending",   icon: Clock,         color: "text-yellow-500", iconBg: "bg-yellow-500/10", border: "border-l-yellow-500" },
                      { key: "confirmed", label: "Confirmed", icon: CheckCircle,   color: "text-green-500",  iconBg: "bg-green-500/10",  border: "border-l-green-500" },
                      { key: "cancelled", label: "Cancelled", icon: XCircle,       color: "text-gray-400",   iconBg: "bg-gray-400/10",   border: "border-l-gray-400" },
                    ].map(({ key, label, icon: Icon, color, iconBg, border }) => (
                      <Card key={key} className={`p-4 hover:shadow-md transition-shadow border-l-4 ${border}`}>
                        <div className="flex items-start justify-between mb-1.5">
                          <div className={`p-2 ${iconBg} rounded-lg`}><Icon className={`w-4 h-4 ${color}`} /></div>
                          <span className="text-2xl font-bold text-foreground">{analytics.appointments?.[key] ?? "—"}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground">{label}</p>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>

              {/* Avg confidence */}
              {analytics.avgConfidence != null && (
                <Card className="border-l-4 border-l-violet-500">
                  <CardContent className="pt-4 pb-3 flex items-center gap-6">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Average AI Model Confidence</p>
                      <p className="text-4xl font-bold text-violet-600">{(analytics.avgConfidence * 100).toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground mt-1">Across all DR screening reports</p>
                    </div>
                    <div className="flex-1">
                      <div className="w-full bg-muted rounded-full h-3">
                        <div
                          className="bg-violet-500 h-3 rounded-full transition-all"
                          style={{ width: `${(analytics.avgConfidence * 100).toFixed(1)}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Screenings + New Users over time */}
              <div className="grid md:grid-cols-2 gap-4">
                {analytics.screeningsOverTime?.length > 0 && (
                  <Card className="shadow-lg border-t-4 border-t-primary">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">Screenings — Last 30 Days</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={analytics.screeningsOverTime} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip labelFormatter={d => `Date: ${d}`} formatter={(v: any) => [`${v} screenings`, ""]} contentStyle={{ borderRadius: 8 }} />
                            <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {analytics.newUsersOverTime?.length > 0 && (
                  <Card className="shadow-lg border-t-4 border-t-emerald-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">New Registrations — Last 30 Days</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={analytics.newUsersOverTime} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip labelFormatter={d => `Date: ${d}`} formatter={(v: any) => [`${v} users`, ""]} contentStyle={{ borderRadius: 8 }} />
                            <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Appointments over time + Specialization distribution */}
              <div className="grid md:grid-cols-2 gap-4">
                {analytics.appointmentsOverTime?.length > 0 && (
                  <Card className="shadow-lg border-t-4 border-t-cyan-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">Appointments — Last 30 Days</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analytics.appointmentsOverTime} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip labelFormatter={d => `Date: ${d}`} formatter={(v: any) => [`${v} appointments`, ""]} contentStyle={{ borderRadius: 8 }} />
                            <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={20} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {analytics.specializationDistribution?.length > 0 && (
                  <Card className="shadow-lg border-t-4 border-t-blue-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">Doctor Specializations</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={analytics.specializationDistribution}
                            layout="vertical"
                            margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                            <Tooltip formatter={(v: any) => [`${v} doctors`, ""]} contentStyle={{ borderRadius: 8 }} />
                            <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} maxBarSize={16} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* DR Stage + Patient Risk Tiers */}
              <div className="grid md:grid-cols-2 gap-4">
                {analytics.stageDistribution?.length > 0 && (
                  <Card className="shadow-lg border-t-4 border-t-violet-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">DR Stage Distribution</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analytics.stageDistribution} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip formatter={(v: any) => [`${v} reports`, "Count"]} contentStyle={{ borderRadius: 8 }} />
                            <Bar dataKey="count" radius={[5, 5, 0, 0]} maxBarSize={48}>
                              {analytics.stageDistribution.map((_: any, i: number) => (
                                <Cell key={i} fill={STAGE_COLORS[i]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {analytics.patientRiskTiers?.length > 0 && (
                  <Card className="shadow-lg border-t-4 border-t-red-500">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">Patient Risk Tiers</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={analytics.patientRiskTiers}
                              dataKey="count"
                              nameKey="label"
                              cx="50%"
                              cy="50%"
                              outerRadius={65}
                              label={false}
                              labelLine={false}
                            >
                              {analytics.patientRiskTiers.map((entry: any, i: number) => (
                                <Cell key={i} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: any) => [`${v} screenings`, ""]} contentStyle={{ borderRadius: 8 }} />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Top Doctors leaderboard */}
              {analytics.topDoctors?.length > 0 && (
                <Card className="shadow-lg border-t-4 border-t-yellow-500">
                  <CardHeader><CardTitle className="text-base font-bold flex items-center gap-2"><Star className="w-4 h-4 text-yellow-500" /> Top Doctors by Consultations</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Rank</th>
                          <th className="pb-2 pr-4 font-medium">Doctor</th>
                          <th className="pb-2 pr-4 font-medium">Specialization</th>
                          <th className="pb-2 pr-4 font-medium">Rating</th>
                          <th className="pb-2 font-medium text-right">Consultations</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.topDoctors.map((doc: any, i: number) => (
                          <tr key={doc._id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="py-2 pr-4">
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white ${
                                i === 0 ? "bg-yellow-500" : i === 1 ? "bg-gray-400" : i === 2 ? "bg-orange-400" : "bg-muted text-muted-foreground"
                              }`}>{i + 1}</span>
                            </td>
                            <td className="py-2 pr-4 font-medium">Dr. {doc.name}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{doc.specialization}</td>
                            <td className="py-2 pr-4">
                              {doc.rating?.average
                                ? <span className="text-yellow-600 font-medium">⭐ {doc.rating.average.toFixed(1)}</span>
                                : <span className="text-muted-foreground text-xs">—</span>}
                            </td>
                            <td className="py-2 text-right">
                              <span className="font-bold text-primary">{doc.count}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <div className="text-center py-16 text-muted-foreground">No analytics data available.</div>
          )}
        </div>
      )}

      {/* ── Confirmation dialog ── */}
      <AlertDialog open={!!pendingAction} onOpenChange={open => { if (!open) setPendingAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.type === "verify"
                ? pendingAction.isVerified ? "Verify Doctor" : "Unverify Doctor"
                : pendingAction?.isSuspended ? "Suspend User" : "Unsuspend User"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.type === "verify"
                ? pendingAction.isVerified
                    ? "This will allow the doctor to appear in searches and accept consultations."
                    : "This will hide the doctor from searches and prevent new consultations."
                : pendingAction?.isSuspended
                    ? "The user will be locked out immediately and cannot log in."
                    : "The user's access will be restored."}
              {" "}Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingAction(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                (pendingAction?.type === "verify" && !pendingAction.isVerified) ||
                (pendingAction?.type === "suspend" && pendingAction.isSuspended)
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
              onClick={() => {
                if (!pendingAction) return;
                if (pendingAction.type === "verify") {
                  confirmVerify(pendingAction.doctorId, pendingAction.isVerified);
                } else {
                  confirmSuspend(pendingAction.userId, pendingAction.isSuspended);
                }
                setPendingAction(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Audit Log ── */}
      {tab === "audit" && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <Select value={logAction} onValueChange={v => { setLogAction(v); setLogPage(1); loadLogs(1, v); }}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Filter by action" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {Object.entries(ACTION_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => loadLogs(logPage, logAction)}>Refresh</Button>
          </div>

          {logsLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>No audit log entries yet.</p>
            </div>
          ) : (
            <Card className="shadow-lg overflow-hidden">
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="p-3 font-medium">Admin</th>
                      <th className="p-3 font-medium">Action</th>
                      <th className="p-3 font-medium">Target</th>
                      <th className="p-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log._id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="p-3">
                          <p className="font-medium text-xs">{log.admin?.firstName} {log.admin?.lastName}</p>
                          <p className="text-xs text-muted-foreground">{log.admin?.email}</p>
                        </td>
                        <td className="p-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ACTION_COLORS[log.action] ?? "bg-muted text-muted-foreground border-border"}`}>
                            {ACTION_LABELS[log.action] ?? log.action}
                          </span>
                        </td>
                        <td className="p-3">
                          <p className="text-xs text-muted-foreground">{log.targetLabel ?? "—"}</p>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
          <Pagination page={logPage} pages={logPages} onChange={p => setLogPage(p)} />
        </div>
      )}

      {/* ── Create Admin Dialog ── */}
      <Dialog open={createAdminOpen} onOpenChange={setCreateAdminOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" /> Create Admin Account
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="admin-first">First Name</Label>
                <Input
                  id="admin-first"
                  placeholder="John"
                  value={createAdminForm.firstName}
                  onChange={e => setCreateAdminForm(f => ({ ...f, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-last">Last Name</Label>
                <Input
                  id="admin-last"
                  placeholder="Doe"
                  value={createAdminForm.lastName}
                  onChange={e => setCreateAdminForm(f => ({ ...f, lastName: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                placeholder="admin@meddycare.com"
                value={createAdminForm.email}
                onChange={e => setCreateAdminForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-pass">Password</Label>
              <Input
                id="admin-pass"
                type="password"
                placeholder="Min. 6 characters"
                value={createAdminForm.password}
                onChange={e => setCreateAdminForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateAdminOpen(false)} disabled={createAdminLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreateAdmin} disabled={createAdminLoading} className="gap-1.5">
              {createAdminLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Create Admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
