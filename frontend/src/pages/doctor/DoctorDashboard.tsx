import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle, Clock, ClipboardList, Users, Star, Phone, Mail,
  MapPin, Plus, Trash2, Send, ChevronRight, AlertCircle, Loader2, ImageIcon,
  CalendarCheck, Calendar, XCircle, Navigation, BarChart2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import apiService from "@/lib/api";
import {
  useSocket,
  type SocketMessageReceivedPayload,
  type SocketTypingPayload,
  type SocketConsultationUpdatedPayload,
} from "@/hooks/use-socket";
import { useNotifications } from "@/contexts/NotificationContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type AvailSlot = { available: boolean; start: string; end: string };

interface DoctorProfile {
  _id: string;
  specialization: string;
  licenseNumber: string;
  experience: number;
  contact?: { phone?: string; email?: string };
  location?: { coordinates?: [number, number]; address?: { formatted?: string } };
  rating?: { average: number; count: number };
  availability?: Record<string, AvailSlot>;
  isVerified: boolean;
  user: { firstName: string; lastName: string; email: string; profileImage?: string };
}

const WEEK_DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"] as const;

function buildAvailability(doc: DoctorProfile): Record<string, AvailSlot> {
  const result: Record<string, AvailSlot> = {};
  for (const day of WEEK_DAYS) {
    result[day] = { available: false, start: "09:00", end: "17:00", ...doc.availability?.[day] };
  }
  return result;
}

interface Medication { name: string; dosage: string; frequency: string; duration: string }
interface Message { _id?: string; senderId: string; senderRole: "patient" | "doctor"; type?: "text" | "image"; text?: string; imageUrl?: string; timestamp: string }

interface Consultation {
  _id: string;
  status: "pending" | "in_review" | "completed" | "cancelled";
  patientMessage?: string;
  createdAt: string;
  patient: { _id: string; firstName: string; lastName: string; email: string; gender?: string; dateOfBirth?: string };
  doctor: { _id: string; specialization: string; user: { firstName: string; lastName: string } };
  report: {
    _id: string;
    imageUrl: string;
    stage: number;
    stageLabel: string;
    probabilities: number[];
    confidence?: number;
    reportText: string;
    createdAt: string;
  };
  diagnosis?: { findings: string; severity: string; recommendations?: string };
  prescription?: { medications: Medication[]; instructions?: string; followUpDate?: string };
  doctorNotes?: string;
}

type Tab = "overview" | "consultations" | "appointments" | "analytics" | "profile";

interface AnalyticsData {
  consultations: { total: number; pending: number; in_review: number; completed: number; cancelled: number };
  consultationsOverTime: { date: string; count: number }[];
  rating: { average: number; count: number; distribution: { star: number; count: number }[] };
  patientRiskTiers: { stage: number; label: string; count: number }[];
}
type StatusFilter = "all" | "pending" | "in_review" | "completed" | "cancelled";

const STAGE_COLORS = ["#10b981", "#3b82f6", "#eab308", "#f97316", "#ef4444"];
const STAGE_NAMES  = ["No DR", "Mild", "Moderate", "Severe", "Proliferative"];
const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-yellow-100 text-yellow-800 border-yellow-200",
  in_review:  "bg-blue-100   text-blue-800   border-blue-200",
  completed:  "bg-green-100  text-green-800  border-green-200",
  cancelled:  "bg-gray-100   text-gray-600   border-gray-200",
};

function patientAge(dob?: string) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / 3.156e10);
}

// ─── Probability bars ─────────────────────────────────────────────────────────

