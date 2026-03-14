import mongoose from 'mongoose';

const { Schema } = mongoose;

const auditLogSchema = new Schema({
  admin:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action:      { type: String, required: true }, // e.g. DOCTOR_VERIFIED, USER_SUSPENDED
  targetType:  { type: String, enum: ['User', 'Doctor', 'Report', 'Consultation', 'System'] },
  targetId:    { type: Schema.Types.ObjectId },
  targetLabel: { type: String },   // human-readable: "Dr. Jane Smith (jane@example.com)"
  metadata:    { type: Schema.Types.Mixed },
  ip:          { type: String },
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export default mongoose.model('AuditLog', auditLogSchema);
