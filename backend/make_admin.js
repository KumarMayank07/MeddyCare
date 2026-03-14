import mongoose from "mongoose";
import User from "./models/User.js"; // Note the .js extension
import dotenv from "dotenv";

dotenv.config();

async function makeAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/clarity_retina_care"
    );

    // Update user role
    const email = process.argv[2] || "magnusprojects01@gmail.com";

    const result = await User.updateOne(
      { email },
      { $set: { role: "admin" } }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ User ${email} is now an admin`);
    } else {
      console.log(`❌ User not found or already admin: ${email}`);
    }

    // Verify the update
    const user = await User.findOne({ email });
    console.log("Current user role:", user?.role);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

makeAdmin();
