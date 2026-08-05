// controllers/admin/adminCustomerController.js
import mongoose from "mongoose";
import User from "../../models/User.js";
import Order from "../../models/Order.js";
import logger from "../../utils/logger.js";
import ReturnRequest from "../../models/ReturnRequest.js"; // ← path apne project ke hisaab se adjust karo

const SORT_FIELDS = {
    name: "name",
    joined: "createdAt",
    wallet: "walletBalance",
    orders: "totalOrders",
    spent: "totalSpent",
};

// ─────────────────────────────────────────────
// GET ALL CUSTOMERS — paginated, searchable, with
// per-customer order count + total spent via $lookup,
// plus overall stats for the top cards.
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// GET ALL CUSTOMERS — paginated, searchable, with
// per-customer order count + total spent via $lookup,
// risk flags (OTP abuse, reset abuse, high return rate),
// plus overall stats for the top cards.
// ─────────────────────────────────────────────
export const getAllCustomers = async (req, res, next) => {
    try {
        const {
            search = "",
            page = 1,
            limit = 20,
            sort = "joined",
            order = "desc",
            verified, // "true" | "false" | undefined
        } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const skip = (pageNum - 1) * limitNum;

        const match = { role: "user" };
        if (search.trim()) {
            const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            match.$or = [{ name: re }, { email: re }];
        }
        if (verified === "true") match.isVerified = true;
        if (verified === "false") match.isVerified = false;

        const sortField = SORT_FIELDS[sort] || "createdAt";
        const sortDir = order === "asc" ? 1 : -1;

        const basePipeline = [
            { $match: match },
            {
                $lookup: {
                    from: "orders",
                    localField: "_id",
                    foreignField: "user",
                    as: "orders",
                },
            },
            {
                $lookup: {
                    from: "returnrequests",
                    localField: "_id",
                    foreignField: "user",
                    as: "returns",
                },
            },
            {
                $addFields: {
                    totalOrders: { $size: "$orders" },
                    totalSpent: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: "$orders",
                                        as: "o",
                                        cond: { $in: ["$$o.paymentStatus", ["paid", "cod"]] },
                                    },
                                },
                                as: "o",
                                in: "$$o.totalAmount",
                            },
                        },
                    },
                    approvedReturnsCount: {
                        $size: {
                            $filter: {
                                input: "$returns",
                                as: "r",
                                cond: { $eq: ["$$r.status", "approved"] },
                            },
                        },
                    },
                },
            },
            {
                $addFields: {
                    returnRate: {
                        $cond: [
                            { $gte: ["$totalOrders", 3] },
                            { $divide: ["$approvedReturnsCount", "$totalOrders"] },
                            0,
                        ],
                    },
                },
            },
            {
                $addFields: {
                    riskFlags: {
                        $concatArrays: [
                            { $cond: [{ $gt: ["$otpRequestCount", 5] }, ["high_otp_requests"], []] },
                            { $cond: [{ $gt: ["$resetRequestCount", 5] }, ["high_reset_attempts"], []] },
                            { $cond: [{ $gt: ["$returnRate", 0.4] }, ["high_return_rate"], []] },
                        ],
                    },
                },
            },
            {
                $project: {
                    password: 0,
                    otp: 0,
                    otpExpires: 0,
                    resetToken: 0,
                    resetTokenExpires: 0,
                    otpRequestCount: 0,
                    otpRequestResetTime: 0,
                    resetRequestCount: 0,
                    resetRequestResetTime: 0,
                    lastOtpSentAt: 0,
                    orders: 0,
                    returns: 0,
                    approvedReturnsCount: 0,
                    wishlist: 0,
                },
            },
        ];

        const [customers, totalResult, statsResult] = await Promise.all([
            User.aggregate([
                ...basePipeline,
                { $sort: { [sortField]: sortDir } },
                { $skip: skip },
                { $limit: limitNum },
            ]).allowDiskUse(true),
            User.aggregate([{ $match: match }, { $count: "count" }]),
            User.aggregate([
                { $match: { role: "user" } },
                {
                    $group: {
                        _id: null,
                        totalCustomers: { $sum: 1 },
                        verifiedCount: { $sum: { $cond: ["$isVerified", 1, 0] } },
                        totalWalletBalance: { $sum: { $ifNull: ["$walletBalance", 0] } },
                    },
                },
            ]),
        ]);

        const total = totalResult[0]?.count || 0;
        const s = statsResult[0] || { totalCustomers: 0, verifiedCount: 0, totalWalletBalance: 0 };

        res.status(200).json({
            customers,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum) || 1,
            stats: {
                totalCustomers: s.totalCustomers,
                verifiedCount: s.verifiedCount,
                unverifiedCount: s.totalCustomers - s.verifiedCount,
                totalWalletBalance: s.totalWalletBalance,
            },
        });
    } catch (err) {
        logger.error("getAllCustomers failed:", err);
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET SINGLE CUSTOMER — profile + full order history
// ─────────────────────────────────────────────

export const getCustomerById = async (req, res, next) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid customer id" });
        }

        const customer = await User.findOne({ _id: id, role: "user" })
            .select(
                "-password -otp -otpExpires -resetToken -resetTokenExpires -otpRequestCount -otpRequestResetTime -resetRequestCount -resetRequestResetTime -lastOtpSentAt"
            )
            .lean();

        if (!customer) return res.status(404).json({ message: "Customer not found" });

        const orders = await Order.find({ user: id })
            .select("items totalAmount paymentStatus orderStatus createdAt")
            .sort({ createdAt: -1 })
            .lean();

        const paidOrders = orders.filter((o) => ["paid", "cod"].includes(o.paymentStatus));
        const grossSpent = paidOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

        // Approved returns ka refunded amount minus karo
        const orderIds = orders.map((o) => o._id);
        const approvedReturns = await ReturnRequest.find({
            order: { $in: orderIds },
            status: "approved",
        })
            .select("order refundAmount")
            .lean();

        const totalRefunded = approvedReturns.reduce((sum, r) => sum + (r.refundAmount || 0), 0);
        const totalSpent = Math.max(0, grossSpent - totalRefunded);

        res.status(200).json({
            customer,
            orders,
            totalOrders: orders.length,
            paidOrdersCount: paidOrders.length,
            totalRefunded,
            totalSpent,
        });
    } catch (err) {
        logger.error("getCustomerById failed:", err);
        next(err);
    }
};

// ─────────────────────────────────────────────
// TOGGLE BLOCK / UNBLOCK CUSTOMER
// ─────────────────────────────────────────────
export const toggleBlockCustomer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body; // optional, admin ki taraf se wajah

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid customer id" });
        }

        const user = await User.findOne({ _id: id, role: "user" });
        if (!user) {
            return res.status(404).json({ message: "Customer not found" });
        }

        user.isBlocked = !user.isBlocked;
        user.blockedReason = user.isBlocked ? (reason || "Blocked by admin") : null;
        user.blockedAt = user.isBlocked ? new Date() : null;

        await user.save();

        res.status(200).json({
            message: `Customer ${user.isBlocked ? "blocked" : "unblocked"} successfully`,
            data: {
                _id: user._id,
                isBlocked: user.isBlocked,
                blockedReason: user.blockedReason,
                blockedAt: user.blockedAt,
            },
        });
    } catch (err) {
        logger.error("toggleBlockCustomer failed:", err);
        next(err);
    }
};