// scripts/backfillAttributeFields.js
import mongoose from "mongoose";
import Product from "../models/Product.js";
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

    const result = await Product.updateMany(
        {
            $or: [
                { type: { $exists: false } },
                { material: { $exists: false } },
                { fit: { $exists: false } },
                { pattern: { $exists: false } },
                { sleeve: { $exists: false } },
                { collar: { $exists: false } },
            ],
        },
        {
            $set: {
                type: "",
                material: "",
                fit: "",
                pattern: "",
                sleeve: "",
                collar: "",
            },
        },
        { multi: true }
    );

    console.log(`Updated ${result.modifiedCount} products`);
    await mongoose.disconnect();
}

run().catch(console.error);