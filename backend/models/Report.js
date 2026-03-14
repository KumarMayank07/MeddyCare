// backend/models/Report.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const ReportSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  imageUrl: { type: String, required: true },
  cloudinaryPublicId: { type: String },
  stage: { type: Number, required: true, min: 0, max: 4 }, // 0=No DR, 4=Proliferative
  stageLabel: { type: String },
  probabilities: { type: [Number], default: [] },       // per-class softmax outputs
  confidence: { type: Number, min: 0, max: 1 },         // max(probabilities) — for filtering/sorting
  reportText: { type: String },
}, { timestamps: true });

ReportSchema.index({ user: 1, createdAt: -1 });
ReportSchema.index({ user: 1, stage: 1 });             // fast filter by DR stage

export default mongoose.model("Report", ReportSchema);
