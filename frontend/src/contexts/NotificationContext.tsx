import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useSocket } from "@/hooks/use-socket";
import { useAuth } from "@/contexts/AuthContext";

export interface AppNotification {
  id: string;
  type: "appointment" | "consultation" | "info";
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  setActiveConsultation: (id: string | null) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
  dismiss: () => {},
  clearAll: () => {},
  setActiveConsultation: () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const { socket } = useSocket();
  const { user } = useAuth();
  const counterRef = useRef(0);
  const role = user?.role ?? "user";
  const activeConsultationRef = useRef<string | null>(null);

  const setActiveConsultation = (id: string | null) => {
    activeConsultationRef.current = id;
  };

  function add(n: Omit<AppNotification, "id" | "timestamp" | "read">) {
    const id = `notif-${Date.now()}-${++counterRef.current}`;
    setNotifications(prev => [{ ...n, id, timestamp: new Date(), read: false }, ...prev].slice(0, 50));
  }

  useEffect(() => {
    if (!socket) return;

    // ── appointment_updated: sent to patient when doctor confirms/rejects/cancels ──
    const onAppointmentUpdated = (payload: { appointmentId: string; status: string; doctorName?: string; patientName?: string }) => {
      if (role === "doctor") {
        const who = payload.patientName ? `${payload.patientName}` : "A patient";
        if (payload.status === "cancelled") {
          add({ type: "appointment", title: "Appointment Cancelled", message: `${who} has cancelled their appointment.` });
        }
        return;
      }
      // Patient perspective
      const by = payload.doctorName ?? "the doctor";
      const statusMap: Record<string, { title: string; message: string }> = {
        confirmed: { title: "Appointment Confirmed ✓", message: `Your appointment has been confirmed by ${by}.` },
        cancelled: { title: "Appointment Declined",    message: `Your appointment was declined by ${by}.` },
      };
      const info = statusMap[payload.status];
      if (info) add({ type: "appointment", ...info });
    };

    // ── new_appointment: sent to doctor when patient books ──
    const onNewAppointment = (payload: { appointmentId: string; patientName?: string }) => {
      if (role !== "doctor") return;
      const who = payload.patientName ?? "A patient";
      add({ type: "appointment", title: "New Appointment Request", message: `${who} has booked an appointment with you.` });
    };

    // ── new_consultation: sent to doctor when patient requests ──
    const onNewConsultation = (payload: { consultationId: string; patientName?: string }) => {
      if (role !== "doctor") return;
      const who = payload.patientName ?? "A patient";
      add({ type: "consultation", title: "New Consultation Request", message: `${who} has requested a consultation for their retina report.` });
    };

    // ── message_notification: sent only to the recipient's personal room ──
    // Distinct from 'message_received' (which goes to the room) to avoid duplicates.
    const onMessageReceived = (payload: { consultationId: string; senderName?: string; message: { senderRole: string; text?: string } }) => {
      // Suppress bell if the user is actively viewing this consultation
      if (activeConsultationRef.current === payload.consultationId) return;
      const { senderRole, text } = payload.message;
      const preview = text ? `"${text.length > 60 ? text.slice(0, 60) + "…" : text}"` : null;
      if (role === "user" && senderRole === "doctor") {
        const name = payload.senderName ?? "Your doctor";
        add({
          type: "consultation",
          title: `Message from ${name}`,
          message: preview ?? `${name} sent you a message in your consultation.`,
        });
      } else if (role === "doctor" && senderRole === "patient") {
        const name = payload.senderName ?? "A patient";
        add({
          type: "consultation",
          title: `Message from ${name}`,
          message: preview ?? `${name} sent you a message.`,
        });
      }
    };

    // ── account_suspended / account_unsuspended: sent by admin ──
    const onAccountSuspended = () => {
      add({ type: "info", title: "Account Suspended", message: "Your account has been suspended by an administrator. Contact support if you believe this is a mistake." });
    };

    const onAccountUnsuspended = () => {
      add({ type: "info", title: "Account Reinstated", message: "Your account suspension has been lifted. You now have full access again." });
    };

    // ── profile_updated: sent to doctor when admin verifies / unverifies ──
    const onProfileUpdated = (payload: { isVerified?: boolean }) => {
      if (role !== "doctor") return;
      if (payload.isVerified === true) {
        add({ type: "info", title: "Account Verified ✓", message: "Your doctor profile has been verified by an administrator. You can now receive consultations and appointments." });
      } else if (payload.isVerified === false) {
        add({ type: "info", title: "Verification Removed", message: "Your doctor verification has been revoked by an administrator. Contact support for more information." });
      }
    };

    // ── consultation_updated: broadcast to the whole room (both parties receive it) ──
    const onConsultationUpdated = (payload: { consultationId: string; status: string; followUpDate?: string; doctorName?: string }) => {
      if (role === "doctor") {
        // Doctor triggered in_review / completed themselves — skip self-echo
        // Only notify if patient cancelled
        if (payload.status === "cancelled") {
          add({ type: "consultation", title: "Consultation Cancelled", message: "A patient has cancelled their consultation request." });
        }
        return;
      }
      // Patient perspective
      const by = payload.doctorName ?? "your doctor";
      if (payload.status === "completed") {
        const followUpLine = payload.followUpDate
          ? ` Follow-up scheduled for ${new Date(payload.followUpDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.`
          : "";
        add({ type: "consultation", title: "Consultation Completed ✓", message: `${by} has completed your consultation. Check the diagnosis in your reports.${followUpLine}` });
        return;
      }
      const statusMap: Record<string, { title: string; message: string }> = {
        in_review: { title: "Consultation In Review",  message: `${by} is now reviewing your retina report.` },
        cancelled: { title: "Consultation Cancelled",  message: `Your consultation was cancelled by ${by}.` },
      };
      const info = statusMap[payload.status];
      if (info) add({ type: "consultation", ...info });
    };

    socket.on("appointment_updated",   onAppointmentUpdated);
    socket.on("new_appointment",       onNewAppointment);
    socket.on("new_consultation",      onNewConsultation);
    socket.on("consultation_updated",  onConsultationUpdated);
    socket.on("message_notification",  onMessageReceived);
    socket.on("account_suspended",     onAccountSuspended);
    socket.on("account_unsuspended",   onAccountUnsuspended);
    socket.on("profile_updated",       onProfileUpdated);

    return () => {
      socket.off("appointment_updated",  onAppointmentUpdated);
      socket.off("new_appointment",      onNewAppointment);
      socket.off("new_consultation",     onNewConsultation);
      socket.off("consultation_updated", onConsultationUpdated);
      socket.off("message_notification", onMessageReceived);
      socket.off("account_suspended",    onAccountSuspended);
      socket.off("account_unsuspended",  onAccountUnsuspended);
      socket.off("profile_updated",      onProfileUpdated);
    };
  }, [socket, role]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  const dismiss = (id: string) => setNotifications(prev => prev.filter(n => n.id !== id));
  const clearAll = () => setNotifications([]);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAllRead, dismiss, clearAll, setActiveConsultation }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
