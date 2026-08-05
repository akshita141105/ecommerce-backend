import mongoose from "mongoose";

const contactMessageSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        orderId: {
            type: String,
            trim: true,
            default: null,
        },
        subject: {
            type: String,
            trim: true,
            default: "General Inquiry",
        },
        message: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ["new", "in_progress", "resolved"],
            default: "new",
        },
        resolutionNote: {
            type: String,
            default: null,
            trim: true,
        },
    },
    { timestamps: true }
);

// Helpful for admin panel: quickly filter unresolved messages, sorted by newest first
contactMessageSchema.index({ status: 1, createdAt: -1 });

const ContactMessage = mongoose.model("ContactMessage", contactMessageSchema);

export default ContactMessage;
