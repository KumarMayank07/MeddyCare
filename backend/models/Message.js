import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageSchema = new Schema({
  consultationId: { type: Schema.Types.ObjectId, ref: 'Consultation', required: true },
  senderId:       { type: Schema.Types.ObjectId, ref: 'User',         required: true },
  senderRole:     { type: String, enum: ['patient', 'doctor'],        required: true },
  type:           { type: String, enum: ['text', 'image'],            default: 'text' },
  text:           { type: String, trim: true },   // body for text; caption for image
  imageUrl:       { type: String },               // Cloudinary URL — required when type='image'
  readBy: [{
    _id:    false,
    user:   { type: Schema.Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now },
  }],
  timestamp: { type: Date, default: Date.now },
}, { id: false });

// ─── Indexes ──────────────────────────────────────────────────────────────────
// 1. Primary: paginate all messages in a consultation chronologically
messageSchema.index({ consultationId: 1, timestamp: 1 });

// 2. Unread query: find unread messages for a participant in a consultation
messageSchema.index({ consultationId: 1, 'readBy.user': 1 });

// 3. Sender history: all messages sent by a user across consultations
messageSchema.index({ senderId: 1, timestamp: -1 });

export default mongoose.model('Message', messageSchema);
