// controllers/user/cartController.js
import Cart from "../../models/Cart.js";
import logger from "../../utils/logger.js";

// ─────────────────────────────────────────────────────────────────
// GET OR CREATE CART
// GET /api/cart
// ─────────────────────────────────────────────────────────────────
export const getOrCreateCart = async (req, res, next) => {
  try {
    const userId = req.user._id;

    let cart = await Cart.findOne({ user: userId, status: "active" });
    if (!cart) {
      cart = await Cart.create({ user: userId });
      logger.info(`Cart created for user: ${userId}`);
    }

    return res.status(200).json({ cartId: cart._id });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// MARK CART AS ORDERED — called internally after payment success
// PATCH /api/cart/:cartId/order
// ─────────────────────────────────────────────────────────────────
export const markCartAsOrdered = async (req, res, next) => {
  try {
    const { cartId } = req.params;

    const cart = await Cart.findOne({ _id: cartId, user: req.user._id });
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    if (cart.status === "ordered") {
      return res.status(400).json({ message: "Cart already ordered" });
    }

    cart.status = "ordered";
    await cart.save();

    logger.info(`Cart marked as ordered: ${cartId}`);
    return res.status(200).json({ message: "Cart marked as ordered" });
  } catch (err) {
    next(err);
  }
};