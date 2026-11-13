// controllers/admin/adminOrderController.ts
import type { NextFunction, Request, Response } from "express";
import type { FilterQuery } from "mongoose";
import Order, { type IOrder, type OrderStatus } from "../../models/Order.js";
import ReturnRequest from "../../models/ReturnRequest.js";
import logger from "../../utils/logger.js";
import mongoose from "mongoose";
import User from "../../models/User.js";
import puppeteer, { type Browser } from "puppeteer";
import { restockItem } from "../../services/inventoryService.js";
import { creditWallet } from "../user/walletController.js";
import { notifyAdmin } from "../../utils/notifyAdmin.js";
import client from "../../config/redis.js";
import { generateInvoiceHTML } from "../../utils/invoiceTemplate.js";

const DEFAULT_LIMIT = 20;

// Dashboard stats/recent-orders/revenue-chart are Redis-cached — any order
// status change (including cancellation) needs to invalidate them so the
// dashboard doesn't keep showing pre-change numbers until the TTL expires.
const invalidateDashboardCache = async () => {
  const statsKeys = await client.keys("admin:dashboard:stats:*");
  const chartKeys = await client.keys("admin:dashboard:chart:*");
  const keys = ["admin:dashboard:recent-orders", ...statsKeys, ...chartKeys];
  await client.del(keys);
};

// ─────────────────────────────────────────────
// GET ALL ORDERS
// GET /api/admin/orders
// Query: page, limit, status, paymentStatus, search, from, to
// ─────────────────────────────────────────────
export const getAllOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = "1", limit = String(DEFAULT_LIMIT), status, paymentStatus, search, from, to } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, parseInt(limit) || DEFAULT_LIMIT);
    const skip = (pageNum - 1) * limitNum;

    const filter: FilterQuery<IOrder> = {};

    if (status && status !== "all") filter.orderStatus = status as OrderStatus;
    if (paymentStatus && paymentStatus !== "all") filter.paymentStatus = paymentStatus;

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = toDate;
      }
    }

    // orderId, address.fullName, aur User ka name/email teeno match karega
    if (search?.trim()) {
      const s = search.trim();

      if (mongoose.Types.ObjectId.isValid(s)) {
        filter._id = new mongoose.Types.ObjectId(s);
      } else {
        const matchingUsers = await User.find({
          $or: [{ name: { $regex: s, $options: "i" } }, { email: { $regex: s, $options: "i" } }],
        })
          .select("_id")
          .lean();

        const userIds = matchingUsers.map((u) => u._id);

        filter.$or = [{ "address.fullName": { $regex: s, $options: "i" } }, ...(userIds.length ? [{ user: { $in: userIds } }] : [])];
      }
    }

    const [orders, total, stats] = await Promise.all([
      Order.find(filter).populate("user", "name email phone").sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),

      Order.countDocuments(filter),

      Order.aggregate([
        { $match: from || to ? { createdAt: filter.createdAt } : {} },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: {
              $sum: {
                $cond: [{ $in: ["$paymentStatus", ["paid", "cod"]] }, "$totalAmount", 0],
              },
            },
            pending: { $sum: { $cond: [{ $eq: ["$orderStatus", "placed"] }, 1, 0] } },
            processing: { $sum: { $cond: [{ $eq: ["$orderStatus", "processing"] }, 1, 0] } },
            shipped: { $sum: { $cond: [{ $eq: ["$orderStatus", "shipped"] }, 1, 0] } },
            delivered: { $sum: { $cond: [{ $eq: ["$orderStatus", "delivered"] }, 1, 0] } },
          },
        },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      stats: stats[0] ?? {
        totalOrders: 0,
        totalRevenue: 0,
        pending: 0,
        processing: 0,
        shipped: 0,
        delivered: 0,
      },
      orders,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET SINGLE ORDER DETAIL
// GET /api/admin/orders/:id
// ─────────────────────────────────────────────
export const getOrderDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(id).populate("user", "name email phone walletBalance").lean();

    if (!order) return res.status(404).json({ message: "Order not found" });

    const returnRequest = await ReturnRequest.findOne({ order: order._id }).lean();

    return res.status(200).json({ success: true, order, returnRequest });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// UPDATE ORDER STATUS
// PATCH /api/admin/orders/:id/status
// Body: { status } — placed | processing | shipped | delivered
// ─────────────────────────────────────────────
const VALID_STATUSES: OrderStatus[] = ["placed", "processing", "shipped", "delivered", "cancelled"];

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, cancelReason } = req.body; // ★ cancelReason add kiya
    const id = req.params.id as string;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    if (status === "cancelled" && !cancelReason) {
      return res.status(400).json({ message: "Cancel reason is required" });
    }

    // Cancellation reverses stock/wallet, so it needs its own
    // transaction + idempotency guard — every other status change is a
    // plain update.
    if (status === "cancelled") {
      return await cancelOrder(id, res, cancelReason);
    }

    const existingOrder = await Order.findById(id).select("orderStatus deliveredAt");
    if (!existingOrder) return res.status(404).json({ message: "Order not found" });

    const updateFields: { orderStatus: OrderStatus; deliveredAt?: Date } = { orderStatus: status };

    if (status === "delivered" && existingOrder.orderStatus !== "delivered") {
      updateFields.deliveredAt = new Date();
    }

    const order = await Order.findByIdAndUpdate(id, { $set: updateFields }, { new: true }).populate("user", "name email");

    await invalidateDashboardCache();

    logger.info(`Order ${order!._id} status → ${status}`);

    return res.status(200).json({ success: true, message: `Status updated to ${status}`, order });
  } catch (err) {
    next(err);
  }
};

