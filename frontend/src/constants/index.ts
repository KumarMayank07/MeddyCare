// ─── DR Stage metadata ────────────────────────────────────────────────────────
export const STAGE_COLORS = [
  "#10b981", // No DR    — emerald-500
  "#3b82f6", // Mild     — blue-500
  "#f59e0b", // Moderate — amber-500
  "#f97316", // Severe   — orange-500
  "#ef4444", // Prolif.  — red-500
] as const;

export const STAGE_NAMES = [
  "No DR",
  "Mild",
  "Moderate",
  "Severe",
  "Proliferative",
] as const;

// ─── Doctor specializations ───────────────────────────────────────────────────
export const SPECIALIZATIONS = [
  "Retina Specialist",
  "Ophthalmologist",
  "Optometrist",
  "General Eye Care",
] as const;

export type Specialization = (typeof SPECIALIZATIONS)[number];

/** For filter dropdowns that need an "All" option */
export const SPECIALIZATIONS_FILTER = ["All", ...SPECIALIZATIONS] as const;

// ─── Consultation / appointment status badge classes ──────────────────────────
export const STATUS_COLORS: Record<string, string> = {
  pending:   "bg-yellow-100 text-yellow-800 border-yellow-200",
  in_review: "bg-blue-100   text-blue-800   border-blue-200",
  completed: "bg-green-100  text-green-800  border-green-200",
  cancelled: "bg-gray-100   text-gray-600   border-gray-200",
};

// ─── Admin audit-log badge labels & classes ───────────────────────────────────
export const ACTION_LABELS: Record<string, string> = {
  DOCTOR_VERIFIED:   "Doctor Verified",
  DOCTOR_UNVERIFIED: "Doctor Unverified",
  USER_SUSPENDED:    "User Suspended",
  USER_UNSUSPENDED:  "User Unsuspended",
  ADMIN_CREATED:     "Admin Created",
};

export const ACTION_COLORS: Record<string, string> = {
  DOCTOR_VERIFIED:   "bg-green-100  text-green-800  border-green-200",
  DOCTOR_UNVERIFIED: "bg-red-100    text-red-800    border-red-200",
  USER_SUSPENDED:    "bg-red-100    text-red-800    border-red-200",
  USER_UNSUSPENDED:  "bg-blue-100   text-blue-800   border-blue-200",
  ADMIN_CREATED:     "bg-purple-100 text-purple-800 border-purple-200",
};

// ─── Pagination ───────────────────────────────────────────────────────────────
export const DOCTORS_PER_PAGE = 12;

// ─── Notification history cap ─────────────────────────────────────────────────
export const NOTIFICATION_HISTORY_LIMIT = 50;
