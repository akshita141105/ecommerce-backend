// ═══════════════════════════════════════════
// routes/user/subcategoryRoutes.js
// ═══════════════════════════════════════════
import express from "express";
import {
  getAllSubcategories, getsinglesubcategory,
} from "../../controllers/user/subcategoryController.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.get("/", getAllSubcategories);
router.get("/:categorySlug", getsinglesubcategory);

export default router;