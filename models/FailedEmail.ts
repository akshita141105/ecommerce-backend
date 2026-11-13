// models/FailedEmail.ts
import mongoose, { Schema, type Document, type Types } from "mongoose";

export type FailedEmailStatus = "failed" | "resent" | "resolved";

export interface IFailedEmail extends Document {
  _id: Types.ObjectId;
  to: string;
  subject: string;
  html: string;
  reason: string;
  attempts: number;
  status: FailedEmailStatus;
  resentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const failedEmailSchema = new Schema<IFailedEmail>(
  {
    to: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    reason: { type: String, required: true }, // error message
    attempts: { type: Number, default: 3 },
    status: {
      type: String,
      enum: ["failed", "resent", "resolved"],
      default: "failed",
    },
    resentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model<IFailedEmail>("FailedEmail", failedEmailSchema);
