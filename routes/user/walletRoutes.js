// ═══════════════════════════════════════════
// routes/user/walletRoutes.js
// ═══════════════════════════════════════════
import express from "express";
import { getWallet } from "../../controllers/user/walletController.js";
import { authenticate } from "../../middleware/auth.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate);

router.get("/", publicLimiter, getWallet);

export default router;