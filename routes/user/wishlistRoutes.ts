// ═══════════════════════════════════════════
// routes/user/wishlistRoutes.ts
// ═══════════════════════════════════════════
import express from "express";
import {
    getWishlist, addToWishlist,
    removeFromWishlist, clearWishlist,
} from "../../controllers/user/wishlistController.js";
import { authenticate } from "../../middleware/auth.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(publicLimiter, authenticate);

router.get("/", getWishlist);
router.post("/add", addToWishlist);
router.post("/remove", removeFromWishlist);
router.post("/clear", clearWishlist);

export default router;
