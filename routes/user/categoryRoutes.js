// ═══════════════════════════════════════════
// routes/user/categoryRoutes.js
// ═══════════════════════════════════════════
import express from "express";
import {
  getCategory, getsingleCategory,
} from "../../controllers/user/categoryController.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.get("/", getCategory);
router.get("/:categorySlug", getsingleCategory);

export default router;