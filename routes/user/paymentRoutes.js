// routes/user/paymentRoutes.js
import express from "express";
import {
    createPaymentOrder,
    createCODOrder,
    verifyPayment,
} from "../../controllers/user/paymentController.js";
import { getSingleOrder } from "../../controllers/user/orderController.js";
import { authenticate } from "../../middleware/auth.js";
import { paymentLimiter, publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

// ── Payment ───────────────────────────────────
router.post("/create", authenticate, paymentLimiter, createPaymentOrder);
router.post("/cod", authenticate, paymentLimiter, createCODOrder);
router.post("/verify", authenticate, publicLimiter, verifyPayment);

// ── Order detail after payment ────────────────
router.get("/order/:id", authenticate, getSingleOrder);

// ── Webhook — index.js mein handle hota hai ──
// app.post("/api/payment/webhook", express.raw(...), verifyPaymentWebhook)

export default router;