// jobs/reconcilePending.js
import cron from "node-cron";
import Order from "../models/Order.js";
import { notifyAdmin } from "../utils/notifyAdmin.js";
import logger from "../utils/logger.js";

const STUCK_THRESHOLD_MINUTES = 20;

// ✅ FIX: ab ye job status change NAHI karta — sirf admin ko alert karta hai
// agar koi order abhi bhi "pending" hai is threshold ke baad. Actual
// expiry (status change + stock release + wallet release) ka single
// source of truth expireStalePendingOrders() hai. Do jagah se status
// change karna race condition create karta tha — agar ye job pehle
// chal jaata, order "expired" mark ho jaata bina stock/wallet release
// ke, kyunki expireStalePendingOrders sirf "pending" orders dhundhta hai.
export const reconcilePendingOrders = async () => {
    try {
        const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000);

        const stuckOrders = await Order.find({
            paymentStatus: "pending",
            createdAt: { $lte: cutoff },
        }).lean();

        if (!stuckOrders.length) return;

        for (const order of stuckOrders) {
            await notifyAdmin({
                type: "ORDER_STUCK_PENDING",
                severity: "critical",
                title: `Order #${order._id.toString().slice(-6)} stuck in pending`,
                message: `Payment not confirmed for over ${STUCK_THRESHOLD_MINUTES} minutes. Expiry job should clear this shortly — if it persists, manual verification needed.`,
                link: `/orders/${order._id}`,
                data: { orderId: order._id, razorpayOrderId: order.razorpayOrderId, amount: order.totalAmount },
                dedupeKey: `stuck-pending:${order._id}`,
            });
        }

        logger.info(`Reconcile pending: ${stuckOrders.length} stuck order(s) flagged for admin review`);
    } catch (err) {
        logger.error("reconcilePendingOrders cron failed:", err);
    }
};

export const registerReconcilePendingCron = () => {
    cron.schedule("*/15 * * * *", reconcilePendingOrders); // har 15 minute
    logger.info("Cron job registered: reconcilePendingOrders (every 15 min)");
};