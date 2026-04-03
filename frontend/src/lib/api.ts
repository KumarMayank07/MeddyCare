import type { User, AuthResponse, Doctor, Report, Consultation, Appointment, Reminder, Pagination } from "@/types";

const API_BASE_URL     = import.meta.env.VITE_API_BASE_URL as string;
const RAG_API_BASE_URL = import.meta.env.VITE_RAG_API_BASE_URL as string;

// ─── Request config ───────────────────────────────────────────────────────────
const REQUEST_TIMEOUT_MS    = 30_000;
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BASE_DELAY_MS   = 1_000; // 1s → 2s → 4s (exponential)

/** Status codes that warrant an automatic retry (transient server errors). */
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504, 429]);

/** Auth endpoints that must never trigger a token-refresh retry. */
const AUTH_SKIP_REFRESH = ["/auth/refresh", "/auth/login", "/auth/logout"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === "Failed to fetch") return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}

function backoffDelay(attempt: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function parseErrorMsg(response: Response, prefix?: string): Promise<string> {
  const data = await response.json().catch(() => ({}));
  return (
    data.detail ||
    data.error ||
    (Array.isArray(data.errors) && data.errors.length > 0
      ? data.errors.map((e: { msg: string }) => e.msg).join(". ")
      : null) ||
    `${prefix ?? "HTTP"} error ${response.status}`
  );
}

// ─── ApiService ───────────────────────────────────────────────────────────────

class ApiService {
  private token: string | null;
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.token = localStorage.getItem("token");
  }

  private getHeaders(extra: HeadersInit = {}): HeadersInit {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(extra as Record<string, string>),
    };
    const currentToken = this.token ?? localStorage.getItem("token");
    if (currentToken) headers["Authorization"] = `Bearer ${currentToken}`;
    return headers;
  }

  /**
   * Executes a fetch with automatic retry on transient errors (network failures,
   * 502/503/504/429). Returns the raw Response so the caller can inspect status.
   */
  private async _fetchWithRetry(url: string, config: RequestInit): Promise<Response> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      if (attempt > 0) await backoffDelay(attempt - 1);

      let response: Response;
      try {
        response = await fetchWithTimeout(url, config);
      } catch (fetchErr) {
        if (isTransientError(fetchErr) && attempt < MAX_TRANSIENT_RETRIES) {
          lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
          continue;
        }
        throw fetchErr;
      }

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_TRANSIENT_RETRIES) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      return response; // success or non-retryable error — caller decides
    }
    throw lastError ?? new Error("Request failed after retries");
  }

  /**
   * Main API request (Node.js backend).
   * Handles 401 auto-refresh and 403 suspension.
   */
  private async request<T>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
    const url    = `${API_BASE_URL}${endpoint}`;
    const config = { ...options, headers: this.getHeaders(options.headers) };

    const response = await this._fetchWithRetry(url, config);

    // ── 401: attempt token refresh (once, never for auth endpoints) ───────────
    if (
      response.status === 401 &&
      !isRetry &&
      AUTH_SKIP_REFRESH.every(path => !endpoint.includes(path))
    ) {
      try {
        const newToken = await this.refreshToken();
        const retryHeaders = {
          ...(options.headers ?? {}),
          "Content-Type": "application/json",
          Authorization: `Bearer ${newToken}`,
        };
        const retryResponse = await fetchWithTimeout(url, { ...options, headers: retryHeaders });
        if (!retryResponse.ok) throw new Error(await parseErrorMsg(retryResponse));
        return retryResponse.json() as Promise<T>;
      } catch {
        window.dispatchEvent(new CustomEvent("auth-expired"));
        throw new Error("Session expired. Please log in again.");
      }
    }

    // ── 403: check for account suspension ────────────────────────────────────
    if (response.status === 403) {
      const data = await response.json().catch(() => ({}));
      if (typeof data.error === "string" && data.error.toLowerCase().includes("suspended")) {
        window.dispatchEvent(new CustomEvent("auth-expired"));
        throw new Error(data.error);
      }
    }

    if (!response.ok) throw new Error(await parseErrorMsg(response));
    return response.json() as Promise<T>;
  }

  /**
   * RAG service request (Python FastAPI backend).
   * Same retry logic; errors use `detail` field (FastAPI default).
   */
  private async ragRequest<T>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
    const url    = `${RAG_API_BASE_URL}${endpoint}`;
    const config = { ...options, headers: this.getHeaders(options.headers) };

    const response = await this._fetchWithRetry(url, config);

    if (response.status === 401 && !isRetry) {
      try {
        const newToken = await this.refreshToken();
        const retryHeaders = {
          ...(options.headers ?? {}),
          "Content-Type": "application/json",
          Authorization: `Bearer ${newToken}`,
        };
        const retryResponse = await fetchWithTimeout(url, { ...options, headers: retryHeaders });
        if (!retryResponse.ok) throw new Error(await parseErrorMsg(retryResponse, "RAG"));
        return retryResponse.json() as Promise<T>;
      } catch {
        window.dispatchEvent(new CustomEvent("auth-expired"));
        throw new Error("Session expired. Please log in again.");
      }
    }

    if (!response.ok) throw new Error(await parseErrorMsg(response, "RAG"));
    return response.json() as Promise<T>;
  }

  /** Deduplicated token refresh — concurrent callers share the same promise. */
  private async refreshToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const response = await this.request<AuthResponse>("/auth/refresh", { method: "POST" }, true);
      this.setToken(response.token);
      localStorage.setItem("user", JSON.stringify(response.user));
      return response.token;
    })().finally(() => { this.refreshPromise = null; });

    return this.refreshPromise;
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async login(email: string, password: string, role?: string): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, role }),
    });
    this.setToken(response.token);
    localStorage.setItem("user", JSON.stringify(response.user));
    return response;
  }

  async register(userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role?: string;
    phone?: string;
    dateOfBirth?: string;
    gender?: string;
  }): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(userData),
    });
    this.setToken(response.token);
    localStorage.setItem("user", JSON.stringify(response.user));
    return response;
  }

  async registerDoctor(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    specialization: string;
    licenseNumber: string;
    experience: number;
    city?: string;
    state?: string;
    country?: string;
    lat?: number;
    lng?: number;
  }): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>("/auth/register-doctor", {
      method: "POST",
      body: JSON.stringify(data),
    });
    this.setToken(response.token);
    localStorage.setItem("user", JSON.stringify(response.user));
    return response;
  }

  async adminLogin(email: string, password: string): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>("/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.setToken(response.token);
    localStorage.setItem("user", JSON.stringify(response.user));
    return response;
  }

  async verifyEmail(token: string) {
    return this.request<{ message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`);
  }

  async resendVerification() {
    return this.request<{ message: string }>("/auth/resend-verification", { method: "POST" });
  }

  async logout() {
    try {
      await this.request("/auth/logout", { method: "POST" });
    } finally {
      this.clearToken();
      localStorage.removeItem("user");
    }
  }

  async getCurrentUser() {
    return this.request<{ user: User }>("/auth/me");
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  async updateProfile(profileData: Partial<User>) {
    return this.request<{ user: User; message: string }>("/users/profile", {
      method: "PUT",
      body: JSON.stringify(profileData),
    });
  }

  async uploadImage(file: File): Promise<{ secure_url: string; publicId: string; width: number; height: number }> {
    const formData = new FormData();
    formData.append("image", file);
    const token = this.token ?? localStorage.getItem("token");
    if (!token) throw new Error("Not authenticated");

    const response = await fetch(`${API_BASE_URL}/upload/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) throw new Error(await parseErrorMsg(response));
    return response.json();
  }

  async uploadProfileImage(file: File): Promise<{ secure_url: string; publicId: string }> {
    const formData = new FormData();
    formData.append("image", file);
    const token = this.token ?? localStorage.getItem("token");
    if (!token) throw new Error("Not authenticated");

    const response = await fetch(`${API_BASE_URL}/upload/profile-image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) throw new Error(await parseErrorMsg(response));
    return response.json();
  }

  // ─── Doctors ──────────────────────────────────────────────────────────────

  async getNearbyDoctors(lat: number, lng: number, maxDistance = 50, specialization?: string) {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), maxDistance: String(maxDistance) });
    if (specialization) params.append("specialization", specialization);
    return this.request<{ doctors: Doctor[]; count: number }>(`/doctors/nearby?${params}`);
  }

  async getAllDoctors(filters: { specialization?: string; city?: string; rating?: number; limit?: number; page?: number } = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v !== undefined) params.append(k, String(v)); });
    return this.request<{ doctors: Doctor[]; pagination: Pagination }>(`/doctors?${params}`);
  }

  async getDoctorById(id: string) {
    return this.request<{ doctor: Doctor }>(`/doctors/${id}`);
  }

  async createDoctorProfile(doctorData: Partial<Doctor>) {
    return this.request<{ doctor: Doctor; message: string }>("/doctors", {
      method: "POST",
      body: JSON.stringify(doctorData),
    });
  }

  async getDoctorProfile() {
    return this.request<{ doctor: Doctor }>("/doctors/me");
  }

  async updateDoctorProfile(id: string, data: Partial<Doctor>) {
    return this.request<{ doctor: Doctor; message: string }>(`/doctors/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getDoctorAnalytics() {
    return this.request<{
      consultations: { total: number; pending: number; in_review: number; completed: number; cancelled: number };
      consultationsOverTime: { date: string; count: number }[];
      rating: { average: number; count: number; distribution: { star: number; count: number }[] };
      patientRiskTiers: { stage: number; label: string; count: number }[];
    }>("/doctors/analytics");
  }

  async getDoctorSlots(doctorId: string, date: string) {
    return this.request<{ slots: string[]; available: boolean }>(`/doctors/${doctorId}/slots?date=${date}`);
  }

  async addDoctorReview(doctorId: string, review: { rating: number; comment?: string }) {
    return this.request<{ doctor: Doctor; message: string }>(`/doctors/${doctorId}/reviews`, {
      method: "POST",
      body: JSON.stringify(review),
    });
  }

  // ─── Appointments ─────────────────────────────────────────────────────────

  async bookAppointment(data: { doctorId: string; date: string; reason: string; notes?: string }) {
    return this.request<{ appointment: Appointment; message: string }>("/appointments", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getAppointments() {
    return this.request<{ appointments: Appointment[] }>("/appointments");
  }

  async cancelAppointment(id: string) {
    return this.request<{ appointment: Appointment; message: string }>(`/appointments/${id}/cancel`, { method: "PATCH" });
  }

  async getDoctorAppointments() {
    return this.request<{ appointments: Appointment[] }>("/appointments/doctor");
  }

  async confirmAppointment(id: string) {
    return this.request<{ appointment: Appointment; message: string }>(`/appointments/${id}/confirm`, { method: "PATCH" });
  }

  async rejectAppointment(id: string) {
    return this.request<{ appointment: Appointment; message: string }>(`/appointments/${id}/reject`, { method: "PATCH" });
  }

  // ─── Consultations ────────────────────────────────────────────────────────

  async createConsultation(data: { doctorId: string; reportId: string; patientMessage?: string }) {
    return this.request<{ consultation: Consultation; message: string }>("/consultations", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getMyConsultations(status?: string) {
    const qs = status ? `?status=${status}` : "";
    return this.request<{ consultations: Consultation[] }>(`/consultations${qs}`);
  }

  async getDoctorConsultations(status?: string) {
    const qs = status ? `?status=${status}` : "";
    return this.request<{ consultations: Consultation[] }>(`/consultations/doctor${qs}`);
  }

  async getConsultation(id: string) {
    return this.request<{ consultation: Consultation }>(`/consultations/${id}`);
  }

  async updateConsultationStatus(id: string, status: string) {
    return this.request<{ consultation: Consultation; message: string }>(`/consultations/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  async submitDiagnosis(id: string, data: {
    diagnosis: { findings: string; severity: string; recommendations?: string };
    prescription?: { medications?: { name: string; dosage: string; frequency: string; duration: string }[]; instructions?: string; followUpDate?: string };
    doctorNotes?: string;
  }) {
    return this.request<{ consultation: Consultation; message: string }>(`/consultations/${id}/diagnose`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async getConsultationMessages(id: string, params: { limit?: number; before?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.limit)  qs.append("limit",  String(params.limit));
    if (params.before) qs.append("before", params.before);
    const query = qs.toString() ? `?${qs}` : "";
    return this.request<{ messages: Record<string, unknown>[]; count: number }>(`/consultations/${id}/messages${query}`);
  }

  async sendConsultationMessage(id: string, text: string) {
    return this.request<{ data: Record<string, unknown>; message: string }>(`/consultations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

  async getReports() {
    return this.request<{ reports: Report[] }>("/reports");
  }

  async analyzeReport(data: { imageUrl: string; publicId: string }) {
    return this.request<{ report: Report }>("/reports/analyze", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ─── Reminders ────────────────────────────────────────────────────────────

  async getReminders() {
    return this.request<{ reminders: Reminder[] }>("/reminders");
  }

  async createReminder(data: { title: string; description?: string; reminderType: string; scheduledAt: string }) {
    return this.request<{ reminder: Reminder; message: string }>("/reminders", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async completeReminder(id: string) {
    return this.request<{ reminder: Reminder; message: string }>(`/reminders/${id}/complete`, { method: "PATCH" });
  }

  async deleteReminder(id: string) {
    return this.request<{ message: string }>(`/reminders/${id}`, { method: "DELETE" });
  }

  // ─── RAG Chat ─────────────────────────────────────────────────────────────

  async ragSendMessage(message: string, chatId?: string) {
    return this.ragRequest<{ answer: string; sources: unknown[]; suggestions: string[]; chat_id: string }>(
      "/chat",
      { method: "POST", body: JSON.stringify({ message, chat_id: chatId, top_k: 5 }) }
    );
  }

  async ragGetChats() {
    return this.ragRequest<{ chats: { id: string; title?: string; created_at: string; updated_at: string; archived?: boolean }[] }>("/chats");
  }

  async ragGetMessages(chatId: string) {
    return this.ragRequest<{ messages: { role: string; text: string; timestamp: string; meta?: Record<string, unknown> }[] }>(
      `/chats/${encodeURIComponent(chatId)}/messages`
    );
  }

  async ragDeleteChat(chatId: string) {
    return this.ragRequest<{ message: string }>(`/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
  }

  async ragRenameChat(chatId: string, newTitle: string) {
    return this.ragRequest<{ message: string }>(`/chats/${encodeURIComponent(chatId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title: newTitle }),
    });
  }

  async ragArchiveChat(chatId: string, archived = true) {
    return this.ragRequest<{ message: string }>(`/chats/${encodeURIComponent(chatId)}`, {
      method: "PATCH",
      body: JSON.stringify({ archived }),
    });
  }

  async ragShareChat(chatId: string) {
    return this.ragRequest<{ shareUrl: string; token: string; expires_at: string }>(
      `/chats/${encodeURIComponent(chatId)}/share`,
      { method: "POST" }
    );
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  async getAdminStats() {
    return this.request<Record<string, unknown>>("/admin/stats");
  }

  async getAdminAnalytics() {
    return this.request<Record<string, unknown>>("/admin/analytics");
  }

  async getAdminUsers(params: { page?: number; limit?: number; role?: string; search?: string } = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) qs.append(k, String(v)); });
    return this.request<{ users: User[]; total: number; page: number; totalPages: number }>(`/admin/users?${qs}`);
  }

  async suspendUser(id: string, isSuspended: boolean) {
    return this.request<{ message: string }>(`/admin/users/${id}/suspend`, {
      method: "PATCH",
      body: JSON.stringify({ isSuspended }),
    });
  }

  async getAdminDoctors(params: { search?: string; page?: number; limit?: number } = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) qs.append(k, String(v)); });
    return this.request<{ doctors: Doctor[]; total: number; page: number }>(`/admin/doctors?${qs}`);
  }

  async verifyDoctor(id: string, isVerified: boolean) {
    return this.request<{ message: string }>(`/admin/doctors/${id}/verify`, {
      method: "PATCH",
      body: JSON.stringify({ isVerified }),
    });
  }

  async createAdmin(data: { email: string; password: string; firstName: string; lastName: string }) {
    return this.request<{ user: User; message: string }>("/admin/create-admin", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getAuditLogs(params: { page?: number; limit?: number; action?: string } = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) qs.append(k, String(v)); });
    return this.request<{ logs: Record<string, unknown>[]; total: number; page: number }>(`/admin/audit-logs?${qs}`);
  }

  // ─── Token management ─────────────────────────────────────────────────────

  isAuthenticated(): boolean {
    return !!this.token;
  }

  getToken(): string | null {
    return this.token ?? localStorage.getItem("token");
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem("token", token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem("token");
  }
}

export const apiService = new ApiService();
export default apiService;
