/**
 * cron.js — Scheduled jobs for MeddyCare
 *
 * Jobs:
 *  1. Daily digest at 08:00 — sends email to each user with today's reminders + appointments
 *  2. Exact-time alert (runs every minute) — sends a "right now" email when a reminder fires
 *  3. Dead letter queue retry (every 15 min) — retries previously failed email jobs
 *
 * Fault tolerance:
 *  - Failed emails are saved to a `FailedJob` collection (dead letter queue)
 *  - A retry cron picks them up with exponential backoff (1 min → 4 min → 16 min)
 *  - After 3 attempts, the job is marked 'dead' (admin-visible, no more retries)
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
import FailedJob from './models/FailedJob.js';

// ─── Mailer ───────────────────────────────────────────────────────────────────
// Create the transporter once at module load — reusing the same SMTP connection
// pool is significantly more efficient than creating a new one per email.

const _transporter = (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS)
  ? nodemailer.createTransport({
      host:   process.env.EMAIL_HOST,
      port:   parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_PORT === '465',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    })
  : null;

async function sendEmail(to, subject, html) {
  if (!_transporter) {
    console.log(`[CRON EMAIL] To: ${to} | Subject: ${subject}`);
    return;
  }
  // Let errors propagate so the caller can catch them for the DLQ
  await _transporter.sendMail({
    from: `"MeddyCare" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
}

// ─── DLQ helper ─────────────────────────────────────────────────────────────
/**
 * Save a failed job to the dead letter queue for later retry.
 * nextRetryAt uses exponential backoff: attempt 1 → 1 min, 2 → 4 min, 3 → 16 min
 */
