// scripts/reconcileExpiredOrderStock.js
//
// ONE-TIME BACKFILL SCRIPT
// Fixes historical data: orders that were already marked "expired"
// by the old (buggy) expireStalePendingOrders job — before it used
// to release reserved stock. Those orders' items are still sitting
// in `reserved` forever. This script finds them and releases stock
// exactly once (guarded by stockReleased flag), same as the fixed
// job now does going forward.
//
// USAGE:
//   node scripts/reconcileExpiredOrderStock.js            → dry run (no writes)
//   node scripts/reconcileExpiredOrderStock.js --apply     → actually releases stock
//
// Safe to re-run: orders already marked stockReleased: true are skipped.

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import connectmongodb from "../db.js";
import Order from "../models/Order.js";
import { releaseStock } from "../services/inventoryService.js";
import logger from "../utils/logger.js";

const DRY_RUN = !process.argv.includes("--apply");

const run = async () => {
    await connectmongodb();

    const target = await Order.find({
        paymentStatus: "expired",
        stockReleased: { $ne: true },
    }).lean();

    if (!target.length) {
        logger.info("reconcileExpiredOrderStock: nothing to fix — all expired orders already reconciled.");
        await mongoose.connection.close();
        return;
    }

    logger.info(
        `reconcileExpiredOrderStock: found ${target.length} expired order(s) with unreleased stock` +
        (DRY_RUN ? " [DRY RUN — no changes will be made]" : " [APPLY MODE]")
    );

    let fixedCount = 0;
    let failedCount = 0;

    for (const order of target) {
        console.log(`\nOrder ${order._id} (created ${order.createdAt.toISOString()}):`);

        if (DRY_RUN) {
            (order.items ?? []).forEach((item) => {
                console.log(
                    `  would release: product=${item.product} color=${item.selectedColor} ` +
                    `size=${item.selectedSize} qty=${item.quantity}`
                );
            });
            continue;
        }

        const releaseResults = await Promise.allSettled(
            (order.items ?? []).map((item) =>
                releaseStock({
                    productId: item.product,
                    color: item.selectedColor,
                    size: item.selectedSize,
                    quantity: item.quantity,
                })
            )
        );

        const failedReleases = releaseResults.filter((r) => r.status === "rejected");

        if (failedReleases.length > 0) {
            failedCount++;
            failedReleases.forEach((r) => {
                console.error(`  FAILED to release an item:`, r.reason?.message ?? r.reason);
            });
            console.log(`  → order ${order._id} left as-is; investigate manually.`);
            continue;
        }

        await Order.findByIdAndUpdate(order._id, {
            $set: { stockReleased: true },
        });

        fixedCount++;
        console.log(`  ✓ released ${order.items?.length ?? 0} item(s), marked stockReleased: true`);
    }

    console.log(
        `\n${DRY_RUN ? "[DRY RUN] Would fix" : "Fixed"}: ${DRY_RUN ? target.length : fixedCount} order(s)` +
        (failedCount ? ` | failed: ${failedCount} (see logs above)` : "")
    );

    if (DRY_RUN) {
        console.log("\nRun again with --apply to actually release the stock.");
    }

    await mongoose.connection.close();
};

run().catch((err) => {
    logger.error("reconcileExpiredOrderStock failed:", err);
    process.exit(1);
});