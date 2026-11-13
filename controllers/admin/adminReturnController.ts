// controllers/admin/adminReturnController.ts — approveReturn (FIXED)
import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import type { FilterQuery } from "mongoose";
import ReturnRequest, { type IReturnRequest } from "../../models/ReturnRequest.js";
import Order, { type IOrder } from "../../models/Order.js";
import { creditWallet } from "../user/walletController.js";
import { restockItem } from "../../services/inventoryService.js";
import logger from "../../utils/logger.js";
import User from "../../models/User.js";
import { checkReturnRateRisk } from "../../utils/riskFlags.js";
import { getRazorpay } from "../../config/razorpay.js";
import { notifyAdmin } from "../../utils/notifyAdmin.js";

export const approveReturn = async (req: Request, res: Response, next: NextFunction) => {
  const returnId = req.params.returnId as string;
  const adminId = req.user!._id;

  // ── Atomic claim, committed immediately — separate from the transaction
  // below on purpose. Sirf tabhi "pending" se "approving" pe set karega jab
  // abhi bhi pending hai (double-approval guard). Committing this BEFORE the
  // Razorpay refund call (instead of inside the same transaction as the
  // refund) is what makes retries safe: if something after the refund
  // fails, we must never roll this claim back to "pending", or a retry
  // could fire a second real-money refund for the same return.
  const claimed = await ReturnRequest.findOneAndUpdate({ _id: returnId, status: "pending" }, { $set: { status: "approving" } }, { new: true });

  if (!claimed) {
    const check = await ReturnRequest.findById(returnId).lean();
    if (!check) return res.status(404).json({ message: "Return request not found" });
    return res.status(400).json({ message: `Return already ${check.status}` });
  }

  // Only ever called before any external refund call succeeds — releases
  // the claim so the request can be retried normally.
  const releaseClaim = () => ReturnRequest.findOneAndUpdate({ _id: returnId, status: "approving" }, { $set: { status: "pending" } }).catch(() => {});

  // Called once real money has already left the business — deliberately
  // does NOT release the claim, so a retry can never re-trigger a
  // duplicate refund. Surfaces it for manual admin resolution instead.
  const flagForManualReview = (reason: string) => {
    logger.error(`Return ${returnId}: refund sent but approval failed to finalize — needs manual review: ${reason}`);
    notifyAdmin({
      type: "RETURN_APPROVAL_INCOMPLETE",
      severity: "critical",
      title: `Return #${returnId} refunded but not finalized`,
      message: `A refund was sent for this return but the approval couldn't be completed (${reason}). Do not re-approve — resolve manually.`,
      link: `/returns/${returnId}`,
    }).catch(() => {});
  };

  const session = await mongoose.startSession();
  session.startTransaction();
  let moneyAlreadyMoved = false;

  try {
    const returnReq = await ReturnRequest.findById(returnId).populate<{ order: IOrder }>("order").session(session);

    const { refundMethod, refundAmount, user: userId, order } = returnReq!;

    // ── 1. Wallet Credit ──────────────────────
    if (refundMethod === "wallet") {
      await creditWallet(userId, refundAmount, "return_approved", `Refund for return #${String(returnReq!._id).slice(-8).toUpperCase()}`, order._id, returnReq!._id, session);
      logger.info(`Wallet credited: ₹${refundAmount} to user ${userId}`);
    }

    // ── 2. Razorpay Refund ────────────────────
    else if (refundMethod === "razorpay") {
      if (!order.paymentId) {
        await session.abortTransaction();
        await releaseClaim();
        return res.status(400).json({
          message: "Payment ID not found. Cannot process Razorpay refund.",
        });
      }

      let razorpayRefund;
      try {
        razorpayRefund = await getRazorpay().payments.refund(order.paymentId, {
          amount: refundAmount * 100,
          notes: {
            reason: returnReq!.reason,
            returnId: String(returnReq!._id),
            orderId: String(order._id),
          },
        });
      } catch (rzpErr) {
        // Refund call itself failed — nothing external happened, safe to release.
        await session.abortTransaction();
        await releaseClaim();
        logger.error("Razorpay refund failed:", rzpErr);
        return res.status(500).json({
          message: "Razorpay refund failed: " + (rzpErr as Error).message,
        });
      }

      // Real money has now moved outside the DB — anything that fails from
      // here on must NOT release the claim (see flagForManualReview above).
      moneyAlreadyMoved = true;
      returnReq!.razorpayRefundId = razorpayRefund.id;
      logger.info(`Razorpay refund initiated: ${razorpayRefund.id} | ₹${refundAmount}`);
    }

    // ── 3. Bank/UPI Transfer ──────────────────
    else if (refundMethod === "bank_transfer" || refundMethod === "upi") {
      logger.info(
        `Manual transfer required: ₹${refundAmount} to ${refundMethod === "upi" ? `UPI: ${returnReq!.bankDetails?.upiId}` : `Account: ${returnReq!.bankDetails?.accountNumber}`}`
      );
    }

    // ═══════════════════════════════════════════════════════════
    // ✅ STOCK WAPAS KARO — refund ke baad, status update se pehle
    //
    // returnReq.items use karo — tera schema confirm karta hai ki
    // yeh hamesha specific product/color/size/quantity hold karta hai
    // (partial returns support karta hai, poora order.items nahi)
    // ═══════════════════════════════════════════════════════════
    for (const item of returnReq!.items) {
      // Defensive guard — schema mein product field required:true nahi hai,
      // agar kabhi missing ho toh restockItem ko galat call jaane se roko
      if (!item.product) {
        logger.warn(`Return ${returnReq!._id}: item "${item.name}" has no product reference — skipping restock`);
        continue;
      }

      await restockItem(
        {
          productId: item.product,
          color: item.selectedColor as string,
          size: item.selectedSize as string,
          quantity: item.quantity,
        },
        session // same transaction ke andar — agar koi step fail ho toh sab rollback
      );
    }

    logger.info(`Stock restocked for return ${returnReq!._id} | ${returnReq!.items.length} item(s)`);

    // ── Update return status ──
    returnReq!.status = "approved";
    returnReq!.processedAt = new Date();
    returnReq!.processedBy = adminId;
    await returnReq!.save({ session });

    // ── Update order status ──
    await Order.findByIdAndUpdate(order._id, { orderStatus: "returned" }, { session });

    await session.commitTransaction();

    logger.info(`Return approved: ${returnReq!._id} | Method: ${refundMethod} | ₹${refundAmount}`);

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

    if (moneyAlreadyMoved) {
      flagForManualReview((err as Error).message);
      return res.status(500).json({
        message: "Refund was sent but approval couldn't be completed. This has been flagged for manual review — do not retry.",
      });
    }

    await releaseClaim();
    next(err);
  } finally {
    await session.endSession();
  }
};

// GET ALL RETURNS — admin
// GET /api/admin/returns
export const getAllReturns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, page = "1", limit = "20" } = req.query as Record<string, string | undefined>;
    const filter: FilterQuery<IReturnRequest> = {};
    if (status) filter.status = status as IReturnRequest["status"];

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
export const getSingleReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const returnReq = await ReturnRequest.findById(req.params.returnId as string)
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
export const rejectReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rejectionReason } = req.body;
    const returnId = req.params.returnId as string;

    if (!rejectionReason) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }

    const returnReq = await ReturnRequest.findOneAndUpdate(
      { _id: returnId, status: "pending" },
      {
        $set: {
          status: "rejected",
          rejectionReason,
          processedAt: new Date(),
          processedBy: req.user!._id,
        },
      },
      { new: true }
    );

    if (!returnReq) {
      const check = await ReturnRequest.findById(returnId).lean();
      if (!check) return res.status(404).json({ message: "Return request not found" });
      return res.status(400).json({ message: `Return already ${check.status}` });
    }

    logger.info(`Return rejected: ${returnReq._id} | Reason: ${rejectionReason}`);

    return res.status(200).json({
      success: true,
      message: "Return request rejected",
    });
  } catch (err) {
    next(err);
  }
};
