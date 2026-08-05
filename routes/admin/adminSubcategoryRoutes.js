// ═══════════════════════════════════════════
// routes/admin/adminSubcategoryRoutes.js
// ═══════════════════════════════════════════
import express from "express";
import {
    createsubcategory, updatesubcategory, deletesubcategory, updateSizeChart, 
} from "../../controllers/admin/adminSubcategoryController.js";
import {
    getAllSubcategories, getsinglesubcategory,
} from "../../controllers/user/subcategoryController.js";
import { uploadSubCategoryImage } from "../../config/multer.js";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

router.get("/", getAllSubcategories);
router.get("/:categorySlug", getsinglesubcategory);
router.post("/", uploadSubCategoryImage.single("image"), createsubcategory);
router.patch("/:subcategorySlug", uploadSubCategoryImage.single("image"), updatesubcategory);
router.delete("/:subcategorySlug", deletesubcategory);
router.patch("/:subcategorySlug/size-chart", updateSizeChart);   // ← naya route

export default router;