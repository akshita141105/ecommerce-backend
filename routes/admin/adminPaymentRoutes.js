// routes/admin/adminPaymentRoutes.js
import express from "express";
import { getPaymentStats, getFailedPayments, getNewPaymentsCount, markOrderPaid } from "../../controllers/admin/adminPaymentController.js";

import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

// GET /api/admin/payments/stats?period=month
router.get("/stats", getPaymentStats);

// GET /api/admin/payments/failed?page=1&limit=20
router.get("/failed", getFailedPayments);

router.get("/new-count", getNewPaymentsCount);   // ★ NAYA

router.patch("/admin/payments/:id/mark-paid", markOrderPaid);   // ★ NAYA

export default router;