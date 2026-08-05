// scripts/migrateAvailable.js
import Product from "../models/Product.js";
import connectmongodb from "../db.js";
import dotenv from "dotenv";

dotenv.config();

await connectmongodb();

const products = await Product.find();
for (const p of products) {
    for (const color of p.colors) {
        for (const size of color.sizes) {
            size.available = size.stock - (size.reserved || 0);
        }
    }
    await p.save();
}
console.log(`${products.length} products migrated`);
process.exit(0);