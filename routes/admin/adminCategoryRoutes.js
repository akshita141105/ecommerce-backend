// ═══════════════════════════════════════════
// routes/admin/adminCategoryRoutes.js
// ═══════════════════════════════════════════
import express from "express";
import {
    createCategory, updateCategory, deleteCategory,
} from "../../controllers/admin/adminCategoryController.js";
import {
    getCategory, getsingleCategory,
} from "../../controllers/user/categoryController.js";
import { uploadCategoryImage } from "../../config/multer.js";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

router.get("/", getCategory);
router.get("/:categorySlug", getsingleCategory);
router.post("/", uploadCategoryImage.single("image"), createCategory);
router.patch("/:categorySlug", uploadCategoryImage.single("image"), updateCategory);
router.delete("/:categorySlug", deleteCategory);

export default router;