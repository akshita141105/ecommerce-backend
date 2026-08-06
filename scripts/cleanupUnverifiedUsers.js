import mongoose from "mongoose";
import User from "../models/User.js";
import dotenv from "dotenv";

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


    const result = await User.deleteMany({ isVerified: false });

    console.log(`🗑️ Deleted ${result.deletedCount} unverified user(s)`);

    await mongoose.disconnect();
};

run().catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
});