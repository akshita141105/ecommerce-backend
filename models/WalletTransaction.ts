import mongoose, { Schema, type Document, type Types } from "mongoose";

export type WalletTransactionType = "credit" | "debit";
export type WalletTransactionReason = "return_approved" | "order_payment" | "admin_credit" | "admin_debit" | "wallet_release";

// ─────────────────────────────────────────────
// 💰 Wallet Transaction Model
// ─────────────────────────────────────────────
export interface IWalletTransaction extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: WalletTransactionType;
  amount: number;
  balanceAfter: number;
  reason: WalletTransactionReason;
  description: string;
  orderId: Types.ObjectId | null;
  returnId: Types.ObjectId | null;
  createdAt: Date;
}

const walletTransactionSchema = new Schema<IWalletTransaction>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Balance after this transaction
    balanceAfter: {
      type: Number,
      required: true,
    },

    reason: {
      type: String,
      enum: [
        "return_approved", // Return se credit
        "order_payment", // Order mein use kiya
        "admin_credit", // Admin ne manually add kiya
        "admin_debit", // Admin ne manually deduct kiya
        "wallet_release", // Reserved wallet amount released back
      ],
      required: true,
    },

    description: {
      type: String,
      required: true,
    },

    // Reference — order ya return se link
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },

    returnId: {
      type: Schema.Types.ObjectId,
      ref: "ReturnRequest",
      default: null,
    },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ user: 1, createdAt: -1 }); // user ki transaction history sorted fetch ke liye
walletTransactionSchema.index({ orderId: 1 }); // order se transactions fetch ke liye
walletTransactionSchema.index({ returnId: 1 }); // return se transactions fetch ke liye

export default mongoose.model<IWalletTransaction>("WalletTransaction", walletTransactionSchema);
