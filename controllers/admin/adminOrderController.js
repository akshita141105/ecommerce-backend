// controllers/admin/adminOrderController.js
import Order from "../../models/Order.js";
import ReturnRequest from "../../models/ReturnRequest.js";
import logger from "../../utils/logger.js";
import mongoose from "mongoose";
import User from "../../models/User.js";
import puppeteer from "puppeteer";

// ⚠️ ASSUMPTION: adjust this import path to wherever generateInvoiceHTML actually
// lives in your project (you shared it as a standalone snippet, not a file path).
import { generateInvoiceHTML } from "../../utils/invoiceTemplate.js";

const DEFAULT_LIMIT = 20;

// ─────────────────────────────────────────────
// GET ALL ORDERS
// GET /api/admin/orders
// Query: page, limit, status, paymentStatus, search, from, to
// ─────────────────────────────────────────────
export const getAllOrders = async (req, res, next) => {
    try {
        const {
            page = 1,
            limit = DEFAULT_LIMIT,
            status,
            paymentStatus,
            search,
            from,
            to,
        } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, parseInt(limit) || DEFAULT_LIMIT);
        const skip = (pageNum - 1) * limitNum;

        const filter = {};

        if (status && status !== "all") filter.orderStatus = status;
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
                    $or: [
                        { name: { $regex: s, $options: "i" } },
                        { email: { $regex: s, $options: "i" } },
                    ],
                }).select("_id").lean();

                const userIds = matchingUsers.map((u) => u._id);

                filter.$or = [
                    { "address.fullName": { $regex: s, $options: "i" } },
                    ...(userIds.length ? [{ user: { $in: userIds } }] : []),
                ];
            }
        }

        const [orders, total, stats] = await Promise.all([
            Order.find(filter)
                .populate("user", "name email phone")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),

            Order.countDocuments(filter),

            Order.aggregate([
                { $match: from || to ? { createdAt: filter.createdAt } : {} },
                {
                    $group: {
                        _id: null,
                        totalOrders: { $sum: 1 },
                        totalRevenue: {
                            $sum: {
                                $cond: [
                                    { $in: ["$paymentStatus", ["paid", "cod"]] },
                                    "$totalAmount", 0
                                ]
                            }
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
                totalOrders: 0, totalRevenue: 0,
                pending: 0, processing: 0, shipped: 0, delivered: 0,
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
export const getOrderDetail = async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: "Invalid order ID" });
        }

        const order = await Order.findById(req.params.id)
            .populate("user", "name email phone walletBalance")
            .lean();

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
export const updateOrderStatus = async (req, res, next) => {
    try {
        const { status, cancelReason } = req.body;   // ★ cancelReason add kiya
        const validStatuses = ["placed", "processing", "shipped", "delivered", "cancelled"];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }

        if (status === "cancelled" && !cancelReason) {
            return res.status(400).json({ message: "Cancel reason is required" });
        }

        const existingOrder = await Order.findById(req.params.id).select("orderStatus deliveredAt");
        if (!existingOrder) return res.status(404).json({ message: "Order not found" });

        const updateFields = { orderStatus: status };

        if (status === "delivered" && existingOrder.orderStatus !== "delivered") {
            updateFields.deliveredAt = new Date();
        }

        if (status === "cancelled") {
            updateFields.cancelReason = cancelReason;
            updateFields.cancelledBy = "admin";
            updateFields.cancelledAt = new Date();
        }

        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { $set: updateFields },
            { new: true }
        ).populate("user", "name email");

        logger.info(`Order ${order._id} status → ${status}${cancelReason ? ` (${cancelReason})` : ""}`);

        return res.status(200).json({ success: true, message: `Status updated to ${status}`, order });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// DOWNLOAD INVOICE (PDF)
// GET /api/admin/orders/:id/invoice
//
// Renders the invoice HTML (generateInvoiceHTML) via a headless browser
// and streams it back as a PDF attachment.
// ─────────────────────────────────────────────
export const downloadInvoice = async (req, res, next) => {
    let browser;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: "Invalid order ID" });
        }

        const order = await Order.findById(req.params.id)
            .populate("user", "name email phone")
            .lean();

        if (!order) return res.status(404).json({ message: "Order not found" });

        // Reuse existing invoice number, or mint one and persist it
        let invoiceNo = order.invoiceNumber;
        if (!invoiceNo) {
            invoiceNo = `INV-${String(order._id).slice(-8).toUpperCase()}`;
            await Order.findByIdAndUpdate(order._id, { invoiceNumber: invoiceNo });
        }

        const html = generateInvoiceHTML(order, invoiceNo);

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
            "Content-Length": pdfBuffer.length,
        });

        return res.send(pdfBuffer);
    } catch (err) {
        if (browser) await browser.close();
        logger.error("downloadInvoice error:", err);
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET ALL RETURN REQUESTS
// GET /api/admin/orders/returns
// Query: status — pending | approved | rejected
// ─────────────────────────────────────────────
// export const getAllReturns = async (req, res, next) => {
//     try {
//         const { status, page = 1 } = req.query;
//         const pageNum = Math.max(1, parseInt(page) || 1);
//         const limitNum = 20;

//         const filter = {};
//         if (status && status !== "all") filter.status = status;

//         const [returns, total] = await Promise.all([
//             ReturnRequest.find(filter)
//                 .populate("user", "name email")
//                 .populate("order", "totalAmount paymentStatus createdAt")
//                 .sort({ createdAt: -1 })
//                 .skip((pageNum - 1) * limitNum)
//                 .limit(limitNum)
//                 .lean(),
//             ReturnRequest.countDocuments(filter),
//         ]);

//         return res.status(200).json({
//             success: true, returns, total,
//             page: pageNum,
//             totalPages: Math.ceil(total / limitNum),
//         });
//     } catch (err) {
//         next(err);
//     }
// };

// ─────────────────────────────────────────────
// APPROVE / REJECT RETURN
// PATCH /api/admin/orders/returns/:id
// Body: { action: "approve" | "reject", adminNote }
// ─────────────────────────────────────────────
// export const handleReturn = async (req, res, next) => {
//     const session = await mongoose.startSession();
//     session.startTransaction();
//     try {
//         const { action, adminNote } = req.body;
//         if (!["approve", "reject"].includes(action)) {
//             return res.status(400).json({ message: "action must be approve or reject" });
//         }

//         const returnReq = await ReturnRequest.findById(req.params.id)
//             .populate("order")
//             .session(session);

//         if (!returnReq) return res.status(404).json({ message: "Return request not found" });
//         if (returnReq.status !== "pending") {
//             return res.status(400).json({ message: `Already ${returnReq.status}` });
//         }

//         returnReq.status = action === "approve" ? "approved" : "rejected";
//         returnReq.adminNote = adminNote || "";
//         await returnReq.save({ session });

//         if (action === "approve" && returnReq.refundMethod === "wallet") {
//             await creditWallet(
//                 returnReq.user,
//                 returnReq.refundAmount,
//                 "return_refund",
//                 `Refund for Order #${String(returnReq.order._id).slice(-8).toUpperCase()}`,
//                 returnReq.order._id,
//                 returnReq._id,
//                 session
//             );
//         }

//         await session.commitTransaction();
//         logger.info(`Return ${returnReq._id} ${action}d by admin`);

//         return res.status(200).json({ success: true, message: `Return ${action}d`, returnReq });
//     } catch (err) {
//         await session.abortTransaction();
//         next(err);
//     } finally {
//         session.endSession();
//     }
// };