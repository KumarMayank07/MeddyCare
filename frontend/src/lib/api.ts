const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const RAG_API_BASE_URL = import.meta.env.VITE_RAG_API_BASE_URL;
const PREDICT_API_URL = import.meta.env.VITE_PREDICT_API_URL;

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

    const response = await fetch(url, config);

    // Auto-refresh on 401, but never retry the refresh/login/logout endpoints
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
        const retryResponse = await fetch(url, retryConfig);
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
    const ragUrl = RAG_API_BASE_URL;
    const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const response = await fetch(`${ragUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${
          this.token || localStorage.getItem("token") || ""
        }`,
      },
      body: JSON.stringify({
        message,
        chat_id: chatId,
        top_k: 5,
        timezone: clientTimezone,
      }),
    });

    if (!response.ok) throw new Error(`RAG chat failed: ${response.status}`);
    return response.json();
  }

  async ragGetChats() {
    const ragUrl = RAG_API_BASE_URL;
    const response = await fetch(`${ragUrl}/chats`, {
      headers: {
        Authorization: `Bearer ${
          this.token || localStorage.getItem("token") || ""
        }`,
      },
    });

    if (!response.ok) throw new Error(`Get chats failed: ${response.status}`);
    return response.json();
  }

  async ragGetMessages(chatId: string) {
    const ragUrl = RAG_API_BASE_URL;
    const response = await fetch(`${ragUrl}/chats/${chatId}/messages`, {
      headers: {
        Authorization: `Bearer ${
          this.token || localStorage.getItem("token") || ""
        }`,
      },
    });

    if (!response.ok)
      throw new Error(`Get messages failed: ${response.status}`);
    return response.json();
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

  async getAdminDoctors(search?: string) {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return await this.request<any>(`/admin/doctors${qs}`);
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

  // --- Added rag chat helpers ---

  async ragDeleteChat(chatId: string) {
    const ragUrl = RAG_API_BASE_URL;
    const response = await fetch(
      `${ragUrl}/chats/${encodeURIComponent(chatId)}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${
            this.token || localStorage.getItem("token") || ""
          }`,
        },
      }
    );

    if (!response.ok) throw new Error(`Delete chat failed: ${response.status}`);
    return response.json();
  }

  async ragRenameChat(chatId: string, newTitle: string) {
    const ragUrl = RAG_API_BASE_URL;
    const response = await fetch(
      `${ragUrl}/chats/${encodeURIComponent(chatId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${
            this.token || localStorage.getItem("token") || ""
          }`,
        },
        body: JSON.stringify({ title: newTitle }),
      }
    );

    if (!response.ok) throw new Error(`Rename chat failed: ${response.status}`);
    return response.json();
  }

  async ragArchiveChat(chatId: string, archived = true) {
    const ragUrl = RAG_API_BASE_URL;
    const response = await fetch(
      `${ragUrl}/chats/${encodeURIComponent(chatId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${
            this.token || localStorage.getItem("token") || ""
          }`,
        },
        body: JSON.stringify({ archived }),
      }
    );

    if (!response.ok)
      throw new Error(`Archive toggle failed: ${response.status}`);
    return response.json();
  }

  async ragShareChat(chatId: string) {
    const ragUrl = RAG_API_BASE_URL;
    const response = await fetch(
      `${ragUrl}/chats/${encodeURIComponent(chatId)}/share`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${
            this.token || localStorage.getItem("token") || ""
          }`,
        },
      }
    );

    if (!response.ok) throw new Error(`Share chat failed: ${response.status}`);
    return response.json();
  }
}

export const apiService = new ApiService();
export default apiService;
