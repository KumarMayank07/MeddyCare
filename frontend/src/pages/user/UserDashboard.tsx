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
} from "recharts";
import {
  TrendingDown,
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

export default function UserDashboard() {
  const [reports, setReports] = useState<Report[]>([]);
  const [upcomingReminders, setUpcomingReminders] = useState(0);
  const [todayItems, setTodayItems] = useState<{ type: "reminder" | "appointment"; time: Date; label: string; sublabel?: string; isCompleted?: boolean; status?: string }[]>([]);
  const [loading, setLoading] = useState(true);
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

  // Prepare chart data
  const chartData = reports
    .slice()
    .reverse()
    .slice(-6)
    .map((report) => {
      const date = new Date(report.createdAt);
      return {
        date: date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        severity: report.stage,
        label: report.stageLabel,
      };
    });

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
    <div className="container py-10 space-y-8">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Your Health Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track your retina health and screening history
          </p>
        </div>
        <div className="flex gap-2 -mt-1">
          <Button
            asChild
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg hover:shadow-xl transition-all duration-200"
          >
            <a href="/reports">
              <Eye className="h-4 w-4 mr-2" />
              New Screening
            </a>
          </Button>
          <Button
            variant="secondary"
            asChild
            className="shadow-md hover:shadow-lg transition-all duration-200"
          >
            <a href="/reminders">
              <Calendar className="h-4 w-4 mr-2" />
              Set Reminder
            </a>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="p-6 hover:shadow-lg transition-shadow duration-200 border-l-4 border-l-blue-500">
          <div className="flex items-start justify-between mb-3">
            <div className="p-3 bg-primary/10 rounded-xl">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <span className="text-2xl font-bold text-foreground">
              {reports.length}
            </span>
          </div>
          <h3 className="font-semibold text-foreground mb-1">Total Reports</h3>
          <p className="text-sm text-muted-foreground">
            {lastReport
              ? `Last: ${new Date(lastReport.createdAt).toLocaleDateString()}`
              : "No reports yet. Upload to get started."}
          </p>
        </Card>

        <Card className="p-6 hover:shadow-lg transition-shadow duration-200 border-l-4 border-l-purple-500">
          <div className="flex items-start justify-between mb-3">
            <div className="p-3 bg-accent rounded-xl">
              <Calendar className="h-6 w-6 text-primary" />
            </div>
            <span className="text-2xl font-bold text-foreground">{upcomingReminders}</span>
          </div>
          <h3 className="font-semibold text-foreground mb-1">
            Upcoming Reminders
          </h3>
          <p className="text-sm text-muted-foreground">
            {upcomingReminders === 0 ? "No reminders configured." : `${upcomingReminders} reminder${upcomingReminders > 1 ? "s" : ""} pending.`}
          </p>
        </Card>

        <Card className="p-6 hover:shadow-lg transition-shadow duration-200 border-l-4 border-l-green-500">
          <div className="flex items-start justify-between mb-3">
            <div className="p-3 bg-muted rounded-xl">
              <MessageSquare className="h-6 w-6 text-green-500" />
            </div>
            <span className="text-2xl font-bold text-foreground">24/7</span>
          </div>
          <h3 className="font-semibold text-foreground mb-1">AI Assistant</h3>
          <p className="text-sm text-muted-foreground">
            Chat with our assistant any time.
          </p>
        </Card>
      </div>

      {/* Progress Chart */}
      <Card className="p-6 shadow-lg border-t-4 border-t-blue-500">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" />
              Severity Progress
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Lower values indicate better retina health
            </p>
          </div>
          {reports.length > 0 && (
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Average Severity</div>
              <div className="text-2xl font-bold text-foreground">
                {getAverageSeverity()}
              </div>
              <div className="text-xs text-muted-foreground">
                Trend:{" "}
                <span
                  className={`font-semibold ${
                    trend === "improving"
                      ? "text-green-500"
                      : trend === "worsening"
                      ? "text-red-500"
                      : "text-muted-foreground"
                  }`}
                >
                  {trend === "improving"
                    ? "↓ Improving"
                    : trend === "worsening"
                    ? "↑ Worsening"
                    : "→ Stable"}
                </span>
              </div>
            </div>
          )}
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
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: chartAxisColor, fontSize: 12 }}
                  axisLine={{ stroke: chartGridColor }}
                />
                <YAxis
                  domain={[0, 4]}
                  ticks={[0, 1, 2, 3, 4]}
                  tick={{ fill: chartAxisColor, fontSize: 12 }}
                  axisLine={{ stroke: chartGridColor }}
                  label={{
                    value: "Severity Stage",
                    angle: -90,
                    position: "insideLeft",
                    style: { fill: chartAxisColor, fontSize: 12 },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    borderRadius: "8px",
                    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                  }}
                  labelStyle={{ color: tooltipLabelColor, fontWeight: 600 }}
                  formatter={(value: any, name: any, props: any) => [
                    `Stage ${value} - ${props.payload.label}`,
                    "Severity",
                  ]}
                />
                <Legend
                  wrapperStyle={{ paddingTop: "20px" }}
                  iconType="circle"
                  formatter={() => "Retinopathy Stage"}
                />
                <Bar
                  dataKey="severity"
                  fill="url(#colorGradient)"
                  radius={[8, 8, 0, 0]}
                  maxBarSize={60}
                />
                <defs>
                  <linearGradient
                    id="colorGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={1} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Today's Agenda */}
      <Card className="p-6 shadow-lg border-t-4 border-t-purple-500">
        <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-purple-500" />
          Today's Agenda
          <span className="text-sm font-normal text-muted-foreground ml-1">
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
        <Card className="p-6 shadow-lg bg-card border-2 border-primary/20">
          <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Most Recent Analysis
          </h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="text-sm text-muted-foreground mb-1">Date</div>
              <div className="font-semibold text-foreground">
                {new Date(lastReport.createdAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="text-sm text-muted-foreground mb-1">Stage</div>
              <div className="font-semibold text-foreground">
                Stage {lastReport.stage}
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="text-sm text-muted-foreground mb-1">Classification</div>
              <div className="font-semibold text-foreground">
                {lastReport.stageLabel}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
