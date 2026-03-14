import mongoose from 'mongoose';

const { Schema } = mongoose;

const medicationSchema = new Schema({
  name:      { type: String, required: true, trim: true },
  dosage:    { type: String, required: true, trim: true },
  frequency: { type: String, required: true, trim: true }, // e.g. "Twice daily"
  duration:  { type: String, required: true, trim: true }, // e.g. "7 days"
}, { _id: false });

const consultationSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: 'User',   required: true },
  doctor:  { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
  report:  { type: Schema.Types.ObjectId, ref: 'Report', required: true },

  status: {
    type: String,
    enum: ['pending', 'in_review', 'completed', 'cancelled'],
    default: 'pending',
  },

  // Patient's initial message / symptoms description
  patientMessage: { type: String, trim: true },

  // Doctor fills this after reviewing the retina report
  diagnosis: {
    findings:        { type: String, trim: true },
    severity:        { type: String, enum: ['normal', 'mild', 'moderate', 'severe', 'critical'] },
    recommendations: { type: String, trim: true },
  },

  prescription: {
    medications:  { type: [medicationSchema], default: [] },
    instructions: { type: String, trim: true },
    followUpDate: { type: Date },
  },

  doctorNotes: { type: String, trim: true },

  // Messages live in the separate Message collection (consultationId ref)

}, { timestamps: true });

// Fast lookups by patient and doctor
consultationSchema.index({ patient: 1, createdAt: -1 });
consultationSchema.index({ doctor: 1, status: 1, createdAt: -1 });

export default mongoose.model('Consultation', consultationSchema);
