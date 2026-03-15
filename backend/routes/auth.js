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
// Logs to console in development; wire up nodemailer/SendGrid/etc. in production
// by replacing the body of this function.
async function sendVerificationEmail(email, _firstName, token) {
  const verifyUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?token=${token}`;

  if (process.env.NODE_ENV !== "production") {
    console.log(`\n[DEV] Verification email for ${email}:`);
    console.log(`  Link: ${verifyUrl}\n`);
    return;
  }

  // Production: use nodemailer or any transactional email service.
  // Uncomment and configure when ready:
  //
  // import nodemailer from "nodemailer";
  // const transporter = nodemailer.createTransport({ ... });
  // await transporter.sendMail({
  //   from: process.env.EMAIL_FROM,
  //   to: email,
  //   subject: "Verify your MeddyCare account",
  //   html: `<p>Hi ${firstName},</p>
  //          <p>Click <a href="${verifyUrl}">here</a> to verify your email.</p>`,
  // });
  console.log(`[PROD] Would send verification email to ${email} → ${verifyUrl}`);
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
      });

      await user.save();

      // Send verification email (fire-and-forget; don't block registration)
      sendVerificationEmail(email, firstName, verificationToken).catch((err) =>
        console.error("Failed to send verification email:", err)
      );

      const token = generateToken(user);
      user.lastLogin = new Date();
      await user.save();

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
      user.lastLogin = new Date();
      await user.save();

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
router.post("/refresh", auth, async (req, res) => {
  try {
    const token = generateToken(req.user);
    res.json({ token, user: req.user.getPublicProfile() });
  } catch (error) {
    console.error("Token refresh error:", error);
    res.status(500).json({ error: "Server error during token refresh" });
  }
});

export default router;
