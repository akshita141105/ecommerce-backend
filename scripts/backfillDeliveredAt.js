// scripts/backfillDeliveredAt.js
import mongoose from "mongoose";
import Order from "../models/Order.js";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const run = async () => {
    if (!MONGO_URI) {
            console.error("❌ Cant find MONGO_URI");
            process.exit(1);
        }
    
        console.log("Connecting to MongoDB...");
        await mongoose.connect(MONGO_URI);
        console.log("✅ Connected");

    const result = await Order.updateMany(
        { orderStatus: "delivered", deliveredAt: null },
        [{ $set: { deliveredAt: "$updatedAt" } }]
    );

    console.log(`Backfilled ${result.modifiedCount} orders`);
    await mongoose.disconnect();
};

run();