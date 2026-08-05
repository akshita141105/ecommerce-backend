import mongoose from "mongoose";

// ─────────────────────────────────────────────
// 💰 Wallet Transaction Model
// ─────────────────────────────────────────────
const walletTransactionSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
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
                "return_approved",   // Return se credit
                "order_payment",     // Order mein use kiya
                "admin_credit",      // Admin ne manually add kiya
                "admin_debit",       // Admin ne manually deduct kiya
            ],
            required: true,
        },

        description: {
            type: String,
            required: true,
        },

        // Reference — order ya return se link
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            default: null,
        },

        returnId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ReturnRequest",
            default: null,
        },
    },
    { timestamps: true }
);

// user: 1 already inline hai ✅
// Yeh add karo — user ki transaction history sorted fetch ke liye
walletTransactionSchema.index({ user: 1, createdAt: -1 });
walletTransactionSchema.index({ orderId: 1 });    // order se transactions fetch ke liye
walletTransactionSchema.index({ returnId: 1 });   // return se transactions fetch ke liye

export default mongoose.model("WalletTransaction", walletTransactionSchema);