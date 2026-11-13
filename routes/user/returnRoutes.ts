// ═══════════════════════════════════════════
// routes/user/returnRoutes.ts
// ═══════════════════════════════════════════
import express from "express";
import {
    createReturnRequest, getMyReturns, getReturnByOrder
} from "../../controllers/user/returnController.js";
import { authenticate } from "../../middleware/auth.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(publicLimiter, authenticate);

router.post("/", createReturnRequest);
router.get("/my-returns", getMyReturns);
router.get("/order/:orderId", getReturnByOrder);

export default router;
