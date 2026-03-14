// backend/routes/reports.js
import express from "express";
import axios from "axios";
import rateLimit from "express-rate-limit";
import Report from "../models/Report.js";
import { auth } from "../middleware/auth.js";

const router = express.Router();

const PREDICT_SERVICE = process.env.PREDICT_SERVICE_URL;
if (!PREDICT_SERVICE) {
  console.error("PREDICT_SERVICE_URL is not set — /api/reports/analyze will not work");
}

// Per-user rate limit: 2 analyses per 2 minutes (each call can take ~60s)
const analyzeRateLimit = rateLimit({
  windowMs: 2 * 60 * 1000,
  max: 2,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: { error: "Too many analysis requests. Please wait a moment before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/analyze", auth, analyzeRateLimit, async (req, res) => {
  try {
    const { imageUrl, publicId } = req.body;
    if (!imageUrl)
      return res.status(400).json({ error: "imageUrl is required" });

    if (!PREDICT_SERVICE) {
      return res.status(503).json({ error: "Prediction service is not configured on this server" });
    }

    // Call python microservice
    const resp = await axios.post(
      `${PREDICT_SERVICE}/predict`,
      {
        image_url: imageUrl,
      },
      { timeout: 60000 }
    );

    const data = resp.data;
    // data: { stage, stage_label, probabilities, report, model_input_shape }

    // Save to MongoDB
    const probabilities = data.probabilities || [];
    const confidence = probabilities.length > 0 ? Math.max(...probabilities) : null;

    const reportDoc = new Report({
      user: req.user._id,
      imageUrl,
      cloudinaryPublicId: publicId || null,
      stage: data.stage,
      stageLabel: data.stage_label,
      probabilities,
      confidence,
      reportText: data.report,
    });
    await reportDoc.save();

    return res.json({
      message: "Analysis complete",
      report: reportDoc,
    });
  } catch (err) {
    console.error("Analyze route error:", err?.message || err);
    if (err.response && err.response.data) {
      // bubble up python service error
      return res
        .status(502)
        .json({
          error: "Prediction service error",
          details: err.response.data,
        });
    }
    return res.status(500).json({ error: "Server error during analysis" });
  }
});

// Get user's reports
router.get("/", auth, async (req, res) => {
  try {
    const reports = await Report.find({ user: req.user._id }).sort({
      createdAt: -1,
    });
    return res.json({ reports });
  } catch (err) {
    console.error("Get reports error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
