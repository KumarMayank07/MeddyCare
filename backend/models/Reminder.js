import mongoose from 'mongoose';

const reminderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  reminderType: {
    type: String,
    enum: ['medication', 'checkup', 'followup', 'other'],
    default: 'other'
  },
  scheduledAt: {
    type: Date,
    required: true
  },
  isCompleted: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date
  },
  // If this reminder was auto-created from an appointment booking
  appointmentRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null,
  },
  // Prevents duplicate exact-time email alerts
  notificationSent: {
    type: Boolean,
    default: false,
  }
}, {
  timestamps: true
});

reminderSchema.index({ user: 1, scheduledAt: 1 });

const Reminder = mongoose.model('Reminder', reminderSchema);
export default Reminder;
