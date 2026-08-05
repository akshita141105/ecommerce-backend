// utils/AppError.js

// ─────────────────────────────────────────────
// Custom Error Class
// ─────────────────────────────────────────────
export class AppError extends Error {
    constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

// ─────────────────────────────────────────────
// Factory helpers — common errors
// Import: import { AppError, Errors } from "../utils/AppError.js"
// Usage:  throw Errors.cartNotFound()
// ─────────────────────────────────────────────
export const Errors = {
    // Cart
    cartNotFound: () => new AppError("Cart not found", 400, "CART_NOT_FOUND"),
    cartEmpty: () => new AppError("Cart is empty", 400, "CART_EMPTY"),

    // Product
    productNotFound: (name) => new AppError(`Product not found: ${name}`, 404, "PRODUCT_NOT_FOUND"),
    colorUnavailable: (color, name) => new AppError(`Color "${color}" not available for ${name}`, 400, "COLOR_UNAVAILABLE"),
    sizeUnavailable: (size, name) => new AppError(`Size "${size}" not available for ${name}`, 400, "SIZE_UNAVAILABLE"),
    insufficientStock: (name, size, available) => new AppError(
        `Insufficient stock for ${name} (${size}) — only ${available} left`, 400, "INSUFFICIENT_STOCK"
    ),
    stockUpdateFailed: (name) => new AppError(`Stock update failed for ${name}`, 409, "STOCK_UPDATE_FAILED"),

    // Order / Payment
    orderNotFound: () => new AppError("Order not found", 404, "ORDER_NOT_FOUND"),
    addressRequired: () => new AppError("Complete address is required", 400, "ADDRESS_REQUIRED"),
    invalidSignature: () => new AppError("Invalid webhook signature", 401, "INVALID_SIGNATURE"),
};