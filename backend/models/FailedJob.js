import mongoose from 'mongoose';

/**
 * Dead Letter Queue — stores failed cron/background jobs for retry.
 *
 * When a cron job (email notification, reminder alert) fails, the error is
 * captured here instead of being silently swallowed. A separate retry cron
 * picks up failed jobs and re-attempts them with exponential backoff.
 *
 * After `maxAttempts` failures the job is marked 'dead' — visible to admins.
 */
const failedJobSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['daily_digest_email', 'reminder_alert_email'],
    index: true,
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  error: {
    type: String,
    required: true,
  },
  attempts: {
    type: Number,
    default: 1,
  },
  maxAttempts: {
    type: Number,
    default: 4,
  },
  status: {
    type: String,
    enum: ['pending', 'dead'],
    default: 'pending',
    index: true,
  },
  nextRetryAt: {
    type: Date,
    required: true,
    index: true,
  },
  resolvedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Compound index for the retry query: pending jobs whose retry time has passed
failedJobSchema.index({ status: 1, nextRetryAt: 1 });

const FailedJob = mongoose.model('FailedJob', failedJobSchema);
export default FailedJob;
