import mongoose, { Schema, type Document, type Types } from "mongoose";
import { addressSchema, type IAddress } from "./Address.js";

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  otp?: string;
  otpExpires?: Date;
  lastOtpSentAt?: Date;
  otpRequestCount: number;
  otpRequestResetTime?: Date;
  isVerified: boolean;
  resetToken?: string;
  resetTokenExpires?: Date;
  resetRequestCount: number;
  resetRequestResetTime?: Date;
  role: "user" | "admin";
  isBlocked: boolean;
  blockedReason: string | null;
  blockedAt: Date | null;
  addresses: Types.DocumentArray<IAddress>;
  createdAt: Date;
  walletBalance: number;
  refreshToken: string | null;
  walletReserved: number;
}

const userSchema = new Schema<IUser>({
  name: {
    required: true,
    trim: true,
    type: String,
    minlength: 3,
  },
  email: {
    required: true,
    unique: true,
    type: String,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  otp: {
    type: String,
  },
  otpExpires: {
    type: Date,
  },
  lastOtpSentAt: {
    type: Date,
  },
  otpRequestCount: {
    type: Number,
    default: 0,
  },
  otpRequestResetTime: {
    type: Date,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  resetToken: {
    type: String,
  },
  resetTokenExpires: {
    type: Date,
  },
  resetRequestCount: {
    type: Number,
    default: 0,
  },
  resetRequestResetTime: {
    type: Date,
  },
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },
  isBlocked: {
    type: Boolean,
    default: false,
  },
  blockedReason: {
    type: String,
    default: null,
  },
  blockedAt: {
    type: Date,
    default: null,
  },

  addresses: [addressSchema],

  // wishlist intentionally removed from here — lives in the WishlistItem collection

  createdAt: {
    type: Date,
    default: Date.now,
  },

  walletBalance: {
    type: Number,
    default: 0,
    min: 0,
  },

  refreshToken: {
    type: String,
    default: null,
    select: false,
  },

  walletReserved: { type: Number, default: 0 },
});

userSchema.index({ role: 1 });
userSchema.index({ isVerified: 1 });
userSchema.index({ otpExpires: 1 });

export default mongoose.model<IUser>("User", userSchema);
