// ─── Core domain types shared across the app ──────────────────────────────────

export interface User {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "user" | "admin" | "doctor";
  profileImage?: string;
  isEmailVerified?: boolean;
  isSuspended?: boolean;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  medicalHistory?: {
    diabetes?: boolean;
    hypertension?: boolean;
    familyHistory?: boolean;
    previousEyeSurgery?: boolean;
    medications?: string[];
    allergies?: string[];
  };
  eyeData?: {
    leftEye?: { vision?: string; pressure?: number; lastExam?: string };
    rightEye?: { vision?: string; pressure?: number; lastExam?: string };
  };
  preferences?: {
    notifications?: { email?: boolean; sms?: boolean; push?: boolean };
    language?: string;
  };
  lastLogin?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  message: string;
}

export interface Doctor {
  _id: string;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    profileImage?: string | null;
  };
  specialization: string;
  licenseNumber?: string;
  experience: number;
  location?: {
    coordinates?: [number, number];
    address?: { formatted?: string; city?: string; state?: string; country?: string };
  };
  rating?: { average: number; count: number };
  distance?: number | null;
  contact?: { phone?: string | null; email?: string | null; website?: string | null };
  isVerified?: boolean;
  isActive?: boolean;
  availability?: Record<string, { available: boolean; start: string; end: string }>;
  services?: { name: string; description?: string; price?: number }[];
  reviews?: { user: string; rating: number; comment?: string; date: string }[];
  education?: { degree: string; institution: string; year: number }[];
  certifications?: string[];
  languages?: string[];
}

export interface Report {
  _id: string;
  user: string;
  imageUrl: string;
  cloudinaryPublicId?: string;
  stage: number;
  stageLabel: string;
  probabilities: number[];
  confidence: number;
  reportText: string;
  createdAt: string;
  updatedAt: string;
}

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
}

export interface Consultation {
  _id: string;
  status: "pending" | "in_review" | "completed" | "cancelled";
  patientMessage?: string;
  createdAt: string;
  patient: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    gender?: string;
    dateOfBirth?: string;
  };
  doctor: {
    _id: string;
    specialization: string;
    user: { firstName: string; lastName: string };
  };
  report: Report;
  diagnosis?: {
    findings: string;
    severity: string;
    recommendations?: string;
  };
  prescription?: {
    medications?: Medication[];
    instructions?: string;
    followUpDate?: string;
  };
  doctorNotes?: string;
}

export interface Appointment {
  _id: string;
  date: string;
  reason: string;
  notes?: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
  doctor: {
    _id: string;
    specialization: string;
    user: { firstName: string; lastName: string };
  };
  user?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  createdAt: string;
}

export interface Reminder {
  _id: string;
  title: string;
  description?: string;
  reminderType: "medication" | "checkup" | "followup" | "other";
  scheduledAt: string;
  isCompleted: boolean;
  completedAt?: string;
  appointmentRef?: string;
  createdAt: string;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
