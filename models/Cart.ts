// models/Cart.ts
import mongoose, { Schema, type Document, type Types } from "mongoose";

export type CartStatus = "active" | "ordered" | "expired" | "processing";

export interface ICart extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  status: CartStatus;
  expiresAt: Date;
  deleteAfter: Date | null;
  processingJobId: Types.ObjectId | null;
  processingStartedAt: Date | null;
  refreshExpiry: () => Promise<void>;
}

const cartSchema = new Schema<ICart>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "ordered", "expired", "processing"],
      default: "active",
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 60 * 1000), // 30 min TTL
    },
    deleteAfter: {
      type: Date,
      default: null,
    },
    // ── Cron job lock fields ──
    processingJobId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    processingStartedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// TTL index — expired carts auto-delete after expiresAt
// NOTE: Cart doc delete hoga but reserved stock cron job release karta hai pehle
cartSchema.index({ deleteAfter: 1 }, { expireAfterSeconds: 0 });
cartSchema.index({ status: 1, expiresAt: 1 }); // cron job ke liye
cartSchema.index({ status: 1, processingJobId: 1 }); // claimed carts fetch ke liye
cartSchema.index({ status: 1, processingStartedAt: 1 });

// Extend TTL on cart activity
cartSchema.methods.refreshExpiry = async function (this: ICart) {
  this.expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await this.save();
};

export default mongoose.model<ICart>("Cart", cartSchema);
