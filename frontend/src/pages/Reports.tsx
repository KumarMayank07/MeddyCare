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
  MessageCircle, Send, ChevronDown, ChevronUp, Upload, Clock, Activity, Download,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/hooks/use-socket";
import { useNotifications } from "@/contexts/NotificationContext";
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
  type?: "text" | "image";
  text?: string;
  imageUrl?: string;
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
  const consultRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [prediction, setPrediction] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [notification, setNotification] = useState<ToastNotification | null>(null);
  const { user } = useAuth();
  const { socket, connected } = useSocket();
  const { setActiveConsultation } = useNotifications();

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

  // Socket: listen for consultation status changes on the personal room (always connected)
  useEffect(() => {
    if (!socket) return;
    const onConsultationUpdated = (payload: {
      consultationId: string;
      status: string;
      followUpDate?: string;
      doctorName?: string;
    }) => {
      setConsultations(prev =>
        prev.map(c =>
          c._id === payload.consultationId
            ? {
                ...c,
                status: payload.status as Consultation["status"],
                // Merge follow-up date into prescription if provided
                ...(payload.followUpDate && {
                  prescription: { ...(c.prescription ?? {}), followUpDate: payload.followUpDate },
                }),
              }
            : c
        )
      );
      // If this consultation is currently expanded, reload its full data to get diagnosis etc.
      if (payload.status === "completed") {
        fetchMyConsultations();
      }
    };
    socket.on("consultation_updated", onConsultationUpdated);
    return () => { socket.off("consultation_updated", onConsultationUpdated); };
  }, [socket]);

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

  const scrollToConsult = (id: string) => {
    // Expand if not already open
    if (expandedConsult !== id) {
      handleExpandConsult(id);
    }
    setTimeout(() => {
      consultRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const handleExpandConsult = async (id: string) => {
    if (expandedConsult === id) { setExpandedConsult(null); setActiveConsultation(null); return; }
    setExpandedConsult(id);
    setActiveConsultation(id);
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

  const downloadReportPDF = (report: Report) => {
    const stageColor = ["#10b981","#3b82f6","#f59e0b","#f97316","#ef4444"][report.stage] ?? "#888";
    const stageLabels = ["No DR","Mild","Moderate","Severe","Proliferative"];
    const probRows = report.probabilities?.length === 5
      ? stageLabels.map((lbl, i) => `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <span style="width:90px;font-size:12px;color:#555">${lbl}</span>
            <div style="flex:1;background:#eee;border-radius:4px;height:8px;overflow:hidden;">
              <div style="width:${(report.probabilities[i]*100).toFixed(1)}%;background:${["#10b981","#3b82f6","#f59e0b","#f97316","#ef4444"][i]??stageColor};height:100%;"></div>
            </div>
            <span style="width:36px;text-align:right;font-size:12px;color:#555">${(report.probabilities[i]*100).toFixed(0)}%</span>
          </div>`).join("")
      : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>MeddyCare — Retina Report</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; color: #111; }
        @media print { body { margin: 20px; } .no-print { display: none; } }
        h1 { font-size: 22px; margin: 0; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: bold; color: #fff; }
        .section { margin-top: 20px; }
        .label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #888; margin-bottom: 4px; }
        .report-text { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px; font-size: 13px; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        td, th { padding: 8px 10px; font-size: 12px; border-bottom: 1px solid #eee; text-align: left; }
        th { color: #888; font-weight: 500; }
      </style></head><body>
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #e0e0e0;padding-bottom:14px;">
        <div>
          <h1>MeddyCare — Retina Report</h1>
          <p style="margin:4px 0 0;color:#666;font-size:13px;">Generated: ${new Date().toLocaleString()}</p>
        </div>
        <span class="badge" style="background:${stageColor}">Stage ${report.stage} — ${report.stageLabel}</span>
      </div>
      <div class="section">
        <table>
          <tr><th>Scan Date</th><td>${formatDate(report.createdAt)}</td>
              <th>Stage</th><td><strong>${report.stage} — ${report.stageLabel}</strong></td></tr>
          ${report.confidence != null ? `<tr><th>AI Confidence</th><td>${(report.confidence*100).toFixed(1)}%</td><td></td><td></td></tr>` : ""}
        </table>
      </div>
      <div class="section">
        <div class="label">Clinical Report</div>
        <div class="report-text">${report.reportText}</div>
      </div>
      ${probRows ? `<div class="section"><div class="label">Stage Probabilities</div>${probRows}</div>` : ""}
      ${report.imageUrl ? `<div class="section"><div class="label">Retina Image</div><img src="${report.imageUrl}" style="width:100%;max-height:300px;object-fit:contain;border:1px solid #ddd;border-radius:8px;background:#000;margin-top:6px;" /></div>` : ""}
      <p style="margin-top:30px;font-size:11px;color:#aaa;text-align:center;">This report is generated by the MeddyCare AI screening system and is not a substitute for professional medical advice.</p>
      <div class="no-print" style="text-align:center;margin-top:24px;">
        <button onclick="window.print()" style="padding:10px 28px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;">Print / Save as PDF</button>
      </div>
    </body></html>`;

    const win = window.open("", "_blank", "width=800,height=700");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
  };

  const stageMeta = (stage: number) => STAGE_META[stage] ?? STAGE_META[0];

  const downloadConsultationPDF = (c: Consultation, reportLabel: string) => {
    const stageColors = ["#10b981","#3b82f6","#f59e0b","#f97316","#ef4444"];
    const stageColor = stageColors[c.report?.stage ?? 0] ?? "#888";
    const doctorName = `Dr. ${c.doctor?.user?.firstName ?? ""} ${c.doctor?.user?.lastName ?? ""}`.trim();
    const messages = consultMessages[c._id] ?? [];
    const statusLabel = c.status === "in_review" ? "In Review" : c.status.charAt(0).toUpperCase() + c.status.slice(1);
    const statusColor = { pending: "#eab308", in_review: "#3b82f6", completed: "#10b981", cancelled: "#6b7280" }[c.status] ?? "#888";

    const row = (label: string, value: string) =>
      `<tr><td class="lbl">${label}</td><td class="val">${value}</td></tr>`;

    const section = (title: string, content: string, borderColor = "#e5e7eb") =>
      `<div class="section" style="border-left:3px solid ${borderColor}">
        <div class="section-title">${title}</div>
        ${content}
      </div>`;

    const diagnosisHtml = c.diagnosis ? section("Doctor's Diagnosis", `
      <table class="detail-table">
        ${row("Findings", c.diagnosis.findings)}
        ${row("Severity", `<span style="text-transform:capitalize;font-weight:600">${c.diagnosis.severity}</span>`)}
        ${c.diagnosis.recommendations ? row("Recommendations", c.diagnosis.recommendations) : ""}
      </table>`, "#10b981") : "";

    const notesHtml = c.doctorNotes ? section("Doctor's Notes", `<p class="prose">${c.doctorNotes}</p>`, "#3b82f6") : "";

    const prescHtml = c.prescription && (c.prescription.followUpDate || c.prescription.instructions || (c.prescription.medications?.length ?? 0) > 0)
      ? section("Prescription & Follow-up", `
        <table class="detail-table">
          ${c.prescription.followUpDate ? row("Follow-up Date", `<strong>${new Date(c.prescription.followUpDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</strong>`) : ""}
          ${c.prescription.instructions ? row("Instructions", c.prescription.instructions) : ""}
          ${c.prescription.medications?.length ? row("Medications", c.prescription.medications.map((m: any) =>
            `<span class="med-tag">${[m.name, m.dosage, m.frequency, m.duration].filter(Boolean).join(" · ")}</span>`
          ).join(" ")) : ""}
        </table>`, "#8b5cf6") : "";

    const patientMsgHtml = c.patientMessage
      ? section("Patient's Complaint", `<p class="prose">${c.patientMessage}</p>`, "#0ea5e9") : "";

    const msgsHtml = messages.length > 0 ? section("Consultation Chat Log", `
      <table class="chat-table">
        <thead><tr><th>Time</th><th>From</th><th>Message</th></tr></thead>
        <tbody>
          ${messages.map(m => `
            <tr class="${m.senderRole === "doctor" ? "row-doctor" : "row-patient"}">
              <td class="chat-time" style="white-space:nowrap">${new Date(m.timestamp).toLocaleDateString()} ${new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
              <td class="chat-from" style="white-space:nowrap">${m.senderRole === "doctor" ? doctorName : "Patient"}</td>
              <td class="chat-msg">${m.text ?? ""}</td>
            </tr>`).join("")}
        </tbody>
      </table>`, "#6b7280") : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>MeddyCare — Consultation Report</title>
      <style>
        *, *::before, *::after { box-sizing: border-box; }
        body { font-family: "Helvetica Neue", Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 40px 32px; color: #111; font-size: 13px; line-height: 1.6; }
        @media print { body { padding: 20px; } .no-print { display: none; } }

        /* Header */
        .header { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 16px; border-bottom: 2px solid #111; margin-bottom: 20px; }
        .header-brand { display: flex; align-items: center; gap: 10px; }
        .brand-dot { width: 36px; height: 36px; background: linear-gradient(135deg, #3b82f6, #6366f1); border-radius: 10px; }
        .brand-name { font-size: 18px; font-weight: 800; letter-spacing: -.3px; }
        .brand-sub { font-size: 11px; color: #666; margin-top: 1px; }
        .stage-badge { padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; color: #fff; white-space: nowrap; }

        /* Info table */
        .info-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
        .info-table td { padding: 4px 12px 4px 0; font-size: 12.5px; vertical-align: top; }
        .info-table .lk { color: #888; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; width: 110px; }
        .status-pill { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; color: #fff; }

        /* Sections */
        .section { margin-top: 20px; padding: 14px 16px; border-radius: 6px; background: #fafafa; border: 1px solid #ebebeb; border-left-width: 3px; page-break-inside: avoid; }
        .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #555; margin-bottom: 10px; }
        .prose { margin: 0; color: #333; }

        /* Detail rows inside section */
        .detail-table { width: 100%; border-collapse: collapse; }
        .detail-table .lbl { color: #666; font-size: 12px; font-weight: 600; width: 130px; padding: 3px 12px 3px 0; vertical-align: top; }
        .detail-table .val { color: #111; font-size: 13px; padding: 3px 0; }
        .med-tag { display: inline-block; background: #ede9fe; color: #5b21b6; border-radius: 4px; padding: 2px 8px; font-size: 11.5px; margin: 2px 2px 2px 0; }

        /* Chat log table */
        .chat-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .chat-table thead tr { background: #f3f4f6; }
        .chat-table th { padding: 6px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #666; border-bottom: 1px solid #e5e7eb; }
        .chat-table td { padding: 7px 10px; vertical-align: top; border-bottom: 1px solid #f0f0f0; }
        .chat-time { color: #888; font-size: 11px; }
        .chat-from { font-weight: 600; }
        .chat-msg { color: #222; }
        .row-doctor .chat-from { color: #16a34a; }
        .row-patient .chat-from { color: #2563eb; }
        .row-doctor { background: #fff; }
        .row-patient { background: #f8faff; }

        /* Footer */
        .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 10px; color: #aaa; }
        .print-btn { display: block; margin: 20px auto 0; padding: 10px 28px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
      </style></head><body>

      <div class="header">
        <div class="header-brand">
          <div class="brand-dot"></div>
          <div>
            <div class="brand-name">MeddyCare</div>
            <div class="brand-sub">Consultation Report</div>
          </div>
        </div>
        <div style="text-align:right">
          <span class="stage-badge" style="background:${stageColor}">Stage ${c.report?.stage} — ${c.report?.stageLabel}</span>
          <div style="font-size:10px;color:#888;margin-top:6px;">Generated: ${new Date().toLocaleString()}</div>
        </div>
      </div>

      <!-- Summary -->
      <table class="info-table">
        <tr><td class="lk">Doctor</td><td><strong>${doctorName}</strong> &nbsp;·&nbsp; ${c.doctor?.specialization ?? ""}</td></tr>
        <tr><td class="lk">Report</td><td>${reportLabel} &nbsp;·&nbsp; Stage ${c.report?.stage} &nbsp;·&nbsp; ${c.report?.stageLabel}</td></tr>
        <tr><td class="lk">Requested</td><td>${new Date(c.createdAt).toLocaleString()}</td></tr>
        <tr><td class="lk">Status</td><td><span class="status-pill" style="background:${statusColor}">${statusLabel}</span></td></tr>
      </table>

      ${patientMsgHtml}
      ${diagnosisHtml}
      ${notesHtml}
      ${prescHtml}
      ${msgsHtml}

      <div class="footer">
        This document is generated by MeddyCare AI Health Assistant and is not a substitute for professional medical advice.
      </div>
      <div class="no-print">
        <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
      </div>
    </body></html>`;

    const win = window.open("", "_blank", "width=840,height=780");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
  };

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

      {/* ── Progressive screening alert ── */}
      {prediction && prediction.stage >= 2 && (
        <div className={`flex items-start gap-4 p-5 rounded-2xl border-2 ${
          prediction.stage >= 3
            ? "bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-700"
            : "bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-700"
        }`}>
          <div className={`p-2.5 rounded-xl shrink-0 ${prediction.stage >= 3 ? "bg-red-100 dark:bg-red-900/40" : "bg-amber-100 dark:bg-amber-900/40"}`}>
            <AlertCircle className={`h-5 w-5 ${prediction.stage >= 3 ? "text-red-600" : "text-amber-600"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`font-bold text-base ${prediction.stage >= 3 ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"}`}>
              {prediction.stage >= 3 ? "⚠️ Urgent:" : "📋 Recommendation:"}{" "}
              Stage {prediction.stage} ({prediction.stageLabel}) Detected
            </p>
            <p className={`text-sm mt-1 ${prediction.stage >= 3 ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
              {prediction.stage >= 4
                ? "Proliferative diabetic retinopathy is sight-threatening. Please consult a retina specialist immediately."
                : prediction.stage === 3
                ? "Severe DR requires prompt specialist evaluation to prevent vision loss. Book an appointment soon."
                : "Moderate DR detected. Regular monitoring and a specialist review are recommended."}
            </p>
          </div>
          <button
            onClick={() => openConsultModal(prediction)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-semibold text-white ${prediction.stage >= 3 ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}`}
          >
            <Stethoscope className="h-4 w-4" />
            Request Consultation
          </button>
        </div>
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
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 shrink-0 text-xs"
                        onClick={() => downloadReportPDF(report)}
                      >
                        <Download className="h-3.5 w-3.5" /> PDF
                      </Button>
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
                          <button
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-opacity hover:opacity-80 ${STATUS_STYLES[existing.status]}`}
                            onClick={() => scrollToConsult(existing._id)}
                            title="View consultation details"
                          >
                            {STATUS_ICONS[existing.status]}
                            Consultation {existing.status === "in_review" ? "In Review" : existing.status.charAt(0).toUpperCase() + existing.status.slice(1)}
                            {" — "}Dr. {existing.doctor?.user?.firstName} {existing.doctor?.user?.lastName}
                          </button>
                          <Button size="sm" variant="outline" className="gap-2 ml-auto" onClick={() => openConsultModal(report)}>
                            <Stethoscope className="h-4 w-4" /> Request Another Doctor
                          </Button>
                        </>
                      ) : anyConsult ? (
                        <>
                          <button
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-opacity hover:opacity-80 ${STATUS_STYLES[anyConsult.status]}`}
                            onClick={() => scrollToConsult(anyConsult._id)}
                            title="View consultation details"
                          >
                            {STATUS_ICONS[anyConsult.status]}
                            {anyConsult.status === "completed" ? "Consultation Completed" : "Consultation Cancelled"}
                            {" — "}Dr. {anyConsult.doctor?.user?.firstName} {anyConsult.doctor?.user?.lastName}
                          </button>
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
                <Card key={c._id} ref={(el) => { consultRefs.current[c._id] = el as HTMLDivElement | null; }} className={`overflow-hidden border-2 ${meta.border}`}>
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
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border capitalize ${STATUS_STYLES[c.status]}`}>
                        {STATUS_ICONS[c.status]}
                        {c.status.replace("_", " ")}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); downloadConsultationPDF(c, reportLabel); }}
                        title="Download consultation PDF"
                        className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border">
                      {/* ── Two-column layout: left = report+diagnosis, right = chat ── */}
                      <div className="grid md:grid-cols-[1fr_1.1fr] divide-y md:divide-y-0 md:divide-x divide-border">

                        {/* ── LEFT PANEL: report info + diagnosis + prescription ── */}
                        <div className="flex flex-col gap-0 overflow-hidden">

                          {/* Report snapshot */}
                          {c.report && (
                            <div className="flex items-center gap-3 px-5 py-4 bg-muted/30">
                              {c.report.imageUrl && (
                                <img src={c.report.imageUrl} alt="Retina" className="w-14 h-14 rounded-xl object-contain bg-black border border-border shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                  <span className="text-xs font-semibold text-muted-foreground">{reportLabel}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${meta.light} ${meta.border} ${meta.text}`}>
                                    Stage {c.report.stage} · {c.report.stageLabel}
                                  </span>
                                </div>
                                {c.report.reportText && (
                                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{c.report.reportText}</p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Patient's initial message */}
                          {c.patientMessage && (
                            <div className="px-5 py-4 border-t border-border">
                              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Your Initial Message</p>
                              <p className="text-sm bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200 p-3 rounded-xl leading-relaxed">{c.patientMessage}</p>
                            </div>
                          )}

                          {/* Diagnosis */}
                          {c.diagnosis && (
                            <div className="px-5 py-4 border-t border-border">
                              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Doctor's Diagnosis</p>
                              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 space-y-1.5 text-sm">
                                <p><span className="font-semibold text-emerald-800 dark:text-emerald-300">Findings:</span> <span className="text-emerald-700 dark:text-emerald-400">{c.diagnosis.findings}</span></p>
                                <p><span className="font-semibold text-emerald-800 dark:text-emerald-300">Severity:</span> <span className="text-emerald-700 dark:text-emerald-400 capitalize">{c.diagnosis.severity}</span></p>
                                {c.diagnosis.recommendations && (
                                  <p><span className="font-semibold text-emerald-800 dark:text-emerald-300">Recommendations:</span> <span className="text-emerald-700 dark:text-emerald-400">{c.diagnosis.recommendations}</span></p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Doctor notes */}
                          {c.doctorNotes && (
                            <div className="px-5 py-4 border-t border-border">
                              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Doctor's Notes</p>
                              <p className="text-sm bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 p-4 rounded-xl leading-relaxed">{c.doctorNotes}</p>
                            </div>
                          )}

                          {/* Prescription */}
                          {c.prescription && (c.prescription.followUpDate || c.prescription.instructions || c.prescription.medications?.length > 0) && (
                            <div className="px-5 py-4 border-t border-border">
                              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Prescription</p>
                              <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl p-4 space-y-3">
                                {c.prescription.followUpDate && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Calendar className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
                                    <span className="font-semibold text-violet-800 dark:text-violet-300">Follow-up:</span>
                                    <span className="text-violet-700 dark:text-violet-400">
                                      {new Date(c.prescription.followUpDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
                                    </span>
                                  </div>
                                )}
                                {c.prescription.instructions && (
                                  <div className="text-sm">
                                    <span className="font-semibold text-violet-800 dark:text-violet-300">Instructions: </span>
                                    <span className="text-violet-700 dark:text-violet-400">{c.prescription.instructions}</span>
                                  </div>
                                )}
                                {c.prescription.medications && c.prescription.medications.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-violet-800 dark:text-violet-300 mb-1.5">Medications</p>
                                    <div className="space-y-1">
                                      {c.prescription.medications.map((med: any, i: number) => (
                                        <div key={i} className="text-sm text-violet-700 dark:text-violet-400 flex gap-2 flex-wrap">
                                          <span className="font-medium">{med.name}</span>
                                          {med.dosage && <span>· {med.dosage}</span>}
                                          {med.frequency && <span>· {med.frequency}</span>}
                                          {med.duration && <span>· {med.duration}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* ── RIGHT PANEL: chat ── */}
                        <div className="flex flex-col h-[420px]">
                          {/* Chat header */}
                          <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center gap-2 shrink-0">
                            <MessageCircle className="h-4 w-4 text-muted-foreground" />
                            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Chat with Dr. {c.doctor?.user?.firstName} {c.doctor?.user?.lastName}</span>
                          </div>

                          {/* Messages */}
                          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                            {messages.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                                <div className="p-3 bg-muted rounded-2xl">
                                  <MessageCircle className="h-6 w-6 text-muted-foreground" />
                                </div>
                                <p className="text-sm text-muted-foreground">No messages yet.<br />Send a message to the doctor.</p>
                              </div>
                            ) : (
                              messages.map((msg, i) => {
                                const isDoctor = msg.senderRole === "doctor";
                                return (
                                  <div key={msg._id ?? i} className={`flex items-end gap-2 ${isDoctor ? "justify-start" : "justify-end"}`}>
                                    {isDoctor && (
                                      <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-700 flex items-center justify-center shrink-0 mb-0.5">
                                        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                          {c.doctor?.user?.firstName?.[0]?.toUpperCase()}
                                        </span>
                                      </div>
                                    )}
                                    <div className={`max-w-[72%] px-3.5 py-2.5 rounded-2xl text-sm shadow-sm ${
                                      isDoctor
                                        ? "bg-muted border border-border text-foreground rounded-bl-sm"
                                        : "bg-blue-600 text-white rounded-br-sm"
                                    }`}>
                                      <p className={`text-[11px] font-semibold mb-1 ${isDoctor ? "text-muted-foreground" : "text-blue-200"}`}>
                                        {isDoctor ? `Dr. ${c.doctor?.user?.firstName}` : "You"}
                                      </p>
                                      {msg.type === "image" && msg.imageUrl
                                        ? <img src={msg.imageUrl} alt={msg.text ?? "image"} className="rounded-xl max-w-full max-h-48 object-cover mb-1" />
                                        : <p className="leading-snug">{msg.text}</p>
                                      }
                                      <p className={`text-[10px] mt-1 ${isDoctor ? "text-muted-foreground" : "text-blue-300"}`}>
                                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                      </p>
                                    </div>
                                    {!isDoctor && (
                                      <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/50 border border-blue-200 dark:border-blue-700 flex items-center justify-center shrink-0 mb-0.5">
                                        <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300">
                                          {user?.firstName?.[0]?.toUpperCase() ?? "Y"}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                            <div ref={messagesEndRef} />
                          </div>

                          {/* Reply input */}
                          {c.status !== "cancelled" ? (
                            <div className="px-4 py-3 border-t border-border bg-background shrink-0">
                              <div className="flex gap-2 items-end">
                                <textarea
                                  rows={1}
                                  className="flex-1 rounded-xl border border-input bg-muted/40 px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring max-h-24"
                                  placeholder="Reply to doctor…"
                                  value={replyText[c._id] ?? ""}
                                  onChange={(e) => setReplyText(prev => ({ ...prev, [c._id]: e.target.value }))}
                                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendReply(c._id); } }}
                                />
                                <Button
                                  size="icon"
                                  className="rounded-xl h-10 w-10 shrink-0 bg-blue-600 hover:bg-blue-700"
                                  onClick={() => handleSendReply(c._id)}
                                  disabled={!(replyText[c._id]?.trim())}
                                >
                                  <Send className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="px-4 py-3 border-t border-border bg-muted/20 shrink-0">
                              <p className="text-xs text-center text-muted-foreground">This consultation is closed.</p>
                            </div>
                          )}
                        </div>
                      </div>
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
