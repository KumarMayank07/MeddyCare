import crypto from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import User from "../models/User.js";
import Doctor from "../models/Doctor.js";
import { auth } from "../middleware/auth.js";
import { emitToUser } from "../socket.js";

async function notifyAdmins(event, data = {}) {
  try {
    const admins = await User.find({ role: "admin" }).select("_id");
    admins.forEach(a => emitToUser(a._id.toString(), event, data));
  } catch { /* non-critical */ }
}

const router = express.Router();

// ── Email helper ─────────────────────────────────────────────────────────────
import nodemailer from "nodemailer";

const _verifyTransporter =
  process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || "587"),
        secure: process.env.EMAIL_PORT === "465",
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      })
    : null;

async function sendVerificationEmail(email, firstName, token) {
  const verifyUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;padding:32px 16px">
        <tr><td align="center">
          <table cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px">

            <!-- Header -->
            <tr><td style="background:linear-gradient(135deg,#2563eb,#0ea5e9);padding:32px 28px;border-radius:16px 16px 0 0;text-align:center">
              <div style="width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,0.2);margin:0 auto 14px;line-height:64px;font-size:32px">🩺</div>
              <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700">Welcome to MeddyCare!</h1>
              <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px">Just one step to activate your account</p>
            </td></tr>

            <!-- Body -->
            <tr><td style="background:#ffffff;padding:32px 28px">
              <p style="margin:0 0 16px;color:#1e293b;font-size:15px;line-height:1.6">Hi <strong>${firstName || 'there'}</strong>,</p>
              <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.7">Thank you for joining MeddyCare — your AI-powered retinal health platform. To get started with DR screenings, doctor consultations, and our AI health assistant, please verify your email address.</p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px">
                <tr><td align="center">
                  <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#0ea5e9);color:#ffffff;padding:14px 36px;border-radius:12px;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px">Verify My Email</a>
                </td></tr>
              </table>

              <p style="margin:0 0 16px;color:#64748b;font-size:13px;line-height:1.6">Or copy and paste this link into your browser:</p>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:20px">
                <tr><td style="background:#f1f5f9;border-radius:8px;padding:12px 16px;word-break:break-all">
                  <a href="${verifyUrl}" style="color:#2563eb;font-size:12px;text-decoration:none">${verifyUrl}</a>
                </td></tr>
              </table>

              <!-- What you get -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f9ff;border-radius:12px;border-left:4px solid #2563eb;margin-bottom:8px">
                <tr><td style="padding:16px 20px">
                  <div style="font-size:13px;font-weight:600;color:#1e40af;margin-bottom:8px">What you can do on MeddyCare:</div>
                  <div style="font-size:13px;color:#475569;line-height:1.7">
                    🔬 Upload retina images for instant AI-powered DR screening<br>
                    👨‍⚕️ Find and book verified eye specialists near you<br>
                    💬 Chat with doctors in real-time for consultations<br>
                    🤖 Ask our AI health assistant any eye-health questions<br>
                    📋 Set medication reminders and track your health journey
                  </div>
                </td></tr>
              </table>
            </td></tr>

            <!-- Security notice -->
            <tr><td style="background:#fffbeb;padding:14px 28px;border-top:1px solid #fde68a">
              <p style="margin:0;font-size:12px;color:#92400e;line-height:1.5">🔒 This verification link expires in <strong>24 hours</strong>. If you did not create an account on MeddyCare, please ignore this email — no action is needed.</p>
            </td></tr>

            <!-- Footer -->
            <tr><td style="background:#f8fafc;padding:24px 28px;border-radius:0 0 16px 16px;border-top:1px solid #e2e8f0;text-align:center">
              <div style="font-size:13px;font-weight:600;color:#64748b;margin-bottom:4px">MeddyCare</div>
              <div style="font-size:12px;color:#94a3b8">AI-Powered Retinal Health Platform</div>
              <div style="font-size:11px;color:#cbd5e1;margin-top:8px">This is an automated message. Please do not reply to this email.</div>
            </td></tr>

          </table>
        </td></tr>
      </table>
    </body></html>`;

  if (!_verifyTransporter) {
    console.log(`\n[DEV] Verification email for ${email}:`);
    console.log(`  Link: ${verifyUrl}\n`);
    return;
  }

  await _verifyTransporter.sendMail({
    from: `"MeddyCare" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify your MeddyCare account",
    html,
  });
}

