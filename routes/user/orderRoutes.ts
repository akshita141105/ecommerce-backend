// ═══════════════════════════════════════════
// routes/user/orderRoutes.ts
// ═══════════════════════════════════════════
import express from "express";
import { getMyOrders, getSingleOrder } from "../../controllers/user/orderController.js";
import { generateInvoice } from "../../controllers/user/invoiceController.js";
import { authenticate } from "../../middleware/auth.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(publicLimiter, authenticate);

router.get("/my-orders", getMyOrders);
router.get("/:orderId/invoice", generateInvoice);
router.get("/:id", getSingleOrder);

export default router;
