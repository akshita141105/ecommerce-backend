import mongoose from 'mongoose';
import { addressSchema } from './Address.js';

const userSchema = new mongoose.Schema({
    name: {
        required: true,
        trim: true,
        type: String,
        minlength: 3
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
        required: true
    },
    otp: {
        type: String
    },
    otpExpires: {
        type: Date
    },
    lastOtpSentAt: {
        type: Date
    },
    otpRequestCount: {
        type: Number,
        default: 0
    },
    otpRequestResetTime: {
        type: Date
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    resetToken: {
        type: String
    },
    resetTokenExpires: {
        type: Date
    },
    resetRequestCount: {
        type: Number,
        default: 0
    },
    resetRequestResetTime: {
        type: Date
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: "user"
    },
    isBlocked: {
        type: Boolean,
        default: false
    },
    blockedReason: {
        type: String,
        default: null
    },
    blockedAt: {
        type: Date,
        default: null
    },

    addresses: [addressSchema],

    wishlist: [
        {
            productId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product"
            },
            color: {
                type: String,
                required: true
            }
        }
    ],

    createdAt: {
        type: Date,
        default: Date.now
    },

    walletBalance : {
        type: Number,
        default : 0,
        min : 0,
    },

    refreshToken: {
        type: String,
        default: null,
        select: false   // normal find/findOne queries mein return nahi hoga, security ke liye
    },

    walletReserved: { type: Number, default: 0 },
});

// Schema ke baad add karo
userSchema.index({ role: 1 });           // admin queries ke liye
userSchema.index({ isVerified: 1 });     // unverified users filter ke liye
userSchema.index({ otpExpires: 1 });     // expired OTP cleanup ke liye
// email unique hai toh auto-indexed hai ✅

export default mongoose.model('User', userSchema);