// ── Token generator ───────────────────────────────────────────────────────────
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    process.env.JWT_SECRET_KEY,
    { expiresIn: `${process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 60}m` }
  );
};

// ── Register (patient) ────────────────────────────────────────────────────────
router.post(
  "/register",
  [
    body("email").isEmail().withMessage("Please enter a valid email address").normalizeEmail(),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    body("firstName").trim().notEmpty().withMessage("First name is required"),
    body("lastName").trim().notEmpty().withMessage("Last name is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, firstName, lastName, phone, dateOfBirth, gender } = req.body;

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: "User with this email already exists" });
      }

      // Role is never accepted from the client — always defaults to 'user'.
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const user = new User({
        email,
        password,
        firstName,
        lastName,
        phone,
        dateOfBirth,
        gender,
        role: "user",
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        lastLogin: new Date(),
      });

      await user.save();

      // Send verification email (fire-and-forget; don't block registration)
      sendVerificationEmail(email, firstName, verificationToken).catch((err) =>
        console.error("Failed to send verification email:", err)
      );

      const token = generateToken(user);

      notifyAdmins("admin_stats_updated", { type: "new_user" });

      res.status(201).json({
        message: "User registered successfully. Please verify your email.",
        token,
        user: user.getPublicProfile(),
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Server error during registration" });
    }
  }
);

// ── Register (doctor) ─────────────────────────────────────────────────────────
// Creates a User with role='doctor' + a Doctor profile (isVerified=false, pending admin approval)
router.post(
  "/register-doctor",
  [
    body("email").isEmail().withMessage("Please enter a valid email address").normalizeEmail(),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    body("firstName").trim().notEmpty().withMessage("First name is required"),
    body("lastName").trim().notEmpty().withMessage("Last name is required"),
    body("specialization").trim().notEmpty().withMessage("Specialization is required"),
    body("licenseNumber").trim().notEmpty().withMessage("License number is required"),
    body("experience").isInt({ min: 0 }).withMessage("Experience must be a non-negative number"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        email,
        password,
        firstName,
        lastName,
        phone,
        specialization,
        licenseNumber,
        experience,
        city,
        state,
        country,
        lat,
        lng,
      } = req.body;

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: "User with this email already exists" });
      }

      const existingDoctor = await Doctor.findOne({ licenseNumber });
      if (existingDoctor) {
        return res.status(400).json({ error: "A doctor with this license number already exists" });
      }

      const verificationToken = crypto.randomBytes(32).toString("hex");
      const user = new User({
        email,
        password,
        firstName,
        lastName,
        phone,
        role: "doctor",
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastLogin: new Date(),
      });
      await user.save();

      // Use GPS coordinates directly if provided, otherwise fall back to geocoding city name
      let coordinates = [0, 0];
      if (lat !== undefined && lng !== undefined) {
        // Frontend sent precise GPS coords — MongoDB GeoJSON stores [lng, lat]
        coordinates = [parseFloat(lng), parseFloat(lat)];
      } else if (city) {
        try {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
            { headers: { "User-Agent": "MeddyCare-App/1.0" } }
          );
          const geoData = await geoRes.json();
          if (geoData.length > 0) {
            coordinates = [parseFloat(geoData[0].lon), parseFloat(geoData[0].lat)];
          }
        } catch (geoErr) {
          console.warn("Geocoding failed, using [0,0]:", geoErr.message);
        }
      }

      const doctor = new Doctor({
        user: user._id,
        specialization,
        licenseNumber,
        experience: parseInt(experience, 10),
        contact: { email, phone },
        location: {
          type: "Point",
          coordinates,
          address: { city: city || "", state: state || "", country: country || "" },
        },
        isVerified: false,
      });
      await doctor.save();

      sendVerificationEmail(email, firstName, verificationToken).catch((err) =>
        console.error("Failed to send verification email:", err)
      );

      const token = generateToken(user);

      notifyAdmins("admin_stats_updated", { type: "new_doctor" });

      res.status(201).json({
        message: "Doctor registered successfully. Your account is pending admin verification.",
        token,
        user: user.getPublicProfile(),
      });
    } catch (error) {
      console.error("Doctor registration error:", error);
      res.status(500).json({ error: "Server error during doctor registration" });
    }
  }
);

