// controllers/user/returnController.js
// controllers/user/returnController.js
import ReturnRequest from "../../models/ReturnRequest.js";
import Order from "../../models/Order.js";
import logger from "../../utils/logger.js";
import { notifyAdmin } from "../../utils/notifyAdmin.js"; // ✅ ADD

export const createReturnRequest = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { orderId, reason, description, refundMethod, bankDetails } = req.body;

    if (!orderId || !reason || !refundMethod) {
      return res.status(400).json({
        message: "Order ID, reason and refund method are required",
      });
    }

    const order = await Order.findOne({ _id: orderId, user: userId });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.orderStatus !== "delivered") {
      return res.status(400).json({
        message: "Only delivered orders can be returned",
      });
    }

    const daysDiff = (Date.now() - new Date(order.updatedAt)) / (1000 * 60 * 60 * 24);
    if (daysDiff > 7) {
      return res.status(400).json({
        message: "Return window of 7 days has expired",
      });
    }

    const existing = await ReturnRequest.findOne({ order: orderId, user: userId });
    if (existing) {
      return res.status(400).json({
        message: `Return request already ${existing.status} for this order`,
      });
    }

    if (refundMethod === "razorpay" && order.paymentStatus !== "paid") {
      return res.status(400).json({
        message: "Razorpay refund is only available for online paid orders",
      });
    }

    if (refundMethod === "bank_transfer") {
      if (!bankDetails?.accountNumber || !bankDetails?.ifscCode || !bankDetails?.accountHolderName) {
        return res.status(400).json({
          message: "Account holder name, account number and IFSC code are required",
        });
      }
    }

    if (refundMethod === "upi") {
      if (!bankDetails?.upiId) {
        return res.status(400).json({ message: "UPI ID is required" });
      }
    }

    // ── Atomic create — DB-level unique index (order+user) duplicate ko reject karega ──
    let returnReq;
    try {
      returnReq = await ReturnRequest.create({
        user: userId,
        order: orderId,
        items: order.items,
        reason,
        description: description || "",
        refundAmount: order.subtotal,
        refundMethod,
        bankDetails: bankDetails || {},
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(400).json({ message: "Return request already exists for this order" });
      }
      throw err;
    }

    logger.info(`Return requested: ${returnReq._id} | Order: ${orderId} | Method: ${refundMethod}`);

    await notifyAdmin({
      type: "RETURN_REQUESTED",
      severity: "high",
      title: `Return requested for order #${order._id.toString().slice(-6)}`,
      message: `Reason: ${reason} · ₹${order.subtotal} · ${refundMethod}`,
      link: `/returns?id=${returnReq._id}`,
      data: {
        returnId: returnReq._id,
        orderId: order._id,
        amount: order.totalAmount,
        refundMethod,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Return request submitted successfully",
      returnRequest: returnReq,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET MY RETURNS
// GET /api/returns/my-returns
// ─────────────────────────────────────────────
export const getMyReturns = async (req, res, next) => {
  try {
    const returns = await ReturnRequest.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate("order", "totalAmount createdAt paymentStatus");

    return res.status(200).json({ success: true, returns });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET RETURN STATUS FOR A SPECIFIC ORDER
// GET /api/returns/order/:orderId
// ─────────────────────────────────────────────
export const getReturnByOrder = async (req, res, next) => {
  try {
    const returnReq = await ReturnRequest.findOne({
      order: req.params.orderId,
      user: req.user._id,
    });

    return res.status(200).json({ success: true, returnRequest: returnReq || null });
  } catch (err) {
    next(err);
  }
};