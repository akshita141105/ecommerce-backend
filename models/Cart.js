// models/Cart.js
import mongoose from "mongoose";

const cartSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
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
            type: mongoose.Schema.Types.ObjectId,
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
cartSchema.methods.refreshExpiry = async function () {
    this.expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.save();
};

// // ─── DEBUG: track every delete operation on Cart ───
// cartSchema.pre("deleteOne", { document: true, query: false }, function (next) {
//     console.log("🔴 Cart.deleteOne (document) called for:", this._id);
//     console.trace();
//     next();
// });

// cartSchema.pre("deleteOne", { document: false, query: true }, function (next) {
//     console.log("🔴 Cart.deleteOne (query) called with filter:", this.getFilter());
//     console.trace();
//     next();
// });

// cartSchema.pre("findOneAndDelete", function (next) {
//     console.log("🔴 Cart.findOneAndDelete called with filter:", this.getFilter());
//     console.trace();
//     next();
// });

// cartSchema.pre("deleteMany", function (next) {
//     console.log("🔴 Cart.deleteMany called with filter:", this.getFilter());
//     console.trace();
//     next();
// });

export default mongoose.model("Cart", cartSchema);