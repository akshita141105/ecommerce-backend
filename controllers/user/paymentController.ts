import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import Cart from "../../models/Cart.js";
import CartItem from "../../models/CartItem.js";
import Order, { type IOrder } from "../../models/Order.js";
import User, { type IUser } from "../../models/User.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import logger from "../../utils/logger.js";
import { AppError } from "../../utils/AppError.js";
import { calculateShipping, calculateCODFee } from "../../utils/shipping.js";
import { confirmPaidOrder } from "../../services/orderConfirmationService.js";
import { deductStock } from "../../services/inventoryService.js";
import { validateCartAndCalculate, releaseStaleOrder, notifyNewOrder } from "../../services/checkoutService.js";
import { getRazorpay } from "../../config/razorpay.js";

// ─────────────────────────────────────────────
// 💳 CREATE RAZORPAY ORDER
// ✅ Idempotent + wallet-aware:
//    - Wallet-full → order confirmed instantly, wallet debited directly
//    - Partial/no wallet → wallet amount RESERVED (not spent) until
//      Razorpay payment is actually confirmed (see confirmPaidOrder)
// ─────────────────────────────────────────────
export const createPaymentOrder = async (req: Request, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user!._id;
    const { address, idempotencyKey, useWallet } = req.body;

    if (!address?.addressData || !address?.city || !address?.pincode) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Complete address is required" });
    }

    const { cart, subtotal, orderItems } = await validateCartAndCalculate(userId, session);

    let user: IUser | null = null; // lazily fetched once, reused across the function

    // ✅ IDEMPOTENCY CHECK 1: is cart ka koi pending order already hai?
    const existingOrder = await Order.findOne({
      cart: cart._id,
      paymentStatus: "pending",
    }).session(session);

    if (existingOrder) {
      let rzpOrder;
      try {
        rzpOrder = await getRazorpay().orders.fetch(existingOrder.razorpayOrderId as string);
      } catch (fetchErr) {
        logger.warn(`Could not fetch existing Razorpay order ${existingOrder.razorpayOrderId}:`, fetchErr);
      }

      if (rzpOrder && rzpOrder.status === "created") {
        await session.commitTransaction();
        logger.info(`Reusing existing pending order ${existingOrder._id} for cart ${cart._id}`);
        return res.status(200).json({
          key_id: process.env.RAZORPAY_KEY_ID,
          amount: rzpOrder.amount,
          currency: rzpOrder.currency,
          razorpay_order_id: rzpOrder.id,
          orderId: existingOrder._id,
          walletUsed: existingOrder.walletUsed || 0,
        });
      }

      // ✅ Stale order — release any wallet reservation and stock, mark
      // expired (this is what prevents "wallet gone, order never
      // completed" and permanent stock-reservation leaks)
      user = (await releaseStaleOrder(existingOrder, userId, session)) || user;
    }

    // ✅ IDEMPOTENCY CHECK 2: client-generated key se duplicate detect karo
    if (idempotencyKey) {
      const existingByKey = await Order.findOne({ idempotencyKey }).session(session);
      if (existingByKey && existingByKey.paymentStatus === "pending") {
        await session.commitTransaction();
        return res.status(200).json({
          key_id: process.env.RAZORPAY_KEY_ID,
          amount: Math.round((existingByKey.totalAmount - (existingByKey.walletUsed || 0)) * 100),
          currency: "INR",
          razorpay_order_id: existingByKey.razorpayOrderId,
          orderId: existingByKey._id,
          walletUsed: existingByKey.walletUsed || 0,
        });
      }
    }

    const shipping = calculateShipping(subtotal);
    const finalTotal = subtotal + shipping;

    // ─────────────────────────────────────────
    // 💰 WALLET: server-side verify, client ka amount trust nahi karte
    // ─────────────────────────────────────────
    let walletToUse = 0;

    if (useWallet) {
      if (!user) user = await User.findById(userId).session(session);
      if (!user) throw new AppError("User not found", 404);

      const availableBalance = user.walletBalance || 0;
      walletToUse = Math.min(availableBalance, finalTotal);
    }

    const amountDue = finalTotal - walletToUse;

    // ─────────────────────────────────────────
    // CASE 1: Wallet fully covers the amount — no Razorpay order needed.
    // Order confirms instantly, so wallet is debited directly —
    // no reservation window, no race.
    // ─────────────────────────────────────────
    if (walletToUse > 0 && amountDue <= 0) {
      user = await User.findByIdAndUpdate(userId, { $inc: { walletBalance: -walletToUse } }, { session, new: true });

      let order: IOrder;
      try {
        [order] = await Order.create(
          [
            {
              user: userId,
              cart: cart._id,
              idempotencyKey: idempotencyKey || undefined,
              address,
              items: orderItems,
              subtotal,
              shipping,
              tax: 0,
              totalAmount: finalTotal,
              walletUsed: walletToUse,
              paymentMethod: "wallet",
              paymentStatus: "paid",
              paymentId: "wallet_full",
            },
          ],
          { session }
        );
      } catch (createErr) {
        if ((createErr as { code?: number }).code === 11000) {
          await session.abortTransaction();
          const raceOrder = await Order.findOne({ idempotencyKey });
          if (raceOrder) {
            return res.status(200).json({
              message: "Order already placed",
              orderId: raceOrder._id,
              walletUsed: raceOrder.walletUsed || 0,
            });
          }
        }
        throw createErr;
      }

      await WalletTransaction.create(
        [
          {
            user: userId,
            type: "debit",
            amount: walletToUse,
            balanceAfter: user!.walletBalance,
            reason: "order_payment",
            description: `Used for Order #${order._id.toString().slice(-8).toUpperCase()}`,
            orderId: order._id,
          },
        ],
        { session }
      );

      for (const item of orderItems) {
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

      await Cart.findByIdAndUpdate(cart._id, { $set: { status: "ordered" } }, { session });

      await CartItem.deleteMany({ cart: cart._id }).session(session);

      await session.commitTransaction();

      logger.info(`Order fully paid via wallet: ${order._id} | user: ${userId} | walletUsed: ${walletToUse}`);

      notifyNewOrder(order, orderItems.length, { extraMessage: "Paid fully via wallet" });

      return res.status(200).json({
        fullyPaidByWallet: true,
        orderId: order._id,
        walletUsed: walletToUse,
      });
    }

    // ─────────────────────────────────────────
    // CASE 2: Partial or no wallet — Razorpay covers amountDue.
    // Wallet amount (if any) is only RESERVED here — actual debit
    // happens in confirmPaidOrder() once payment is confirmed, and
    // is released back automatically if this order expires.
    // ─────────────────────────────────────────
    if (walletToUse > 0) {
      await User.findByIdAndUpdate(userId, { $inc: { walletBalance: -walletToUse, walletReserved: walletToUse } }, { session });
    }

    const orderId = new mongoose.Types.ObjectId();

    const razorpayOrder = await getRazorpay().orders.create({
      amount: Math.round(amountDue * 100),
      currency: "INR",
      receipt: orderId.toString(), // ✅ guaranteed-unique, tied to the actual order
    });

    let order: IOrder;
    try {
      [order] = await Order.create(
        [
          {
            _id: orderId,
            user: userId,
            cart: cart._id,
            idempotencyKey: idempotencyKey || undefined,
            address,
            items: orderItems,
            subtotal,
            shipping,
            tax: 0,
            totalAmount: finalTotal,
            walletUsed: walletToUse,
            paymentMethod: walletToUse > 0 ? "wallet+razorpay" : "razorpay",
            paymentStatus: "pending",
            razorpayOrderId: razorpayOrder.id,
          },
        ],
        { session }
      );
    } catch (createErr) {
      if ((createErr as { code?: number }).code === 11000) {
        await session.abortTransaction();
        const raceOrder = await Order.findOne({ idempotencyKey });
        if (raceOrder) {
          return res.status(200).json({
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: Math.round((raceOrder.totalAmount - (raceOrder.walletUsed || 0)) * 100),
            currency: "INR",
            razorpay_order_id: raceOrder.razorpayOrderId,
            orderId: raceOrder._id,
            walletUsed: raceOrder.walletUsed || 0,
          });
        }
      }
      throw createErr;
    }

    await session.commitTransaction();

    logger.info(`Payment order created: ${order._id} | Razorpay: ${razorpayOrder.id} | walletReserved: ${walletToUse}`);

    return res.status(200).json({
      key_id: process.env.RAZORPAY_KEY_ID,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      razorpay_order_id: razorpayOrder.id,
      orderId: order._id,
      walletUsed: walletToUse,
    });
  } catch (err) {
    await session.abortTransaction();
    logger.error("createPaymentOrder error:", err);
    next(err);
  } finally {
    await session.endSession();
  }
};

