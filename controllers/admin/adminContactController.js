// controllers/admin/adminContactController.js
import mongoose from "mongoose";
import ContactMessage from "../../models/ContactMessage.js";
import logger from "../../utils/logger.js"; // ← path apne project ke hisaab se adjust karo
import { sendEmail } from "../../utils/emailQueue.js";

const ALLOWED_STATUSES = ["new", "in_progress", "resolved"];

const STATUS_EMAIL_COPY = {
    in_progress: {
        subject: "We're looking into your message",
        body: "Our team has picked up your message and is currently looking into it. We'll follow up with a resolution shortly.",
    },
    resolved: {
        subject: "Your query has been resolved",
        body: "We've resolved your query. If you feel this needs further attention, feel free to reach out again.",
    },
};

// ─────────────────────────────────────────────
// GET ALL CONTACT MESSAGES — paginated, filterable by status
// ─────────────────────────────────────────────
export const getAllContactMessages = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, status } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const skip = (pageNum - 1) * limitNum;

        const match = {};
        if (status && ALLOWED_STATUSES.includes(status)) {
            match.status = status;
        }

        const [messages, totalResult, statsResult] = await Promise.all([
            ContactMessage.find(match)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            ContactMessage.aggregate([{ $match: match }, { $count: "count" }]),
            ContactMessage.aggregate([
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        newCount: { $sum: { $cond: [{ $eq: ["$status", "new"] }, 1, 0] } },
                        inProgressCount: { $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] } },
                        resolvedCount: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } },
                    },
                },
            ]),
        ]);

        const total = totalResult[0]?.count || 0;
        const s = statsResult[0] || { total: 0, newCount: 0, inProgressCount: 0, resolvedCount: 0 };

        res.status(200).json({
            messages,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum) || 1,
            stats: {
                total: s.total,
                newCount: s.newCount,
                inProgressCount: s.inProgressCount,
                resolvedCount: s.resolvedCount,
            },
        });
    } catch (err) {
        logger.error("getAllContactMessages failed:", err);
        next(err);
    }
};

// ─────────────────────────────────────────────
// GET SINGLE CONTACT MESSAGE BY ID
// ─────────────────────────────────────────────
export const getContactMessageById = async (req, res, next) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid message id" });
        }

        const contactMessage = await ContactMessage.findById(id).lean();

        if (!contactMessage) {
            return res.status(404).json({ message: "Message not found" });
        }

        res.status(200).json({ data: contactMessage });
    } catch (err) {
        logger.error("getContactMessageById failed:", err);
        next(err);
    }
};

// ─────────────────────────────────────────────
// UPDATE CONTACT MESSAGE STATUS
// ─────────────────────────────────────────────
export const updateContactMessageStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, resolutionNote } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid message id" });
        }

        if (!ALLOWED_STATUSES.includes(status)) {
            return res.status(400).json({ message: "Invalid status value" });
        }

        if (status === "resolved" && !resolutionNote?.trim()) {
            return res.status(400).json({ message: "Resolution note is required to mark as resolved" });
        }

        const updateFields = { status };
        if (status === "resolved") {
            updateFields.resolutionNote = resolutionNote.trim();
        }

        // ── atomic: sirf tabhi update karega jab status abhi bhi purana hai ──
        // ── new: false → purana document return karta hai, taaki pata chale actual old status kya tha ──
        const previous = await ContactMessage.findOneAndUpdate(
            { _id: id, status: { $ne: status } },  // status same hai toh match hi nahi karega
            { $set: updateFields },
            { new: false }
        );

        // ── previous null ho sakta hai do reasons se: doc exist nahi karta, YA status already same tha ──
        if (!previous) {
            const doc = await ContactMessage.findById(id).lean();
            if (!doc) {
                return res.status(404).json({ message: "Message not found" });
            }
            // status already same tha — no-op
            return res.status(200).json({ message: "Status updated successfully", data: doc });
        }

        const updated = { ...previous.toObject(), ...updateFields };

        const copy = STATUS_EMAIL_COPY[status];
        if (copy) {
            const noteHtml = status === "resolved" && updated.resolutionNote
                ? `<p style="font-size:13px;color:#555;margin:8px 0 0;padding:10px 12px;background:#fff;border:1px solid #eee;border-radius:6px;">
                       <strong>Resolution note:</strong> ${updated.resolutionNote}
                   </p>`
                : "";

            try {
                await sendEmail(
                    updated.email,
                    copy.subject,
                    `
                    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;">
                      <div style="border-left:4px solid #b8860b;padding:16px 20px;background:#fafafa;">
                        <p style="font-size:11px;font-weight:700;text-transform:uppercase;color:#b8860b;margin:0 0 6px;">
                          DRAPE Support
                        </p>
                        <p style="font-size:14px;color:#555;margin:0 0 4px;">Hi ${updated.name},</p>
                        <p style="font-size:14px;color:#555;margin:0 0 12px;">${copy.body}</p>
                        ${noteHtml}
                        <p style="font-size:12px;color:#888;margin:12px 0 0;">Regarding: <strong>${updated.subject}</strong></p>
                      </div>
                    </div>`
                );
            } catch (emailErr) {
                logger.error("Failed to send contact status email:", emailErr);
            }
        }

        res.status(200).json({
            message: "Status updated successfully",
            data: updated,
        });
    } catch (err) {
        logger.error("updateContactMessageStatus failed:", err);
        next(err);
    }
};

// ─────────────────────────────────────────────
// DELETE CONTACT MESSAGE
// ─────────────────────────────────────────────
export const deleteContactMessage = async (req, res, next) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid message id" });
        }

        const deleted = await ContactMessage.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ message: "Message not found" });
        }

        res.status(200).json({ message: "Message deleted successfully" });
    } catch (err) {
        logger.error("deleteContactMessage failed:", err);
        next(err);
    }
};