// ── Cancel: atomically claim the order first (so a double-click/retry
// can't reverse stock or wallet twice), then restock items and refund any
// wallet-paid portion inside a transaction. Any Razorpay-captured amount
// is flagged for a manual refund rather than auto-refunded — a status
// PATCH has no natural retry boundary to protect against firing that
// external call twice, unlike the claim-then-act pattern that makes the
// return-approval refund safe to retry. ──
const cancelOrder = async (orderId: string, res: Response, cancelReason: string) => {
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, orderStatus: { $ne: "cancelled" } },
    { $set: { orderStatus: "cancelled", cancelReason, cancelledBy: "admin", cancelledAt: new Date() } },
    { new: true }
  );

  if (!claimed) {
    const check = await Order.findById(orderId).select("orderStatus").lean();
    if (!check) return res.status(404).json({ message: "Order not found" });
    return res.status(400).json({ message: "Order already cancelled" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Stock is only ever deducted for orders that reached paid/cod —
    // nothing to release for a still-pending order.
    if (claimed.paymentStatus === "paid" || claimed.paymentStatus === "cod") {
      for (const item of claimed.items ?? []) {
        await restockItem(
          { productId: item.product, color: item.selectedColor as string, size: item.selectedSize as string, quantity: item.quantity as number },
          session
        );
      }
      logger.info(`Stock restocked for cancelled order ${claimed._id} | ${claimed.items?.length ?? 0} item(s)`);
    }

    if (claimed.walletUsed > 0) {
      await creditWallet(
        claimed.user,
        claimed.walletUsed,
        "admin_credit",
        `Refund — Order #${claimed._id.toString().slice(-8).toUpperCase()} cancelled by admin`,
        claimed._id,
        null,
        session
      );
      logger.info(`Wallet refunded: ₹${claimed.walletUsed} for cancelled order ${claimed._id}`);
    }

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    // The cancellation itself already committed (claim step, above) —
    // surface the reversal failure rather than leaving it silently
    // unreconciled.
    logger.error(`Order ${orderId} cancelled but stock/wallet reversal failed — needs manual review:`, err);
    notifyAdmin({
      type: "ORDER_CANCEL_REFUND_NEEDED",
      severity: "critical",
      title: `Order #${orderId} cancelled but not reconciled`,
      message: `Order was marked cancelled but stock/wallet reversal failed (${(err as Error).message}). Resolve manually.`,
      link: `/orders/${orderId}`,
    }).catch(() => {});
  } finally {
    await session.endSession();
  }

  // Any Razorpay-captured remainder (totalAmount beyond what wallet
  // covered, on a paid order) needs a manual refund.
  const razorpayCaptured = claimed.paymentStatus === "paid" && claimed.totalAmount > (claimed.walletUsed || 0);
  if (razorpayCaptured) {
    const amount = claimed.totalAmount - (claimed.walletUsed || 0);
    notifyAdmin({
      type: "ORDER_CANCEL_REFUND_NEEDED",
      severity: "high",
      title: `Manual Razorpay refund needed — Order #${orderId}`,
      message: `Order cancelled; ₹${amount} was captured via Razorpay and needs a manual refund (paymentId: ${claimed.paymentId || "n/a"}).`,
      link: `/orders/${orderId}`,
    }).catch(() => {});
  }

  await invalidateDashboardCache();

  logger.info(`Order ${claimed._id} status → cancelled (${cancelReason})`);

  const order = await Order.findById(claimed._id).populate("user", "name email");

  return res.status(200).json({ success: true, message: "Status updated to cancelled", order });
};

// ─────────────────────────────────────────────
// DOWNLOAD INVOICE (PDF)
// GET /api/admin/orders/:id/invoice
//
// Renders the invoice HTML (generateInvoiceHTML) via a headless browser
// and streams it back as a PDF attachment.
// ─────────────────────────────────────────────
export const downloadInvoice = async (req: Request, res: Response, next: NextFunction) => {
  let browser: Browser | null = null;
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    const order = await Order.findById(id).populate("user", "name email phone").lean();

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Reuse existing invoice number, or mint one and persist it
    let invoiceNo = order.invoiceNumber;
    if (!invoiceNo) {
      invoiceNo = `INV-${String(order._id).slice(-8).toUpperCase()}`;
      await Order.findByIdAndUpdate(order._id, { invoiceNumber: invoiceNo });
    }

    const html = generateInvoiceHTML(order as unknown as IOrder, invoiceNo);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    await browser.close();
    browser = null;

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Invoice-${invoiceNo}.pdf"`,
      "Content-Length": String(pdfBuffer.length),
    });

    return res.send(pdfBuffer);
  } catch (err) {
    if (browser) await (browser as Browser).close();
    logger.error("downloadInvoice error:", err);
    next(err);
  }
};
