// jobs/expireOrders.js
import mongoose from "mongoose";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { releaseStock } from "../services/inventoryService.js";
import logger from "../utils/logger.js";

const EXPIRY_MINUTES = 20;

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
    let failedCount = 0;

    for (const order of staleOrders) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            for (const item of order.items ?? []) {
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

            if (order.walletUsed > 0) {
                const user = await User.findById(order.user).session(session);
                if (user) {
                    user.walletBalance = (user.walletBalance || 0) + order.walletUsed;
                    user.walletReserved = Math.max(0, (user.walletReserved || 0) - order.walletUsed);
                    await user.save({ session });

                    await WalletTransaction.create(
                        [{
                            user: order.user,
                            type: "credit",
                            amount: order.walletUsed,
                            balanceAfter: user.walletBalance,
                            reason: "wallet_release",
                            description: `Released — Order #${order._id.toString().slice(-8).toUpperCase()} expired`,
                            orderId: order._id,
                        }],
                        { session }
                    );
                }
            }

            await Order.findByIdAndUpdate(
                order._id,
                { $set: { paymentStatus: "expired", stockReleased: true } },
                { session }
            );

            await session.commitTransaction();
            expiredCount++;
            logger.info(`Order expired: ${order._id} | items released: ${order.items?.length ?? 0}`);
        } catch (err) {
            await session.abortTransaction();
            failedCount++;
            logger.error(`Failed to expire order ${order._id}:`, err);
        } finally {
            session.endSession();
        }
    }

    logger.info(`expireStalePendingOrders done | expired: ${expiredCount} | failed/retry-pending: ${failedCount}`);
};