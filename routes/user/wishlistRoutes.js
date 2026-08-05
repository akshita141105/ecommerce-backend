// ═══════════════════════════════════════════
// routes/user/wishlistRoutes.js
// ═══════════════════════════════════════════
import express from "express";
import {
    getWishlist, addToWishlist,
    removeFromWishlist, clearWishlist,
} from "../../controllers/user/wishlistController.js";
import { authenticate } from "../../middleware/auth.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate);

router.get("/" , getWishlist);
router.post("/add", publicLimiter, addToWishlist);
router.post("/remove", publicLimiter, removeFromWishlist);
router.post("/clear", publicLimiter, clearWishlist);

export default router;