// ── Verify email ──────────────────────────────────────────────────────────────
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Verification token is required" });

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired verification token" });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    res.json({ message: "Email verified successfully" });
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({ error: "Server error during email verification" });
  }
});

// ── Resend verification ───────────────────────────────────────────────────────
router.post("/resend-verification", auth, async (req, res) => {
  try {
    const user = req.user;

    if (user.isEmailVerified) {
      return res.status(400).json({ error: "Email is already verified" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.emailVerificationToken = token;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    await sendVerificationEmail(user.email, user.firstName, token);

    res.json({ message: "Verification email resent" });
  } catch (error) {
    console.error("Resend verification error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post(
  "/login",
  [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, role } = req.body;

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ error: "Invalid credentials" });
      }

      if (user.isSuspended) {
        return res.status(403).json({ error: "Your account has been suspended. Please contact support." });
      }

      // Validate claimed role matches actual role in DB
      if (role && user.role !== role) {
        return res.status(403).json({ error: `Access denied. This account is not registered as ${role}.` });
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(400).json({ error: "Invalid credentials" });
      }

      const token = generateToken(user);
      user.lastLogin = new Date();
      await user.save();

      res.json({
        message: "Login successful",
        token,
        user: user.getPublicProfile(),
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Server error during login" });
    }
  }
);

// ── Admin login ───────────────────────────────────────────────────────────────
router.post(
  "/admin-login",
  [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ error: "Invalid admin credentials" });
      }

      if (user.role !== "admin") {
        return res.status(403).json({ error: "Access denied. Admin privileges required." });
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(400).json({ error: "Invalid admin credentials" });
      }

      const token = generateToken(user);
      user.lastLogin = new Date();
      await user.save();

      res.json({
        message: "Admin login successful",
        token,
        user: user.getPublicProfile(),
      });
    } catch (error) {
      console.error("Admin login error:", error);
      res.status(500).json({ error: "Server error during admin login" });
    }
  }
);

// ── Get current user ──────────────────────────────────────────────────────────
router.get("/me", auth, async (req, res) => {
  try {
    res.json({ user: req.user.getPublicProfile() });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", auth, async (_req, res) => {
  try {
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Server error during logout" });
  }
});

// ── Refresh token ─────────────────────────────────────────────────────────────
// Does NOT use `auth` middleware — it must accept EXPIRED tokens (that is the
// whole point of a refresh endpoint). It verifies the signature but ignores
// the expiration claim, then issues a fresh access token.
router.post("/refresh", async (req, res) => {
  try {
    const raw = req.header("Authorization")?.replace("Bearer ", "");
    if (!raw) return res.status(401).json({ error: "No token provided." });

    let decoded;
    try {
      decoded = jwt.verify(raw, process.env.JWT_SECRET_KEY, { ignoreExpiration: true });
    } catch {
      return res.status(401).json({ error: "Invalid token." });
    }

    const user = await User.findById(decoded.userId).select("-password");
    if (!user) return res.status(401).json({ error: "User not found." });
    if (user.isSuspended) return res.status(403).json({ error: "Account suspended. Contact support." });

    const token = generateToken(user);
    res.json({ token, user: user.getPublicProfile() });
  } catch (error) {
    console.error("Token refresh error:", error);
    res.status(500).json({ error: "Server error during token refresh" });
  }
});

export default router;
