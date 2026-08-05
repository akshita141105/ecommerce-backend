// routes/admin/promoBannerRoutes.js
import express from "express";
import {
    createPromoBanner,
    getAllPromoBanners,
    updatePromoBanner,
    deletePromoBanner,
} from "../../controllers/admin/adminPromoBannerController.js";
import { uploadPromoBannerImage } from "../../config/multer.js";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

router.post("/", uploadPromoBannerImage.single("image"), createPromoBanner);
router.get("/", getAllPromoBanners);
router.patch("/:id", uploadPromoBannerImage.single("image"), updatePromoBanner);
router.delete("/:id", deletePromoBanner);

export default router;