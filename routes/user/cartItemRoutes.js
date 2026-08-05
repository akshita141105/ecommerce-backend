// routes/user/cartItemRoutes.js
import express from "express";
import {
    addToCart,
    getCartItems,
    updateCartItem,
    removeCartItem,
    clearCart,
} from "../../controllers/user/cartItemController.js";
import { authenticate } from "../../middleware/auth.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate);

router.post("/", publicLimiter, addToCart);
router.get("/:cartId", getCartItems);
router.patch("/:cartItemId", updateCartItem);
router.delete("/:cartItemId", removeCartItem);
router.delete("/clear/:cartId", clearCart);

export default router;
