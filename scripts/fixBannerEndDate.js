// scripts/fixBannerEndDate.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import PromoBanner from "../models/PromoBanner.js";


dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const run = async () => {
    if (!MONGO_URI) {
        console.error("❌ MONGO_URI env variable nahi mila.");
        process.exit(1);
    }

    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected");

    const banners = await PromoBanner.find({});
    for (const banner of banners) {
        const fixedEnd = new Date(banner.endDate);
        fixedEnd.setHours(23, 59, 59, 999);
        banner.endDate = fixedEnd;
        await banner.save();
        console.log(`Fixed: ${banner._id} → ${fixedEnd}`);
    }

    await mongoose.disconnect();
}

run();