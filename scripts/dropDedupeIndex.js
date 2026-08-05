// scripts/recreateDedupeIndex.js
// Recreates a PARTIAL unique index on dedupeKey:
// - unique when dedupeKey is a real string (prevents true duplicates)
// - does NOT apply to documents where dedupeKey is null/missing
// Run once: node scripts/recreateDedupeIndex.js

import mongoose from "mongoose";
import dotenv from "dotenv";

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

    const collection = mongoose.connection.collection("adminnotifications");

    console.log("\n🏗️  Creating partial unique index on dedupeKey...");
    await collection.createIndex(
        { dedupeKey: 1 },
        {
            unique: true,
            partialFilterExpression: { dedupeKey: { $type: "string" } },
            name: "dedupeKey_1_partial_unique",
        }
    );
    console.log("✅ Created: dedupeKey_1_partial_unique");

    const indexes = await collection.indexes();
    console.log("\n📋 Current indexes:");
    console.table(indexes.map(i => ({
        name: i.name,
        key: JSON.stringify(i.key),
        unique: !!i.unique,
        partial: !!i.partialFilterExpression,
    })));

    await mongoose.disconnect();
    console.log("\n✅ Done.");
    process.exit(0);
}

run().catch((err) => {
    console.error("❌ Script failed:", err.message);
    process.exit(1);
});