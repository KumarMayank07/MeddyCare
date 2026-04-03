/**
 * utils/email.js — Shared SMTP transporter for MeddyCare
 *
 * Creates one connection pool at startup and reuses it across all email senders
 * (auth verification, cron digest, exact-time alerts, DLQ retries).
 *
 * Dev fallback: if EMAIL_HOST / EMAIL_USER / EMAIL_PASS are not set,
 * sendEmail() logs to stdout instead of connecting to SMTP.
 */

import nodemailer from 'nodemailer';

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

/**
 * Send an email.
 * - In production (SMTP configured): sends via nodemailer; throws on failure.
 * - In development (no SMTP): logs the subject + recipient to stdout.
 */
export async function sendEmail(to, subject, html) {
  if (!_transporter) {
    console.log(`[DEV EMAIL] To: ${to} | Subject: ${subject}`);
    return;
  }
  await _transporter.sendMail({
    from: `"MeddyCare" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
}
