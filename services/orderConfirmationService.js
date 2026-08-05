import mongoose from "mongoose";
import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/cartItem.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import logger from "../utils/logger.js";
import { deductStock } from "./inventoryService.js";
import { notifyAdmin } from "../utils/notifyAdmin.js";

export const confirmPaidOrder = async ({ razorpayOrderId, paymentId, source }) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const order = await Order.findOneAndUpdate(
            { razorpayOrderId, paymentStatus: "pending" },
            { $set: { paymentStatus: "paid", paymentId } },
            { new: true, session }
        );

        if (!order) {
            await session.abortTransaction();
            logger.info(`[${source}] Order already processed or not found | razorpayOrderId: ${razorpayOrderId}`);
            return null;
        }

        // ✅ Convert the reserved wallet amount into an actual debit now
        // that the Razorpay payment is confirmed.
        if (order.walletUsed > 0) {
            const user = await User.findById(order.user).session(session);
            if (user) {
                user.walletReserved = Math.max(0, (user.walletReserved || 0) - order.walletUsed);
                await user.save({ session });

                await WalletTransaction.create(
                    [{
                        user: order.user,
                        type: "debit",
                        amount: order.walletUsed,
                        balanceAfter: user.walletBalance,
                        reason: "order_payment",
                        description: `Used for Order #${order._id.toString().slice(-8).toUpperCase()}`,
                        orderId: order._id,
                    }],
                    { session }
                );
            } else {
                logger.error(`[${source}] Wallet user not found while confirming order ${order._id}`);
            }
        }

        for (const item of order.items) {
            await deductStock(
                {
                    productId: item.product,
                    color: item.selectedColor,
                    size: item.selectedSize,
                    quantity: item.quantity,
                },
                session
            );
        }

        const cart = await Cart.findOneAndUpdate(
            { _id: order.cart, status: "active" },
            { $set: { status: "ordered" } },
            { session, new: true }
        );

        if (cart) {
            await CartItem.deleteMany({ cart: cart._id }).session(session);
        }

        await session.commitTransaction();

        logger.info(`[${source}] Order ${order._id} confirmed | walletDebited: ${order.walletUsed || 0} | stock deducted`);

        notifyAdmin({
            type: order.totalAmount >= 10000 ? "HIGH_VALUE_ORDER" : "NEW_ORDER",
            severity: order.totalAmount >= 10000 ? "high" : "medium",
            title: `New order #${order._id.toString().slice(-6)} — ₹${order.totalAmount}`,
            message: `${order.items.length} item(s) · Paid online (confirmed via ${source})`,
            link: `/orders/${order._id}`,
            data: { orderId: order._id, amount: order.totalAmount },
        }).catch((err) => logger.error("notifyAdmin failed:", err));

        return order;
    } catch (err) {
        await session.abortTransaction();
        logger.error(`[${source}] confirmPaidOrder transaction failed:`, err);
        throw err;
    } finally {
        session.endSession();
    }
};