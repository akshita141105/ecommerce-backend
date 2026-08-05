import ContactMessage from "../../models/ContactMessage.js";
import logger from "../../utils/logger.js"; // ← path apne project ke hisaab se adjust karo
import { notifyAdmin } from "../../utils/notifyAdmin.js";  // ← ye line delete karo

// Simple email format check — good enough for form validation, not RFC-perfect
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ─────────────────────────────────────────────
// SUBMIT CONTACT MESSAGE — public, anyone can submit
// ─────────────────────────────────────────────
export const submitContactMessage = async (req, res, next) => {
    try {
        const { name, email, orderId, subject, message } = req.body;

        if (!name?.trim() || !email?.trim() || !message?.trim()) {
            return res.status(400).json({
                message: "Name, email, and message are required",
            });
        }

        if (!isValidEmail(email.trim())) {
            return res.status(400).json({
                message: "Please enter a valid email address",
            });
        }

        if (message.trim().length > 5000) {
            return res.status(400).json({
                message: "Message is too long (max 5000 characters)",
            });
        }

        const contactMessage = await ContactMessage.create({
            name: name.trim(),
            email: email.trim(),
            orderId: orderId?.trim() || null,
            subject: subject?.trim() || "General Inquiry",
            message: message.trim(),
        });

        await notifyAdmin({
            type: "CONTACT_MESSAGE",
            severity: "high",
            title: "New contact message received",
            message: `${contactMessage.name} sent a message: "${contactMessage.subject}"`,
            link: "/contacts",
        });

        // TODO (optional, later): send a notification email to the support inbox
        // and/or a confirmation email to the user here, e.g. via Nodemailer.

        res.status(201).json({
            message: "Your message has been received. We'll get back to you soon.",
            data: { id: contactMessage._id },
        });
    } catch (err) {
        logger.error("submitContactMessage failed:", err);
        next(err);
    }
};
