// controllers/admin/adminReturnController.js — approveReturn (FIXED)
import mongoose from "mongoose";
import Razorpay from "razorpay";
import ReturnRequest from "../../models/ReturnRequest.js";
import Order from "../../models/Order.js";
import { creditWallet } from "../user/walletController.js";
import { restockItem } from "../../services/inventoryService.js"; // ✅ NEW IMPORT
import logger from "../../utils/logger.js";
import User from "../../models/User.js";
import { checkReturnRateRisk } from "../../utils/riskFlags.js";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export const approveReturn = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const adminId = req.user._id;

    const returnReq = await ReturnRequest.findById(req.params.returnId)
      .populate("order")
      .session(session);

    if (!returnReq) {
      return res.status(404).json({ message: "Return request not found" });
    }

    if (returnReq.status !== "pending") {
      return res.status(400).json({ message: `Return already ${returnReq.status}` });
    }

    const { refundMethod, refundAmount, user: userId, order } = returnReq;

    // ── 1. Wallet Credit ──────────────────────
    if (refundMethod === "wallet") {
      await creditWallet(
        userId,
        refundAmount,
        "return_approved",
        `Refund for return #${String(returnReq._id).slice(-8).toUpperCase()}`,
        order._id,
        returnReq._id,
        session
      );
      logger.info(`Wallet credited: ₹${refundAmount} to user ${userId}`);
    }

    // ── 2. Razorpay Refund ────────────────────
    else if (refundMethod === "razorpay") {
      if (!order.paymentId) {
        await session.abortTransaction();
        return res.status(400).json({
          message: "Payment ID not found. Cannot process Razorpay refund.",
        });
      }

      try {
        const razorpayRefund = await razorpay.payments.refund(order.paymentId, {
          amount: refundAmount * 100,
          notes: {
            reason: returnReq.reason,
            returnId: String(returnReq._id),
            orderId: String(order._id),
          },
        });

        returnReq.razorpayRefundId = razorpayRefund.id;
        logger.info(`Razorpay refund initiated: ${razorpayRefund.id} | ₹${refundAmount}`);
      } catch (rzpErr) {
        await session.abortTransaction();
        logger.error("Razorpay refund failed:", rzpErr);
        return res.status(500).json({
          message: "Razorpay refund failed: " + rzpErr.message,
        });
      }
    }

    // ── 3. Bank/UPI Transfer ──────────────────
    else if (refundMethod === "bank_transfer" || refundMethod === "upi") {
      logger.info(
        `Manual transfer required: ₹${refundAmount} to ${refundMethod === "upi"
          ? `UPI: ${returnReq.bankDetails?.upiId}`
          : `Account: ${returnReq.bankDetails?.accountNumber}`
        }`
      );
    }

    // ═══════════════════════════════════════════════════════════
    // ✅ STOCK WAPAS KARO — refund ke baad, status update se pehle
    //
    // returnReq.items use karo — tera schema confirm karta hai ki
    // yeh hamesha specific product/color/size/quantity hold karta hai
    // (partial returns support karta hai, poora order.items nahi)
    // ═══════════════════════════════════════════════════════════
    for (const item of returnReq.items) {
      // Defensive guard — schema mein product field required:true nahi hai,
      // agar kabhi missing ho toh restockItem ko galat call jaane se roko
      if (!item.product) {
        logger.warn(
          `Return ${returnReq._id}: item "${item.name}" has no product reference — skipping restock`
        );
        continue;
      }

      await restockItem(
        {
          productId: item.product,
          color: item.selectedColor,
          size: item.selectedSize,
          quantity: item.quantity,
        },
        session // same transaction ke andar — agar koi step fail ho toh sab rollback
      );
    }

    logger.info(
      `Stock restocked for return ${returnReq._id} | ${returnReq.items.length} item(s)`
    );

    // ── Update return status ──
    returnReq.status = "approved";
    returnReq.processedAt = new Date();
    returnReq.processedBy = adminId;
    await returnReq.save({ session });

    // ── Update order status ──
    await Order.findByIdAndUpdate(
      order._id,
      { orderStatus: "returned" },
      { session }
    );

    await session.commitTransaction();

    logger.info(`Return approved: ${returnReq._id} | Method: ${refundMethod} | ₹${refundAmount}`);


    // ✅ Return rate risk check — transaction ke bahar, response ko block nahi karna
    (async () => {
      try {
        const [totalOrders, approvedReturnsCount, user] = await Promise.all([
          Order.countDocuments({ user: userId }),
          ReturnRequest.countDocuments({ user: userId, status: "approved" }),
          User.findById(userId),
        ]);
        if (user && totalOrders > 0) {
          const returnRate = approvedReturnsCount / totalOrders;
          await checkReturnRateRisk(user, returnRate, totalOrders);
        }
      } catch (e) {
        logger.error("checkReturnRateRisk failed:", e);
      }
    })();

    const message =
      refundMethod === "wallet"
        ? `Return approved. ₹${refundAmount} credited to wallet.`
        : refundMethod === "razorpay"
          ? `Return approved. ₹${refundAmount} refund initiated (5-7 days).`
          : `Return approved. Please manually transfer ₹${refundAmount} to the user.`;

    return res.status(200).json({ success: true, message });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

// GET ALL RETURNS — admin
// GET /api/admin/returns
export const getAllReturns = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [total, returns] = await Promise.all([
      ReturnRequest.countDocuments(filter),
      ReturnRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("user", "name email")
        .populate("order", "totalAmount createdAt paymentStatus paymentId"),
    ]);

    return res.status(200).json({
      success: true,
      returns,
      total,
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    next(err);
  }
};

// GET SINGLE RETURN — admin
// GET /api/admin/returns/:returnId
export const getSingleReturn = async (req, res, next) => {
  try {
    const returnReq = await ReturnRequest.findById(req.params.returnId)
      .populate("user", "name email")
      .populate("order", "totalAmount createdAt paymentStatus paymentId items");

    if (!returnReq) {
      return res.status(404).json({ message: "Return request not found" });
    }

    return res.status(200).json({ success: true, returnRequest: returnReq });
  } catch (err) {
    next(err);
  }
};

// REJECT RETURN — admin
// PATCH /api/admin/returns/:returnId/reject
export const rejectReturn = async (req, res, next) => {
  try {
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }

    const returnReq = await ReturnRequest.findById(req.params.returnId);
    if (!returnReq) {
      return res.status(404).json({ message: "Return request not found" });
    }

    if (returnReq.status !== "pending") {
      return res.status(400).json({ message: `Return already ${returnReq.status}` });
    }

    returnReq.status = "rejected";
    returnReq.rejectionReason = rejectionReason;
    returnReq.processedAt = new Date();
    returnReq.processedBy = req.user._id;
    await returnReq.save();

    logger.info(`Return rejected: ${returnReq._id} | Reason: ${rejectionReason}`);

    return res.status(200).json({
      success: true,
      message: "Return request rejected",
    });
  } catch (err) {
    next(err);
  }
};