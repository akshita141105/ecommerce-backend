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

console.log("📦 emailQueue.js loaded | REDIS_URL:", process.env.REDIS_URL);

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

// Transporter verify — confirm karega SMTP connection sahi hai ya nahi, startup pe hi
transporter.verify((err, success) => {
    if (err) {
        console.error("❌ SMTP transporter verify FAILED:", err.message);
    } else {
        console.log("✅ SMTP transporter verified, ready to send emails");
    }
});

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

        console.log("📧 SMTP CONFIG AT SEND TIME:", {
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            user: process.env.SMTP_USER,
            from: process.env.SMTP_FROM_EMAIL,
        });

        try {
            const info = await transporter.sendMail({
                from: `"DRAPE" <${process.env.SMTP_FROM_EMAIL}>`,
                to,
                subject,
                html,
            });
            console.log("✅ transporter.sendMail SUCCESS:", info.response);
            logger.info(`Email sent: ${subject} → ${to}`);
        } catch (sendErr) {
            console.error("❌ transporter.sendMail THREW ERROR:", sendErr.message);
            throw sendErr; // rethrow so BullMQ still marks the job failed/retries
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

// ─── Worker events ────────────────────────────
emailWorker.on("completed", (job) => {
    console.log(`🎉 Email job completed: ${job.id}`);
    logger.info(`Email job completed: ${job.id}`);
});

emailWorker.on("failed", (job, err) => {
    console.error(`💥 Email job failed: ${job?.id} | ${err.message}`);
    logger.error(`Email job failed: ${job?.id} | ${err.message}`);

    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts || 1);

    if (isFinalAttempt) {
        console.error(`🚨 FINAL ATTEMPT FAILED for job ${job.id}, notifying admin + saving FailedEmail`);

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