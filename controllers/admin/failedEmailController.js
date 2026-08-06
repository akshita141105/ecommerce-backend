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

        // ── Atomic claim: sirf tabhi "resent" pe set karega jab abhi resent nahi hua ──
        // Isse email do baar bhejne se bachta hai agar do admin same time pe click karein
        const failedEmail = await FailedEmail.findOneAndUpdate(
            { _id: id, status: { $ne: "resent" } },
            { $set: { status: "resent", resentAt: new Date() } },
            { new: true }
        );

        if (!failedEmail) {
            const check = await FailedEmail.findById(id).lean();
            if (!check) return res.status(404).json({ message: "Failed email not found" });
            return res.status(400).json({ message: "Email already resent" });
        }

        // ── ab actual send karo — status pehle hi lock ho chuka hai ──
        try {
            await sendEmail(failedEmail.to, failedEmail.subject, failedEmail.html);
        } catch (sendErr) {
            // send fail hua toh status wapas revert karo taaki dobara try ho sake
            await FailedEmail.findByIdAndUpdate(id, { $set: { status: "failed" } });
            throw sendErr;
        }

        res.status(200).json({ message: "Email re-queued successfully" });
    } catch (err) {
        logger.error("resendFailedEmail failed:", err);
        next(err);
    }
};