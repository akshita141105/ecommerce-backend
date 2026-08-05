// ═══════════════════════════════════════════
// routes/user/returnRoutes.js
// ═══════════════════════════════════════════
import express from "express";
import {
    createReturnRequest, getMyReturns, getReturnByOrder
} from "../../controllers/user/returnController.js";
import { authenticate } from "../../middleware/auth.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate);

router.post("/", publicLimiter,createReturnRequest);
router.get("/my-returns", getMyReturns);
router.get("/order/:orderId", getReturnByOrder);

export default router;