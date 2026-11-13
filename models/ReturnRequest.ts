import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IReturnItem {
  _id: Types.ObjectId;
  product?: Types.ObjectId;
  name: string;
  image: string;
  selectedSize?: string;
  selectedColor?: string;
  quantity: number;
  price: number;
}

export type ReturnReason = "wrong_item" | "damaged_product" | "size_issue" | "not_as_described" | "changed_mind" | "other";
export type RefundMethod = "wallet" | "razorpay" | "bank_transfer" | "upi";
// "approving" is a short-lived atomic claim state (see
// controllers/admin/adminReturnController.js) written via findOneAndUpdate
// between "pending" and "approved"/"rejected" — not just a UI label.
export type ReturnStatus = "pending" | "approving" | "approved" | "rejected";

export interface IReturnRequest extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  order: Types.ObjectId;
  items: Types.DocumentArray<IReturnItem>;
  reason: ReturnReason;
  description: string;
  refundAmount: number;
  refundMethod: RefundMethod;
  bankDetails: {
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    upiId: string;
  };
  status: ReturnStatus;
  rejectionReason: string;
  processedAt: Date | null;
  processedBy: Types.ObjectId | null;
  razorpayRefundId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const returnRequestSchema = new Schema<IReturnRequest>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    order: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    // Items being returned
    items: [
      {
        product: { type: Schema.Types.ObjectId, ref: "Product" },
        name: { type: String, required: true },
        image: { type: String, default: "" },
        selectedSize: { type: String },
        selectedColor: { type: String },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
      },
    ],

    // Return reason
    reason: {
      type: String,
      enum: ["wrong_item", "damaged_product", "size_issue", "not_as_described", "changed_mind", "other"],
      required: true,
    },

    description: {
      type: String,
      default: "",
      maxlength: 500,
    },

    refundAmount: {
      type: Number,
      required: true,
    },

    // ── Refund Method ──────────────────────────────
    refundMethod: {
      type: String,
      enum: [
        "wallet", // Wallet credit — dono ke liye
        "razorpay", // Razorpay refund — sirf online paid
        "bank_transfer", // Manual bank — dono ke liye
        "upi", // UPI transfer — dono ke liye
      ],
      required: true,
    },

    // Bank details — bank_transfer ya upi select kiya toh
    bankDetails: {
      accountHolderName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      upiId: { type: String, default: "" },
    },

    // ── Status ──────────────────────────────────────
    status: {
      type: String,
      // "approving" — atomic claim state committed before an admin's
      // approval mutates money/stock, so a retry can't double-process the
      // same request (see adminReturnController.js). Previously missing
      // from this enum even though the code writes it via findOneAndUpdate
      // (which skips validators), so it silently bypassed schema validation.
      enum: ["pending", "approving", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    rejectionReason: {
      type: String,
      default: "",
    },

    processedAt: {
      type: Date,
      default: null,
    },

    processedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Razorpay refund ID — if refundMethod is razorpay
    razorpayRefundId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

returnRequestSchema.index({ status: 1, createdAt: -1 }); // admin panel sorted list ke liye
returnRequestSchema.index({ order: 1, user: 1 }, { unique: true });

export default mongoose.model<IReturnRequest>("ReturnRequest", returnRequestSchema);
