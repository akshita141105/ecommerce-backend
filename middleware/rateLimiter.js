// middleware/rateLimiter.js
import rateLimit from "express-rate-limit";

// ─────────────────────────────────────────────
// HELPER — standard rate limit response
// ─────────────────────────────────────────────
const handler = (req, res) =>
  res.status(429).json({
    success: false,
    message: "Too many requests. Please try again later.",
  });

// ─────────────────────────────────────────────
// PUBLIC API — general browsing
// 100 requests per 10 min per IP
// ─────────────────────────────────────────────
export const publicLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// ─────────────────────────────────────────────
// AUTH — login, signup
// 10 requests per 15 min per IP
// ─────────────────────────────────────────────
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  message: "Too many auth attempts. Try again in 15 minutes.",
});

// ─────────────────────────────────────────────
// OTP — resend otp
// 5 requests per 15 min per IP
// ─────────────────────────────────────────────
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// ─────────────────────────────────────────────
// ADMIN API — admin panel actions
// 200 requests per 10 min per IP
// ─────────────────────────────────────────────
export const adminLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// ─────────────────────────────────────────────
// BULK UPLOAD — heavy operation
// 10 requests per hour per IP
// ─────────────────────────────────────────────
export const bulkUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// ─────────────────────────────────────────────
// PAYMENT — payment creation
// 20 requests per 15 min per IP
// ─────────────────────────────────────────────
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

// ─────────────────────────────────────────────
// SEARCH — search queries
// 60 requests per 5 min per IP
// ─────────────────────────────────────────────
export const searchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});
