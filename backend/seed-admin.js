/**
 * seed-admin.js
 * Creates the initial admin account if it doesn't already exist.
 *
 * Usage:
 *   node seed-admin.js
 *
 * Reads credentials and MONGODB_URI from .env in the same directory.
 * Required env vars: MONGODB_URI, ADMIN_EMAIL, ADMIN_PASSWORD
 * Optional env vars: ADMIN_FIRST (default "Meddy"), ADMIN_LAST (default "Admin")
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';

dotenv.config();

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_FIRST    = process.env.ADMIN_FIRST || 'Meddy';
const ADMIN_LAST     = process.env.ADMIN_LAST  || 'Admin';

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
  process.exit(1);
}

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const existing = await User.findOne({ email: ADMIN_EMAIL });
    if (existing) {
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        await existing.save();
        console.log(`✅ Existing user promoted to admin: ${ADMIN_EMAIL}`);
      } else {
        console.log(`ℹ️  Admin already exists: ${ADMIN_EMAIL}`);
      }
      return;
    }

    const admin = new User({
      email:           ADMIN_EMAIL,
      password:        ADMIN_PASSWORD,   // hashed by pre-save hook
      firstName:       ADMIN_FIRST,
      lastName:        ADMIN_LAST,
      role:            'admin',
      isEmailVerified: true,
    });
    await admin.save();
    console.log(`✅ Admin created: ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error('❌ Seed error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seed();
