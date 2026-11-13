// jobs/expireOrders.js
import mongoose from "mongoose";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { releaseStock } from "../services/inventoryService.js";
import { confirmPaidOrder } from "../services/orderConfirmationService.js";
import { getRazorpay } from "../config/razorpay.js";
import { notifyAdmin } from "../utils/notifyAdmin.js";
import logger from "../utils/logger.js";

const EXPIRY_MINUTES = 20;

// ── Chhota retry helper — transient/write-conflict errors ke liye ──
const isTransientError = (err) =>
    err?.errorLabels?.includes("TransientTransactionError") || err?.code === 112;

const withRetry = async (fn, maxAttempts = 3) => {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (!isTransientError(err) || attempt === maxAttempts) throw err;
            // chhota exponential backoff
            await new Promise((r) => setTimeout(r, 50 * attempt));
        }
    }
    throw lastErr;
};

// ── Ask Razorpay directly whether this order was actually paid before we
// consider expiring it. A lost/delayed webhook must never result in
// silently expiring — and releasing the stock/wallet reservation for — an
// order that was genuinely paid. Returns the captured payment object, or
// null if nothing was captured. Throws if the check itself couldn't be
// completed (caller must treat that as "unknown", not "unpaid").
const findCapturedPayment = async (razorpayOrderId) => {
    if (!razorpayOrderId) return null;
    const { items: payments } = await getRazorpay().orders.fetchPayments(razorpayOrderId);
    return payments?.find((p) => p.status === "captured") ?? null;
};

export const expireStalePendingOrders = async () => {
    const cutoff = new Date(Date.now() - EXPIRY_MINUTES * 60 * 1000);

    const staleOrders = await Order.find({
        paymentStatus: "pending",
        stockReleased: { $ne: true },
        createdAt: { $lt: cutoff },
    }).lean();

    if (!staleOrders.length) return;

    logger.info(`expireStalePendingOrders: found ${staleOrders.length} stale order(s)`);

    let expiredCount = 0;
    let recoveredCount = 0;
    let skippedCount = 0;
    let unverifiedCount = 0;
    let failedCount = 0;

    for (const order of staleOrders) {
        // ── Reconcile with Razorpay before declaring this order dead ──
        let capturedPayment;
        try {
            capturedPayment = await findCapturedPayment(order.razorpayOrderId);
        } catch (err) {
            // Couldn't verify either way — fail safe. Skip this order this
            // cycle rather than risk expiring a payment we can't confirm,
            // and retry the check on the next run.
            unverifiedCount++;
            logger.warn(`expireStalePendingOrders: Razorpay reconciliation check failed for order ${order._id}, skipping this cycle: ${err.message}`);
            continue;
        }

        if (capturedPayment) {
            // Razorpay shows this was actually paid — the webhook (and the
            // client-side verify call) must both have been missed. Recover
            // it through the normal confirmation path instead of expiring it.
            try {
                const confirmed = await confirmPaidOrder({
                    razorpayOrderId: order.razorpayOrderId,
                    paymentId: capturedPayment.id,
                    source: "reconcile",
                });
                if (confirmed) {
                    recoveredCount++;
                    logger.info(`Order recovered via Razorpay reconciliation: ${order._id} | payment: ${capturedPayment.id}`);
                } else {
                    skippedCount++; // already confirmed by something else in the meantime
                }
            } catch (err) {
                failedCount++;
                logger.error(`Order ${order._id}: Razorpay shows a captured payment but confirming it failed — needs manual review:`, err);
                notifyAdmin({
                    type: "ORDER_RECONCILE_FAILED",
                    severity: "critical",
                    title: `Order #${order._id} paid on Razorpay but not recovered`,
                    message: `Razorpay shows a captured payment (${capturedPayment.id}) for this order, but confirming it failed (${err.message}). Resolve manually — do not let this order auto-expire.`,
                    link: `/orders/${order._id}`,
                }).catch(() => {});
            }
            continue;
        }

        // ── Nothing captured on Razorpay's side — safe to expire ──
        const session = await mongoose.startSession();
        try {
            await withRetry(() =>
                session.withTransaction(async () => {
                    // Claim first, atomically, conditional on the order still being
                    // "pending". This is the exact same guard `confirmPaidOrder`
                    // uses (also conditional on `paymentStatus: "pending"`) — so
                    // whichever of the two commits first wins, and the other finds
                    // no matching document and does nothing. Without this claim-
                    // first ordering, a payment that gets confirmed concurrently
                    // with this cron could have its stock released and its order
                    // stamped back to "expired" after it was already paid.
                    const claimed = await Order.findOneAndUpdate(
                        { _id: order._id, paymentStatus: "pending" },
                        { $set: { paymentStatus: "expired", stockReleased: true } },
                        { session, new: true }
                    );

                    if (!claimed) {
                        skippedCount++;
                        return;
                    }

                    for (const item of claimed.items ?? []) {
                        await releaseStock(
                            {
                                productId: item.product,
                                color: item.selectedColor,
                                size: item.selectedSize,
                                quantity: item.quantity,
                            },
                            session
                        );
                    }

                    if (claimed.walletUsed > 0) {
                        const user = await User.findById(claimed.user).session(session);
                        if (user) {
                            user.walletBalance = (user.walletBalance || 0) + claimed.walletUsed;
                            user.walletReserved = Math.max(0, (user.walletReserved || 0) - claimed.walletUsed);
                            await user.save({ session });

                            await WalletTransaction.create(
                                [{
                                    user: claimed.user,
                                    type: "credit",
                                    amount: claimed.walletUsed,
                                    balanceAfter: user.walletBalance,
                                    reason: "wallet_release",
                                    description: `Released — Order #${claimed._id.toString().slice(-8).toUpperCase()} expired`,
                                    orderId: claimed._id,
                                }],
                                { session }
                            );
                        }
                    }

                    expiredCount++;
                    logger.info(`Order expired: ${claimed._id} | items released: ${claimed.items?.length ?? 0}`);
                })
            );
        } catch (err) {
            failedCount++;
            logger.error(`Failed to expire order ${order._id}:`, err);
        } finally {
            await session.endSession();
        }
    }

    logger.info(
        `expireStalePendingOrders done | expired: ${expiredCount} | recovered via reconciliation: ${recoveredCount} | ` +
        `already confirmed: ${skippedCount} | unverified (retry next cycle): ${unverifiedCount} | failed: ${failedCount}`
    );
};