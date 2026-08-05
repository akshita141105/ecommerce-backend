// routes/user/cartRoutes.js
import express from "express";
import {
    getOrCreateCart,
    markCartAsOrdered,
} from "../../controllers/user/cartController.js";
import { authenticate } from "../../middleware/auth.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate);

router.get("/my-cart", getOrCreateCart);
router.patch("/:cartId/ordered", markCartAsOrdered);

export default router;