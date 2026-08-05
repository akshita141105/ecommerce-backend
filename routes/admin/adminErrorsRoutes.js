import express from "express";
import { getErrors, getErrorDetail } from "../../controllers/admin/adminErrorsController.js";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

router.get("/", getErrors);
router.get("/:issueId", getErrorDetail);

export default router;