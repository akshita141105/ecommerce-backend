// routes/admin/failedEmailRoutes.js
import express from "express";
import { getFailedEmails, resendFailedEmail } from "../../controllers/admin/failedEmailController.js";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

router.get("/failed-emails", getFailedEmails);
router.post("/failed-emails/:id/resend", resendFailedEmail);

export default router;