import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import connectmongodb from "../db.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/cartItem.js";
import { releaseStock } from "../services/inventoryService.js";
import logger from "../utils/logger.js";

const DRY_RUN = !process.argv.includes("--apply");

const run = async () => {
    await connectmongodb();

    const allCartItems = await CartItem.find({}).lean();

    if (!allCartItems.length) {
        console.log("No cart items found at all.");
        await mongoose.connection.close();
        return;
    }

    // Batch-check which carts actually exist
    const cartIds = [...new Set(allCartItems.map((ci) => ci.cart.toString()))];
    const existingCarts = await Cart.find({ _id: { $in: cartIds } }).select("_id").lean();
    const existingCartIds = new Set(existingCarts.map((c) => c._id.toString()));

    const orphans = allCartItems.filter((ci) => !existingCartIds.has(ci.cart.toString()));

    if (!orphans.length) {
        console.log("reconcileOrphanedCartItems: no orphaned cart items found — nothing to fix.");
        await mongoose.connection.close();
        return;
    }

    console.log(
        `reconcileOrphanedCartItems: found ${orphans.length} orphaned cart item(s)` +
        (DRY_RUN ? " [DRY RUN — no changes will be made]" : " [APPLY MODE]")
    );

    let fixedCount = 0;
    let failedCount = 0;

    for (const item of orphans) {
        console.log(
            `\nOrphaned CartItem ${item._id} | cart: ${item.cart} (not found) | ` +
            `product: ${item.product} | color: ${item.selectedColor} | size: ${item.selectedSize} | qty: ${item.quantity}`
        );

        if (DRY_RUN) {
            console.log(`  would release ${item.quantity} unit(s) and delete this cart item`);
            continue;
        }

        try {
            await releaseStock({
                productId: item.product,
                color: item.selectedColor,
                size: item.selectedSize,
                quantity: item.quantity,
            });

            await CartItem.findByIdAndDelete(item._id);

            fixedCount++;
            console.log(`  ✓ released ${item.quantity} unit(s), deleted orphaned cart item`);
        } catch (err) {
            failedCount++;
            console.error(`  FAILED:`, err.message);
        }
    }

    console.log(
        `\n${DRY_RUN ? "[DRY RUN] Would fix" : "Fixed"}: ${DRY_RUN ? orphans.length : fixedCount} orphan(s)` +
        (failedCount ? ` | failed: ${failedCount}` : "")
    );

    if (DRY_RUN) {
        console.log("\nRun again with --apply to actually release the stock and clean up.");
    }

    await mongoose.connection.close();
};

run().catch((err) => {
    logger.error("reconcileOrphanedCartItems failed:", err);
    process.exit(1);
});