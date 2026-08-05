// services/inventoryService.js
import mongoose from "mongoose";
import Product from "../models/Product.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/cartItem.js";
import logger from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────────
// RESERVE — called when item is added to cart
// No pre-read; single atomic findOneAndUpdate guards race conditions.
// If null returned, check whether product/color/size actually exists
// to return a precise error to the caller.
// ─────────────────────────────────────────────────────────────────
export const reserveStock = async (
    { productId, color, size, quantity },
    session = null
) => {
    const updated = await Product.findOneAndUpdate(
        {
            _id: productId,
            colors: {
                $elemMatch: {
                    colorName: color,
                    sizes: { $elemMatch: { size, available: { $gte: quantity } } },
                },
            },
        },
        {
            $inc: {
                "colors.$[c].sizes.$[s].reserved": quantity,
                "colors.$[c].sizes.$[s].available": -quantity,
            },
        },
        {
            arrayFilters: [{ "c.colorName": color }, { "s.size": size }],
            new: true,
            ...(session && { session }),
        }
    );

    if (!updated) {
        // Precise error: distinguish "not found" vs "out of stock"
        const product = await Product.findOne(
            { _id: productId },
            { colors: 1 },
            session ? { session } : {}
        ).lean();

        if (!product) throw new Error("PRODUCT_NOT_FOUND");

        const colorObj = product.colors.find((c) => c.colorName === color);
        if (!colorObj) throw new Error("COLOR_NOT_FOUND");

        const sizeObj = colorObj.sizes.find((s) => s.size === size);
        if (!sizeObj) throw new Error("SIZE_NOT_FOUND");

        throw new Error("INSUFFICIENT_STOCK");
    }

    logger.info(
        `Stock reserved: ${productId} | ${color}/${size} | qty: ${quantity}`
    );
    return updated;
};

