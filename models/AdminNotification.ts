// models/AdminNotification.ts
import mongoose, { Schema, type Document, type Types } from "mongoose";

export type AdminNotificationType =
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "NEW_ORDER"
  | "ORDER_STUCK_PENDING"
  | "PAYMENT_FAILED"
  | "RETURN_REQUESTED"
  | "HIGH_VALUE_ORDER"
  | "SERVER_ERROR_SPIKE"
  | "STOCK_NEGATIVE"
  | "CRON_FAILED"
  | "EMAIL_FAILED"
  | "CONTACT_MESSAGE"
  | "SUSPICIOUS_CUSTOMER"
  | "FAQ_BULK_UPLOAD_COMPLETE"
  | "FAQ_BULK_UPLOAD_CHUNK_FAILED"
  | "BULK_UPLOAD_COMPLETE"
  | "BULK_UPLOAD_CHUNK_FAILED"
  | "RETURN_APPROVAL_INCOMPLETE"
  | "ORDER_CANCEL_REFUND_NEEDED"
  | "ORDER_RECONCILE_FAILED";

export type AdminNotificationSeverity = "critical" | "high" | "medium" | "low";

export interface IAdminNotification extends Document {
  _id: Types.ObjectId;
  type: AdminNotificationType;
  severity: AdminNotificationSeverity;
  title: string;
  message: string;
  link: string | null;
  data: Record<string, unknown>;
  read: boolean;
  dedupeKey: string | null;
  emailSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const adminNotificationSchema = new Schema<IAdminNotification>(
  {
    type: {
      type: String,
      enum: [
        "LOW_STOCK",
        "OUT_OF_STOCK",
        "NEW_ORDER",
        "ORDER_STUCK_PENDING",
        "PAYMENT_FAILED",
        "RETURN_REQUESTED",
        "HIGH_VALUE_ORDER",
        "SERVER_ERROR_SPIKE",
        "STOCK_NEGATIVE",
        "CRON_FAILED",
        "EMAIL_FAILED",
        "CONTACT_MESSAGE",
        "SUSPICIOUS_CUSTOMER",
        "FAQ_BULK_UPLOAD_COMPLETE",
        "FAQ_BULK_UPLOAD_CHUNK_FAILED",
        "BULK_UPLOAD_COMPLETE",
        "BULK_UPLOAD_CHUNK_FAILED",
        "RETURN_APPROVAL_INCOMPLETE",
        "ORDER_CANCEL_REFUND_NEEDED",
        "ORDER_RECONCILE_FAILED",
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ["critical", "high", "medium", "low"],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: null },
    data: { type: Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
    dedupeKey: { type: String, default: null },
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Bell dropdown — unread count + sorted list
adminNotificationSchema.index({ read: 1, createdAt: -1 });

// Dedupe lookup — fast range query
adminNotificationSchema.index({ dedupeKey: 1, createdAt: -1 });

// Read notifications — 90 days me cleanup
adminNotificationSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 90 * 24 * 60 * 60,
    partialFilterExpression: { read: true },
  }
);

// Unread safety net — 180 days
adminNotificationSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 180 * 24 * 60 * 60,
    partialFilterExpression: { read: false },
  }
);

export default mongoose.model<IAdminNotification>("AdminNotification", adminNotificationSchema);
