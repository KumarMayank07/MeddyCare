import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import {
  TrendingDown,
  TrendingUp,
  Minus,
  Calendar,
  MessageSquare,
  FileText,
  Eye,
  Loader2,
  Bell,
  CheckCircle,
  Clock,
  CalendarCheck,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { useSocket } from "@/hooks/use-socket";
import apiService from "@/lib/api";

interface Report {
  _id: string;
  stage: number;
  stageLabel: string;
  createdAt: string;
}

interface Reminder {
  _id: string;
  title: string;
  description?: string;
  reminderType: string;
  scheduledAt: string;
  isCompleted: boolean;
}

interface Appointment {
  _id: string;
  date: string;
  reason: string;
  status: string;
  doctor: {
    specialization: string;
    user: { firstName: string; lastName: string };
  };
}

const STAGE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#f97316", "#ef4444"];
const STAGE_NAMES  = ["No DR", "Mild", "Moderate", "Severe", "Prolif."];

export default function UserDashboard() {
  const [reports, setReports] = useState<Report[]>([]);
  const [upcomingReminders, setUpcomingReminders] = useState(0);
  const [todayItems, setTodayItems] = useState<{ type: "reminder" | "appointment"; time: Date; label: string; sublabel?: string; isCompleted?: boolean; status?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartView, setChartView] = useState<"bar" | "line">("bar");
  const { isDark } = useTheme();
  const { socket } = useSocket();
  const fetchAppointmentsRef = useRef<() => void>(() => {});

  useEffect(() => {
    fetchReports();
    fetchReminders();
    fetchAppointments();
  }, []);

  // Keep ref in sync so socket listener always calls the latest version
  useEffect(() => { fetchAppointmentsRef.current = fetchAppointments; });

  // Real-time: reload appointments when doctor confirms/rejects
  useEffect(() => {
    if (!socket) return;
    const onUpdated = () => fetchAppointmentsRef.current();
    socket.on('appointment_updated', onUpdated);
    return () => { socket.off('appointment_updated', onUpdated); };
  }, [socket]);

  const fetchReports = async () => {
    try {
      const { reports: data } = await apiService.getReports();
      setReports(data || []);
    } catch (err) {
      console.error("Failed to fetch reports", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchReminders = async () => {
    try {
      const { reminders: data } = await apiService.getReminders();
      const upcoming = (data || []).filter((r: Reminder) => !r.isCompleted);
      setUpcomingReminders(upcoming.length);
      // Collect today's reminders
      const today = new Date();
      const todayReminders = (data || []).filter((r: Reminder) => {
        const d = new Date(r.scheduledAt);
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      }).map((r: Reminder) => ({
        type: "reminder" as const,
        time: new Date(r.scheduledAt),
        label: r.title,
        sublabel: r.description,
        isCompleted: r.isCompleted,
      }));
      setTodayItems(prev => {
        const appts = prev.filter(i => i.type === "appointment");
        return [...todayReminders, ...appts].sort((a, b) => a.time.getTime() - b.time.getTime());
      });
    } catch (err) {
      console.error("Failed to fetch reminders", err);
    }
  };

  const fetchAppointments = async () => {
    try {
      const { appointments: data } = await apiService.getAppointments();
      const today = new Date();
      const todayAppts = (data || []).filter((a: Appointment) => {
        const d = new Date(a.date);
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      }).map((a: Appointment) => ({
        type: "appointment" as const,
        time: new Date(a.date),
        label: `Appointment with Dr. ${a.doctor?.user?.firstName} ${a.doctor?.user?.lastName}`,
        sublabel: a.reason,
        status: a.status,
      }));
      setTodayItems(prev => {
        const reminders = prev.filter(i => i.type === "reminder");
        return [...reminders, ...todayAppts].sort((a, b) => a.time.getTime() - b.time.getTime());
      });
    } catch (err) {
      console.error("Failed to fetch appointments", err);
    }
  };

  // Last-6 bar chart data (existing view)
  const chartData = reports
    .slice()
    .reverse()
    .slice(-6)
    .map((report) => ({
      date: new Date(report.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      severity: report.stage,
      label: report.stageLabel,
    }));

  // Full-history line chart data
  const fullChartData = reports
    .slice()
    .reverse()
    .map((report, idx) => ({
      index: idx + 1,
      date: new Date(report.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      severity: report.stage,
      label: report.stageLabel,
    }));

  // Stage distribution counts
  const stageDist = STAGE_NAMES.map((name, i) => ({
    name,
    count: reports.filter(r => r.stage === i).length,
    color: STAGE_COLORS[i],
  })).filter(s => s.count > 0);

  const getLastReport = () => {
    if (reports.length === 0) return null;
    return reports[0];
  };

  const getAverageSeverity = () => {
    if (reports.length === 0) return 0;
    const sum = reports.reduce((acc, r) => acc + r.stage, 0);
    return (sum / reports.length).toFixed(1);
  };

  const getSeverityTrend = () => {
    if (reports.length < 2) return "stable";
    const recent = reports.slice(0, 3);
    const older = reports.slice(3, 6);
    if (older.length === 0) return "stable";
    const recentAvg =
      recent.reduce((acc, r) => acc + r.stage, 0) / recent.length;
    const olderAvg = older.reduce((acc, r) => acc + r.stage, 0) / older.length;
    if (recentAvg < olderAvg - 0.3) return "improving";
    if (recentAvg > olderAvg + 0.3) return "worsening";
    return "stable";
  };

  const lastReport = getLastReport();
  const trend = getSeverityTrend();

  // Chart colors adapt to dark mode
  const chartAxisColor = isDark ? "#9ca3af" : "#6b7280";
  const chartGridColor = isDark ? "#374151" : "#e5e7eb";
  const tooltipBg = isDark ? "#1f2937" : "rgba(255,255,255,0.98)";
  const tooltipBorder = isDark ? "#374151" : "#e5e7eb";
  const tooltipLabelColor = isDark ? "#f9fafb" : "#111827";

  return (
    <div className="container py-10 space-y-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Your Health Dashboard
          </h1>
          <p className="text-base text-muted-foreground mt-1.5">
            Track your retina health and screening history
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            asChild
            size="default"
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg transition-all duration-200 rounded-xl font-semibold"
          >
            <a href="/reports">
              <Eye className="h-4 w-4 mr-2" />
              New Screening
            </a>
          </Button>
          <Button
            variant="secondary"
            asChild
            size="default"
            className="shadow-sm hover:shadow-md transition-all duration-200 rounded-xl font-semibold border border-border/60"
          >
            <a href="/reminders">
              <Calendar className="h-4 w-4 mr-2" />
              Set Reminder
            </a>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-5 md:grid-cols-3">
        <Card className="p-6 hover:shadow-lg transition-all duration-200 border border-border/60 hover:border-blue-400/40 dark:hover:border-blue-500/40 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-blue-600 rounded-l-2xl" />
          <div className="flex items-start justify-between mb-4 pl-2">
            <div className="p-3 bg-blue-500/10 rounded-xl ring-1 ring-blue-500/20">
              <FileText className="h-6 w-6 text-blue-500" />
            </div>
            <span className="text-3xl font-bold tabular-nums text-foreground">
              {reports.length}
            </span>
          </div>
          <div className="pl-2">
            <h3 className="font-semibold text-foreground mb-1">Total Reports</h3>
            <p className="text-sm text-muted-foreground">
              {lastReport
                ? `Last: ${new Date(lastReport.createdAt).toLocaleDateString()}`
                : "No reports yet. Upload to get started."}
            </p>
          </div>
        </Card>

        <Card className="p-6 hover:shadow-lg transition-all duration-200 border border-border/60 hover:border-purple-400/40 dark:hover:border-purple-500/40 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-purple-500 to-purple-600 rounded-l-2xl" />
          <div className="flex items-start justify-between mb-4 pl-2">
            <div className="p-3 bg-purple-500/10 rounded-xl ring-1 ring-purple-500/20">
              <Calendar className="h-6 w-6 text-purple-500" />
            </div>
            <span className="text-3xl font-bold tabular-nums text-foreground">{upcomingReminders}</span>
          </div>
          <div className="pl-2">
            <h3 className="font-semibold text-foreground mb-1">Upcoming Reminders</h3>
            <p className="text-sm text-muted-foreground">
              {upcomingReminders === 0 ? "No reminders configured." : `${upcomingReminders} reminder${upcomingReminders > 1 ? "s" : ""} pending.`}
            </p>
          </div>
        </Card>

        <Card className="p-6 hover:shadow-lg transition-all duration-200 border border-border/60 hover:border-green-400/40 dark:hover:border-green-500/40 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-green-500 to-emerald-500 rounded-l-2xl" />
          <div className="flex items-start justify-between mb-4 pl-2">
            <div className="p-3 bg-green-500/10 rounded-xl ring-1 ring-green-500/20">
              <MessageSquare className="h-6 w-6 text-green-500" />
            </div>
            <span className="text-3xl font-bold tabular-nums text-foreground">24/7</span>
          </div>
          <div className="pl-2">
            <h3 className="font-semibold text-foreground mb-1">AI Assistant</h3>
            <p className="text-sm text-muted-foreground">
              Chat with our assistant any time.
            </p>
          </div>
        </Card>
      </div>

      {/* Progress Chart */}
      <Card className="p-7 shadow-md border border-border/60 rounded-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-500 rounded-t-2xl" />
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h3 className="text-xl font-bold text-foreground flex items-center gap-2.5">
              <div className="p-1.5 bg-primary/10 rounded-lg">
                <TrendingDown className="h-5 w-5 text-primary" />
              </div>
              Severity Progress
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5 ml-0.5">
              Lower values indicate better retina health
            </p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {reports.length > 0 && (
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Avg Severity</div>
                <div className="text-2xl font-bold text-foreground">{getAverageSeverity()}</div>
                <div className="text-xs text-muted-foreground flex items-center justify-end gap-1 mt-0.5">
                  {trend === "improving" ? <TrendingDown className="h-3 w-3 text-green-500" /> : trend === "worsening" ? <TrendingUp className="h-3 w-3 text-red-500" /> : <Minus className="h-3 w-3" />}
                  <span className={trend === "improving" ? "text-green-500 font-semibold" : trend === "worsening" ? "text-red-500 font-semibold" : "font-semibold"}>
                    {trend === "improving" ? "Improving" : trend === "worsening" ? "Worsening" : "Stable"}
                  </span>
                </div>
              </div>
            )}
            {reports.length > 0 && (
              <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                <button onClick={() => setChartView("bar")} className={`px-3 py-1.5 transition-colors ${chartView === "bar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  Last 6
                </button>
                <button onClick={() => setChartView("line")} className={`px-3 py-1.5 transition-colors ${chartView === "line" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  Full History
                </button>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : reports.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center">
            <div className="p-4 bg-muted rounded-full mb-4">
              <Eye className="h-8 w-8 text-muted-foreground" />
            </div>
            <h4 className="text-lg font-semibold text-foreground mb-2">
              No Data Yet
            </h4>
            <p className="text-sm text-muted-foreground max-w-md">
              Upload your first retina image in the Reports section to start
              tracking your progress
            </p>
            <Button asChild className="mt-4">
              <a href="/reports">Upload First Image</a>
            </Button>
          </div>
        ) : chartView === "bar" ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="date" tick={{ fill: chartAxisColor, fontSize: 12 }} axisLine={{ stroke: chartGridColor }} />
                <YAxis domain={[0, 4]} ticks={[0, 1, 2, 3, 4]} tick={{ fill: chartAxisColor, fontSize: 12 }} axisLine={{ stroke: chartGridColor }}
                  label={{ value: "Stage", angle: -90, position: "insideLeft", style: { fill: chartAxisColor, fontSize: 11 } }} />
                <Tooltip contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: "8px" }}
                  labelStyle={{ color: tooltipLabelColor, fontWeight: 600 }}
                  formatter={(value: any, _: any, props: any) => [`Stage ${value} — ${props.payload.label}`, "Severity"]} />
                <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" formatter={() => "Retinopathy Stage"} />
                <Bar dataKey="severity" fill="url(#barGrad)" radius={[6, 6, 0, 0]} maxBarSize={56}>
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={1} />
                    </linearGradient>
                  </defs>
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fullChartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="date" tick={{ fill: chartAxisColor, fontSize: 11 }} axisLine={{ stroke: chartGridColor }} interval="preserveStartEnd" />
                <YAxis domain={[0, 4]} ticks={[0, 1, 2, 3, 4]} tick={{ fill: chartAxisColor, fontSize: 12 }} axisLine={{ stroke: chartGridColor }}
                  label={{ value: "Stage", angle: -90, position: "insideLeft", style: { fill: chartAxisColor, fontSize: 11 } }} />
                <Tooltip contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: "8px" }}
                  labelStyle={{ color: tooltipLabelColor, fontWeight: 600 }}
                  formatter={(value: any, _: any, props: any) => [`Stage ${value} — ${props.payload.label}`, "Severity"]} />
                <ReferenceLine y={2} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "Moderate", fill: "#f59e0b", fontSize: 10, position: "right" }} />
                <Line type="monotone" dataKey="severity" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: "#3b82f6", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Stage distribution pills */}
        {reports.length > 0 && stageDist.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border/50">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Stage Distribution ({reports.length} scans)</p>
            <div className="flex flex-wrap gap-2">
              {stageDist.map(s => (
                <div key={s.name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold" style={{ borderColor: s.color + "55", backgroundColor: s.color + "18", color: s.color }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  {s.name}: {s.count}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Today's Agenda */}
      <Card className="p-7 shadow-md border border-border/60 rounded-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 via-violet-500 to-purple-500 rounded-t-2xl" />
        <h3 className="text-xl font-bold text-foreground mb-5 flex items-center gap-2.5">
          <div className="p-1.5 bg-purple-500/10 rounded-lg">
            <CalendarCheck className="h-5 w-5 text-purple-500" />
          </div>
          Today's Agenda
          <span className="text-sm font-normal text-muted-foreground ml-1 bg-muted/60 px-2.5 py-0.5 rounded-full border border-border/50">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </h3>
        {todayItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Bell className="h-8 w-8 text-muted-foreground mb-3 opacity-40" />
            <p className="text-sm text-muted-foreground">Nothing scheduled for today. Enjoy your day!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {todayItems.map((item, idx) => (
              <div key={idx} className={`flex items-start gap-3 p-3 rounded-lg border ${item.isCompleted ? "opacity-50 bg-muted/30" : "bg-muted/50"}`}>
                <div className={`p-2 rounded-lg shrink-0 ${item.type === "appointment" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-purple-100 dark:bg-purple-900/30"}`}>
                  {item.type === "appointment"
                    ? <Calendar className={`w-4 h-4 ${item.status === "confirmed" ? "text-green-600" : item.status === "cancelled" ? "text-red-500" : "text-blue-600"}`} />
                    : item.isCompleted
                      ? <CheckCircle className="w-4 h-4 text-green-600" />
                      : <Clock className="w-4 h-4 text-purple-600" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${item.isCompleted ? "line-through text-muted-foreground" : "text-foreground"}`}>{item.label}</p>
                  {item.sublabel && <p className="text-xs text-muted-foreground truncate mt-0.5">{item.sublabel}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {item.time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    {item.type === "appointment" && item.status && (
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-medium ${
                        item.status === "confirmed" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                        item.status === "cancelled" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                      }`}>{item.status}</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent Report Summary */}
      {lastReport && (
        <Card className="p-7 shadow-md border border-primary/20 rounded-2xl relative overflow-hidden bg-gradient-to-br from-card to-primary/5">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-[hsl(var(--primary-variant))] to-primary rounded-t-2xl" />
          <h3 className="text-xl font-bold text-foreground mb-5 flex items-center gap-2.5">
            <div className="p-1.5 bg-primary/10 rounded-lg">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            Most Recent Analysis
          </h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-muted/40 rounded-xl p-4 border border-border/40">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Date</div>
              <div className="font-semibold text-foreground text-base">
                {new Date(lastReport.createdAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </div>
            <div className="bg-muted/40 rounded-xl p-4 border border-border/40">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Stage</div>
              <div className="font-semibold text-foreground text-base">
                Stage {lastReport.stage}
              </div>
            </div>
            <div className="bg-muted/40 rounded-xl p-4 border border-border/40">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Classification</div>
              <div className="font-semibold text-foreground text-base">
                {lastReport.stageLabel}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
