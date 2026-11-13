import "./config/instrument.js";

import * as Sentry from "@sentry/node";

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import cron from "node-cron";
import connectmongodb from "./config/db.js";
import globalErrorHandler from "./middleware/globalErrorHandler.js";
import logger from "./utils/logger.js";
import { emailWorker } from "./utils/emailQueue.js";
import { releaseExpiredCartStock } from "./services/inventoryService.js";
import { notifyAdmin } from "./utils/notifyAdmin.js";
import { verifyPaymentWebhook } from "./controllers/user/paymentController.js";
import { registerStockMonitorCron } from "./jobs/stockMonitor.js";
import { registerReconcilePendingCron } from "./jobs/reconcilePending.js";
import { expireStalePendingOrders } from "./jobs/expireOrders.js";
import routes from "./routes/index.js";


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
    "https://ecommerce-admin-panel-lime.vercel.app",
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

// ─── API Routes ────────────────────────────────
app.use("/api", routes);

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

