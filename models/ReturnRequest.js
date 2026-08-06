import mongoose from "mongoose";

const returnRequestSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        order: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            required: true,
        },

        // Items being returned
        items: [
            {
                product:       { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
                name:          { type: String, required: true },
                image:         { type: String, default: "" },
                selectedSize:  { type: String },
                selectedColor: { type: String },
                quantity:      { type: Number, required: true },
                price:         { type: Number, required: true },
            },
        ],

        // Return reason
        reason: {
            type: String,
            enum: [
                "wrong_item",
                "damaged_product",
                "size_issue",
                "not_as_described",
                "changed_mind",
                "other",
            ],
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
                "wallet",           // Wallet credit — dono ke liye
                "razorpay",         // Razorpay refund — sirf online paid
                "bank_transfer",    // Manual bank — dono ke liye
                "upi",              // UPI transfer — dono ke liye
            ],
            required: true,
        },

        // Bank details — bank_transfer ya upi select kiya toh
        bankDetails: {
            accountHolderName: { type: String, default: "" },
            accountNumber:     { type: String, default: "" },
            ifscCode:          { type: String, default: "" },
            upiId:             { type: String, default: "" },
        },

        // ── Status ──────────────────────────────────────
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
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
            type: mongoose.Schema.Types.ObjectId,
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

// user: 1 aur status: 1 already inline hain ✅
// Yeh add karo
returnRequestSchema.index({ status: 1, createdAt: -1 }); // admin panel sorted list ke liye
returnRequestSchema.index({ order: 1, user: 1 }, { unique: true });

export default mongoose.model("ReturnRequest", returnRequestSchema);