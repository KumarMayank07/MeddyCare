/**
 * cron.js — Scheduled jobs for MeddyCare
 *
 * Jobs:
 *  1. Daily digest at 08:00 — sends email to each user with today's reminders + appointments
 *  2. Exact-time alert (runs every minute) — sends a "right now" email when a reminder fires
 *
 * Email sending:
 *  - In development (no SMTP config): logs to console
 *  - In production: set EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS in .env
 */

import cron from 'node-cron';
import nodemailer from 'nodemailer';
import Reminder from './models/Reminder.js';
import Appointment from './models/Appointment.js';
import User from './models/User.js';

// ─── Mailer ───────────────────────────────────────────────────────────────────

function createTransporter() {
  if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return nodemailer.createTransport({
      host:   process.env.EMAIL_HOST,
      port:   parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_PORT === '465',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  // Dev fallback — log only
  return null;
}

async function sendEmail(to, subject, html) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[CRON EMAIL] To: ${to} | Subject: ${subject}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"MeddyCare" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error('[CRON] Email send failed:', err.message);
  }
}

// ─── Daily digest — 08:00 every day ──────────────────────────────────────────

async function sendDailyDigest() {
  try {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,  0,  0,   0);
    const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);

    // Find all users who have reminders or confirmed appointments today
    const reminders = await Reminder.find({
      scheduledAt: { $gte: todayStart, $lte: todayEnd },
      isCompleted: false,
    }).populate('user', 'email firstName');

    const appointments = await Appointment.find({
      date: { $gte: todayStart, $lte: todayEnd },
      status: { $in: ['pending', 'confirmed'] },
    }).populate('user', 'email firstName')
      .populate({ path: 'doctor', populate: { path: 'user', select: 'firstName lastName' } });

    // Group by user email
    const byUser = {};

    for (const r of reminders) {
      if (!r.user?.email) continue;
      const key = r.user.email;
      if (!byUser[key]) byUser[key] = { firstName: r.user.firstName, reminders: [], appointments: [] };
      byUser[key].reminders.push(r);
    }

    for (const a of appointments) {
      if (!a.user?.email) continue;
      const key = a.user.email;
      if (!byUser[key]) byUser[key] = { firstName: a.user.firstName, reminders: [], appointments: [] };
      byUser[key].appointments.push(a);
    }

    for (const [email, data] of Object.entries(byUser)) {
      const { firstName, reminders: rems, appointments: appts } = data;

      const reminderRows = rems.map(r =>
        `<li><b>${r.title}</b> at ${new Date(r.scheduledAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}
         ${r.description ? `<br><span style="color:#666">${r.description}</span>` : ''}</li>`
      ).join('');

      const apptRows = appts.map(a =>
        `<li>Appointment with <b>Dr. ${a.doctor?.user?.firstName} ${a.doctor?.user?.lastName}</b>
         at ${new Date(a.date).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}
         — ${a.reason}
         <span style="padding:2px 8px;border-radius:12px;font-size:12px;background:${a.status==='confirmed'?'#d1fae5':'#fef9c3'};color:${a.status==='confirmed'?'#065f46':'#854d0e'}">${a.status}</span></li>`
      ).join('');

      const html = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#3b82f6,#6366f1);padding:24px;border-radius:12px 12px 0 0">
            <h1 style="color:white;margin:0;font-size:20px">🩺 MeddyCare — Today's Agenda</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</p>
          </div>
          <div style="background:#f8fafc;padding:24px;border-radius:0 0 12px 12px">
            <p>Hi <b>${firstName}</b>, here's what's scheduled for today:</p>
            ${appts.length > 0 ? `<h3 style="color:#3b82f6">📅 Appointments</h3><ul>${apptRows}</ul>` : ''}
            ${rems.length > 0 ? `<h3 style="color:#8b5cf6">🔔 Reminders</h3><ul>${reminderRows}</ul>` : ''}
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
            <p style="color:#94a3b8;font-size:12px">You're receiving this because you have items scheduled today on MeddyCare.</p>
          </div>
        </div>`;

      await sendEmail(email, `MeddyCare — Your schedule for today`, html);
    }

    console.log(`[CRON] Daily digest sent to ${Object.keys(byUser).length} user(s)`);
  } catch (err) {
    console.error('[CRON] Daily digest error:', err.message);
  }
}

// ─── Exact-time reminder alert — every minute ────────────────────────────────

async function sendExactTimeAlerts() {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 60_000); // 1 min ago
    const windowEnd   = new Date(now.getTime());

    const dueReminders = await Reminder.find({
      scheduledAt: { $gte: windowStart, $lt: windowEnd },
      isCompleted: false,
      notificationSent: { $ne: true },
    }).populate('user', 'email firstName');

    for (const r of dueReminders) {
      if (!r.user?.email) continue;

      const html = `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
          <div style="background:#8b5cf6;padding:20px;border-radius:12px 12px 0 0">
            <h2 style="color:white;margin:0">🔔 Reminder: ${r.title}</h2>
          </div>
          <div style="background:#faf5ff;padding:20px;border-radius:0 0 12px 12px">
            <p>Hi <b>${r.user.firstName}</b>, this is your scheduled reminder.</p>
            ${r.description ? `<p style="color:#6b7280">${r.description}</p>` : ''}
            <p style="color:#94a3b8;font-size:12px">MeddyCare — Health Management System</p>
          </div>
        </div>`;

      await sendEmail(r.user.email, `🔔 Reminder: ${r.title}`, html);

      // Mark as notified to avoid re-sending
      await Reminder.findByIdAndUpdate(r._id, { notificationSent: true });
    }
  } catch (err) {
    console.error('[CRON] Exact-time alert error:', err.message);
  }
}

// ─── Register jobs ────────────────────────────────────────────────────────────

export function startCronJobs() {
  // Daily digest at 08:00 AM server time
  cron.schedule('0 8 * * *', sendDailyDigest, { timezone: 'Asia/Kolkata' });

  // Exact-time alerts — every minute
  cron.schedule('* * * * *', sendExactTimeAlerts);

  console.log('✅ Cron jobs started (daily digest @ 08:00, minute alerts)');
}