// ─────────────────────────────────────────────
// 🔔 WEBHOOK — Razorpay Payment Captured
// ─────────────────────────────────────────────
export const verifyPaymentWebhook = async (req: Request, res: Response) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET as string;
  const signature = req.headers["x-razorpay-signature"] as string | undefined;

  try {
    if (!signature) {
      logger.warn("Webhook: missing x-razorpay-signature header");
      return res.status(200).json({ message: "Missing signature" });
    }

    // Mounted with express.raw() before express.json() — req.body is a Buffer here.
    const digest = crypto
      .createHmac("sha256", secret)
      .update(req.body as Buffer)
      .digest("hex");

    const digestBuf = Buffer.from(digest, "hex");
    const sigBuf = Buffer.from(signature, "hex");

    if (digestBuf.length !== sigBuf.length || !crypto.timingSafeEqual(digestBuf, sigBuf)) {
      logger.warn("Webhook: Invalid signature received");
      return res.status(200).json({ message: "Invalid signature" });
    }

    const payload = JSON.parse((req.body as Buffer).toString("utf-8"));
    const eventType = payload.event;

    logger.info(`Webhook received: ${eventType}`);

    if (eventType === "payment.failed") {
      const paymentEntity = payload?.payload?.payment?.entity;
      const razorpay_order_id = paymentEntity?.order_id;
      const errorReason = paymentEntity?.error_description || "Payment failed";

      await Order.findOneAndUpdate({ razorpayOrderId: razorpay_order_id, paymentStatus: "pending" }, { paymentStatus: "failed", failureReason: errorReason });

      return res.status(200).json({ message: "Payment failure recorded" });
    }

    if (eventType !== "payment.captured") {
      return res.status(200).json({ message: `Event ${eventType} ignored` });
    }

    const paymentEntity = payload?.payload?.payment?.entity;
    if (!paymentEntity) {
      logger.warn("Webhook: Payment entity missing in payload");
      return res.status(200).json({ message: "Payment entity missing" });
    }

    const { id: razorpay_payment_id, order_id: razorpay_order_id } = paymentEntity;

    try {
      await confirmPaidOrder({
        razorpayOrderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        source: "webhook",
      });
    } catch {
      return res.status(200).json({ message: "Processing error, will retry" });
    }

    return res.status(200).json({ message: "Payment verified and order confirmed" });
  } catch (err) {
    logger.error("Webhook outer error:", err);
    return res.status(200).json({ message: "Webhook error" });
  }
};

