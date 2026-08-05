// ═══════════════════════════════════════════
// routes/admin/adminReturnRoutes.js
// ═══════════════════════════════════════════
import express from "express";
import {
    getAllReturns, getSingleReturn,
    approveReturn, rejectReturn,
} from "../../controllers/admin/adminReturnController.js";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

router.get("/", getAllReturns);
router.get("/:returnId", getSingleReturn);
router.patch("/:returnId/approve", approveReturn);
router.patch("/:returnId/reject", rejectReturn);

export default router;
