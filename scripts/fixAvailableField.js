// scripts/fixAvailableField.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "../models/Product.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function run() {
    if (!MONGO_URI) {
        console.error("❌ MONGO_URI env variable nahi mila.");
        process.exit(1);
    }

    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected");

    const products = await Product.find({});
    let fixedCount = 0;

    for (const p of products) {
        await p.save(); // pre("validate") hook available ko recalculate karega
        fixedCount++;
    }

    console.log(`${fixedCount} products fixed`);
    await mongoose.disconnect();
    process.exit(0);
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});