function ProbabilityBars({ probabilities }: { probabilities: number[] }) {
  if (!probabilities || probabilities.length !== 5) return null;
  return (
    <div className="space-y-1.5">
      {STAGE_NAMES.map((name, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-24 text-muted-foreground shrink-0">{name}</span>
          <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full transition-all"
              style={{ width: `${(probabilities[i] * 100).toFixed(1)}%`, backgroundColor: STAGE_COLORS[i] }}
            />
          </div>
          <span className="w-10 text-right text-muted-foreground shrink-0">
            {(probabilities[i] * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Medication row ───────────────────────────────────────────────────────────

function MedicationRow({
  med, onChange, onRemove,
}: { med: Medication; onChange: (m: Medication) => void; onRemove: () => void }) {
  return (
    <div className="grid grid-cols-5 gap-2 items-center">
      {(["name", "dosage", "frequency", "duration"] as (keyof Medication)[]).map((f) => (
        <Input
          key={f}
          placeholder={f.charAt(0).toUpperCase() + f.slice(1)}
          value={med[f]}
          onChange={(e) => onChange({ ...med, [f]: e.target.value })}
          className="text-sm"
        />
      ))}
      <Button size="icon" variant="ghost" onClick={onRemove} className="text-destructive hover:text-destructive">
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ─── Consultation detail panel ────────────────────────────────────────────────

function ConsultationDetail({
  consultation,
  onUpdate,
}: { consultation: Consultation; onUpdate: (c: Consultation) => void }) {
  const { toast }                         = useToast();
  const { socket, connected }             = useSocket();
  const { setActiveConsultation }         = useNotifications();
  const messagesEndRef                    = useRef<HTMLDivElement>(null);
  const imageInputRef                     = useRef<HTMLInputElement>(null);
  const typingTimerRef                    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local messages — loaded from API on mount, then updated live via socket
  const [messages, setMessages]           = useState<Message[]>([]);
  const [typingLabel, setTypingLabel]     = useState<string | null>(null);

  const [innerTab, setInnerTab]           = useState<"chat" | "diagnosis">("chat");
  const [diagFindings, setDiagFindings]   = useState(consultation.diagnosis?.findings ?? "");
  const [diagSeverity, setDiagSeverity]   = useState(consultation.diagnosis?.severity ?? "");
  const [diagRecs, setDiagRecs]           = useState(consultation.diagnosis?.recommendations ?? "");
  const [medications, setMedications]     = useState<Medication[]>(consultation.prescription?.medications ?? []);
  const [rxInstructions, setRxInstructions] = useState(consultation.prescription?.instructions ?? "");
  const [followUpDate, setFollowUpDate]   = useState(
    consultation.prescription?.followUpDate ? consultation.prescription.followUpDate.split("T")[0] : ""
  );
  const [doctorNotes, setDoctorNotes]     = useState(consultation.doctorNotes ?? "");
  const [diagLoading, setDiagLoading]     = useState(false);
  const [msgContent, setMsgContent]       = useState("");
  const [imgUploading, setImgUploading]   = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  // ── Stable timestamp sort ───────────────────────────────────────────────────
  const sortByTs = (msgs: Message[]) =>
    [...msgs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // ── Socket room management ──────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    socket.emit("join_consultation", { consultationId: consultation._id });
    setActiveConsultation(consultation._id);

    const onMessageReceived = (payload: SocketMessageReceivedPayload) => {
      if (payload.consultationId !== consultation._id) return;
      setMessages(prev => {
        // Deduplicate by _id — server echoes back to sender too
        if (prev.some(m => m._id === payload.message._id)) return prev;
        // Replace the ONE optimistic placeholder that matches this echo:
        // match on text + senderRole + no _id, but only remove the FIRST match so
        // two identical consecutive messages aren't both wiped by the first echo.
        let replaced = false;
        const withoutOptimistic = prev.filter(m => {
          if (
            !replaced &&
            m._id === undefined &&
            m.text === payload.message.text &&
            m.senderRole === payload.message.senderRole
          ) {
            replaced = true;
            return false; // drop this one placeholder
          }
          return true;
        });
        // Insert at correct chronological position instead of blindly appending
        return sortByTs([...withoutOptimistic, payload.message as unknown as Message]);
      });
    };

    const onTyping = (payload: SocketTypingPayload) => {
      if (payload.senderRole === "patient") {
        setTypingLabel(payload.isTyping ? "Patient is typing…" : null);
      }
    };

    const onConsultationUpdated = (payload: SocketConsultationUpdatedPayload) => {
      if (payload.consultationId !== consultation._id) return;
      // Reload the full consultation from server to get latest state
      apiService.getConsultation(consultation._id).then(({ consultation: updated }) => {
        onUpdate(updated);
      }).catch(() => {});
    };

    socket.on("message_received",     onMessageReceived);
    socket.on("typing_status",        onTyping);
    socket.on("consultation_updated", onConsultationUpdated);

    return () => {
      socket.emit("leave_consultation", { consultationId: consultation._id });
      socket.off("message_received",     onMessageReceived);
      socket.off("typing_status",        onTyping);
      socket.off("consultation_updated", onConsultationUpdated);
      setActiveConsultation(null);
    };
  }, [socket, consultation._id]);

  // Load message history from API whenever the selected consultation changes
  useEffect(() => {
    setMessages([]);
    apiService.getConsultationMessages(consultation._id)
      .then(({ messages: loaded }) => setMessages(prev => {
        // Keep any socket-delivered messages that arrived while the fetch was in flight
        const loadedIds = new Set((loaded as Message[]).map(m => m._id).filter(Boolean));
        const socketOnly = prev.filter(m => m._id && !loadedIds.has(m._id));
        // Sort the merged result so socket-arrived messages land in the right position
        return sortByTs([...(loaded as Message[]), ...socketOnly]);
      }))
      .catch(() => {});
  }, [consultation._id]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingLabel]);

  const isOpen      = consultation.status === "pending" || consultation.status === "in_review";
  const isCompleted = consultation.status === "completed";

  // ── Send message via socket ─────────────────────────────────────────────────
  const handleSendMessage = () => {
    if (!msgContent.trim() || !socket || !connected) return;
    const text = msgContent.trim();

    // Optimistic update — shows immediately, replaced when server echoes back
    setMessages(prev => [...prev, {
      senderId: "", senderRole: "doctor" as const, type: "text" as const,
      text, timestamp: new Date().toISOString(),
    }]);

    socket.emit("send_message", { consultationId: consultation._id, text, type: "text" });
    setMsgContent("");
    // Cancel any pending typing indicator
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    socket.emit("typing", { consultationId: consultation._id, isTyping: false });
  };

  // ── Typing indicator ────────────────────────────────────────────────────────
  const handleMsgInput = (value: string) => {
    setMsgContent(value);
    if (!socket || !connected) return;
    socket.emit("typing", { consultationId: consultation._id, isTyping: true });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socket.emit("typing", { consultationId: consultation._id, isTyping: false });
    }, 2000);
  };

  // ── Image sharing ───────────────────────────────────────────────────────────
  const handleImageShare = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socket || !connected) return;
    setImgUploading(true);
    try {
      const uploaded = await apiService.uploadImage(file);
      socket.emit("send_message", {
        consultationId: consultation._id,
        text: file.name,          // caption = original filename
        type: "image",
        imageUrl: uploaded.url,
      });
    } catch (err: unknown) {
      toast({ title: "Image upload failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally {
      setImgUploading(false);
      e.target.value = "";
    }
  };

  // ── Status + diagnosis (still REST — these are structural changes) ──────────
  const handleStatusChange = async (newStatus: string) => {
    setStatusLoading(true);
    try {
      const { consultation: updated } = await apiService.updateConsultationStatus(consultation._id, newStatus);
      onUpdate(updated);
      toast({ title: `Marked as ${newStatus.replace("_", " ")}` });
    } catch (err: unknown) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally { setStatusLoading(false); }
  };

  const handleDiagnose = async () => {
    if (!diagFindings.trim() || !diagSeverity) {
      toast({ title: "Findings and severity are required", variant: "destructive" });
      return;
    }
    setDiagLoading(true);
    try {
      const { consultation: updated } = await apiService.submitDiagnosis(consultation._id, {
        diagnosis: { findings: diagFindings, severity: diagSeverity, recommendations: diagRecs || undefined },
        prescription: {
          medications: medications.filter(m => m.name.trim()),
          instructions: rxInstructions || undefined,
          followUpDate: followUpDate || undefined,
        },
        doctorNotes: doctorNotes || undefined,
      });
      onUpdate(updated);
      toast({ title: "Diagnosis saved", description: "Consultation marked as completed." });
    } catch (err: unknown) {
      toast({ title: "Failed to save", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally { setDiagLoading(false); }
  };

  const p = consultation.patient;
  const r = consultation.report;

  return (
    <div className="flex flex-col border border-border rounded-xl overflow-hidden bg-card shadow-sm" style={{ height: "calc(100vh - 230px)" }}>

      {/* ── Top strip: patient + status + inner tabs ── */}
      <div className="shrink-0 border-b border-border bg-muted/20">
        {/* Patient row */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
              {p.firstName[0]}{p.lastName[0]}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm leading-tight">{p.firstName} {p.lastName}</p>
              <p className="text-xs text-muted-foreground truncate">
                {p.email}
                {(p.gender || p.dateOfBirth) && <span className="ml-2 capitalize">{p.gender}{p.gender && p.dateOfBirth && " · "}{p.dateOfBirth && `${patientAge(p.dateOfBirth)} yrs`}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold capitalize ${STATUS_COLORS[consultation.status]}`}>
              {consultation.status.replace("_", " ")}
            </span>
            {isOpen && consultation.status === "pending" && (
              <>
                <Button size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700" onClick={() => handleStatusChange("in_review")} disabled={statusLoading}>
                  {statusLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardList className="w-3 h-3" />} Start Review
                </Button>
                <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={() => handleStatusChange("cancelled")} disabled={statusLoading}>
                  <XCircle className="w-3 h-3" /> Decline
                </Button>
              </>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full border ${connected ? "text-green-600 border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800" : "text-gray-400 border-gray-300 bg-gray-50"}`}>
              {connected ? "● Live" : "○ Offline"}
            </span>
          </div>
        </div>
        {/* Inner tab bar */}
        <div className="flex border-t border-border">
          {[
            { key: "chat" as const, label: "Report & Chat" },
            { key: "diagnosis" as const, label: isCompleted ? "Diagnosis & Rx" : "Write Diagnosis" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setInnerTab(key)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
                innerTab === key
                  ? "border-primary text-primary bg-background"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
            >
              {label}
              {key === "diagnosis" && isOpen && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Pending</span>}
              {key === "diagnosis" && isCompleted && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Done</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Report & Chat ── */}
      {innerTab === "chat" && (
        <div className="flex flex-1 min-h-0 divide-x divide-border">

          {/* Left: retina + patient message */}
          <div className="w-[280px] shrink-0 flex flex-col overflow-y-auto">
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Retina Scan</p>
                <span className="text-[11px] px-2 py-0.5 rounded-full border font-bold"
                  style={{ backgroundColor: STAGE_COLORS[r.stage] + "22", color: STAGE_COLORS[r.stage], borderColor: STAGE_COLORS[r.stage] + "55" }}>
                  Stage {r.stage} — {r.stageLabel}
                </span>
              </div>
              <img src={r.imageUrl} alt="Retina" className="w-full rounded-xl border border-border object-contain bg-black" style={{ maxHeight: 180 }} />
              {r.confidence != null && (
                <p className="text-xs text-muted-foreground text-center">{(r.confidence * 100).toFixed(1)}% model confidence</p>
              )}
              <ProbabilityBars probabilities={r.probabilities} />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">AI Report</p>
                <p className="text-xs text-muted-foreground leading-relaxed bg-muted/40 p-3 rounded-lg border border-border">{r.reportText}</p>
              </div>
              {consultation.patientMessage && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Patient's Message</p>
                  <p className="text-xs bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200 p-3 rounded-lg leading-relaxed">{consultation.patientMessage}</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: full-height chat */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <div className="p-3 bg-muted rounded-2xl"><Send className="h-5 w-5 text-muted-foreground" /></div>
                  <p className="text-sm text-muted-foreground">No messages yet.<br />Send a message to start the conversation.</p>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isDoc = msg.senderRole === "doctor";
                  return (
                    <div key={msg._id ?? i} className={`flex items-end gap-2 ${isDoc ? "justify-end" : "justify-start"}`}>
                      {!isDoc && (
                        <div className="w-7 h-7 rounded-full bg-sky-100 dark:bg-sky-900/50 border border-sky-200 dark:border-sky-700 flex items-center justify-center shrink-0 mb-0.5">
                          <span className="text-[10px] font-bold text-sky-700 dark:text-sky-300">{p.firstName[0]}</span>
                        </div>
                      )}
                      <div className={`max-w-[72%] px-3.5 py-2.5 rounded-2xl text-sm shadow-sm ${
                        isDoc ? "bg-emerald-600 text-white rounded-br-sm" : "bg-muted border border-border text-foreground rounded-bl-sm"
                      }`}>
                        <p className={`text-[11px] font-semibold mb-1 ${isDoc ? "text-emerald-200" : "text-muted-foreground"}`}>
                          {isDoc ? "You (Dr.)" : p.firstName}
                        </p>
                        {msg.type === "image" && msg.imageUrl && (
                          <img src={msg.imageUrl} alt={msg.text ?? "image"} className="rounded-lg max-w-full mb-1 max-h-40 object-cover" />
                        )}
                        {msg.text && <p className="leading-snug">{msg.text}</p>}
                        <p className={`text-[10px] mt-1 ${isDoc ? "text-emerald-300" : "text-muted-foreground"}`}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      {isDoc && (
                        <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-700 flex items-center justify-center shrink-0 mb-0.5">
                          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">Dr</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
            {typingLabel && <p className="text-xs text-muted-foreground italic px-4 pb-1">{typingLabel}</p>}
            {consultation.status !== "cancelled" ? (
              <div className="px-4 py-3 border-t border-border bg-background shrink-0">
                <div className="flex gap-2 items-center">
                  <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageShare} />
                  <Button size="icon" variant="outline" className="h-9 w-9 shrink-0 rounded-xl" onClick={() => imageInputRef.current?.click()} disabled={imgUploading || !connected}>
                    {imgUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                  </Button>
                  <Input
                    placeholder={connected ? "Message patient…" : "Connecting…"}
                    value={msgContent}
                    onChange={(e) => handleMsgInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                    disabled={!connected}
                    className="flex-1 rounded-xl"
                  />
                  <Button size="icon" className="h-9 w-9 shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-700" onClick={handleSendMessage} disabled={!connected || !msgContent.trim()}>
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 border-t border-border bg-muted/20 shrink-0 text-center">
                <p className="text-xs text-muted-foreground">This consultation is closed.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Diagnosis ── */}
      {innerTab === "diagnosis" && (
        <div className="flex-1 overflow-y-auto p-6">
          {isCompleted && consultation.diagnosis ? (
            <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Doctor's Diagnosis</p>
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 space-y-2 text-sm">
                    <p><span className="font-semibold text-emerald-800 dark:text-emerald-300">Findings:</span> <span className="text-emerald-700 dark:text-emerald-400">{consultation.diagnosis.findings}</span></p>
                    <p><span className="font-semibold text-emerald-800 dark:text-emerald-300">Severity:</span> <span className="text-emerald-700 dark:text-emerald-400 capitalize">{consultation.diagnosis.severity}</span></p>
                    {consultation.diagnosis.recommendations && (
                      <p><span className="font-semibold text-emerald-800 dark:text-emerald-300">Recommendations:</span> <span className="text-emerald-700 dark:text-emerald-400">{consultation.diagnosis.recommendations}</span></p>
                    )}
                  </div>
                </div>
                {consultation.doctorNotes && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Doctor's Notes</p>
                    <p className="text-sm bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 p-4 rounded-xl">{consultation.doctorNotes}</p>
                  </div>
                )}
              </div>
              {consultation.prescription && (consultation.prescription.followUpDate || consultation.prescription.instructions || (consultation.prescription.medications?.length ?? 0) > 0) && (
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Prescription</p>
                    <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl p-4 space-y-3 text-sm">
                      {consultation.prescription.followUpDate && (
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-violet-600 shrink-0" />
                          <span className="font-semibold text-violet-800 dark:text-violet-300">Follow-up:</span>
                          <span className="text-violet-700 dark:text-violet-400">{new Date(consultation.prescription.followUpDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</span>
                        </div>
                      )}
                      {consultation.prescription.instructions && (
                        <p><span className="font-semibold text-violet-800 dark:text-violet-300">Instructions:</span> <span className="text-violet-700 dark:text-violet-400">{consultation.prescription.instructions}</span></p>
                      )}
                      {(consultation.prescription.medications?.length ?? 0) > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-violet-800 dark:text-violet-300">Medications</p>
                          {consultation.prescription!.medications.map((m, i) => (
                            <div key={i} className="text-xs text-violet-700 dark:text-violet-400 bg-violet-100/50 dark:bg-violet-900/20 px-3 py-1.5 rounded-lg flex gap-2 flex-wrap">
                              <span className="font-semibold">{m.name}</span>
                              {m.dosage && <span>· {m.dosage}</span>}
                              {m.frequency && <span>· {m.frequency}</span>}
                              {m.duration && <span>· {m.duration}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : isOpen ? (
            <div className="space-y-5 max-w-4xl">
              <div className="grid md:grid-cols-2 gap-5">
                {/* Left column */}
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Findings <span className="text-destructive">*</span></Label>
                    <textarea
                      className="w-full min-h-[100px] rounded-xl border border-input bg-muted/30 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Describe what you observe in the retina scan…"
                      value={diagFindings}
                      onChange={(e) => setDiagFindings(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Severity <span className="text-destructive">*</span></Label>
                    <Select value={diagSeverity} onValueChange={setDiagSeverity}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select severity" /></SelectTrigger>
                      <SelectContent>
                        {["normal", "mild", "moderate", "severe", "critical"].map(s => (
                          <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Recommendations</Label>
                    <textarea
                      className="w-full min-h-[80px] rounded-xl border border-input bg-muted/30 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Treatment plan, lifestyle advice…"
                      value={diagRecs}
                      onChange={(e) => setDiagRecs(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Doctor Notes <span className="text-xs text-muted-foreground font-normal">(private)</span></Label>
                    <textarea
                      className="w-full min-h-[72px] rounded-xl border border-input bg-muted/30 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Internal notes not shared with patient…"
                      value={doctorNotes}
                      onChange={(e) => setDoctorNotes(e.target.value)}
                    />
                  </div>
                </div>
                {/* Right column */}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Follow-up Date</Label>
                      <Input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="rounded-xl" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Rx Instructions</Label>
                      <Input placeholder="e.g. Take with food" value={rxInstructions} onChange={(e) => setRxInstructions(e.target.value)} className="rounded-xl" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Medications</Label>
                      <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg gap-1" onClick={() => setMedications([...medications, { name: "", dosage: "", frequency: "", duration: "" }])}>
                        <Plus className="w-3 h-3" /> Add
                      </Button>
                    </div>
                    {medications.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-5 gap-1.5 text-[10px] text-muted-foreground px-0.5">
                          <span>Name</span><span>Dosage</span><span>Frequency</span><span>Duration</span><span />
                        </div>
                        {medications.map((med, i) => (
                          <MedicationRow key={i} med={med}
                            onChange={(u) => { const arr = [...medications]; arr[i] = u; setMedications(arr); }}
                            onRemove={() => setMedications(medications.filter((_, j) => j !== i))}
                          />
                        ))}
                      </div>
                    )}
                    {medications.length === 0 && (
                      <p className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-xl border border-dashed text-center">No medications added yet.</p>
                    )}
                  </div>
                </div>
              </div>
              <Button onClick={handleDiagnose} disabled={diagLoading} size="lg" className="bg-emerald-600 hover:bg-emerald-700 gap-2 w-full md:w-auto">
                {diagLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Submit Diagnosis & Complete Consultation
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-center">
              <div>
                <XCircle className="w-10 h-10 mx-auto mb-2 text-muted-foreground opacity-40" />
                <p className="text-sm text-muted-foreground">This consultation was cancelled.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function DoctorDashboard() {
  const { toast } = useToast();
  const { socket } = useSocket();

  const [tab, setTab]                       = useState<Tab>("overview");
  const [profile, setProfile]               = useState<DoctorProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [consultations, setConsultations]   = useState<Consultation[]>([]);
  const [consultLoading, setConsultLoading] = useState(false);
  const [statusFilter, setStatusFilter]     = useState<StatusFilter>("all");
  const [selected, setSelected]             = useState<Consultation | null>(null);

  const [appointments, setAppointments]         = useState<any[]>([]);
  const [apptLoading, setApptLoading]           = useState(false);

  const [analytics, setAnalytics]               = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Profile edit
  const [editMode, setEditMode]         = useState(false);
  const [editSpec, setEditSpec]         = useState("");
  const [editExp, setEditExp]           = useState("");
  const [editPhone, setEditPhone]       = useState("");
  const [editEmail, setEditEmail]       = useState("");
  const [editCoords, setEditCoords]     = useState<[number, number] | null>(null);
  const [locLoading, setLocLoading]     = useState(false);
  const [saveLoading, setSaveLoading]   = useState(false);

  // Availability edit
  const [availEditMode, setAvailEditMode]           = useState(false);
  const [editAvailability, setEditAvailability]     = useState<Record<string, AvailSlot>>({});
  const [originalAvailability, setOriginalAvailability] = useState<Record<string, AvailSlot>>({});

  useEffect(() => { loadProfile(); }, []);

  // Load consultations both for overview stats and for the consultations tab
  useEffect(() => {
    if (profile) loadConsultations();
  }, [profile, statusFilter, tab]);

  useEffect(() => {
    if (profile) loadAppointments();
  }, [profile, tab]);

  useEffect(() => {
    if (tab === "analytics" && profile) loadAnalytics();
  }, [tab, profile]);

  // Real-time: reload when backend pushes events to this doctor's user room
  useEffect(() => {
    if (!socket) return;

    // New items arriving — reload the relevant list
    const onNewConsultation = () => loadConsultations();
    const onNewAppointment  = () => loadAppointments();
    const onProfileUpdated  = () => loadProfile();

    // Patient cancelled an appointment → update its status instantly in the list
    const onAppointmentUpdated = (payload: { appointmentId: string; status: string }) => {
      setAppointments(prev =>
        prev.map(a => a._id === payload.appointmentId ? { ...a, status: payload.status } : a)
      );
    };

    // Consultation status changed (e.g. patient cancelled) → update list + selected panel
    const onConsultationUpdated = (payload: { consultationId: string; status: string }) => {
      setConsultations(prev =>
        prev.map(c => c._id === payload.consultationId ? { ...c, status: payload.status as Consultation["status"] } : c)
      );
      setSelected(prev =>
        prev?._id === payload.consultationId ? { ...prev, status: payload.status as Consultation["status"] } : prev
      );
    };

    socket.on('new_consultation',    onNewConsultation);
    socket.on('new_appointment',     onNewAppointment);
    socket.on('profile_updated',     onProfileUpdated);
    socket.on('appointment_updated', onAppointmentUpdated);
    socket.on('consultation_updated', onConsultationUpdated);

    return () => {
      socket.off('new_consultation',    onNewConsultation);
      socket.off('new_appointment',     onNewAppointment);
      socket.off('profile_updated',     onProfileUpdated);
      socket.off('appointment_updated', onAppointmentUpdated);
      socket.off('consultation_updated', onConsultationUpdated);
    };
  }, [socket]);

  const loadProfile = async () => {
    try {
      const data = await apiService.getDoctorProfile();
      const doc = data.doctor as DoctorProfile;
      setProfile(doc);
      setEditSpec(doc.specialization);
      setEditExp(String(doc.experience));
      setEditPhone(doc.contact?.phone ?? "");
      setEditEmail(doc.contact?.email ?? "");
      if (doc.location?.coordinates?.length === 2) {
        setEditCoords(doc.location.coordinates);
      }
      const avail = buildAvailability(doc);
      setEditAvailability(avail);
      setOriginalAvailability(avail);
    } catch {
      // no doctor profile yet
    } finally { setProfileLoading(false); }
  };

  const loadConsultations = async () => {
    setConsultLoading(true);
    try {
      const { consultations: data } = await apiService.getDoctorConsultations(
        statusFilter === "all" ? undefined : statusFilter
      );
      setConsultations(data);
    } catch (err: unknown) {
      toast({ title: "Failed to load consultations", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setConsultLoading(false); }
  };

  const loadAppointments = async () => {
    setApptLoading(true);
    try {
      const { appointments: data } = await apiService.getDoctorAppointments();
      setAppointments(data);
    } catch (err: unknown) {
      toast({ title: "Failed to load appointments", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setApptLoading(false); }
  };

  const handleConfirmAppointment = async (id: string) => {
    try {
      const { appointment } = await apiService.confirmAppointment(id);
      setAppointments(prev => prev.map(a => a._id === id ? appointment : a));
      toast({ title: "Appointment confirmed" });
    } catch (err: unknown) {
      toast({ title: "Failed to confirm", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  };

  const handleRejectAppointment = async (id: string) => {
    try {
      const { appointment } = await apiService.rejectAppointment(id);
      setAppointments(prev => prev.map(a => a._id === id ? appointment : a));
      toast({ title: "Appointment rejected" });
    } catch (err: unknown) {
      toast({ title: "Failed to reject", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  };

  const handleSaveProfile = async () => {
    if (!profile) return;
    setSaveLoading(true);
    try {
      const payload: Record<string, unknown> = {
        specialization: editSpec,
        experience: parseInt(editExp),
        contact: { phone: editPhone, email: editEmail },
      };
      if (editCoords) {
        payload.location = {
          type: 'Point',
          coordinates: editCoords, // [lng, lat] as GeoJSON
          address: profile.location?.address ?? {},
        };
      }
      await apiService.updateDoctorProfile(profile._id, payload);
      await loadProfile();
      setEditMode(false);
      toast({ title: "Profile updated" });
    } catch (err: unknown) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSaveLoading(false); }
  };

  const handleSaveAvailability = async () => {
    if (!profile) return;
    setSaveLoading(true);
    try {
      await apiService.updateDoctorProfile(profile._id, { availability: editAvailability });
      await loadProfile();
      setAvailEditMode(false);
      toast({ title: "Availability updated" });
    } catch (err: unknown) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSaveLoading(false); }
  };

  const toggleDayAvailability = (day: string) => {
    setEditAvailability(prev => ({
      ...prev,
      [day]: { ...prev[day], available: !prev[day].available },
    }));
  };

  const updateSlotTime = (day: string, field: "start" | "end", value: string) => {
    setEditAvailability(prev => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const data = await apiService.getDoctorAnalytics();
      setAnalytics(data);
    } catch (err: unknown) {
      toast({ title: "Failed to load analytics", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setAnalyticsLoading(false); }
  };

  const handleUpdate = (updated: Consultation) => {
    setConsultations(prev => prev.map(c => c._id === updated._id ? updated : c));
    setSelected(updated);
  };

  const stats = {
    pending:   consultations.filter(c => c.status === "pending").length,
    inReview:  consultations.filter(c => c.status === "in_review").length,
    completed: consultations.filter(c => c.status === "completed").length,
    patients:  new Set(consultations.map(c => c.patient._id)).size,
  };

  const filtered = statusFilter === "all" ? consultations : consultations.filter(c => c.status === statusFilter);

  const pendingAppts = appointments.filter(a => a.status === "pending").length;

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview",      label: "Overview" },
    { key: "consultations", label: `Consultations${stats.pending > 0 ? ` (${stats.pending})` : ""}` },
    { key: "appointments",  label: `Appointments${pendingAppts > 0 ? ` (${pendingAppts})` : ""}` },
    { key: "analytics",     label: "Analytics" },
    { key: "profile",       label: "Profile" },
  ];

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container py-16 text-center space-y-4 max-w-md mx-auto">
        <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground" />
        <h2 className="text-xl font-semibold">Doctor profile not found</h2>
        <p className="text-muted-foreground text-sm">
          You need a doctor profile to use this dashboard. Contact an admin or create your profile via the API.
        </p>
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg overflow-hidden">
            {profile.user.profileImage
              ? <img src={profile.user.profileImage} alt="avatar" className="w-full h-full object-cover" />
              : profile.user.firstName[0]
            }
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dr. {profile.user.firstName} {profile.user.lastName}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-muted-foreground text-sm">{profile.specialization}</span>
              {profile.isVerified
                ? <Badge className="bg-green-600 hover:bg-green-600 text-white text-xs">Verified</Badge>
                : <Badge variant="outline" className="text-yellow-600 border-yellow-400 text-xs">Pending Verification</Badge>
              }
            </div>
          </div>
        </div>
        {profile.rating && (
          <div className="text-right bg-muted/50 px-4 py-3 rounded-xl border">
            <div className="flex items-center gap-1 justify-end">
              <Star className="w-4 h-4 text-yellow-500 fill-current" />
              <span className="text-xl font-bold">{profile.rating.average.toFixed(1)}</span>
            </div>
            <p className="text-xs text-muted-foreground">{profile.rating.count} reviews</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg bg-muted p-1 w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setSelected(null); }}
            className={`px-5 py-2 text-sm font-medium rounded-md transition-all ${
              tab === key
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Pending",   value: stats.pending,   icon: Clock,         color: "text-yellow-500", iconBg: "bg-yellow-500/10", border: "border-l-yellow-500" },
              { label: "In Review", value: stats.inReview,  icon: ClipboardList, color: "text-blue-500",   iconBg: "bg-blue-500/10",   border: "border-l-blue-500" },
              { label: "Completed", value: stats.completed, icon: CheckCircle,   color: "text-green-500",  iconBg: "bg-green-500/10",  border: "border-l-green-500" },
              { label: "Patients",  value: stats.patients,  icon: Users,         color: "text-primary",    iconBg: "bg-primary/10",    border: "border-l-primary" },
            ].map(({ label, value, icon: Icon, color, iconBg, border }) => (
              <Card key={label} className={`p-6 hover:shadow-lg transition-shadow duration-200 border-l-4 ${border}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-3 ${iconBg} rounded-xl`}><Icon className={`w-6 h-6 ${color}`} /></div>
                  <span className="text-3xl font-bold text-foreground">{value}</span>
                </div>
                <h3 className="font-semibold text-foreground">{label}</h3>
              </Card>
            ))}
          </div>

          <Card className="shadow-lg border-t-4 border-t-blue-500">
            <CardHeader><CardTitle className="text-lg font-bold">Recent Consultations</CardTitle></CardHeader>
            <CardContent>
              {consultLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : consultations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No consultations yet.</p>
              ) : (
                <div className="space-y-2">
                  {consultations.slice(0, 6).map(c => (
                    <div
                      key={c._id}
                      onClick={() => { setTab("consultations"); setSelected(c); }}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold">
                          {c.patient.firstName[0]}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{c.patient.firstName} {c.patient.lastName}</p>
                          <p className="text-xs text-muted-foreground">Stage {c.report.stage} — {c.report.stageLabel}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${STATUS_COLORS[c.status]}`}>
                          {c.status.replace("_", " ")}
                        </span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Consultations ── */}
      {tab === "consultations" && (
        <div className="flex gap-4">
          {/* Left list */}
          <div className="w-72 shrink-0 space-y-3">
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v as StatusFilter); setSelected(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_review">In Review</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            {consultLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No consultations found.</p>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-310px)]">
                {filtered.map(c => (
                  <Card
                    key={c._id}
                    onClick={() => setSelected(c)}
                    className={`cursor-pointer border-l-4 transition-all hover:shadow-md ${selected?._id === c._id ? "ring-2 ring-primary" : ""}`}
                    style={{ borderLeftColor: STAGE_COLORS[c.report.stage] }}
                  >
                    <CardContent className="p-3 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-sm font-semibold truncate">{c.patient.firstName} {c.patient.lastName}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium capitalize shrink-0 ${STATUS_COLORS[c.status]}`}>
                          {c.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">Stage {c.report.stage} · {c.report.stageLabel}</p>
                      {/* Report ID — lets doctor distinguish multiple reports from same patient */}
                      <p className="text-xs font-mono text-muted-foreground/70">
                        Report&nbsp;
                        <span className="font-semibold tracking-wide" style={{ color: STAGE_COLORS[c.report.stage] }}>
                          #{c.report._id.slice(-6).toUpperCase()}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Right detail */}
          <div className="flex-1 min-w-0">
            {selected ? (
              <ConsultationDetail
                key={selected._id}
                consultation={selected}
                onUpdate={handleUpdate}
              />
            ) : (
              <div className="flex items-center justify-center h-64 border-2 border-dashed rounded-xl text-muted-foreground">
                <div className="text-center">
                  <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Select a consultation to review</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Appointments ── */}
      {tab === "appointments" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Patient Appointments
            </h2>
            <Button size="sm" variant="outline" onClick={loadAppointments} disabled={apptLoading}>
              {apptLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
            </Button>
          </div>

          {apptLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : appointments.length === 0 ? (
            <Card className="p-10 text-center border-dashed">
              <CalendarCheck className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">No appointments booked yet.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {appointments.map((appt) => {
                const statusColors: Record<string, string> = {
                  pending:   "bg-yellow-100 text-yellow-800 border-yellow-200",
                  confirmed: "bg-green-100 text-green-800 border-green-200",
                  cancelled: "bg-gray-100 text-gray-500 border-gray-200",
                  completed: "bg-blue-100 text-blue-800 border-blue-200",
                };
                const apptDate = new Date(appt.date);
                const isPast = apptDate < new Date();
                return (
                  <Card key={appt._id} className="p-4 flex items-start justify-between gap-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary font-semibold text-sm">
                        {appt.user?.firstName?.[0]}{appt.user?.lastName?.[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{appt.user?.firstName} {appt.user?.lastName}</p>
                        <p className="text-xs text-muted-foreground">{appt.user?.email}</p>
                        {appt.user?.phone && <p className="text-xs text-muted-foreground">{appt.user.phone}</p>}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-xs flex items-center gap-1 text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {apptDate.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            {isPast && appt.status === "pending" && <span className="text-orange-500 font-medium ml-1">(overdue)</span>}
                          </span>
                        </div>
                        <p className="text-xs mt-1"><span className="font-medium">Reason:</span> {appt.reason}</p>
                        {appt.notes && <p className="text-xs text-muted-foreground mt-0.5"><span className="font-medium">Notes:</span> {appt.notes}</p>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${statusColors[appt.status] ?? ""}`}>
                        {appt.status}
                      </span>
                      {appt.status === "pending" && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="gap-1 bg-green-600 hover:bg-green-700 text-white text-xs h-7 px-2"
                            onClick={() => handleConfirmAppointment(appt._id)}
                          >
                            <CheckCircle className="w-3 h-3" /> Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="gap-1 text-xs h-7 px-2"
                            onClick={() => handleRejectAppointment(appt._id)}
                          >
                            <XCircle className="w-3 h-3" /> Reject
                          </Button>
                        </div>
                      )}
                      {appt.status === "confirmed" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1 text-xs h-7 px-2"
                          onClick={() => handleRejectAppointment(appt._id)}
                        >
                          <XCircle className="w-3 h-3" /> Cancel
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Analytics ── */}
      {tab === "analytics" && (
        <div className="space-y-6">
          {analyticsLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : !analytics ? (
            <div className="text-center py-16 text-muted-foreground">
              <BarChart2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No analytics data available.</p>
            </div>
          ) : (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { label: "Total",      value: analytics.consultations.total,      color: "text-primary",    bg: "bg-primary/10",    border: "border-l-primary" },
                  { label: "Pending",    value: analytics.consultations.pending,    color: "text-yellow-500", bg: "bg-yellow-500/10", border: "border-l-yellow-500" },
                  { label: "In Review",  value: analytics.consultations.in_review,  color: "text-blue-500",   bg: "bg-blue-500/10",   border: "border-l-blue-500" },
                  { label: "Completed",  value: analytics.consultations.completed,  color: "text-green-500",  bg: "bg-green-500/10",  border: "border-l-green-500" },
                  { label: "Cancelled",  value: analytics.consultations.cancelled,  color: "text-gray-400",   bg: "bg-gray-400/10",   border: "border-l-gray-400" },
                ].map(({ label, value, color, bg, border }) => (
                  <Card key={label} className={`p-5 border-l-4 ${border}`}>
                    <div className={`inline-flex p-2 rounded-lg ${bg} mb-2`}>
                      <ClipboardList className={`w-5 h-5 ${color}`} />
                    </div>
                    <p className="text-2xl font-bold">{value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                  </Card>
                ))}
              </div>

              {/* Charts row */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Consultations over time */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">Consultations — Last 30 Days</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {analytics.consultationsOverTime.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-10">No data for the last 30 days.</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={analytics.consultationsOverTime} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                          <Tooltip
                            contentStyle={{ fontSize: 12, borderRadius: 8 }}
                            labelFormatter={(v) => new Date(v).toLocaleDateString()}
                          />
                          <Line
                            type="monotone"
                            dataKey="count"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            activeDot={{ r: 5 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                {/* Rating distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">
                      Rating Distribution
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        avg {analytics.rating.average.toFixed(1)} ★ ({analytics.rating.count} reviews)
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={analytics.rating.distribution} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="star" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}★`} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [v, "Reviews"]} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {analytics.rating.distribution.map((_, i) => (
                            <Cell key={i} fill={["#ef4444","#f97316","#eab308","#3b82f6","#10b981"][i]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Patient risk tiers */}
              {analytics.patientRiskTiers.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">Patient Risk Distribution</CardTitle>
                    <CardDescription>DR stage breakdown across all consultations</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={analytics.patientRiskTiers} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [v, "Patients"]} />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                          {analytics.patientRiskTiers.map((tier) => (
                            <Cell key={tier.stage} fill={STAGE_COLORS[tier.stage] ?? "#6b7280"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Profile ── */}
      {tab === "profile" && (
        <div className="grid md:grid-cols-2 gap-6">
          <Card className="shadow-lg border-t-4 border-t-blue-500">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-bold">Practice Information</CardTitle>
                {!editMode
                  ? (
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white gap-1"
                      onClick={() => setEditMode(true)}
                    >
                      Edit Profile
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
                      <Button size="sm" onClick={handleSaveProfile} disabled={saveLoading}
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
                      >
                        {saveLoading && <Loader2 className="w-3 h-3 animate-spin mr-1" />} Save Changes
                      </Button>
                    </div>
                  )
                }
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {editMode ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Specialization</Label>
                    <Select value={editSpec} onValueChange={setEditSpec}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Retina Specialist","Ophthalmologist","Optometrist","General Eye Care"].map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Years of Experience</Label>
                    <Input type="number" min="0" value={editExp} onChange={e => setEditExp(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                    <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+91-XXXXX-XXXXX" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contact Email <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                    <Input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="clinic@example.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Clinic Location (for map pin)</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5 shrink-0"
                        disabled={locLoading}
                        onClick={() => {
                          if (!navigator.geolocation) return;
                          setLocLoading(true);
                          navigator.geolocation.getCurrentPosition(
                            (pos) => {
                              // Store as [lng, lat] — GeoJSON convention
                              setEditCoords([pos.coords.longitude, pos.coords.latitude]);
                              setLocLoading(false);
                            },
                            () => setLocLoading(false),
                            { timeout: 10000 }
                          );
                        }}
                      >
                        {locLoading
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Navigation className="w-3.5 h-3.5" />
                        }
                        {editCoords ? "Update Location" : "Use My Location"}
                      </Button>
                      {editCoords && (
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                          ✓ {editCoords[1].toFixed(4)}, {editCoords[0].toFixed(4)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">This places a green pin on the Doctors map for patients to find you.</p>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  {[
                    { label: "Specialization", value: profile.specialization },
                    { label: "Experience",     value: `${profile.experience} years` },
                    { label: "License",        value: profile.licenseNumber },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-semibold">{value}</span>
                    </div>
                  ))}
                  <div className="pt-1 space-y-2">
                    {profile.contact?.phone ? (
                      <div className="flex items-center gap-2 text-sm"><Phone className="w-4 h-4 text-muted-foreground" /><span>{profile.contact.phone}</span></div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Phone className="w-4 h-4" /><span>No phone added</span></div>
                    )}
                    {profile.contact?.email ? (
                      <div className="flex items-center gap-2 text-sm"><Mail className="w-4 h-4 text-muted-foreground" /><span>{profile.contact.email}</span></div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Mail className="w-4 h-4" /><span>No contact email added</span></div>
                    )}
                    {profile.location?.coordinates?.length === 2 ? (
                      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                        <Navigation className="w-4 h-4 shrink-0" />
                        <span>Map pin set — {profile.location.coordinates[1].toFixed(4)}, {profile.location.coordinates[0].toFixed(4)}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Navigation className="w-4 h-4 shrink-0" />
                        <span>No map pin — edit profile to add location</span>
                      </div>
                    )}
                    {profile.location?.address?.formatted && (
                      <div className="flex items-center gap-2 text-sm"><MapPin className="w-4 h-4 text-muted-foreground shrink-0" /><span>{profile.location.address.formatted}</span></div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-lg border-t-4 border-t-green-500">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-bold">Weekly Availability</CardTitle>
                {!availEditMode ? (
                  <Button
                    size="sm"
                    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white gap-1"
                    onClick={() => setAvailEditMode(true)}
                  >
                    Edit Schedule
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setEditAvailability({ ...originalAvailability }); setAvailEditMode(false); }}
                    >
                      Revert
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveAvailability}
                      disabled={saveLoading}
                      className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white"
                    >
                      {saveLoading && <Loader2 className="w-3 h-3 animate-spin mr-1" />} Save
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {WEEK_DAYS.map(day => {
                  const slot = { available: false, start: "09:00", end: "17:00", ...(availEditMode ? editAvailability[day] : profile.availability?.[day]) };
                  const isAvailable = slot?.available ?? false;
                  return (
                    <div
                      key={day}
                      className={`px-4 py-3 rounded-xl border-2 transition-all ${
                        isAvailable
                          ? "bg-green-500/10 border-green-500/40"
                          : "bg-red-500/5 border-red-400/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {isAvailable
                            ? <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                            : <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                          }
                          <span className={`capitalize font-semibold text-sm ${isAvailable ? "text-foreground" : "text-muted-foreground"}`}>
                            {day}
                          </span>
                        </div>
                        {availEditMode ? (
                          <button
                            type="button"
                            onClick={() => toggleDayAvailability(day)}
                            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              isAvailable
                                ? "bg-red-500 hover:bg-red-600 text-white"
                                : "bg-green-500 hover:bg-green-600 text-white"
                            }`}
                          >
                            {isAvailable ? "Mark Off" : "Mark On"}
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            {isAvailable && (
                              <span className="text-xs text-muted-foreground font-medium">
                                {slot?.start} – {slot?.end}
                              </span>
                            )}
                            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
                              isAvailable
                                ? "bg-green-500/20 text-green-600 dark:text-green-400"
                                : "bg-red-500/10 text-red-400"
                            }`}>
                              {isAvailable ? "Available" : "Off"}
                            </span>
                          </div>
                        )}
                      </div>
                      {availEditMode && isAvailable && (
                        <div className="flex items-center gap-3 mt-2 pl-8">
                          <label className="text-xs text-muted-foreground">From</label>
                          <input
                            type="time"
                            value={slot?.start ?? "09:00"}
                            onChange={e => updateSlotTime(day, "start", e.target.value)}
                            className="text-xs bg-background border border-border rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <label className="text-xs text-muted-foreground">To</label>
                          <input
                            type="time"
                            value={slot?.end ?? "17:00"}
                            onChange={e => updateSlotTime(day, "end", e.target.value)}
                            className="text-xs bg-background border border-border rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