// ─────────────────────────────────────────────────────────────────
// RELEASE — called when item is removed from cart / cart expires
// Pipeline update used because arrayFilters don't work with
// aggregation pipelines. $max/$min prevent negative values and
// cap available at stock ceiling.
// ─────────────────────────────────────────────────────────────────
export const releaseStock = async (
    { productId, color, size, quantity },
    session = null
) => {
    const updated = await Product.findOneAndUpdate(
        { _id: productId },
        [
            {
                $set: {
                    colors: {
                        $map: {
                            input: "$colors",
                            as: "c",
                            in: {
                                $cond: [
                                    { $eq: ["$$c.colorName", color] },
                                    {
                                        $mergeObjects: [
                                            "$$c",
                                            {
                                                sizes: {
                                                    $map: {
                                                        input: "$$c.sizes",
                                                        as: "s",
                                                        in: {
                                                            $cond: [
                                                                { $eq: ["$$s.size", size] },
                                                                {
                                                                    $mergeObjects: [
                                                                        "$$s",
                                                                        {
                                                                            reserved: {
                                                                                $max: [
                                                                                    0,
                                                                                    { $subtract: ["$$s.reserved", quantity] },
                                                                                ],
                                                                            },
                                                                            // Cap available at stock ceiling
                                                                            available: {
                                                                                $min: [
                                                                                    "$$s.stock",
                                                                                    { $add: ["$$s.available", quantity] },
                                                                                ],
                                                                            },
                                                                        },
                                                                    ],
                                                                },
                                                                "$$s",
                                                            ],
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                    "$$c",
                                ],
                            },
                        },
                    },
                },
            },
        ],
        { new: true, ...(session && { session }) }
    );

    if (!updated) throw new Error("PRODUCT_NOT_FOUND");

    logger.info(
        `Stock released: ${productId} | ${color}/${size} | qty: ${quantity}`
    );
    return updated;
};

// ─────────────────────────────────────────────────────────────────
// DEDUCT — called on payment success
// Decrements both stock and reserved (available was already
// decremented at reserve time). colorName added to top-level
// $elemMatch to prevent cross-color size matching.
// ─────────────────────────────────────────────────────────────────
export const deductStock = async (
    { productId, color, size, quantity },
    session = null
) => {
    const updated = await Product.findOneAndUpdate(
        {
            _id: productId,
            colors: {
                $elemMatch: {
                    colorName: color,                   // ← prevents cross-color match
                    sizes: {
                        $elemMatch: {
                            size,
                            stock: { $gte: quantity },
                            reserved: { $gte: quantity },
                        },
                    },
                },
            },
        },
        {
            $inc: {
                "colors.$[c].sizes.$[s].stock": -quantity,
                "colors.$[c].sizes.$[s].reserved": -quantity,
            },
        },
        {
            arrayFilters: [{ "c.colorName": color }, { "s.size": size }],
            new: true,
            ...(session && { session }),
        }
    );

    if (!updated) throw new Error("DEDUCT_FAILED");

    logger.info(
        `Stock deducted: ${productId} | ${color}/${size} | qty: ${quantity}`
    );
    return updated;
};

// ─────────────────────────────────────────────────────────────────
// RESTOCK — called on order cancel or return approved
// Increments both stock and available. available is capped at the
// new stock value via pipeline to prevent available > stock drift
// from any double-restock scenario.
// ─────────────────────────────────────────────────────────────────
export const restockItem = async (
    { productId, color, size, quantity },
    session = null
) => {
    const updated = await Product.findOneAndUpdate(
        { _id: productId },
        [
            {
                $set: {
                    colors: {
                        $map: {
                            input: "$colors",
                            as: "c",
                            in: {
                                $cond: [
                                    { $eq: ["$$c.colorName", color] },
                                    {
                                        $mergeObjects: [
                                            "$$c",
                                            {
                                                sizes: {
                                                    $map: {
                                                        input: "$$c.sizes",
                                                        as: "s",
                                                        in: {
                                                            $cond: [
                                                                { $eq: ["$$s.size", size] },
                                                                {
                                                                    $mergeObjects: [
                                                                        "$$s",
                                                                        {
                                                                            // Increment stock first, then derive available
                                                                            stock: { $add: ["$$s.stock", quantity] },
                                                                            available: {
                                                                                // Cap: available cannot exceed new stock
                                                                                $min: [
                                                                                    { $add: ["$$s.stock", quantity] },
                                                                                    { $add: ["$$s.available", quantity] },
                                                                                ],
                                                                            },
                                                                        },
                                                                    ],
                                                                },
                                                                "$$s",
                                                            ],
                                                        },
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                    "$$c",
                                ],
                            },
                        },
                    },
                },
            },
        ],
        { new: true, ...(session && { session }) }
    );

    if (!updated) throw new Error("PRODUCT_NOT_FOUND");

    logger.info(
        `Stock restocked: ${productId} | ${color}/${size} | qty: ${quantity}`
    );
    return updated;
};

// ─────────────────────────────────────────────────────────────────
// RELEASE EXPIRED CART STOCK — called by cron job every 5 min
//
// Flow:
//  0. Recover stale "processing" carts (crash / timeout recovery)
//  1. Atomically claim expired carts with a unique jobId
//  2. Batch-fetch all CartItems for claimed carts (N+1 fix)
//  3. Per cart: release stock → only if ALL releases succeed,
//     mark expired + delete items; otherwise reset to "active"
//     so the next cron run retries cleanly.
// ─────────────────────────────────────────────────────────────────
const STALE_THRESHOLD_MINUTES = 5;

export const releaseExpiredCartStock = async () => {
    // ── Step 0: Stale lock recovery ──────────────────────────────
    const staleThreshold = new Date(
        Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000
    );

    console.log("🔵 CRON STARTED:", new Date());

    const staleResult = await Cart.updateMany(
        { status: "processing", processingStartedAt: { $lte: staleThreshold } },
        {
            $set: { status: "active" },
            $unset: { processingJobId: 1, processingStartedAt: 1 },
        }
    );

    if (staleResult.modifiedCount > 0) {
        logger.warn(
            `Stale locks recovered: ${staleResult.modifiedCount} carts reset to active`
        );
    }

    // ── Step 1: Atomic claim with unique jobId ────────────────────
    const jobId = new mongoose.Types.ObjectId();
    const now = new Date();

    await Cart.updateMany(
        { status: "active", expiresAt: { $lte: now } },
        {
            $set: {
                status: "processing",
                processingJobId: jobId,
                processingStartedAt: now,
            },
        }
    );

    const claimedCarts = await Cart.find({
        status: "processing",
        processingJobId: jobId,
    }).lean();

    console.log("🔵 Claimed carts:", claimedCarts.length, claimedCarts.map(c => c._id.toString()));


    if (!claimedCarts.length) {
        logger.info("releaseExpiredCartStock: no expired carts found");
        return;
    }

    logger.info(
        `releaseExpiredCartStock: claimed ${claimedCarts.length} carts | jobId: ${jobId}`
    );

    // ── Step 2: Batch fetch all items (N+1 fix) ───────────────────
    const cartIds = claimedCarts.map((c) => c._id);
    const allItems = await CartItem.find({ cart: { $in: cartIds } }).lean();

    console.log("🔵 Items found:", allItems.length, allItems.map(i => ({
        product: i.product.toString(),
        color: i.selectedColor,
        size: i.selectedSize,
        qty: i.quantity
    })));

    const itemsByCart = allItems.reduce((acc, item) => {
        const key = item.cart.toString();
        (acc[key] ??= []).push(item);
        return acc;
    }, {});

    // ── Step 3: Process each cart independently ───────────────────
    const results = await Promise.allSettled(
        claimedCarts.map(async (cart) => {
            const items = itemsByCart[cart._id.toString()] ?? [];

            // 3a. Attempt stock release for every item
            const releaseResults = await Promise.allSettled(
                items.map((item) => {
                    console.log("🔵 Attempting release:", item.product.toString(), item.selectedColor, item.selectedSize, item.quantity);
                    return releaseStock({
                        productId: item.product,
                        color: item.selectedColor,
                        size: item.selectedSize,
                        quantity: item.quantity,
                    }).then((res) => {
                        console.log("🟢 Release SUCCESS:", item.product.toString());
                        return res;
                    }).catch((err) => {
                        console.log("🔴 Release FAILED:", item.product.toString(), "-", err.message);
                        throw err;
                    });
                })
            );

            const failedReleases = releaseResults.filter(
                (r) => r.status === "rejected"
            );

            failedReleases.forEach((r, i) => {
                logger.error(
                    `Release failed | cart: ${cart._id} | product: ${items[i]?.product}`,
                    r.reason
                );
            });

            // 3b. If ANY release failed, reset cart to "active" for retry.
            //     Do NOT delete items — stock was not fully released.
            if (failedReleases.length > 0) {
                await Cart.findByIdAndUpdate(cart._id, {
                    $set: { status: "active" },
                    $unset: { processingJobId: 1, processingStartedAt: 1 },
                });

                throw new Error(
                    `Partial release failure | cart: ${cart._id} | ` +
                    `${failedReleases.length}/${items.length} items failed`
                );
            }

            console.log("🟢 All releases succeeded, expiring cart:", cart._id.toString());

            // 3c. All releases succeeded — safe to expire + clean up
            await Cart.findByIdAndUpdate(cart._id, {
                $set: {
                    status: "expired",
                    deleteAfter: new Date(Date.now() + 10 * 60 * 1000),
                },
                $unset: { processingJobId: 1, processingStartedAt: 1 },
            });

            await CartItem.deleteMany({ cart: cart._id });

            logger.info(
                `Cart expired: ${cart._id} | items released: ${items.length}`
            );
        })
    );

    // ── Step 4: Summary log ───────────────────────────────────────
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    if (failed > 0) {
        logger.error(
            `releaseExpiredCartStock done | success: ${succeeded} | ` +
            `failed: ${failed} | jobId: ${jobId}`
        );
    } else {
        logger.info(
            `releaseExpiredCartStock done | success: ${succeeded} | jobId: ${jobId}`
        );
    }
};

// ─────────────────────────────────────────────────────────────────
// HELPER — get available qty for a specific color/size
// ─────────────────────────────────────────────────────────────────
export const getAvailable = (product, color, size) => {
    const colorObj = product.colors.find((c) => c.colorName === color);
    const sizeObj = colorObj?.sizes.find((s) => s.size === size);
    return sizeObj?.available ?? 0;
};
