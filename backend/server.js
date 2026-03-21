import dotenv from "dotenv";
dotenv.config();

// ── Validate required environment variables before doing anything else ────────
const REQUIRED_ENV = ["MONGODB_URI", "JWT_SECRET_KEY"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(", ")}`);
  console.error("   Check your .env file and try again.");
  process.exit(1);
}

import { createServer } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { Server as SocketServer } from "socket.io";
import { setupSocket, setIo } from "./socket.js";
import { startCronJobs } from "./cron.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import doctorRoutes from "./routes/doctors.js";
import uploadRoutes from "./routes/upload.js";
import reportsRouter from "./routes/reports.js";
import remindersRouter from "./routes/reminders.js";
import adminRouter from "./routes/admin.js";
import appointmentsRouter from "./routes/appointments.js";
import consultationsRouter from "./routes/consultations.js";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// Socket.io — same port as Express, uses upgrade mechanism
const io = new SocketServer(httpServer, {
  cors: {
    origin: (process.env.NODE_ENV === "production"
      ? (process.env.FRONTEND_URL || "").split(",").map(u => u.trim())
      : ["http://localhost:5173", "http://localhost:5174", "http://localhost:3001"]),
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

setupSocket(io);
setIo(io);

// Trust the first proxy (nginx, AWS ALB, etc.) for accurate client IPs in rate limiter
app.set("trust proxy", 1);

// Security middleware
app.use(helmet());

// Configure CORS origins
const corsOrigins = {
  development: [
    "http://localhost:3001",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:8080",
    "http://localhost:8501",
    "http://localhost:8502",
  ],
  production: (process.env.FRONTEND_URL || "https://yourdomain.com").split(",").map(url => url.trim()),
};

const allowedOrigins = corsOrigins[process.env.NODE_ENV] || corsOrigins.development;

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// General API rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again later." },
});
app.use("/api/", limiter);

// Stricter limiter for auth endpoints to slow brute-force attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later." },
});

// Body parsing middleware — 1 MB is sufficient; the upload endpoints use multipart
app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true, limit: "3mb" }));

// Database connection with better error handling
const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined in environment variables");
    }

    console.log("Attempting to connect to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB successfully");
    startCronJobs();
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    console.error("Please check your MONGODB_URI in the .env file");
    process.exit(1);
  }
};

// Initialize database connection
connectDB();

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "MeddyCare API is running",
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
  });
});

// API v1 routes
const v1 = express.Router();
v1.use("/auth",          authLimiter, authRoutes);
v1.use("/users",         userRoutes);
v1.use("/doctors",       doctorRoutes);
v1.use("/upload",        uploadRoutes);
v1.use("/reports",       reportsRouter);
v1.use("/reminders",     remindersRouter);
v1.use("/admin",         adminRouter);
v1.use("/appointments",  appointmentsRouter);
v1.use("/consultations", consultationsRouter);
app.use("/api/v1", v1);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const server = httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await mongoose.connection.close();
      console.log("MongoDB connection closed.");
    } catch (err) {
      console.error("Error closing MongoDB connection:", err.message);
    }
    process.exit(0);
  });

  // Force exit if still open after 10s
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
