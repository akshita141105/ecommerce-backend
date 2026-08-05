// controllers/admin/adminPaymentController.js
import Order from "../../models/Order.js";

export const getPaymentStats = async (req, res, next) => {
    try {
        const { period = "month", from, to } = req.query;

        let start, end = new Date();
        if (from || to) {
            start = from ? new Date(from) : new Date(0);
            end = to ? new Date(to) : new Date();
            end.setHours(23, 59, 59, 999);
        } else {
            start = new Date();
            switch (period) {
                case "today": start.setHours(0, 0, 0, 0); break;
                case "week": start.setDate(start.getDate() - 7); break;
                case "month": start.setMonth(start.getMonth() - 1); break;
                case "year": start.setFullYear(start.getFullYear() - 1); break;
                default: start.setMonth(start.getMonth() - 1);
            }
        }

        const [byPaymentStatus, byPaymentMethod, byOrderStatus, revenue] = await Promise.all([
            Order.aggregate([
                { $match: { createdAt: { $gte: start, $lte: end } } },
                { $group: { _id: "$paymentStatus", count: { $sum: 1 }, amount: { $sum: "$totalAmount" } } },
            ]),
            Order.aggregate([
                {
                    $match: {
                        createdAt: { $gte: start, $lte: end },
                        paymentStatus: { $in: ["paid", "cod"] },
                    },
                },
                { $group: { _id: "$paymentMethod", count: { $sum: 1 }, amount: { $sum: "$totalAmount" } } },
            ]),
            Order.aggregate([
                { $match: { createdAt: { $gte: start, $lte: end }, orderStatus: "cancelled" } },
                { $group: { _id: "$cancelReason", count: { $sum: 1 } } },
            ]),
            Order.aggregate([
                {
                    $match: {
                        createdAt: { $gte: start, $lte: end },
                        paymentStatus: { $in: ["paid", "cod"] },
                    },
                },
                { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" }, totalOrders: { $sum: 1 } } },
            ]),
        ]);

        return res.status(200).json({
            success: true,
            period: { start, end },
            revenue: revenue[0] || { totalRevenue: 0, totalOrders: 0 },
            byPaymentStatus,   // [{ _id: "paid", count, amount }, { _id: "cod", ... }, { _id: "failed", ... }, { _id: "expired", ... }]
            byPaymentMethod,   // [{ _id: "razorpay", ... }, { _id: "cod", ... }, { _id: "wallet", ... }]
            cancelReasons: byOrderStatus,   // [{ _id: "changed mind", count: 3 }, ...]
        });
    } catch (err) {
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET FAILED/EXPIRED PAYMENTS — list view
// ─────────────────────────────────────────────
export const getFailedPayments = async (req, res, next) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const filter = { paymentStatus: { $in: ["failed", "expired"] } };

        const [orders, total] = await Promise.all([
            Order.find(filter)
                .populate("user", "name email")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .lean(),
            Order.countDocuments(filter),
        ]);

        return res.status(200).json({ success: true, orders, total, totalPages: Math.ceil(total / Number(limit)) });
    } catch (err) {
        next(err);
    }
};

// controllers/admin/adminPaymentController.js mein add karo

// ─────────────────────────────────────────────
// NEW PAYMENTS COUNT — since a given timestamp
// GET /api/admin/payments/new-count?since=ISO_DATE
// ─────────────────────────────────────────────
export const getNewPaymentsCount = async (req, res, next) => {
    try {
        const { since } = req.query;
        if (!since) return res.status(200).json({ success: true, count: 0 });

        const count = await Order.countDocuments({
            createdAt: { $gt: new Date(since) },
            paymentStatus: { $in: ["paid", "cod"] },
        });

        return res.status(200).json({ success: true, count });
    } catch (err) {
        next(err);
    }
};

export const markOrderPaid = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (!["failed", "expired"].includes(order.paymentStatus)) {
            return res.status(400).json({ message: "Only failed/expired orders can be marked paid" });
        }

        order.paymentStatus = "paid";
        order.paymentMethod = order.paymentMethod || "manual";
        order.markedPaidBy = req.user._id;
        order.markedPaidAt = new Date();
        order.manualPaymentNote = req.body.note || "";
        await order.save();

        return res.status(200).json({ success: true, message: "Order marked as paid", order });
    } catch (err) {
        next(err);
    }
};