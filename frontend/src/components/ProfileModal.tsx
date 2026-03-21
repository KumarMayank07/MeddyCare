import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  User,
  Edit2,
  Archive,
  X,
  Mail,
  CalendarDays,
  MessageCircle,
} from "lucide-react";
import apiService from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface StoredUser {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  phone?: string;
  gender?: string;
  dateOfBirth?: string;
  profileImage?: string;
  createdAt?: string;
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalChats?: number;      // optional — chat stats hidden when not provided
  archivedCount?: number;
}

export default function ProfileModal({
  isOpen,
  onClose,
  totalChats,
  archivedCount,
}: ProfileModalProps) {
  const { updateUser } = useAuth();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [userData, setUserData] = useState<StoredUser>({});
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", gender: "", dateOfBirth: "" });
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedFileRef = useRef<File | null>(null);

  useEffect(() => {
    if (!isOpen) {
      selectedFileRef.current = null;
      return;
    }

    // Seed from localStorage immediately so fields are visible right away
    const stored = localStorage.getItem("user");
    const cached: StoredUser = stored ? JSON.parse(stored) : {};
    setUserData(cached);
    setForm({
      firstName:   cached.firstName   ?? "",
      lastName:    cached.lastName    ?? "",
      phone:       cached.phone       ?? "",
      gender:      cached.gender      ?? "",
      dateOfBirth: cached.dateOfBirth ? cached.dateOfBirth.split("T")[0] : "",
    });
    setAvatarPreview(cached.profileImage ?? null);
    setMode("view");
    setError("");
    setSuccess("");

    // Then fetch fresh data from the server so the profile image (and any
    // other field updated outside this session) is always up-to-date.
    let cancelled = false;
    apiService.getCurrentUser()
      .then((res) => {
        if (cancelled) return;
        const fresh: StoredUser = res.user;
        setUserData(fresh);
        setForm({
          firstName:   fresh.firstName   ?? "",
          lastName:    fresh.lastName    ?? "",
          phone:       fresh.phone       ?? "",
          gender:      fresh.gender      ?? "",
          dateOfBirth: fresh.dateOfBirth ? fresh.dateOfBirth.split("T")[0] : "",
        });
        setAvatarPreview(fresh.profileImage ?? null);
        // Persist the fresh snapshot back to localStorage
        try { localStorage.setItem("user", JSON.stringify(fresh)); } catch { /* quota */ }
      })
      .catch(() => { /* network error — keep cached data */ });

    return () => { cancelled = true; };
  }, [isOpen]);

  if (!isOpen) return null;

  const fullName    = [userData.firstName, userData.lastName].filter(Boolean).join(" ") || "—";
  const initials    = [(userData.firstName?.[0] ?? ""), (userData.lastName?.[0] ?? "")].join("").toUpperCase() || "?";
  const isPatient   = userData.role === "user";
  const displayRole = userData.role === "user" ? "patient" : (userData.role ?? "");
  const showStats   = totalChats !== undefined && archivedCount !== undefined;

  const roleColors: Record<string, string> = {
    admin:  "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    doctor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    user:   "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  };
  const roleColor = roleColors[userData.role ?? ""] ?? "bg-muted text-muted-foreground";

  const formatDate = (ts?: string) => {
    if (!ts) return "—";
    const normalized = /[Zz]|[+-]\d{2}:\d{2}$/.test(ts) ? ts : ts + "Z";
    return new Date(normalized).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("Image must be under 2 MB."); return; }
    setError("");
    selectedFileRef.current = file;
    const reader = new FileReader();
    reader.onloadend = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, string> = {
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
      };
      if (form.phone.trim())  payload.phone       = form.phone.trim();
      if (form.gender)        payload.gender      = form.gender;
      if (form.dateOfBirth)   payload.dateOfBirth = form.dateOfBirth;

      // Upload new avatar to Cloudinary; store the returned URL (not base64)
      if (selectedFileRef.current) {
        const uploadRes = await apiService.uploadProfileImage(selectedFileRef.current);
        payload.profileImage = uploadRes.url;
        selectedFileRef.current = null;
      }

      const res = await apiService.updateProfile(payload);
      const updated = { ...userData, ...res.user };
      // Sync to AuthContext (which also writes localStorage) so all consumers update
      updateUser(updated);
      setUserData(updated);
      setSuccess("Profile updated successfully!");
      setMode("view");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xs mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60 sticky top-0 bg-card z-10">
          <h2 className="text-base font-semibold text-foreground">
            {mode === "edit" ? "Edit Profile" : "Profile"}
          </h2>
          <div className="flex items-center gap-2">
            {mode === "view" && (
              <button
                onClick={() => { setSuccess(""); setMode("edit"); }}
                className="text-xs px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
              >
                Edit
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Inline feedback */}
        {success && mode === "view" && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-medium">
            {success}
          </div>
        )}
        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-medium">
            {error}
          </div>
        )}

        {/* Avatar */}
        <div className="flex flex-col items-center pt-4 pb-3 px-5">
          <div className="relative">
            <div className="h-14 w-14 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center overflow-hidden">
              {avatarPreview ? (
                <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-lg font-bold text-primary">{initials}</span>
              )}
            </div>
            {mode === "edit" && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 bg-primary text-white rounded-full p-1 shadow-md hover:bg-primary/90 transition-colors"
                  title="Change photo"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageChange}
                />
              </>
            )}
          </div>

          {mode === "view" && (
            <>
              <p className="text-sm font-semibold text-foreground mt-2">{fullName}</p>
              {userData.role && (
                <span className={cn("mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium capitalize", roleColor)}>
                  {displayRole}
                </span>
              )}
            </>
          )}
        </div>

        {/* ── VIEW MODE ── */}
        {mode === "view" && (
          <>
            <div className="px-5 pb-3 space-y-2.5">
              <div className="flex items-center gap-3 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-foreground truncate">{userData.email ?? "—"}</span>
              </div>
              {userData.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground shrink-0 text-xs font-semibold">TEL</span>
                  <span className="text-foreground">{userData.phone}</span>
                </div>
              )}
              {isPatient && userData.gender && (
                <div className="flex items-center gap-3 text-sm capitalize">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{userData.gender}</span>
                </div>
              )}
              {isPatient && userData.dateOfBirth && (
                <div className="flex items-center gap-3 text-sm">
                  <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{formatDate(userData.dateOfBirth)}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm">
                <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-foreground">Joined {formatDate(userData.createdAt)}</span>
              </div>
            </div>

            {/* Chat stats — only shown when counts are passed in */}
            {showStats && (
              <div className="mx-4 mb-4 rounded-xl bg-muted/50 border border-border/50 p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                  Chat Stats
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col items-center gap-1 bg-card rounded-lg py-2.5 border border-border/40">
                    <MessageCircle className="h-4 w-4 text-primary" />
                    <span className="text-lg font-bold text-foreground">{totalChats}</span>
                    <span className="text-xs text-muted-foreground">Total Chats</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 bg-card rounded-lg py-2.5 border border-border/40">
                    <Archive className="h-4 w-4 text-muted-foreground" />
                    <span className="text-lg font-bold text-foreground">{archivedCount}</span>
                    <span className="text-xs text-muted-foreground">Archived</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── EDIT MODE ── */}
        {mode === "edit" && (
          <div className="px-4 pb-4 space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">First Name *</label>
                <input
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  placeholder="First name"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Last Name *</label>
                <input
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  placeholder="Last name"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Phone</label>
              <input
                type="tel"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+1 234 567 8900"
              />
            </div>

            {/* Patient-only fields */}
            {isPatient && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Gender</label>
                  <select
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    value={form.gender}
                    onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Date of Birth</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    value={form.dateOfBirth}
                    onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                  />
                </div>
              </>
            )}

            {/* Read-only email */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Email (read-only)</label>
              <input
                disabled
                className="w-full rounded-lg border border-input bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
                value={userData.email ?? ""}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setMode("view"); setError(""); }}
                className="flex-1 px-3 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
