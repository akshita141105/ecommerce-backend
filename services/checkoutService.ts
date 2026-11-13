// services/checkoutService.ts
// Business logic shared by the payment/COD checkout flows in
// controllers/user/paymentController.js — cart validation/pricing, stale
// pending-order cleanup, and the "new order" admin notification, kept out
// of the controller so it only handles request/response plumbing.
import type { ClientSession, Types } from "mongoose";
import Cart, { type ICart } from "../models/Cart.js";
import CartItem, { type ICartItem } from "../models/CartItem.js";
import Order, { type IOrder, type IOrderItem } from "../models/Order.js";
import User, { type IUser } from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import type { IProduct } from "../models/Product.js";
import logger from "../utils/logger.js";
import { AppError } from "../utils/AppError.js";
import { calculateoffer } from "./offer.js";
import { releaseStock } from "./inventoryService.js";
import { notifyAdmin } from "../utils/notifyAdmin.js";

type OrderItemDraft = Pick<IOrderItem, "product" | "name" | "quantity" | "selectedColor" | "selectedSize" | "price" | "image">;

type PopulatedCartItem = Omit<ICartItem, "product"> & { product: IProduct };

// ─── Validate the user's active cart and price it ──
export const validateCartAndCalculate = async (
  userId: Types.ObjectId | string,
  session: ClientSession
): Promise<{ cart: ICart; cartItems: PopulatedCartItem[]; subtotal: number; orderItems: OrderItemDraft[] }> => {
  const cart = await Cart.findOne({ user: userId, status: "active" }).session(session);
  if (!cart) throw new AppError("Cart not found", 400);

  const cartItems = await CartItem.find({ cart: cart._id })
    .populate<{ product: IProduct }>("product")
    .session(session);

  if (!cartItems.length) throw new AppError("Cart is empty", 400);

  let subtotal = 0;
  const orderItems: OrderItemDraft[] = [];

  for (const item of cartItems) {
    const product = item.product;
    if (!product) throw new AppError("One or more products no longer exist", 400);

    const colorObj = product.colors.find((c) => c.colorName === item.selectedColor);
    if (!colorObj) {
      throw new AppError(`Color "${item.selectedColor}" not available for ${product.name}`, 400);
    }

    const sizeObj = colorObj.sizes.find((s) => s.size === item.selectedSize);
    if (!sizeObj) {
      throw new AppError(`Size "${item.selectedSize}" not available for ${product.name}`, 400);
    }

    const available = sizeObj.available ?? sizeObj.stock - (sizeObj.reserved ?? 0);

    if (available < item.quantity) {
      throw new AppError(`Insufficient stock for ${product.name} (${item.selectedSize}) — only ${available} left`, 400);
    }

    const { finalprice } = calculateoffer(product);
    const effectivePrice = finalprice;
    subtotal += effectivePrice * item.quantity;

    orderItems.push({
      product: product._id,
      name: product.name,
      quantity: item.quantity,
      selectedColor: item.selectedColor,
      selectedSize: item.selectedSize,
      price: effectivePrice, // offer price stored, not the raw product price
      image: colorObj?.images[0] || "",
    });
  }

  return { cart, cartItems, subtotal, orderItems };
};

// ─── Release a stale pending order: refund any reserved wallet amount and
// release any reserved stock, then mark it expired. Returns the updated
// User doc if a wallet reservation was released, otherwise null. Used when a
// new checkout attempt finds an old Razorpay order that's no longer valid. ──
export const releaseStaleOrder = async (existingOrder: IOrder, userId: Types.ObjectId | string, session: ClientSession): Promise<IUser | null> => {
  let updatedUser: IUser | null = null;

  if (existingOrder.walletUsed > 0) {
    updatedUser = await User.findOneAndUpdate(
      { _id: userId },
      [
        {
          $set: {
            walletBalance: { $add: [{ $ifNull: ["$walletBalance", 0] }, existingOrder.walletUsed] },
            walletReserved: {
              $max: [0, { $subtract: [{ $ifNull: ["$walletReserved", 0] }, existingOrder.walletUsed] }],
            },
          },
        },
      ],
      { session, new: true }
    );

    if (updatedUser) {
      await WalletTransaction.create(
        [
          {
            user: userId,
            type: "credit",
            amount: existingOrder.walletUsed,
            balanceAfter: updatedUser.walletBalance,
            reason: "wallet_release",
            description: `Released — Order #${existingOrder._id.toString().slice(-8).toUpperCase()} expired`,
            orderId: existingOrder._id,
          },
        ],
        { session }
      );
    }
  }

  // Stale order's reserved stock must also be released — otherwise it's a
  // permanent leak (paymentStatus alone used to be set to "expired" while
  // the reservation stayed on the product forever).
  if (!existingOrder.stockReleased) {
    for (const item of existingOrder.items) {
      try {
        await releaseStock(
          {
            productId: item.product,
            color: item.selectedColor as string,
            size: item.selectedSize as string,
            quantity: item.quantity as number,
          },
          session
        );
      } catch (releaseErr) {
        logger.error(`Failed to release stock for stale order ${existingOrder._id} item ${item.product}:`, releaseErr);
        // Abort the whole transaction — marking the order "expired" isn't
        // safe if stock release failed, or the orphaned-reservation
        // problem this exists to fix would just recur.
        throw releaseErr;
      }
    }
  }

  await Order.findByIdAndUpdate(existingOrder._id, { $set: { stockReleased: true, paymentStatus: "expired" } }, { session });

  return updatedUser;
};

interface NotifyNewOrderOptions {
  label?: string;
  extraMessage: string;
}

// ─── Fire the admin "new order placed" notification — same shape whether the
// order was paid fully by wallet or placed COD. ──
export const notifyNewOrder = (order: IOrder, itemCount: number, { label = "New order", extraMessage }: NotifyNewOrderOptions) => {
  notifyAdmin({
    type: order.totalAmount >= 10000 ? "HIGH_VALUE_ORDER" : "NEW_ORDER",
    severity: order.totalAmount >= 10000 ? "high" : "medium",
    title: `${label} #${order._id.toString().slice(-6)} — ₹${order.totalAmount}`,
    message: `${itemCount} item(s) · ${extraMessage}`,
    link: `/orders/${order._id}`,
    data: { orderId: order._id, amount: order.totalAmount },
  }).catch((err) => logger.error("notifyAdmin failed:", err));
};
