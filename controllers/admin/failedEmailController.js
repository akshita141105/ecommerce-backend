// controllers/admin/failedEmailController.js
import FailedEmail from "../../models/FailedEmail.js";
import { sendEmail } from "../../utils/emailQueue.js";
import logger from "../../utils/logger.js";

export const getFailedEmails = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

        const match = {};
        if (status) match.status = status;

        const [emails, total] = await Promise.all([
            FailedEmail.find(match)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            FailedEmail.countDocuments(match),
        ]);

        res.status(200).json({
            emails,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum) || 1,
        });
    } catch (err) {
        logger.error("getFailedEmails failed:", err);
        next(err);
    }
};

export const resendFailedEmail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const failedEmail = await FailedEmail.findById(id);

        if (!failedEmail) {
            return res.status(404).json({ message: "Failed email not found" });
        }

        await sendEmail(failedEmail.to, failedEmail.subject, failedEmail.html);

        failedEmail.status = "resent";
        failedEmail.resentAt = new Date();
        await failedEmail.save();

        res.status(200).json({ message: "Email re-queued successfully" });
    } catch (err) {
        logger.error("resendFailedEmail failed:", err);
        next(err);
    }
};