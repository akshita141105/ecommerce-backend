// Ek baar run karo — Node shell mein ya script banao
import Product from "../models/Product.js";
import connectmongodb from "../db.js";
import dotenv from "dotenv";

dotenv.config();

await connectmongodb();

const result = await Product.updateMany(
    {},
    [{
        $set: {
            "colors": {
                $map: {
                    input: "$colors",
                    as: "c",
                    in: {
                        $mergeObjects: ["$$c", {
                            sizes: {
                                $map: {
                                    input: "$$c.sizes",
                                    as: "s",
                                    in: {
                                        $mergeObjects: ["$$s", {
                                            reserved: { $ifNull: ["$$s.reserved", 0] },
                                            // available ka $ifNull ki jagah hamesha recalculate karo
                                            available: { $max: [0, { $subtract: ["$$s.stock", { $ifNull: ["$$s.reserved", 0] }] }] }
                                        }]
                                    }
                                }
                            }
                        }]
                    }
                }
            }
        }
    }]
);

console.log(`✅ Done — ${result.modifiedCount} products updated`);
process.exit(0); // ✅ ADD KARO