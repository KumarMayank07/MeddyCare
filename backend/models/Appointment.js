import mongoose from 'mongoose';

const { Schema } = mongoose;

const appointmentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
  date: { type: Date, required: true },
  reason: { type: String, required: true, trim: true },
  notes: { type: String, trim: true },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'pending'
  },
}, { timestamps: true });

appointmentSchema.index({ user: 1, date: -1 });
appointmentSchema.index({ doctor: 1, date: 1 });

const Appointment = mongoose.model('Appointment', appointmentSchema);
export default Appointment;
