// models/PromoBanner.js
import mongoose from "mongoose";

const promoBannerSchema = new mongoose.Schema(
    {
        imageUrl: { type: String, required: true },
        imagePublicId: { type: String, required: true },
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        isActive: { type: Boolean, default: true },
        linkUrl: { type: String }, // optional - banner click pe redirect
    },
    { timestamps: true }
);

export default mongoose.model("PromoBanner", promoBannerSchema);