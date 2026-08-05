import "./instrument.js";

import * as Sentry from "@sentry/node";

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import cron from "node-cron";
import mongoose from "mongoose";
import connectmongodb from "./db.js";
import globalErrorHandler from "./middleware/globalErrorHandler.js";
import logger from "./utils/logger.js";
import { emailWorker } from "./utils/emailQueue.js";
import { releaseExpiredCartStock } from "./services/inventoryService.js";
import { notifyAdmin } from "./utils/notifyAdmin.js";
import { verifyPaymentWebhook } from "./controllers/user/paymentController.js";
import { registerStockMonitorCron } from "./jobs/stockMonitor.js";
import { registerReconcilePendingCron } from "./jobs/reconcilePending.js";
import { expireStalePendingOrders } from "./jobs/expireOrders.js";


// ─── User Routes ──────────────────────────────
import authRoutes from "./routes/user/authRoutes.js";
import addressRoutes from "./routes/user/addressRoutes.js";
import cartRoutes from "./routes/user/cartRoutes.js";
import cartItemRoutes from "./routes/user/cartItemRoutes.js";
import categoryPublicRoutes from "./routes/user/categoryRoutes.js";
import subcategoryPublicRoutes from "./routes/user/subcategoryRoutes.js";
import productPublicRoutes from "./routes/user/productRoutes.js";
import orderRoutes from "./routes/user/orderRoutes.js";
import paymentRoutes from "./routes/user/paymentRoutes.js";
import walletRoutes from "./routes/user/walletRoutes.js";
import wishlistRoutes from "./routes/user/wishlistRoutes.js";
import returnPublicRoutes from "./routes/user/returnRoutes.js";
import lookbookPublicRoutes from "./routes/user/lookbookRoutes.js";
import faqRoutes from "./routes/user/faqRoutes.js";
import contactRoutes from "./routes/user/contactRoutes.js";
import promoBannerRoutes from "./routes/user/promoBannerRoutes.js";

// ─── Admin Routes ─────────────────────────────
import adminDashboardRoutes from "./routes/admin/adminDashboardRoutes.js";
import adminProductRoutes from "./routes/admin/adminProductRoutes.js";
import adminCategoryRoutes from "./routes/admin/adminCategoryRoutes.js";
import adminSubcategoryRoutes from "./routes/admin/adminSubcategoryRoutes.js";
import adminReturnRoutes from "./routes/admin/adminReturnRoutes.js";
import adminLookbookRoutes from "./routes/admin/lookbookRoutes.js";
import bulkUploadRoutes from "./routes/admin/bulkUploadRoutes.js";
import adminInventoryRoutes from "./routes/admin/adminInventoryRoutes.js";
import notificationRoutes from "./routes/admin/adminnotificationsRoutes.js";
import adminOrderRoutes from "./routes/admin/adminOrderRoutes.js";
import adminCustomerRoutes from "./routes/admin/adminCustomerRoutes.js";
import adminFaqRoutes from "./routes/admin/adminfaqRoutes.js";
import adminContactRoutes from "./routes/admin/adminContactRoutes.js";
import adminErrorsRoutes from "./routes/admin/adminErrorsRoutes.js";
import failedEmailRoutes from "./routes/admin/failedEmailRoutes.js";
import adminPromoBannerRoutes from "./routes/admin/adminPromoBannerRoutes.js";
import adminPaymentRoutes from "./routes/admin/adminPaymentRoutes.js";



const app = express();
const PORT = process.env.PORT || 8000;


// ─── Start Server ─────────────────────────────
const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});

// ─── Process-level error handlers ─────────────
process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled Rejection:", { reason });
    server.close(() => process.exit(1));
});

process.on("uncaughtException", (err) => {
    logger.error("Uncaught Exception:", err);
    server.close(() => process.exit(1));
});

// ─── DB server───────
connectmongodb();

// ─── CORS ─────────────────────────────────────
const allowedOrigins = [
    process.env.CLIENT_URL,
    process.env.ADMIN_URL,
    "http://localhost:3000",
    "http://localhost:3001",
    "https://ecommerce-frontend-snowy-iota.vercel.app",
].filter(Boolean);

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true); // Postman, curl, server-to-server
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
// app.options("/(.*)", cors(corsOptions));  // ✅ same options reuse karo, dono jagah consistent

app.use(cookieParser());

// ─── Webhook — raw body pehle ─────────────────
app.post(
    "/api/payment/webhook",
    express.raw({ type: "application/json" }),
    verifyPaymentWebhook
);

app.use(express.json());

// ─── Health Check ─────────────────────────────
app.get("/api/health", async (req, res) => {
    try {
        await mongoose.connection.db.admin().ping();
        res.json({
            status: "ok",
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        });
    } catch {
        res.status(503).json({ status: "degraded" });
    }
});

// ═══════════════════════════════════════════
// USER ROUTES
// ═══════════════════════════════════════════
app.use("/api/auth", authRoutes);
app.use("/api/address", addressRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/cart-items", cartItemRoutes);
app.use("/api/categories", categoryPublicRoutes);
app.use("/api/subcategories", subcategoryPublicRoutes);
app.use("/api/products", productPublicRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/returns", returnPublicRoutes);
app.use("/api/lookbook", lookbookPublicRoutes);
app.use("/api/faqs", faqRoutes);
app.use("/api/contact", contactRoutes); // ✅ new contact route
app.use("/api/promo-banner", promoBannerRoutes); // ✅ new promo banner route

// ═══════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════
app.use("/api/admin/dashboard", adminDashboardRoutes);
app.use("/api/admin/products/bulk-upload", bulkUploadRoutes); // ✅ specific pehle
app.use("/api/admin/products", adminProductRoutes);  // ✅ dynamic baad
app.use("/api/admin/categories", adminCategoryRoutes);
app.use("/api/admin/subcategories", adminSubcategoryRoutes);
app.use("/api/admin/returns", adminReturnRoutes);
app.use("/api/admin/lookbook", adminLookbookRoutes);
app.use("/api/admin/inventory", adminInventoryRoutes);
app.use("/api/admin/notifications", notificationRoutes);
app.use("/api/admin/orders", adminOrderRoutes);
app.use("/api/admin/customers", adminCustomerRoutes);
app.use("/api/admin/faqs", adminFaqRoutes);
app.use("/api/admin/contact", adminContactRoutes); // ✅ new admin contact route
app.use("/api/admin", failedEmailRoutes);
app.use("/api/admin/errors", adminErrorsRoutes);
app.use("/api/admin/promo-banner", adminPromoBannerRoutes);
app.use("/api/admin/payments", adminPaymentRoutes);


Sentry.setupExpressErrorHandler(app);


// ─── Global Error Handler ─────────────────────
app.use(globalErrorHandler);

// ─── Cron Jobs ────────────────────────────────
cron.schedule("*/5 * * * *", async () => {
    try {
        await releaseExpiredCartStock();
    } catch (err) {
        logger.error("Cron releaseExpiredCartStock failed:", err);
        await notifyAdmin({
            type: "CRON_FAILED",
            severity: "critical",
            title: "Cron failed: releaseExpiredCartStock",
            message: err.message,
            dedupeKey: "cron_releaseExpiredCartStock",
        }).catch(() => { });
    }
});

cron.schedule("*/10 * * * *", () => {
    expireStalePendingOrders().catch((err) => logger.error("expireOrders job failed:", err));
});

logger.info("Cron: releaseExpiredCartStock registered (every 5 min)");
registerStockMonitorCron();
registerReconcilePendingCron();

app.get("/", (req, res) => {
    res.send("API is running ✅");
});

