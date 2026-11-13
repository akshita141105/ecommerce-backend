// routes/user/promoBannerRoutes.ts
import express from "express";
import { getActivePromoBanner } from "../../controllers/user/promoBannerController.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(publicLimiter);

router.get("/active", getActivePromoBanner);

export default router;
