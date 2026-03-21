const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const RAG_API_BASE_URL = import.meta.env.VITE_RAG_API_BASE_URL;


const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

// ── Retry configuration for transient errors ────────────────────────────────
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1_000; // 1s → 2s → 4s (exponential)

/** HTTP status codes that indicate a transient (retryable) server error. */
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504, 429]);

/** Returns true if this error looks like a transient network failure. */
function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === "Failed to fetch") return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}

/** Sleep with exponential backoff: attempt 0 → 1s, 1 → 2s, 2 → 4s */
function backoffDelay(attempt: number): Promise<void> {
  const ms = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wraps a fetch call with an AbortController timeout. */
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

class ApiService {
  private baseURL: string;
  private token: string | null;
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.baseURL = API_BASE_URL;
    this.token = localStorage.getItem("token"); // initialize from storage
  }

  private getHeaders(extra: HeadersInit = {}): HeadersInit {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...extra,
    };
    const currentToken = this.token || localStorage.getItem("token");
    if (currentToken) {
      headers["Authorization"] = `Bearer ${currentToken}`;
    }
    return headers;
  }

  /**
   * Core request method with:
   *  - 401 auto-refresh (single retry)
   *  - 403 "suspended" → force logout
   *  - Transient error retry with exponential backoff (502, 503, 504, 429, network failures)
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    isRetry = false
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const config: RequestInit = {
      ...options,
      headers: this.getHeaders(options.headers || {}),
    };

    // ── Retry loop for transient errors ──────────────────────────────────
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      if (attempt > 0) {
        await backoffDelay(attempt - 1);
      }

      let response: Response;
      try {
        response = await fetchWithTimeout(url, config);
      } catch (fetchErr) {
        // Network error / timeout — retry if transient
        if (isTransientError(fetchErr) && attempt < MAX_TRANSIENT_RETRIES) {
          lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
          continue;
        }
        throw fetchErr;
      }

      // ── Transient server errors → retry ──────────────────────────────
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_TRANSIENT_RETRIES) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      // ── Auto-refresh on 401, but never retry the refresh/login/logout endpoints
      if (
        response.status === 401 &&
        !isRetry &&
        !endpoint.includes("/auth/refresh") &&
        !endpoint.includes("/auth/login") &&
        !endpoint.includes("/auth/logout")
      ) {
        try {
          const newToken = await this.refreshToken();
          const retryConfig: RequestInit = {
            ...options,
            headers: {
              ...(options.headers || {}),
              "Content-Type": "application/json",
              Authorization: `Bearer ${newToken}`,
            },
          };
          const retryResponse = await fetchWithTimeout(url, retryConfig);
          if (!retryResponse.ok) {
            const errData = await retryResponse.json().catch(() => ({}));
            throw new Error(errData.error || (Array.isArray(errData.errors) && errData.errors.length > 0 ? errData.errors.map((e: { msg: string }) => e.msg).join(". ") : null) || `HTTP error! status: ${retryResponse.status}`);
          }
          return retryResponse.json();
        } catch {
          window.dispatchEvent(new CustomEvent("auth-expired"));
          throw new Error("Session expired. Please log in again.");
        }
      }

      // 403 with "suspended" message → force logout immediately
      if (response.status === 403) {
        const errorData = await response.json().catch(() => ({}));
        if (typeof errorData.error === "string" && errorData.error.toLowerCase().includes("suspended")) {
          window.dispatchEvent(new CustomEvent("auth-expired"));
          throw new Error(errorData.error);
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message =
          errorData.error ||
          (Array.isArray(errorData.errors) && errorData.errors.length > 0
            ? errorData.errors.map((e: { msg: string }) => e.msg).join(". ")
            : null) ||
          `HTTP error! status: ${response.status}`;
        throw new Error(message);
      }
      return response.json();
    }

    // All retries exhausted
    throw lastError || new Error("Request failed after retries");
  }

  /**
   * Shared request helper for the RAG service — same retry + 401/token-refresh logic.
   */
  private async ragRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    isRetry = false
  ): Promise<T> {
    const url = `${RAG_API_BASE_URL}${endpoint}`;
    const config: RequestInit = {
      ...options,
      headers: this.getHeaders(options.headers || {}),
    };

    // ── Retry loop for transient errors ──────────────────────────────────
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      if (attempt > 0) {
        await backoffDelay(attempt - 1);
      }

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

      // ── Transient server errors → retry ──────────────────────────────
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_TRANSIENT_RETRIES) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      if (response.status === 401 && !isRetry) {
        try {
          const newToken = await this.refreshToken();
          const retryConfig: RequestInit = {
            ...options,
            headers: {
              ...(options.headers || {}),
              "Content-Type": "application/json",
              Authorization: `Bearer ${newToken}`,
            },
          };
          const retryResponse = await fetchWithTimeout(url, retryConfig);
          if (!retryResponse.ok) {
            const errData = await retryResponse.json().catch(() => ({}));
            throw new Error(errData.detail || errData.error || `RAG error: ${retryResponse.status}`);
          }
          return retryResponse.json();
        } catch {
          window.dispatchEvent(new CustomEvent("auth-expired"));
          throw new Error("Session expired. Please log in again.");
        }
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || `RAG error: ${response.status}`);
      }
      return response.json();
    }

    // All retries exhausted
    throw lastError || new Error("RAG request failed after retries");
  }

  // Deduplicated token refresh — concurrent callers share the same promise
  private async refreshToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const response = await this.request<{ token: string; user: any }>(
        "/auth/refresh",
        { method: "POST" },
        true
      );
      this.setToken(response.token);
      localStorage.setItem("user", JSON.stringify(response.user));
      return response.token;
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  // Authentication methods

  async login(email: string, password: string, role?: string) {
    const response = await this.request<{
      token: string;
      user: any;
      message: string;
    }>("/auth/login", {
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
  }) {
    const response = await this.request<{
      token: string;
      user: any;
      message: string;
    }>("/auth/register", {
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
  }) {
    const response = await this.request<{ token: string; user: any; message: string }>(
      "/auth/register-doctor",
      { method: "POST", body: JSON.stringify(data) }
    );
    this.setToken(response.token);
    localStorage.setItem("user", JSON.stringify(response.user));
    return response;
  }

  async verifyEmail(token: string) {
    return await this.request<{ message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`);
  }

  async resendVerification() {
    return await this.request<{ message: string }>("/auth/resend-verification", { method: "POST" });
  }

  async adminLogin(email: string, password: string) {
    const response = await this.request<{
      token: string;
      user: any;
      message: string;
    }>("/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    this.setToken(response.token);
    localStorage.setItem("user", JSON.stringify(response.user));

    return response;
  }

  async logout() {
    try {
      await this.request("/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      this.clearToken();
      localStorage.removeItem("user");
    }
  }

  async getCurrentUser() {
    return await this.request<{ user: any }>("/auth/me");
  }

  // User profile methods

  async updateProfile(profileData: any) {
    return await this.request<{ user: any; message: string }>(
      "/users/profile",
      {
        method: "PUT",
        body: JSON.stringify(profileData),
      }
    );
  }

  // Doctor methods

  async getNearbyDoctors(
    lat: number,
    lng: number,
    maxDistance = 50,
    specialization?: string
  ) {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lng: lng.toString(),
      maxDistance: maxDistance.toString(),
    });
    if (specialization) params.append("specialization", specialization);

    return await this.request<{ doctors: any[]; count: number }>(
      `/doctors/nearby?${params}`
    );
  }

  async getAllDoctors(
    filters: {
      specialization?: string;
      city?: string;
      rating?: number;
      limit?: number;
      page?: number;
    } = {}
  ) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined) params.append(key, value.toString());
    });

    return await this.request<{ doctors: any[]; pagination: any }>(
      `/doctors?${params}`
    );
  }

  async getDoctorById(id: string) {
    return await this.request<{ doctor: any }>(`/doctors/${id}`);
  }

  async createDoctorProfile(doctorData: any) {
    return await this.request<{ doctor: any; message: string }>("/doctors", {
      method: "POST",
      body: JSON.stringify(doctorData),
    });
  }

  async getDoctorProfile() {
    return await this.request<{ doctor: any }>("/doctors/me");
  }

  async updateDoctorProfile(id: string, data: { specialization?: string; experience?: number; contact?: { phone?: string; email?: string } }) {
    return await this.request<{ doctor: any; message: string }>(`/doctors/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getDoctorAnalytics() {
    return await this.request<{
      consultations: { total: number; pending: number; in_review: number; completed: number; cancelled: number };
      consultationsOverTime: { date: string; count: number }[];
      rating: { average: number; count: number; distribution: { star: number; count: number }[] };
      patientRiskTiers: { stage: number; label: string; count: number }[];
    }>('/doctors/analytics');
  }

  async getDoctorSlots(doctorId: string, date: string) {
    return await this.request<{ slots: string[]; available: boolean }>(`/doctors/${doctorId}/slots?date=${date}`);
  }

  async addDoctorReview(
    doctorId: string,
    review: { rating: number; comment?: string }
  ) {
    return await this.request<{ doctor: any; message: string }>(
      `/doctors/${doctorId}/reviews`,
      {
        method: "POST",
        body: JSON.stringify(review),
      }
    );
  }

  // Upload methods

  async uploadImage(file: File) {
    const formData = new FormData();
    formData.append("image", file);

    const currentToken = this.token || localStorage.getItem("token");
    if (!currentToken) throw new Error("Not authenticated");

    const url = `${API_BASE_URL}/upload/image`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${currentToken}` },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return await response.json();
  }

  async uploadProfileImage(file: File) {
    const formData = new FormData();
    formData.append("image", file);

    const currentToken = this.token || localStorage.getItem("token");
    if (!currentToken) throw new Error("Not authenticated");

    const url = `${API_BASE_URL}/upload/profile-image`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${currentToken}` },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }
    return await response.json();
  }

  // Utility methods

  isAuthenticated(): boolean {
    return !!this.token;
  }

  getToken(): string | null {
    return this.token || localStorage.getItem("token");
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem("token", token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem("token");
  }

  // Report methods

  async getReports() {
    return await this.request<{ reports: any[] }>("/reports");
  }

  async analyzeReport(data: { imageUrl: string; publicId: string }) {
    return await this.request<{ report: any }>("/reports/analyze", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Reminder methods

  async getReminders() {
    return await this.request<{ reminders: any[] }>("/reminders");
  }

  async createReminder(data: { title: string; description?: string; reminderType: string; scheduledAt: string }) {
    return await this.request<{ reminder: any; message: string }>("/reminders", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async completeReminder(id: string) {
    return await this.request<{ reminder: any; message: string }>(`/reminders/${id}/complete`, {
      method: "PATCH",
    });
  }

  async deleteReminder(id: string) {
    return await this.request<{ message: string }>(`/reminders/${id}`, {
      method: "DELETE",
    });
  }

  // Appointment methods

  async bookAppointment(data: { doctorId: string; date: string; reason: string; notes?: string }) {
    return await this.request<{ appointment: any; message: string }>("/appointments", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getAppointments() {
    return await this.request<{ appointments: any[] }>("/appointments");
  }

  async cancelAppointment(id: string) {
    return await this.request<{ appointment: any; message: string }>(`/appointments/${id}/cancel`, {
      method: "PATCH",
    });
  }

  async getDoctorAppointments() {
    return await this.request<{ appointments: any[] }>("/appointments/doctor");
  }

  async confirmAppointment(id: string) {
    return await this.request<{ appointment: any; message: string }>(`/appointments/${id}/confirm`, {
      method: "PATCH",
    });
  }

  async rejectAppointment(id: string) {
    return await this.request<{ appointment: any; message: string }>(`/appointments/${id}/reject`, {
      method: "PATCH",
    });
  }

  // RAG Chat methods

  async ragSendMessage(message: string, chatId?: string) {
    return this.ragRequest<any>("/chat", {
      method: "POST",
      body: JSON.stringify({ message, chat_id: chatId, top_k: 5 }),
    });
  }

  async ragGetChats() {
    return this.ragRequest<any>("/chats");
  }

  async ragGetMessages(chatId: string) {
    return this.ragRequest<any>(`/chats/${encodeURIComponent(chatId)}/messages`);
  }

  // Consultation methods

  async createConsultation(data: { doctorId: string; reportId: string; patientMessage?: string }) {
    return await this.request<{ consultation: any; message: string }>("/consultations", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getMyConsultations(status?: string) {
    const params = status ? `?status=${status}` : "";
    return await this.request<{ consultations: any[] }>(`/consultations${params}`);
  }

  async getDoctorConsultations(status?: string) {
    const params = status ? `?status=${status}` : "";
    return await this.request<{ consultations: any[] }>(`/consultations/doctor${params}`);
  }

  async getConsultation(id: string) {
    return await this.request<{ consultation: any }>(`/consultations/${id}`);
  }

  async updateConsultationStatus(id: string, status: string) {
    return await this.request<{ consultation: any; message: string }>(`/consultations/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  async submitDiagnosis(id: string, data: {
    diagnosis: { findings: string; severity: string; recommendations?: string };
    prescription?: { medications?: any[]; instructions?: string; followUpDate?: string };
    doctorNotes?: string;
  }) {
    return await this.request<{ consultation: any; message: string }>(`/consultations/${id}/diagnose`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async getConsultationMessages(id: string, params: { limit?: number; before?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.limit)  qs.append("limit",  String(params.limit));
    if (params.before) qs.append("before", params.before);
    const query = qs.toString() ? `?${qs}` : "";
    return await this.request<{ messages: any[]; count: number }>(`/consultations/${id}/messages${query}`);
  }

  async sendConsultationMessage(id: string, text: string) {
    return await this.request<{ data: any; message: string }>(`/consultations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  }

  // Admin methods

  async getAdminStats() {
    return await this.request<any>('/admin/stats');
  }

  async getAdminAnalytics() {
    return await this.request<any>('/admin/analytics');
  }

  async getAdminUsers(params: { page?: number; limit?: number; role?: string; search?: string } = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) qs.append(k, String(v)); });
    return await this.request<any>(`/admin/users?${qs}`);
  }

  async suspendUser(id: string, isSuspended: boolean) {
    return await this.request<any>(`/admin/users/${id}/suspend`, {
      method: 'PATCH',
      body: JSON.stringify({ isSuspended }),
    });
  }

  async getAdminDoctors(params: { search?: string; page?: number; limit?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.search) qs.append('search', params.search);
    if (params.page) qs.append('page', params.page.toString());
    if (params.limit) qs.append('limit', params.limit.toString());
    const query = qs.toString();
    return await this.request<any>(`/admin/doctors${query ? `?${query}` : ''}`);
  }

  async verifyDoctor(id: string, isVerified: boolean) {
    return await this.request<any>(`/admin/doctors/${id}/verify`, {
      method: 'PATCH',
      body: JSON.stringify({ isVerified }),
    });
  }

  async createAdmin(data: { email: string; password: string; firstName: string; lastName: string }) {
    return await this.request<any>('/admin/create-admin', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getAuditLogs(params: { page?: number; limit?: number; action?: string } = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) qs.append(k, String(v)); });
    return await this.request<any>(`/admin/audit-logs?${qs}`);
  }

  // --- RAG chat management helpers ---

  async ragDeleteChat(chatId: string) {
    return this.ragRequest<any>(`/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
  }

  async ragRenameChat(chatId: string, newTitle: string) {
    return this.ragRequest<any>(`/chats/${encodeURIComponent(chatId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title: newTitle }),
    });
  }

  async ragArchiveChat(chatId: string, archived = true) {
    return this.ragRequest<any>(`/chats/${encodeURIComponent(chatId)}`, {
      method: "PATCH",
      body: JSON.stringify({ archived }),
    });
  }

  async ragShareChat(chatId: string) {
    return this.ragRequest<any>(`/chats/${encodeURIComponent(chatId)}/share`, { method: "POST" });
  }
}

export const apiService = new ApiService();
export default apiService;
