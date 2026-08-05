// models/FailedEmail.js
import mongoose from "mongoose";

const failedEmailSchema = new mongoose.Schema(
    {
        to: { type: String, required: true },
        subject: { type: String, required: true },
        html: { type: String, required: true },
        reason: { type: String, required: true },       // error message
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

export default mongoose.model("FailedEmail", failedEmailSchema);