async function enqueueFailedJob(type, payload, error) {
  try {
    const backoffMs = 60_000; // 1 minute base
    await FailedJob.create({
      type,
      payload,
      error: error?.message || String(error),
      attempts: 1,
      nextRetryAt: new Date(Date.now() + backoffMs),
    });
    console.log(`[DLQ] Enqueued failed ${type} job for retry`);
  } catch (dlqErr) {
    // Last resort — if even the DLQ write fails, log it
    console.error('[DLQ] Failed to enqueue job:', dlqErr.message);
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

      const typeIcon = { medication: '💊', checkup: '🔍', followup: '📋', other: '📌' };

      const reminderRows = rems.map(r => {
        const time = new Date(r.scheduledAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const icon = typeIcon[r.reminderType] || '🔔';
        const typeBg = r.reminderType === 'medication' ? '#dbeafe' : r.reminderType === 'checkup' ? '#fce7f3' : r.reminderType === 'followup' ? '#e0e7ff' : '#f1f5f9';
        const typeColor = r.reminderType === 'medication' ? '#1e40af' : r.reminderType === 'checkup' ? '#9d174d' : r.reminderType === 'followup' ? '#3730a3' : '#475569';
        return `
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9">
              <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
                <td width="48" style="vertical-align:top">
                  <div style="width:40px;height:40px;border-radius:10px;background:${typeBg};display:flex;align-items:center;justify-content:center;font-size:18px;line-height:40px;text-align:center">${icon}</div>
                </td>
                <td style="vertical-align:top;padding-left:12px">
                  <div style="font-weight:600;color:#1e293b;font-size:14px;margin-bottom:2px">${r.title}</div>
                  ${r.description ? `<div style="color:#64748b;font-size:13px;margin-bottom:4px">${r.description}</div>` : ''}
                  <div style="display:inline-flex;gap:6px;align-items:center">
                    <span style="font-size:12px;color:#64748b">⏰ ${time}</span>
                    <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${typeBg};color:${typeColor};text-transform:capitalize">${r.reminderType}</span>
                  </div>
                </td>
              </tr></table>
            </td>
          </tr>`;
      }).join('');

      const apptRows = appts.map(a => {
        const time = new Date(a.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const isConfirmed = a.status === 'confirmed';
        const statusBg = isConfirmed ? '#dcfce7' : '#fef9c3';
        const statusColor = isConfirmed ? '#166534' : '#854d0e';
        const statusIcon = isConfirmed ? '✅' : '⏳';
        const doctorName = `Dr. ${a.doctor?.user?.firstName || ''} ${a.doctor?.user?.lastName || ''}`.trim();
        const spec = a.doctor?.specialization || '';
        return `
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9">
              <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
                <td width="48" style="vertical-align:top">
                  <div style="width:40px;height:40px;border-radius:10px;background:#dbeafe;display:flex;align-items:center;justify-content:center;font-size:18px;line-height:40px;text-align:center">🩺</div>
                </td>
                <td style="vertical-align:top;padding-left:12px">
                  <div style="font-weight:600;color:#1e293b;font-size:14px;margin-bottom:2px">${doctorName}</div>
                  ${spec ? `<div style="color:#64748b;font-size:13px;margin-bottom:3px">${spec}</div>` : ''}
                  <div style="color:#64748b;font-size:13px;margin-bottom:4px">${a.reason}</div>
                  <div style="display:inline-flex;gap:6px;align-items:center">
                    <span style="font-size:12px;color:#64748b">⏰ ${time}</span>
                    <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${statusBg};color:${statusColor}">${statusIcon} ${a.status}</span>
                  </div>
                </td>
              </tr></table>
            </td>
          </tr>`;
      }).join('');

      const totalItems = rems.length + appts.length;

      const html = `
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;padding:32px 16px">
            <tr><td align="center">
              <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px">

                <!-- Header -->
                <tr><td style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:32px 28px;border-radius:16px 16px 0 0">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
                    <td>
                      <div style="font-size:28px;line-height:1">🩺</div>
                      <h1 style="color:#ffffff;margin:8px 0 0;font-size:22px;font-weight:700;letter-spacing:-0.3px">Good Morning, ${firstName}!</h1>
                      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">Here's your health schedule for today</p>
                    </td>
                    <td align="right" style="vertical-align:top">
                      <div style="background:rgba(255,255,255,0.2);border-radius:12px;padding:10px 14px;text-align:center">
                        <div style="color:#ffffff;font-size:22px;font-weight:700;line-height:1">${new Date().getDate()}</div>
                        <div style="color:rgba(255,255,255,0.85);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
                      </div>
                    </td>
                  </tr></table>
                </td></tr>

                <!-- Summary bar -->
                <tr><td style="background:#ffffff;padding:16px 28px;border-bottom:1px solid #e2e8f0">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
                    <td style="text-align:center;padding:4px 0">
                      <span style="display:inline-block;background:#eff6ff;color:#2563eb;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600">${totalItems} item${totalItems !== 1 ? 's' : ''} today</span>
                      ${appts.length > 0 ? `<span style="display:inline-block;background:#f0fdf4;color:#166534;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;margin-left:8px">${appts.length} appointment${appts.length !== 1 ? 's' : ''}</span>` : ''}
                      ${rems.length > 0 ? `<span style="display:inline-block;background:#faf5ff;color:#7c3aed;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;margin-left:8px">${rems.length} reminder${rems.length !== 1 ? 's' : ''}</span>` : ''}
                    </td>
                  </tr></table>
                </td></tr>

                ${appts.length > 0 ? `
                <!-- Appointments section -->
                <tr><td style="background:#ffffff;padding:20px 28px 0">
                  <h2 style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1e293b">📅 Appointments</h2>
                  <p style="margin:0 0 12px;font-size:13px;color:#94a3b8">Your scheduled doctor visits for today</p>
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fafbfc;border-radius:12px;overflow:hidden">
                    ${apptRows}
                  </table>
                </td></tr>` : ''}

                ${rems.length > 0 ? `
                <!-- Reminders section -->
                <tr><td style="background:#ffffff;padding:20px 28px 0">
                  <h2 style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1e293b">🔔 Reminders</h2>
                  <p style="margin:0 0 12px;font-size:13px;color:#94a3b8">Medications, check-ups, and follow-ups due today</p>
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fafbfc;border-radius:12px;overflow:hidden">
                    ${reminderRows}
                  </table>
                </td></tr>` : ''}

                <!-- Tip / CTA -->
                <tr><td style="background:#ffffff;padding:24px 28px">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f9ff;border-radius:12px;border-left:4px solid #2563eb;padding:16px 20px">
                    <tr><td>
                      <div style="font-size:13px;font-weight:600;color:#1e40af;margin-bottom:4px">💡 Health Tip</div>
                      <div style="font-size:13px;color:#475569;line-height:1.5">Regular eye check-ups are crucial for early detection of diabetic retinopathy. If you have diabetes, schedule a comprehensive eye exam at least once a year.</div>
                    </td></tr>
                  </table>
                </td></tr>

                <!-- Footer -->
                <tr><td style="background:#f8fafc;padding:24px 28px;border-radius:0 0 16px 16px;border-top:1px solid #e2e8f0">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
                    <td style="text-align:center">
                      <div style="font-size:13px;font-weight:600;color:#64748b;margin-bottom:6px">MeddyCare</div>
                      <div style="font-size:12px;color:#94a3b8;line-height:1.6">AI-Powered Retinal Health Platform</div>
                      <div style="font-size:11px;color:#cbd5e1;margin-top:8px">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
                      <div style="font-size:11px;color:#cbd5e1;margin-top:4px">You're receiving this because you have health events scheduled today.</div>
                    </td>
                  </tr></table>
                </td></tr>

              </table>
            </td></tr>
          </table>
        </body></html>`;

      try {
        await sendEmail(email, `MeddyCare — Your schedule for today`, html);
      } catch (emailErr) {
        console.error(`[CRON] Digest email failed for ${email}:`, emailErr.message);
        await enqueueFailedJob('daily_digest_email', { to: email, subject: 'MeddyCare — Your schedule for today', html }, emailErr);
      }
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

      const typeIcon = { medication: '💊', checkup: '🔍', followup: '📋', other: '📌' };
      const icon = typeIcon[r.reminderType] || '🔔';
      const typeBg = r.reminderType === 'medication' ? '#dbeafe' : r.reminderType === 'checkup' ? '#fce7f3' : r.reminderType === 'followup' ? '#e0e7ff' : '#f1f5f9';
      const typeColor = r.reminderType === 'medication' ? '#1e40af' : r.reminderType === 'checkup' ? '#9d174d' : r.reminderType === 'followup' ? '#3730a3' : '#475569';
      const timeStr = new Date(r.scheduledAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date(r.scheduledAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

      const urgencyMsg = r.reminderType === 'medication'
        ? "It's time to take your medication. Staying consistent with your doses is key to managing your health effectively."
        : r.reminderType === 'checkup'
          ? "Your scheduled check-up is now. Regular screenings help catch issues early when they're most treatable."
          : r.reminderType === 'followup'
            ? "Time for your follow-up. Keeping up with follow-ups ensures your treatment plan stays on track."
            : "You have a health reminder right now. Taking care of small tasks keeps your wellness routine strong.";

      const html = `
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;padding:32px 16px">
            <tr><td align="center">
              <table cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px">

                <!-- Header -->
                <tr><td style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:28px 28px 24px;border-radius:16px 16px 0 0;text-align:center">
                  <div style="width:56px;height:56px;border-radius:16px;background:rgba(255,255,255,0.2);margin:0 auto 12px;line-height:56px;font-size:28px">${icon}</div>
                  <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700">Reminder: ${r.title}</h1>
                  <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px">${dateStr} at ${timeStr}</p>
                </td></tr>

                <!-- Body -->
                <tr><td style="background:#ffffff;padding:28px">
                  <p style="margin:0 0 16px;color:#1e293b;font-size:15px;line-height:1.6">Hi <strong>${r.user.firstName}</strong>,</p>
                  <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6">${urgencyMsg}</p>
                  ${r.description ? `
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#faf5ff;border-radius:12px;border-left:4px solid #8b5cf6;margin-bottom:16px">
                    <tr><td style="padding:14px 18px">
                      <div style="font-size:11px;font-weight:600;color:#7c3aed;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Details</div>
                      <div style="font-size:14px;color:#475569;line-height:1.5">${r.description}</div>
                    </td></tr>
                  </table>` : ''}
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border-radius:12px">
                    <tr>
                      <td style="padding:12px 16px;text-align:center;border-right:1px solid #e2e8f0" width="50%">
                        <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Type</div>
                        <span style="display:inline-block;padding:3px 12px;border-radius:10px;font-size:12px;font-weight:600;background:${typeBg};color:${typeColor};text-transform:capitalize">${r.reminderType}</span>
                      </td>
                      <td style="padding:12px 16px;text-align:center" width="50%">
                        <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Scheduled</div>
                        <div style="font-size:13px;font-weight:600;color:#1e293b">${timeStr}</div>
                      </td>
                    </tr>
                  </table>
                </td></tr>

                <!-- Footer -->
                <tr><td style="background:#f8fafc;padding:20px 28px;border-radius:0 0 16px 16px;border-top:1px solid #e2e8f0;text-align:center">
                  <div style="font-size:13px;font-weight:600;color:#64748b;margin-bottom:4px">MeddyCare</div>
                  <div style="font-size:12px;color:#94a3b8">AI-Powered Retinal Health Platform</div>
                  <div style="font-size:11px;color:#cbd5e1;margin-top:6px">This alert was triggered by your scheduled reminder.</div>
                </td></tr>

              </table>
            </td></tr>
          </table>
        </body></html>`;

      try {
        await sendEmail(r.user.email, `🔔 Reminder: ${r.title}`, html);
        // Mark as notified to avoid re-sending
        await Reminder.findByIdAndUpdate(r._id, { notificationSent: true });
      } catch (emailErr) {
        console.error(`[CRON] Reminder alert failed for ${r.user.email}:`, emailErr.message);
        await enqueueFailedJob('reminder_alert_email', {
          to: r.user.email,
          subject: `🔔 Reminder: ${r.title}`,
          html,
          reminderId: r._id.toString(),
        }, emailErr);
        // Still mark as notificationSent so the main cron doesn't re-enqueue it
        // The DLQ retry will handle delivery
        await Reminder.findByIdAndUpdate(r._id, { notificationSent: true });
      }
    }
  } catch (err) {
    console.error('[CRON] Exact-time alert error:', err.message);
  }
}

// ─── Dead Letter Queue retry — every 15 minutes ─────────────────────────────

async function retryFailedJobs() {
  try {
    const now = new Date();
    const jobs = await FailedJob.find({
      status: 'pending',
      nextRetryAt: { $lte: now },
    }).limit(50);  // process in batches to avoid overload

    if (jobs.length === 0) return;
    console.log(`[DLQ] Retrying ${jobs.length} failed job(s)`);

    for (const job of jobs) {
      try {
        // Re-attempt the email send
        await sendEmail(job.payload.to, job.payload.subject, job.payload.html);

        // If we get here, the retry succeeded — mark as resolved by removing
        await FailedJob.findByIdAndDelete(job._id);
        console.log(`[DLQ] ✅ Retry succeeded for ${job.type} → ${job.payload.to}`);
      } catch (retryErr) {
        const nextAttempt = job.attempts + 1;

        if (nextAttempt >= job.maxAttempts) {
          // Exhausted all retries — mark as dead
          await FailedJob.findByIdAndUpdate(job._id, {
            status: 'dead',
            attempts: nextAttempt,
            error: retryErr?.message || String(retryErr),
          });
          console.error(`[DLQ] ❌ Job permanently failed after ${nextAttempt} attempts: ${job.type} → ${job.payload.to}`);
        } else {
          // Exponential backoff: attempt 2 → 4 min, attempt 3 → 16 min
          const backoffMs = Math.pow(4, nextAttempt - 1) * 60_000;
          await FailedJob.findByIdAndUpdate(job._id, {
            attempts: nextAttempt,
            nextRetryAt: new Date(Date.now() + backoffMs),
            error: retryErr?.message || String(retryErr),
          });
          console.log(`[DLQ] Retry ${nextAttempt}/${job.maxAttempts} failed for ${job.type}, next retry in ${backoffMs / 60_000} min`);
        }
      }
    }
  } catch (err) {
    console.error('[DLQ] Retry cron error:', err.message);
  }
}

// ─── Register jobs ────────────────────────────────────────────────────────────

export function startCronJobs() {
  // Daily digest at 08:00 AM server time
  cron.schedule('0 8 * * *', sendDailyDigest, { timezone: 'Asia/Kolkata' });

  // Exact-time alerts — every minute
  cron.schedule('* * * * *', sendExactTimeAlerts);

  // Dead letter queue retry — every 15 minutes
  cron.schedule('*/15 * * * *', retryFailedJobs);

  console.log('✅ Cron jobs started (daily digest @ 08:00, minute alerts, DLQ retry every 15m)');
}
