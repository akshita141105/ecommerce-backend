import { Queue, Worker } from "bullmq";
import nodemailer from "nodemailer";
import logger from "./logger.js";
import { notifyAdmin } from "./notifyAdmin.js";
import FailedEmail from "../models/FailedEmail.js"; // path adjust karo


import dotenv from "dotenv";
dotenv.config();

const connection = {
    url: process.env.REDIS_URL,
};




// ─── Transporter ─────────────────────────────
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// ─── Queue ────────────────────────────────────
export const emailQueue = new Queue("emailQueue", {
    connection,
    defaultJobOptions: {
        attempts: 3,           // 3 baar try karega
        backoff: {
            type: "exponential", // 1s, 2s, 4s gap
            delay: 1000,
        },
        removeOnComplete: 100, // last 100 completed jobs rakho
        removeOnFail: 200,     // last 200 failed jobs rakho
    },
});

// ─── Worker ───────────────────────────────────
export const emailWorker = new Worker(
    "emailQueue",
    async (job) => {
        const { to, subject, html } = job.data;

        console.log("FROM VALUE IS:", JSON.stringify(process.env.SMTP_FROM_EMAIL)); // ← ye line add karo

        await transporter.sendMail({
            from: `"DRAPE" <${process.env.SMTP_FROM_EMAIL}>`,
            to,
            subject,
            html,
        });

        logger.info(`Email sent: ${subject} → ${to}`);
    },
    {
        connection,
        concurrency: 5,
    }
);
// ─── Worker events ────────────────────────────
emailWorker.on("completed", (job) => {
    logger.info(`Email job completed: ${job.id}`);
});

emailWorker.on("failed", (job, err) => {
    logger.error(`Email job failed: ${job.id} | ${err.message}`);

    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts || 1);

    if (isFinalAttempt) {
        // Admin ko sirf alert — link failed-emails page pe
        notifyAdmin({
            type: "EMAIL_FAILED",
            severity: "high",
            title: "Email failed to send",
            message: `Failed to send email "${job.data.subject}" to ${job.data.to}`,
            link: "/failed-emails",
        });

        // Actual record — resend ke liye
        FailedEmail.create({
            to: job.data.to,
            subject: job.data.subject,
            html: job.data.html,
            reason: err.message,
            attempts: job.attemptsMade,
        }).catch((e) => logger.error("Failed to save FailedEmail record:", e));
    }
});

// ─── Helper: add to queue ─────────────────────
export const sendEmail = async (to, subject, html) => {
    await emailQueue.add("send-email", { to, subject, html });
    logger.info(`Email queued: ${subject} → ${to}`);
};