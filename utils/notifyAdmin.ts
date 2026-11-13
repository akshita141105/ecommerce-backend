// utils/notifyAdmin.ts
import type { ModifyResult } from "mongoose";
import AdminNotification, { type AdminNotificationSeverity, type AdminNotificationType, type IAdminNotification } from "../models/AdminNotification.js";
import logger from "./logger.js";
import { sendEmail } from "./emailQueue.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

const DEDUPE_WINDOW_MINUTES: Partial<Record<AdminNotificationType, number>> = {
  LOW_STOCK: 60,
  OUT_OF_STOCK: 60,
  ORDER_STUCK_PENDING: 30,
  SERVER_ERROR_SPIKE: 15,
  SUSPICIOUS_CUSTOMER: 24 * 60, // ek din mein ek hi baar notify, spam nahi
};

const escapeHtml = (str: unknown = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

interface NotifyAdminParams {
  type: AdminNotificationType;
  severity: AdminNotificationSeverity;
  title: string;
  message: string;
  link?: string | null;
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
}

export const notifyAdmin = async ({
  type,
  severity,
  title,
  message,
  link = null,
  data = {},
  dedupeKey = null,
}: NotifyAdminParams): Promise<IAdminNotification | null> => {
  try {
    const windowMin = DEDUPE_WINDOW_MINUTES[type] ?? 60;
    let notification: IAdminNotification | null;

    if (dedupeKey) {
      const windowStart = new Date(Date.now() - windowMin * 60 * 1000);

      try {
        // Atomic upsert — but concurrent calls for the SAME dedupeKey
        // can still race each other when no matching doc exists yet.
        // The unique index on dedupeKey is what actually prevents the
        // duplicate; we just need to catch it gracefully below.
        const result = (await AdminNotification.findOneAndUpdate(
          { dedupeKey, createdAt: { $gte: windowStart } },
          {
            $setOnInsert: {
              type,
              severity,
              title,
              message,
              link,
              data,
              dedupeKey,
            },
          },
          { upsert: true, new: true, rawResult: true }
        )) as unknown as ModifyResult<IAdminNotification>;

        const isNew = !!result.lastErrorObject?.upserted;

        if (!isNew) {
          logger.info(`Notification deduped: ${dedupeKey}`);
          return null;
        }

        notification = result.value;
      } catch (err) {
        // E11000 = another concurrent call won the race for this
        // dedupeKey. That's expected, not a real failure — treat it
        // the same as a normal dedupe and move on quietly.
        if ((err as { code?: number }).code === 11000) {
          logger.info(`Notification deduped (race): ${dedupeKey}`);
          return null;
        }
        throw err;
      }
    } else {
      notification = await AdminNotification.create({
        type,
        severity,
        title,
        message,
        link,
        data,
      });
    }

    if (!notification) return null;

    logger.info(`Admin notification created: [${severity}] ${title}`);

    // Email sirf high/critical pe, aur sirf naye notifications pe
    if ((severity === "critical" || severity === "high") && ADMIN_EMAIL) {
      try {
        await sendEmail(ADMIN_EMAIL, `[${severity.toUpperCase()}] ${title}`, buildEmailHtml({ severity, title, message, link, data }));

        // Single atomic update — extra save() nahi
        await AdminNotification.findByIdAndUpdate(notification._id, { $set: { emailSent: true } });
      } catch (emailErr) {
        logger.error("Failed to queue admin notification email:", emailErr);
      }
    }

    return notification;
  } catch (err) {
    logger.error("notifyAdmin failed:", err);
    return null;
  }
};

const ALLOWED_DATA_KEYS = [
  "orderId",
  "amount",
  "remaining",
  "productId",
  "color",
  "size",
  "returnId",
  "refundMethod",
  "customerId",
  "customerEmail",
  "customerPhone",
];

const buildDataSection = (data: Record<string, unknown>) => {
  const rows = Object.entries(data)
    .filter(([k]) => ALLOWED_DATA_KEYS.includes(k))
    .map(
      ([k, v]) => `
      <tr>
        <td style="color:#888;font-size:12px;padding:2px 8px 2px 0;white-space:nowrap">
          ${escapeHtml(k)}
        </td>
        <td style="font-size:12px;color:#111">${escapeHtml(String(v))}</td>
      </tr>`
    )
    .join("");

  return rows ? `<table style="margin-top:12px;border-collapse:collapse">${rows}</table>` : "";
};

interface BuildEmailHtmlParams {
  severity: AdminNotificationSeverity;
  title: string;
  message: string;
  link: string | null;
  data: Record<string, unknown>;
}

const buildEmailHtml = ({ severity, title, message, link, data }: BuildEmailHtmlParams) => {
  const color = severity === "critical" ? "#dc2626" : "#d97706";
  const baseUrl = process.env.ADMIN_PANEL_URL || "http://localhost:3000";

  // link sanitize — sirf relative paths
  const safePath = link?.startsWith("/") ? link : "";

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;">
      <div style="border-left:4px solid ${color};padding:16px 20px;background:#fafafa;">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;
          color:${color};margin:0 0 6px;">
          ${severity} alert
        </p>
        <h2 style="font-size:16px;margin:0 0 8px;color:#111;">
          ${escapeHtml(title)}
        </h2>
        <p style="font-size:14px;color:#555;margin:0 0 12px;">
          ${escapeHtml(message)}
        </p>
        ${buildDataSection(data)}
        ${
          safePath
            ? `<a href="${baseUrl}${safePath}"
              style="display:inline-block;margin-top:16px;padding:8px 16px;
              background:#111;color:#fff;border-radius:8px;
              font-size:13px;text-decoration:none;">
              View Details
            </a>`
            : ""
        }
      </div>
    </div>`;
};