// ─────────────────────────────────────────────
// 🚚 CREATE COD ORDER
// ─────────────────────────────────────────────
export const createCODOrder = async (req: Request, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user!._id;
    const { address } = req.body;

    if (!address?.addressData || !address?.city || !address?.pincode) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Complete address is required" });
    }

    const { cart, subtotal, orderItems } = await validateCartAndCalculate(userId, session);

    const existingOrder = await Order.findOne({
      cart: cart._id,
      paymentStatus: { $in: ["pending", "cod"] },
    }).session(session);

    if (existingOrder) {
      await session.abortTransaction();
      return res.status(200).json({
        message: "Order already placed for this cart",
        orderId: existingOrder._id,
      });
    }

    const shipping = calculateShipping(subtotal);
    const codFee = calculateCODFee(subtotal);
    const finalTotal = subtotal + shipping + codFee;

    for (const item of orderItems) {
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

    const [order] = await Order.create(
      [
        {
          user: userId,
          cart: cart._id,
          address,
          items: orderItems,
          subtotal,
          shipping,
          codFee,
          tax: 0,
          totalAmount: finalTotal,
          paymentMethod: "cod",
          paymentStatus: "cod",
        },
      ],
      { session }
    );

    await Cart.findByIdAndUpdate(cart._id, { $set: { status: "ordered" } }, { session });
    await CartItem.deleteMany({ cart: cart._id }).session(session);

    await session.commitTransaction();

    logger.info(`COD Order placed: ${order._id} | user: ${userId}`);

    notifyNewOrder(order, orderItems.length, { label: "New COD order", extraMessage: "Cash on Delivery" });

    return res.status(201).json({
      message: "COD Order placed successfully",
      orderId: order._id,
    });
  } catch (err) {
    await session.abortTransaction();
    logger.error("createCODOrder error:", err);
    next(err);
  } finally {
    await session.endSession();
  }
};

// ─────────────────────────────────────────────
// ✅ VERIFY PAYMENT — Frontend callback
// ─────────────────────────────────────────────
export const verifyPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment verification fields" });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET as string)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.user.toString() !== req.user!._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (order.paymentStatus === "paid") {
      return res.status(200).json({ message: "Payment verified", orderId: order._id });
    }

    const confirmedOrder = await confirmPaidOrder({
      razorpayOrderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      source: "client-verify",
    });

    return res.status(200).json({
      message: "Payment verified",
      orderId: confirmedOrder ? confirmedOrder._id : order._id,
    });
  } catch (err) {
    next(err);
  }
};
