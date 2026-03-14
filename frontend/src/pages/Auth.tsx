import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import apiService from "@/lib/api";
import { Eye, EyeOff, ChevronDown } from "lucide-react";

type Role = "user" | "doctor" | "admin";

const ROLES: { value: Role; label: string }[] = [
  { value: "user", label: "User" },
  { value: "doctor", label: "Doctor" },
  { value: "admin", label: "Admin" },
];

const SPECIALIZATIONS = [
  "Retina Specialist",
  "Ophthalmologist",
  "Optometrist",
  "General Eye Care",
];

export default function Auth() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { login, register, user, updateUser } = useAuth();

  const [mode, setMode] = useState<"login" | "signup" | "doctor-signup">("login");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginRole, setLoginRole] = useState<Role | "">("");

  // Patient signup form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");

  // Doctor signup form
  const [docFirstName, setDocFirstName] = useState("");
  const [docLastName, setDocLastName] = useState("");
  const [docEmail, setDocEmail] = useState("");
  const [docPassword, setDocPassword] = useState("");
  const [docPhone, setDocPhone] = useState("");
  const [docSpecialization, setDocSpecialization] = useState(SPECIALIZATIONS[0]);
  const [docLicense, setDocLicense] = useState("");
  const [docExperience, setDocExperience] = useState("");
  const [docCity, setDocCity] = useState("");

  const redirectByRole = (role: string) => {
    if (role === "admin") navigate("/admin");
    else if (role === "doctor") navigate("/doctor");
    else navigate("/dashboard");
  };

  useEffect(() => {
    if (user) redirectByRole(user.role);
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (!loginRole) {
      toast({ title: "Select a role", description: "Please choose your role to continue.", variant: "destructive" });
      setLoading(false);
      return;
    }
    try {
      const res = await login(loginEmail, loginPassword, loginRole);
      toast({ title: "Welcome back!", description: "Login successful." });
      redirectByRole((res as any)?.user?.role || loginRole);
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message || "Check your credentials and try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await register({
        email: signupEmail,
        password: signupPassword,
        firstName,
        lastName,
      });
      toast({ title: "Account created!", description: `Welcome, ${firstName}! Please verify your email.` });
      redirectByRole((res as any)?.user?.role ?? "user");
    } catch (error: any) {
      toast({
        title: "Sign up failed",
        description: error.message || "Check your information and try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDoctorSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docExperience || isNaN(Number(docExperience)) || Number(docExperience) < 0) {
      toast({ title: "Invalid experience", description: "Enter a valid number of years.", variant: "destructive" });
      return;
    }
    if (!docCity.trim()) {
      toast({ title: "City is required", description: "We need your city to show you on the map for patients.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await apiService.registerDoctor({
        email: docEmail,
        password: docPassword,
        firstName: docFirstName,
        lastName: docLastName,
        phone: docPhone || undefined,
        specialization: docSpecialization,
        licenseNumber: docLicense,
        experience: Number(docExperience),
        city: docCity.trim(),
      });
      // Update AuthContext so ProtectedRoute lets the user through
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resAny = res as any;
      if (resAny?.user) updateUser(resAny.user);
      toast({
        title: "Doctor account created!",
        description: "Your account is pending admin verification. You'll be notified once approved.",
      });
      redirectByRole((res as any)?.user?.role ?? "doctor");
    } catch (error: any) {
      toast({
        title: "Sign up failed",
        description: error.message || "Check your information and try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <div className="w-8 h-8 rounded-full bg-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">MeddyCare</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {mode === "login"
              ? "Sign in to your account"
              : mode === "doctor-signup"
              ? "Register as a doctor"
              : "Create your account"}
          </p>
        </div>

        <Card className="p-8 shadow-lg border border-border/60">
          {/* Toggle */}
          <div className="flex rounded-lg bg-muted p-1 mb-6">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                mode === "login"
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                mode === "signup"
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Patient
            </button>
            <button
              type="button"
              onClick={() => setMode("doctor-signup")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                mode === "doctor-signup"
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Doctor
            </button>
          </div>

          {/* ── Login ── */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="you@domain.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    disabled={loading}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-role">Role</Label>
                <div className="relative">
                  <select
                    id="login-role"
                    value={loginRole}
                    onChange={(e) => setLoginRole(e.target.value as Role)}
                    disabled={loading}
                    className="w-full h-10 px-3 pr-8 rounded-md border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="" disabled>Select Role</option>
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </div>
              </div>

              <Button type="submit" className="w-full mt-2" disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          )}

          {/* ── Patient signup ── */}
          {mode === "signup" && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    type="text"
                    placeholder="First Name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    type="text"
                    placeholder="Last Name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="you@domain.com"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="signup-password">Password</Label>
                <div className="relative">
                  <Input
                    id="signup-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    required
                    disabled={loading}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full mt-2" disabled={loading}>
                {loading ? "Creating account..." : "Create Account"}
              </Button>
            </form>
          )}

          {/* ── Doctor signup ── */}
          {mode === "doctor-signup" && (
            <form onSubmit={handleDoctorSignup} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="doc-firstName">First Name</Label>
                  <Input
                    id="doc-firstName"
                    type="text"
                    placeholder="First Name"
                    value={docFirstName}
                    onChange={(e) => setDocFirstName(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-lastName">Last Name</Label>
                  <Input
                    id="doc-lastName"
                    type="text"
                    placeholder="Last Name"
                    value={docLastName}
                    onChange={(e) => setDocLastName(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="doc-email">Email</Label>
                <Input
                  id="doc-email"
                  type="email"
                  placeholder="doctor@clinic.com"
                  value={docEmail}
                  onChange={(e) => setDocEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="doc-password">Password</Label>
                <div className="relative">
                  <Input
                    id="doc-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={docPassword}
                    onChange={(e) => setDocPassword(e.target.value)}
                    required
                    disabled={loading}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="doc-specialization">Specialization</Label>
                <div className="relative">
                  <select
                    id="doc-specialization"
                    value={docSpecialization}
                    onChange={(e) => setDocSpecialization(e.target.value)}
                    disabled={loading}
                    className="w-full h-10 px-3 pr-8 rounded-md border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {SPECIALIZATIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="doc-license">License Number</Label>
                  <Input
                    id="doc-license"
                    type="text"
                    placeholder="MCI-123456"
                    value={docLicense}
                    onChange={(e) => setDocLicense(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-experience">Experience (years)</Label>
                  <Input
                    id="doc-experience"
                    type="number"
                    min="0"
                    placeholder="5"
                    value={docExperience}
                    onChange={(e) => setDocExperience(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="doc-city">
                  City <span className="text-destructive">*</span>
                  <span className="text-xs text-muted-foreground ml-1">— used to show you on the map</span>
                </Label>
                <Input
                  id="doc-city"
                  type="text"
                  placeholder="e.g. Mumbai, Delhi, Bengaluru"
                  value={docCity}
                  onChange={(e) => setDocCity(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="doc-phone">Phone (optional)</Label>
                <Input
                  id="doc-phone"
                  type="tel"
                  placeholder="XXXXX-XXXXX"
                  value={docPhone}
                  onChange={(e) => setDocPhone(e.target.value)}
                  disabled={loading}
                />
              </div>

              <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3">
                Your account will be reviewed by an admin before you can accept consultations.
              </p>

              <Button type="submit" className="w-full mt-2" disabled={loading}>
                {loading ? "Submitting..." : "Register as Doctor"}
              </Button>
            </form>
          )}

          <p className="text-center text-xs text-muted-foreground mt-5">
            {mode !== "login" ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-primary hover:underline font-medium"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="text-primary hover:underline font-medium"
                >
                  Sign up
                </button>
              </>
            )}
          </p>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          © 2026 RetinaCare AI. All rights reserved.
        </p>
      </div>
    </div>
  );
}
