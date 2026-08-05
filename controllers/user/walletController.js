import User from "../../models/User.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import { AppError } from "../../utils/AppError.js";

// GET /api/wallet
export const getWallet = async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id).select("walletBalance walletReserved");
        if (!user) return next(new AppError("User not found", 404));

        const transactions = await WalletTransaction.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .limit(20)
            .populate("orderId", "_id")
            .populate("returnId", "_id");

        return res.status(200).json({
            success: true,
            walletBalance: user.walletBalance || 0,
            walletReserved: user.walletReserved || 0,
            transactions,
        });
    } catch (err) {
        next(err);
    }
};

// 🔧 INTERNAL HELPER — used for return/refund credits only
export const creditWallet = async (userId, amount, reason, description, orderId = null, returnId = null, session = null) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    user.walletBalance = (user.walletBalance || 0) + amount;
    await user.save({ session });

    await WalletTransaction.create(
        [{
            user: userId,
            type: "credit",
            amount,
            balanceAfter: user.walletBalance,
            reason,
            description,
            orderId,
            returnId,
        }],
        { session }
    );

    return user.walletBalance;
};