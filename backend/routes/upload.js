import dotenv from "dotenv";
dotenv.config();

import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { auth } from "../middleware/auth.js";
import Report from "../models/Report.js";
import User from "../models/User.js";

// Extract the Cloudinary publicId from a secure_url
// e.g. https://res.cloudinary.com/cloud/image/upload/v123/folder/file.jpg → folder/file
function publicIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/upload\/(?:[^/]+\/)*v\d+\/(.+)\.[a-z0-9]+$/i)
    || url.match(/\/upload\/(.+)\.[a-z0-9]+$/i);
  return match ? match[1] : null;
}

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// @route   POST /api/upload/image
// @desc    Upload image to Cloudinary
// @access  Private
router.post("/image", auth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    const b64 = Buffer.from(req.file.buffer).toString("base64");
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;

    const result = await cloudinary.uploader.upload(dataURI, {
      folder: "meddycare",
      resource_type: "auto",
      transformation: [
        { width: 800, height: 600, crop: "limit" },
        { quality: "auto" },
      ],
    });

    res.json({
      message: "Image uploaded successfully",
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    });
  } catch (error) {
    console.error("Image upload error:", error.message);
    console.error("Error details:", error);
    res.status(500).json({
      error: "Server error while uploading image",
      details: error.message,
    });
  }
});

// @route   POST /api/upload/profile-image
// @desc    Upload profile image
// @access  Private
router.post(
  "/profile-image",
  auth,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const b64 = Buffer.from(req.file.buffer).toString("base64");
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;

      const result = await cloudinary.uploader.upload(dataURI, {
        folder: "meddycare/profiles",
        resource_type: "auto",
        transformation: [
          { width: 400, height: 400, crop: "fill", gravity: "face" },
          { quality: "auto" },
        ],
      });

      res.json({
        message: "Profile image uploaded successfully",
        url: result.secure_url,
        publicId: result.public_id,
      });
    } catch (error) {
      console.error("Profile image upload error:", error);
      res
        .status(500)
        .json({ error: "Server error while uploading profile image" });
    }
  }
);

// @route   DELETE /api/upload/:publicId
// @desc    Delete image from Cloudinary
// @access  Private — user may only delete assets they own; admins unrestricted
router.delete("/:publicId", auth, async (req, res) => {
  try {
    // publicId may contain slashes (folder/filename) so decode it
    const publicId = decodeURIComponent(req.params.publicId);

    if (req.user.role !== "admin") {
      // Check 1: retina report image owned by this user
      const ownedReport = await Report.findOne({
        user: req.user._id,
        cloudinaryPublicId: publicId,
      });

      // Check 2: profile image — stored as a URL, extract publicId for comparison
      const currentUser = await User.findById(req.user._id).select("profileImage");
      const profilePublicId = publicIdFromUrl(currentUser?.profileImage);

      const ownsAsset = ownedReport || (profilePublicId && profilePublicId === publicId);
      if (!ownsAsset) {
        return res.status(403).json({ error: "Access denied: asset does not belong to you" });
      }
    }

    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result === "ok") {
      res.json({ message: "Image deleted successfully" });
    } else {
      res.status(400).json({ error: "Failed to delete image" });
    }
  } catch (error) {
    console.error("Image deletion error:", error);
    res.status(500).json({ error: "Server error while deleting image" });
  }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "File size too large. Maximum size is 5MB." });
    }
    return res.status(400).json({ error: "File upload error" });
  }

  if (error.message === "Only image files are allowed") {
    return res.status(400).json({ error: error.message });
  }

  next(error);
});

export default router;
