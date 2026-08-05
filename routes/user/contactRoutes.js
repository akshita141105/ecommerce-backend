// routes/contactRoutes.js
import express from "express";
import { submitContactMessage } from "../../controllers/user/contactController.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use( publicLimiter);

// ─── Public route — anyone can submit the contact form ──────
router.post("/", submitContactMessage);

export default router;
