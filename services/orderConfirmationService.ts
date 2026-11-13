import mongoose from "mongoose";
import Order, { type IOrder } from "../models/Order.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import logger from "../utils/logger.js";
import { deductStock } from "./inventoryService.js";
import { notifyAdmin } from "../utils/notifyAdmin.js";

interface ConfirmPaidOrderParams {
  razorpayOrderId: string;
  paymentId: string;
  source: string;
}

export const confirmPaidOrder = async ({ razorpayOrderId, paymentId, source }: ConfirmPaidOrderParams): Promise<IOrder | null> => {
  const session = await mongoose.startSession();
  let order: IOrder | null = null;

  try {
    // session.withTransaction (vs manual start/commit/abort) automatically
    // retries the whole callback on a transient write conflict — e.g. two
    // of the same user's orders confirming near-simultaneously and racing
    // on the same User document — instead of surfacing a hard failure for
    // a payment that actually succeeded.
    await session.withTransaction(async () => {
      order = await Order.findOneAndUpdate({ razorpayOrderId, paymentStatus: "pending" }, { $set: { paymentStatus: "paid", paymentId } }, { new: true, session });

      if (!order) {
        logger.info(`[${source}] Order already processed or not found | razorpayOrderId: ${razorpayOrderId}`);
        return;
      }

      // Convert the reserved wallet amount into an actual debit now
      // that the Razorpay payment is confirmed.
      if (order.walletUsed > 0) {
        const user = await User.findById(order.user).session(session);
        if (user) {
          user.walletReserved = Math.max(0, (user.walletReserved || 0) - order.walletUsed);
          await user.save({ session });

          await WalletTransaction.create(
            [
              {
                user: order.user,
                type: "debit",
                amount: order.walletUsed,
                balanceAfter: user.walletBalance,
                reason: "order_payment",
                description: `Used for Order #${order._id.toString().slice(-8).toUpperCase()}`,
                orderId: order._id,
              },
            ],
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
            color: item.selectedColor as string,
            size: item.selectedSize as string,
            quantity: item.quantity as number,
          },
          session
        );
      }

      const cart = await Cart.findOneAndUpdate({ _id: order.cart, status: "active" }, { $set: { status: "ordered" } }, { session, new: true });

      if (cart) {
        await CartItem.deleteMany({ cart: cart._id }).session(session);
      }
    });
  } catch (err) {
    logger.error(`[${source}] confirmPaidOrder transaction failed:`, err);
    throw err;
  } finally {
    await session.endSession();
  }

  if (!order) return null;

  const confirmedOrder: IOrder = order;
  logger.info(`[${source}] Order ${confirmedOrder._id} confirmed | walletDebited: ${confirmedOrder.walletUsed || 0} | stock deducted`);

  notifyAdmin({
    type: confirmedOrder.totalAmount >= 10000 ? "HIGH_VALUE_ORDER" : "NEW_ORDER",
    severity: confirmedOrder.totalAmount >= 10000 ? "high" : "medium",
    title: `New order #${confirmedOrder._id.toString().slice(-6)} — ₹${confirmedOrder.totalAmount}`,
    message: `${confirmedOrder.items.length} item(s) · Paid online (confirmed via ${source})`,
    link: `/orders/${confirmedOrder._id}`,
    data: { orderId: confirmedOrder._id, amount: confirmedOrder.totalAmount },
  }).catch((err) => logger.error("notifyAdmin failed:", err));

  return confirmedOrder;
};
