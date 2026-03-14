import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Calendar, Eye, AlertCircle, CheckCircle, XCircle, Stethoscope,
  MessageCircle, Send, ChevronDown, ChevronUp, Upload, Clock, Activity,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/hooks/use-socket";
import apiService from "@/lib/api";

interface Report {
  _id: string;
  imageUrl: string;
  stage: number;
  stageLabel: string;
  reportText: string;
  createdAt: string;
  probabilities: number[];
  confidence?: number;
}

interface ToastNotification {
  id: string;
  type: "success" | "error";
  title: string;
  message: string;
}

function ToastNotification({
  notification,
  onClose,
}: {
  notification: ToastNotification;
  onClose: () => void;
}) {
  const isError = notification.type === "error";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className={`rounded-3xl shadow-2xl p-8 max-w-sm w-full mx-4 animate-scale-in border ${
        isError
          ? "bg-card border-red-200 dark:border-red-800"
          : "bg-card border-green-200 dark:border-green-800"
      }`}>
        <div className="flex justify-center mb-5">
          <div className={`rounded-2xl p-4 ${isError ? "bg-red-100 dark:bg-red-900/40" : "bg-green-100 dark:bg-green-900/40"}`}>
            {isError
              ? <XCircle className="h-10 w-10 text-red-500" strokeWidth={1.5} />
              : <CheckCircle className="h-10 w-10 text-green-500" strokeWidth={2} />
            }
          </div>
        </div>
        <h3 className="text-center text-xl font-bold text-foreground mb-2">{notification.title}</h3>
        <p className="text-center text-sm text-muted-foreground leading-relaxed mb-6">{notification.message}</p>
        <button
          onClick={onClose}
          className={`w-full font-semibold py-3 px-6 rounded-2xl transition-all text-white ${
            isError ? "bg-red-500 hover:bg-red-600" : "bg-green-500 hover:bg-green-600"
          }`}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

interface Consultation {
  _id: string;
  status: "pending" | "in_review" | "completed" | "cancelled";
  createdAt: string;
  patientMessage?: string;
  doctor: { _id: string; specialization: string; user: { firstName: string; lastName: string } };
  report: { _id: string; stage: number; stageLabel: string; imageUrl?: string; reportText?: string };
  diagnosis?: { findings: string; severity: string; recommendations?: string };
  prescription?: { followUpDate?: string; instructions?: string; medications?: any[] };
  doctorNotes?: string;
}

interface Message {
  _id?: string;
  senderId: string;
  senderRole: "patient" | "doctor";
  text?: string;
  timestamp: string;
}

const STAGE_META = [
  { label: "No DR",          color: "#10b981", bg: "bg-emerald-500",  light: "bg-emerald-50 dark:bg-emerald-950/30",  border: "border-emerald-200 dark:border-emerald-800",  text: "text-emerald-700 dark:text-emerald-400" },
  { label: "Mild",           color: "#3b82f6", bg: "bg-blue-500",     light: "bg-blue-50 dark:bg-blue-950/30",        border: "border-blue-200 dark:border-blue-800",        text: "text-blue-700 dark:text-blue-400" },
  { label: "Moderate",       color: "#f59e0b", bg: "bg-amber-500",    light: "bg-amber-50 dark:bg-amber-950/30",      border: "border-amber-200 dark:border-amber-800",      text: "text-amber-700 dark:text-amber-400" },
  { label: "Severe",         color: "#f97316", bg: "bg-orange-500",   light: "bg-orange-50 dark:bg-orange-950/30",    border: "border-orange-200 dark:border-orange-800",    text: "text-orange-700 dark:text-orange-400" },
  { label: "Proliferative",  color: "#ef4444", bg: "bg-red-500",      light: "bg-red-50 dark:bg-red-950/30",          border: "border-red-200 dark:border-red-800",          text: "text-red-700 dark:text-red-400" },
];

const STATUS_STYLES: Record<string, string> = {
  pending:   "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700",
  in_review: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700",
  completed: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700",
  cancelled: "bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600",
};

const STATUS_ICONS: Record<string, JSX.Element> = {
  pending:   <Clock className="h-3.5 w-3.5" />,
  in_review: <Activity className="h-3.5 w-3.5" />,
  completed: <CheckCircle className="h-3.5 w-3.5" />,
  cancelled: <XCircle className="h-3.5 w-3.5" />,
};

export default function Reports() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [prediction, setPrediction] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [notification, setNotification] = useState<ToastNotification | null>(null);
  const { user } = useAuth();
  const { socket, connected } = useSocket();

  // Consultation request state
  const [consultReport, setConsultReport]     = useState<Report | null>(null);
  const [doctors, setDoctors]                 = useState<{ _id: string; specialization: string; user: { firstName: string; lastName: string } }[]>([]);
  const [doctorsLoading, setDoctorsLoading]   = useState(false);
  const [selectedDoctor, setSelectedDoctor]   = useState("");
  const [consultMsg, setConsultMsg]           = useState("");
  const [consultLoading, setConsultLoading]   = useState(false);

  // My consultations state
  const [consultations, setConsultations]               = useState<Consultation[]>([]);
  const [consultationsLoading, setConsultationsLoading] = useState(false);
  const [expandedConsult, setExpandedConsult]           = useState<string | null>(null);
  const [consultMessages, setConsultMessages]           = useState<Record<string, Message[]>>({});
  const [replyText, setReplyText]                       = useState<Record<string, string>>({});

  useEffect(() => {
    fetchReports();
    fetchMyConsultations();
  }, []);

  // Socket: join/leave consultation rooms and receive messages
  useEffect(() => {
    if (!socket || !expandedConsult) return;
    socket.emit("join_consultation", { consultationId: expandedConsult });
    const handler = (payload: any) => {
      if (payload.consultationId !== expandedConsult) return;
      setConsultMessages(prev => {
        const list = prev[expandedConsult] ?? [];
        if (list.some((m: Message) => m._id === payload.message._id)) return prev;
        const withoutOptimistic = list.filter((m: Message) =>
          !(m._id === undefined && m.text === payload.message.text && m.senderRole === payload.message.senderRole)
        );
        return { ...prev, [expandedConsult]: [...withoutOptimistic, payload.message] };
      });
    };
    socket.on("message_received", handler);
    return () => {
      socket.emit("leave_consultation", { consultationId: expandedConsult });
      socket.off("message_received", handler);
    };
  }, [socket, expandedConsult]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consultMessages, expandedConsult]);

  const fetchMyConsultations = async () => {
    setConsultationsLoading(true);
    try {
      const { consultations: data } = await apiService.getMyConsultations();
      setConsultations(data);
    } catch { /* ignore */ }
    finally { setConsultationsLoading(false); }
  };

  // Returns an active (pending/in_review) consultation for a given report, if any
  const activeConsultForReport = (reportId: string) =>
    consultations.find(c =>
      c.report?._id === reportId && ["pending", "in_review"].includes(c.status)
    ) ?? null;

  const handleExpandConsult = async (id: string) => {
    if (expandedConsult === id) { setExpandedConsult(null); return; }
    setExpandedConsult(id);
    try {
      const { messages: loaded } = await apiService.getConsultationMessages(id);
      setConsultMessages(prev => {
        const loadedIds = new Set((loaded as Message[]).map(m => m._id).filter(Boolean));
        const socketOnly = (prev[id] ?? []).filter(m => m._id && !loadedIds.has(m._id));
        return { ...prev, [id]: [...(loaded as Message[]), ...socketOnly] };
      });
    } catch { /* ignore */ }
  };

  const handleSendReply = async (consultId: string) => {
    const text = replyText[consultId]?.trim();
    if (!text) return;
    setReplyText(prev => ({ ...prev, [consultId]: "" }));
    const optimistic: Message = { senderId: user?._id ?? "", senderRole: "patient", text, timestamp: new Date().toISOString() };
    setConsultMessages(prev => ({ ...prev, [consultId]: [...(prev[consultId] ?? []), optimistic] }));
    if (socket && connected) {
      socket.emit("send_message", { consultationId: consultId, text, type: "text" });
    } else {
      try { await apiService.sendConsultationMessage(consultId, text); } catch { /* ignore */ }
    }
  };

  const showNotification = (type: "success" | "error", title: string, message: string) => {
    setNotification({ id: Date.now().toString(), type, title, message });
    setTimeout(() => setNotification(null), 10000);
  };

  const fetchReports = async () => {
    try {
      const { reports: data } = await apiService.getReports();
      setReports(data || []);
    } catch (err) {
      console.error("Failed to fetch reports", err);
    } finally { setLoadingReports(false); }
  };

  const openConsultModal = async (report: Report) => {
    setConsultReport(report);
    setSelectedDoctor("");
    setConsultMsg("");
    setDoctorsLoading(true);
    try {
      const { doctors: list } = await apiService.getAllDoctors({ limit: 50 });
      setDoctors(list);
    } catch { setDoctors([]); }
    finally { setDoctorsLoading(false); }
  };

  const handleRequestConsultation = async () => {
    if (!consultReport || !selectedDoctor) return;
    setConsultLoading(true);
    try {
      await apiService.createConsultation({
        doctorId: selectedDoctor,
        reportId: consultReport._id,
        patientMessage: consultMsg.trim() || undefined,
      });
      showNotification("success", "Consultation Requested!", "The doctor will review your retina report.");
      setConsultReport(null);
      await fetchMyConsultations();
    } catch (err: any) {
      showNotification("error", "Request Failed", err.message || "Could not send consultation request.");
    } finally { setConsultLoading(false); }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showNotification("error", "Invalid File", "Please select an image file (JPEG, PNG, etc.).");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showNotification("error", "File Too Large", "Maximum image size is 10 MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    try {
      setUploading(true);
      const uploadData = await apiService.uploadImage(file);
      showNotification("success", "Image Uploaded!", "Starting AI analysis...");
      setUploading(false);
      setAnalyzing(true);
      const analyzeData = await apiService.analyzeReport({ imageUrl: uploadData.url, publicId: uploadData.publicId });
      setPrediction(analyzeData.report);
      showNotification("success", "Analysis Complete!", `Stage: ${analyzeData.report.stageLabel}`);
      await fetchReports();
    } catch (err: any) {
      showNotification("error", "Upload Failed", err.message || "An error occurred. Please try again.");
    } finally {
      setUploading(false);
      setAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const formatDate = (dateString: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(dateString));

  const stageMeta = (stage: number) => STAGE_META[stage] ?? STAGE_META[0];

  // Active consultation for the currently open modal
  const modalActiveConsult = consultReport ? activeConsultForReport(consultReport._id) : null;

  return (
    <div className="container py-10 space-y-10 max-w-5xl">
      {notification && <ToastNotification notification={notification} onClose={() => setNotification(null)} />}

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Retina Reports</h1>
          <p className="text-muted-foreground mt-1">AI-powered diabetic retinopathy screening</p>
        </div>
        <Button
          size="lg"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || analyzing}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg gap-2 px-6"
        >
          {uploading ? <><Loader2 className="h-4 w-4 animate-spin" />Uploading…</>
           : analyzing ? <><Loader2 className="h-4 w-4 animate-spin" />Analyzing…</>
           : <><Upload className="h-4 w-4" />Upload Retina Image</>}
        </Button>
        <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
      </div>

      {/* ── Latest prediction card ── */}
      {prediction && (
        <Card className={`overflow-hidden border-2 shadow-xl ${stageMeta(prediction.stage).border}`}>
          <div className={`h-1.5 w-full ${stageMeta(prediction.stage).bg}`} />
          <div className="p-6 border-b border-border flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-2xl ${stageMeta(prediction.stage).light}`}>
                <AlertCircle className={`h-6 w-6 ${stageMeta(prediction.stage).text}`} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Latest Analysis</p>
                <h3 className="text-xl font-bold text-foreground">Stage {prediction.stage} — {prediction.stageLabel}</h3>
              </div>
            </div>
            {prediction.confidence != null && (
              <div className={`px-5 py-2.5 rounded-2xl ${stageMeta(prediction.stage).light} border ${stageMeta(prediction.stage).border}`}>
                <p className="text-xs font-medium text-muted-foreground">Confidence</p>
                <p className={`text-2xl font-bold ${stageMeta(prediction.stage).text}`}>{(prediction.confidence * 100).toFixed(1)}%</p>
              </div>
            )}
          </div>
          <div className="p-6 grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              {prediction.probabilities?.length === 5 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Stage Probabilities</p>
                  <div className="space-y-2">
                    {["No DR", "Mild", "Moderate", "Severe", "Proliferative"].map((label, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <span className="w-24 text-muted-foreground shrink-0">{label}</span>
                        <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                          <div className="h-2.5 rounded-full transition-all" style={{ width: `${(prediction.probabilities[i] * 100).toFixed(1)}%`, backgroundColor: STAGE_META[i].color }} />
                        </div>
                        <span className="w-12 text-right text-xs text-muted-foreground shrink-0">{(prediction.probabilities[i] * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Clinical Report</p>
                <p className="text-sm text-muted-foreground leading-relaxed bg-muted/50 p-4 rounded-xl border border-border">{prediction.reportText}</p>
              </div>
            </div>
            {prediction.imageUrl && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Analyzed Image</p>
                <img src={prediction.imageUrl} alt="Retina scan" className="w-full h-64 object-contain rounded-xl border-2 border-border bg-black shadow-md" />
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Reports History ── */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-primary/10 rounded-xl">
            <Calendar className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Reports History</h2>
            <p className="text-sm text-muted-foreground">{reports.length} scan{reports.length !== 1 ? "s" : ""} total</p>
          </div>
        </div>

        {loadingReports ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : reports.length === 0 ? (
          <Card className="p-16 text-center border-2 border-dashed">
            <div className="flex flex-col items-center gap-4">
              <div className="p-5 bg-muted rounded-2xl"><Eye className="h-10 w-10 text-muted-foreground" /></div>
              <div>
                <h3 className="text-lg font-semibold">No reports yet</h3>
                <p className="text-sm text-muted-foreground mt-1">Upload your first retina image to get AI screening</p>
              </div>
            </div>
          </Card>
        ) : (
          <div className="space-y-5">
            {reports.map((report, idx) => {
              const meta = stageMeta(report.stage);
              const existing = activeConsultForReport(report._id);
              // Also check for any completed consultation for this report
              const anyConsult = consultations.find(c => c.report?._id === report._id);
              return (
                <Card key={report._id} className={`overflow-hidden border-2 shadow-md hover:shadow-xl transition-shadow ${meta.border}`}>
                  {/* Colored top bar */}
                  <div className={`h-1.5 w-full ${meta.bg}`} />
                  <div className="p-6">
                    {/* Top row */}
                    <div className="flex items-start justify-between mb-5 gap-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${meta.light}`}>
                          <Eye className={`h-5 w-5 ${meta.text}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-muted-foreground">Report #{reports.length - idx}</span>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${meta.light} ${meta.border} ${meta.text}`}>
                              Stage {report.stage} — {report.stageLabel}
                            </span>
                            {report.confidence != null && (
                              <span className="text-xs text-muted-foreground">{(report.confidence * 100).toFixed(1)}% confidence</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />{formatDate(report.createdAt)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Content grid */}
                    <div className="grid md:grid-cols-2 gap-6 mb-5">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Analysis Result</p>
                        <p className="text-sm text-muted-foreground bg-muted/50 p-4 rounded-xl border border-border leading-relaxed">
                          {report.reportText}
                        </p>
                        {/* Stage probability mini-bars */}
                        {report.probabilities?.length === 5 && (
                          <div className="mt-4 space-y-1.5">
                            {["No DR", "Mild", "Moderate", "Severe", "Proliferative"].map((label, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className="w-20 text-muted-foreground shrink-0">{label}</span>
                                <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                                  <div className="h-1.5 rounded-full" style={{ width: `${(report.probabilities[i] * 100).toFixed(0)}%`, backgroundColor: STAGE_META[i].color }} />
                                </div>
                                <span className="w-9 text-right text-muted-foreground shrink-0">{(report.probabilities[i] * 100).toFixed(0)}%</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Retina Image</p>
                        <img
                          src={report.imageUrl}
                          alt="Retina scan"
                          className="w-full h-56 object-contain rounded-xl border-2 border-border bg-black shadow-sm"
                        />
                      </div>
                    </div>

                    {/* Consultation action */}
                    <div className="pt-4 border-t border-border flex items-center gap-3 flex-wrap">
                      {existing ? (
                        <>
                          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold ${STATUS_STYLES[existing.status]}`}>
                            {STATUS_ICONS[existing.status]}
                            Consultation {existing.status === "in_review" ? "In Review" : existing.status.charAt(0).toUpperCase() + existing.status.slice(1)}
                            {" — "}Dr. {existing.doctor?.user?.firstName} {existing.doctor?.user?.lastName}
                          </div>
                          <Button size="sm" variant="outline" className="gap-2 ml-auto" onClick={() => openConsultModal(report)}>
                            <Stethoscope className="h-4 w-4" /> Request Another Doctor
                          </Button>
                        </>
                      ) : anyConsult ? (
                        <>
                          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold ${STATUS_STYLES[anyConsult.status]}`}>
                            {STATUS_ICONS[anyConsult.status]}
                            {anyConsult.status === "completed" ? "Consultation Completed" : "Consultation Cancelled"}
                            {" — "}Dr. {anyConsult.doctor?.user?.firstName} {anyConsult.doctor?.user?.lastName}
                          </div>
                          <Button size="sm" variant="outline" className="gap-2 ml-auto" onClick={() => openConsultModal(report)}>
                            <Stethoscope className="h-4 w-4" /> Request New Consultation
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => openConsultModal(report)}
                          className="gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow"
                        >
                          <Stethoscope className="h-4 w-4" />
                          Request Doctor Consultation
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── My Consultations ── */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-primary/10 rounded-xl">
            <MessageCircle className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">My Consultations</h2>
            <p className="text-sm text-muted-foreground">{consultations.length} consultation{consultations.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {consultationsLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : consultations.length === 0 ? (
          <Card className="p-14 text-center border-2 border-dashed">
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-muted rounded-2xl"><Stethoscope className="h-8 w-8 text-muted-foreground" /></div>
              <p className="text-sm text-muted-foreground">No consultations yet. Request one from any report above.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {consultations.map((c) => {
              const isExpanded = expandedConsult === c._id;
              const messages = consultMessages[c._id] ?? [];
              const reportIdx = reports.findIndex(r => r._id === c.report?._id);
              const reportNum = reportIdx >= 0 ? reports.length - reportIdx : null;
              const reportLabel = reportNum !== null ? `Report #${reportNum}` : `Report …${c.report?._id?.slice(-6) ?? ""}`;
              const meta = stageMeta(c.report?.stage ?? 0);
              return (
                <Card key={c._id} className={`overflow-hidden border-2 ${meta.border}`}>
                  <div className={`h-1 w-full ${meta.bg}`} />
                  <button
                    className="w-full text-left p-5 flex items-center justify-between gap-4 hover:bg-muted/30 transition-colors"
                    onClick={() => handleExpandConsult(c._id)}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`p-2.5 rounded-xl ${meta.light} shrink-0`}>
                        <Stethoscope className={`h-5 w-5 ${meta.text}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p className="font-semibold text-foreground">
                            Dr. {c.doctor?.user?.firstName} {c.doctor?.user?.lastName}
                          </p>
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${meta.light} ${meta.border} ${meta.text}`}>
                            {reportLabel} · Stage {c.report?.stage} · {c.report?.stageLabel}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{c.doctor?.specialization} · {formatDate(c.createdAt)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border capitalize ${STATUS_STYLES[c.status]}`}>
                        {STATUS_ICONS[c.status]}
                        {c.status.replace("_", " ")}
                      </span>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border">
                      {c.report && (
                        <div className="px-5 pt-4 pb-3 flex items-center gap-4 bg-muted/30 border-b border-border">
                          {c.report.imageUrl && (
                            <img src={c.report.imageUrl} alt="Retina" className="w-16 h-16 rounded-xl object-contain bg-black border border-border shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-muted-foreground">{reportLabel}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${meta.light} ${meta.border} ${meta.text}`}>
                                Stage {c.report.stage} · {c.report.stageLabel}
                              </span>
                            </div>
                            {c.report.reportText && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.report.reportText}</p>
                            )}
                          </div>
                        </div>
                      )}

                      {c.patientMessage && (
                        <div className="px-5 pt-4 pb-2">
                          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Your initial message</p>
                          <p className="text-sm bg-muted/50 p-3 rounded-xl border border-border">{c.patientMessage}</p>
                        </div>
                      )}

                      {c.diagnosis && (
                        <div className="px-5 pt-3 pb-2">
                          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Doctor's Diagnosis</p>
                          <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl p-4 space-y-1.5 text-sm">
                            <p><span className="font-semibold">Findings:</span> {c.diagnosis.findings}</p>
                            <p><span className="font-semibold">Severity:</span> {c.diagnosis.severity}</p>
                            {c.diagnosis.recommendations && (
                              <p><span className="font-semibold">Recommendations:</span> {c.diagnosis.recommendations}</p>
                            )}
                          </div>
                        </div>
                      )}

                      {c.doctorNotes && (
                        <div className="px-5 pt-2 pb-2">
                          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Doctor's Notes</p>
                          <p className="text-sm bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-4 rounded-xl">{c.doctorNotes}</p>
                        </div>
                      )}

                      <div className="px-5 pt-3 pb-2">
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Messages</p>
                        <div className="space-y-2 max-h-72 overflow-y-auto pr-1 rounded-xl bg-muted/20 p-3 border border-border">
                          {messages.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-6">No messages yet. The doctor will reply here.</p>
                          ) : (
                            messages.map((msg, i) => {
                              const isDoctor = msg.senderRole === "doctor";
                              return (
                                <div key={msg._id ?? i} className={`flex ${isDoctor ? "justify-end" : "justify-start"}`}>
                                  <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                                    isDoctor ? "bg-emerald-600 text-white rounded-tr-sm" : "bg-sky-500 text-white rounded-tl-sm"
                                  }`}>
                                    <p className="text-xs font-semibold mb-0.5 opacity-80">{isDoctor ? `Dr. ${c.doctor?.user?.firstName}` : "You"}</p>
                                    <p>{msg.text}</p>
                                    <p className="text-xs mt-1 opacity-60">{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                                  </div>
                                </div>
                              );
                            })
                          )}
                          <div ref={messagesEndRef} />
                        </div>
                      </div>

                      {c.status !== "cancelled" && (
                        <div className="px-5 pb-5 pt-2">
                          <div className="flex gap-2">
                            <textarea
                              rows={1}
                              className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                              placeholder="Reply to doctor…"
                              value={replyText[c._id] ?? ""}
                              onChange={(e) => setReplyText(prev => ({ ...prev, [c._id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendReply(c._id); } }}
                            />
                            <Button
                              size="icon"
                              className="rounded-xl h-10 w-10 shrink-0"
                              onClick={() => handleSendReply(c._id)}
                              disabled={!(replyText[c._id]?.trim())}
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Consultation Request Modal ── */}
      <Dialog open={!!consultReport} onOpenChange={(open) => !open && setConsultReport(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Request Doctor Consultation</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Report preview */}
            {consultReport && (
              <div className={`flex items-center gap-4 p-4 rounded-xl border-2 ${stageMeta(consultReport.stage).light} ${stageMeta(consultReport.stage).border}`}>
                <img src={consultReport.imageUrl} alt="" className="w-16 h-16 rounded-xl object-contain bg-black border border-border shrink-0" />
                <div>
                  <p className={`font-bold text-base ${stageMeta(consultReport.stage).text}`}>
                    Stage {consultReport.stage} — {consultReport.stageLabel}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatDate(consultReport.createdAt)}</p>
                </div>
              </div>
            )}

            {/* Already requested banner */}
            {modalActiveConsult && (
              <div className={`flex items-start gap-3 p-4 rounded-xl border-2 ${STATUS_STYLES[modalActiveConsult.status]}`}>
                <div className="shrink-0 mt-0.5">{STATUS_ICONS[modalActiveConsult.status]}</div>
                <div>
                  <p className="font-semibold text-sm">Active consultation exists</p>
                  <p className="text-xs mt-0.5">
                    You already have a <strong>{modalActiveConsult.status.replace("_", " ")}</strong> consultation with{" "}
                    Dr. {modalActiveConsult.doctor?.user?.firstName} {modalActiveConsult.doctor?.user?.lastName} for this report.
                    You can still request a second opinion from a different doctor.
                  </p>
                </div>
              </div>
            )}

            {/* Doctor select */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Select Doctor <span className="text-destructive">*</span></Label>
              {doctorsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading doctors…
                </div>
              ) : doctors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No doctors available.</p>
              ) : (
                <Select value={selectedDoctor} onValueChange={setSelectedDoctor}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Choose a doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map(d => {
                      const alreadySent = consultations.some(
                        c => c.report?._id === consultReport?._id
                          && c.doctor?._id === d._id
                          && ["pending", "in_review"].includes(c.status)
                      );
                      return (
                        <SelectItem key={d._id} value={d._id} disabled={alreadySent}>
                          Dr. {d.user.firstName} {d.user.lastName} — {d.specialization}
                          {alreadySent ? " (already requested)" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Message to doctor <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <textarea
                className="w-full min-h-[100px] rounded-xl border border-input bg-background px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Describe your symptoms or concerns…"
                value={consultMsg}
                onChange={(e) => setConsultMsg(e.target.value)}
                disabled={consultLoading}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="lg" onClick={() => setConsultReport(null)} disabled={consultLoading}>Cancel</Button>
            <Button
              size="lg"
              onClick={handleRequestConsultation}
              disabled={consultLoading || !selectedDoctor}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 gap-2"
            >
              {consultLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
              Send Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <style>{`
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scale-in { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-fade-in { animation: fade-in 0.2s ease-out; }
        .animate-scale-in { animation: scale-in 0.25s ease-out; }
      `}</style>
    </div>
  );
}
