import { Queue, Worker } from "bullmq";
import axios from "axios";
import logger from "./logger.js";
import { notifyAdmin } from "./notifyAdmin.js";
import FailedEmail from "../models/FailedEmail.js";

import dotenv from "dotenv";
dotenv.config();

const connection = {
  url: process.env.REDIS_URL,
};

interface EmailJobData {
  to: string;
  subject: string;
  html: string;
}

// ─── Queue ────────────────────────────────────
export const emailQueue = new Queue<EmailJobData>("emailQueue", {
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
  logger.error(`emailQueue Redis connection error: ${err.message}`);
});

// ─── Worker ───────────────────────────────────
export const emailWorker = new Worker<EmailJobData>(
  "emailQueue",
  async (job) => {
    const { to, subject, html } = job.data;

    try {
      await axios.post(
        "https://api.brevo.com/v3/smtp/email",
        {
          sender: { email: process.env.SMTP_FROM_EMAIL, name: "TEC" },
          to: [{ email: to }],
          subject,
          htmlContent: html,
        },
        {
          headers: {
            "api-key": process.env.BREVO_API_KEY,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      logger.info(`Email sent: ${subject} → ${to}`);
    } catch (sendErr) {
      const detail = (sendErr as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message || (sendErr as Error).message;
      logger.error(`Email send failed: ${subject} → ${to} | ${detail}`);
      throw new Error(detail);
    }
  },
  {
    connection,
    concurrency: 5,
  }
);

emailWorker.on("error", (err) => {
  logger.error(`emailWorker Redis connection error: ${err.message}`);
});

emailWorker.on("completed", (job) => {
  logger.info(`Email job completed: ${job.id}`);
});

emailWorker.on("failed", (job, err) => {
  logger.error(`Email job failed: ${job?.id} | ${err.message}`);

  if (!job) return;

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
export const sendEmail = async (to: string, subject: string, html: string): Promise<void> => {
  try {
    await emailQueue.add("send-email", { to, subject, html });
    logger.info(`Email queued: ${subject} → ${to}`);
  } catch (addErr) {
    logger.error(`emailQueue.add() failed: ${(addErr as Error).message}`);
    throw addErr;
  }
};
