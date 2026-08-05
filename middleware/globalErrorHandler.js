import logger from "../utils/logger.js";
import { AppError } from "../utils/AppError.js";

// ─────────────────────────────────────────────────────────
// Global Error Handler Middleware
// Usage: app.use(globalErrorHandler) — last middleware in app.js
// ─────────────────────────────────────────────────────────

const globalErrorHandler = (err, req, res, next) => {
    // Known operational error (thrown by us)
    if (err instanceof AppError && err.isOperational) {
        logger.warn(`[${err.code}] ${err.message}`, {
            path: req.path,
            method: req.method,
        });
        return res.status(err.statusCode).json({
            success: false,
            code: err.code,
            message: err.message,
        });
    }

    // Mongoose validation error
    if (err.name === "ValidationError") {
        const message = Object.values(err.errors).map((e) => e.message).join(", ");
        logger.warn(`Validation Error: ${message}`);
        return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message });
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        logger.warn(`Duplicate key: ${field}`);
        return res.status(409).json({ success: false, code: "DUPLICATE_KEY", message: `${field} already exists `});
    }

    // Mongoose CastError — invalid ObjectId
if (err.name === "CastError") {
  return res.status(400).json({
    success: false,
    code: "INVALID_ID",
    message: `Invalid ${err.path}: ${err.value}`,
  });
}

    // Unknown / unexpected error — don't leak internals
    logger.error("Unexpected error:", { message: err.message, stack: err.stack, path: req.path });
    return res.status(500).json({
        success: false,
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again later.",
    });
};

export default globalErrorHandler;