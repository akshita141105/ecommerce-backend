import express from "express";
import {
    getAllOrders,
    getOrderDetail,
    updateOrderStatus,
    downloadInvoice,
} from "../../controllers/admin/adminOrderController.js";
import {
    getAllReturns,      // ✅ yahan se lo ab
    approveReturn,
    rejectReturn,
} from "../../controllers/admin/adminReturnController.js";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

// Specific routes pehle
router.get("/returns", getAllReturns);
router.patch("/returns/:id/approve", approveReturn);
router.patch("/returns/:id/reject", rejectReturn);

// Generic :id routes baad mein
router.get("/", getAllOrders);
router.get("/:id", getOrderDetail);
router.get("/:id/invoice", downloadInvoice);
router.patch("/:id/status", updateOrderStatus);

export default router;