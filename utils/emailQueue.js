import { Queue, Worker } from "bullmq";
import logger from "./logger.js";
import { notifyAdmin } from "./notifyAdmin.js";
import FailedEmail from "../models/FailedEmail.js";

import dotenv from "dotenv";
dotenv.config();

const connection = {
    url: process.env.REDIS_URL,
};

console.log("📦 emailQueue.js loaded | REDIS_URL:", process.env.REDIS_URL);

// ─── Queue ────────────────────────────────────
export const emailQueue = new Queue("emailQueue", {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
    },
});

emailQueue.on("error", (err) => {
    console.error("❌ emailQueue Redis connection error:", err.message);
});

// ─── Worker ───────────────────────────────────
export const emailWorker = new Worker(
    "emailQueue",
    async (job) => {
        console.log(`🔧 WORKER PICKED UP JOB: ${job.id} | to: ${job.data.to} | subject: ${job.data.subject}`);

        const { to, subject, html } = job.data;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 sec timeout

            const response = await fetch("https://api.brevo.com/v3/smtp/email", {
                method: "POST",
                headers: {
                    "api-key": process.env.BREVO_API_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    sender: { email: process.env.SMTP_FROM_EMAIL, name: "DRAPE" },
                    to: [{ email: to }],
                    subject,
                    htmlContent: html,
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const data = await response.json();

            if (!response.ok) {
                console.error("❌ Brevo API ERROR:", data);
                throw new Error(data.message || `Brevo API failed with status ${response.status}`);
            }

            logger.info(`Email sent: ${subject} → ${to}`);
        } catch (sendErr) {
            console.error("❌ Email send FAILED:", sendErr.message);
            throw sendErr;
        }
    },
    {
        connection,
        concurrency: 5,
    }
);

emailWorker.on("error", (err) => {
    console.error("❌ emailWorker Redis connection error:", err.message);
});

emailWorker.on("completed", (job) => {
    logger.info(`Email job completed: ${job.id}`);
});

emailWorker.on("failed", (job, err) => {
    console.error(`💥 Email job failed: ${job?.id} | ${err.message}`);
    logger.error(`Email job failed: ${job?.id} | ${err.message}`);

    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts || 1);

    if (isFinalAttempt) {
        notifyAdmin({
            type: "EMAIL_FAILED",
            severity: "high",
            title: "Email failed to send",
            message: `Failed to send email "${job.data.subject}" to ${job.data.to}`,
            link: "/failed-emails",
        });

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
    console.log(`➕ sendEmail() called | to: ${to} | subject: ${subject}`);
    try {
        const job = await emailQueue.add("send-email", { to, subject, html });
        console.log(`✅ Job added to queue successfully | jobId: ${job.id}`);
        logger.info(`Email queued: ${subject} → ${to}`);
    } catch (addErr) {
        console.error("❌ emailQueue.add() FAILED:", addErr.message);
        throw addErr;
    }
};