/**
 * seed-admin.js
 * Creates the initial admin account if it doesn't already exist.
 *
 * Usage:
 *   node seed-admin.js
 *
 * Reads MONGODB_URI from .env in the same directory.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';

dotenv.config();

const ADMIN_EMAIL    = 'meddycare111@gmail.com';
const ADMIN_PASSWORD = 'Mayank2001@';
const ADMIN_FIRST    = 'Meddy';
const ADMIN_LAST     = 'Admin';

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
    console.log(`   Password: ${ADMIN_PASSWORD}`);
  } catch (err) {
    console.error('❌ Seed error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seed();
