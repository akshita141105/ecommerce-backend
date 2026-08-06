// controllers/user/cartItemController.js
import Cart from "../../models/Cart.js";
import CartItem from "../../models/cartItem.js";
import Product from "../../models/Product.js";
import {
  reserveStock,
  releaseStock,
} from "../../services/inventoryService.js";
import logger from "../../utils/logger.js";
import { calculateoffer } from "../../services/offer.js";



/** Returns the cart only if it is active and belongs to this user */
const getActiveCart = (cartId, userId) =>
  Cart.findOne({ _id: cartId, user: userId, status: "active" });

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
      console.log("🟢 NEW CART CREATED:", cart._id, "for user:", userId, "at", new Date());
      logger.info(`Cart created for user: ${userId}`);
    }
    else{
      console.log("🟢 EXISTING CART FOUND:", cart._id, "status:", cart.status, "expiresAt:", cart.expiresAt);
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

    const cart = await Cart.findOneAndUpdate(
      { _id: cartId, user: req.user._id, status: { $ne: "ordered" } },
      { $set: { status: "ordered" } },
      { new: true }
    );

    if (!cart) {
      const check = await Cart.findOne({ _id: cartId, user: req.user._id }).lean();
      if (!check) return res.status(404).json({ message: "Cart not found" });
      return res.status(400).json({ message: "Cart already ordered" });
    }

    logger.info(`Cart marked as ordered: ${cartId}`);
    return res.status(200).json({ message: "Cart marked as ordered" });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// ADD TO CART
// POST /api/cart-items
// Body: { productId, selectedColor, selectedSize, quantity? }
//
// reserveStock atomically checks + decrements available and
// increments reserved — no separate stock pre-read needed here.
// ─────────────────────────────────────────────────────────────────
export const addToCart = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { productId, selectedColor, selectedSize, quantity = 1 } = req.body;

    if (!productId || !selectedColor || !selectedSize) {
      return res
        .status(400)
        .json({ message: "productId, selectedColor, selectedSize are required" });
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ message: "Quantity must be a positive integer" });
    }

    // ── Get or create active cart ──
    let cart = await Cart.findOne({ user: userId, status: "active" });
    if (!cart) cart = await Cart.create({ user: userId });

    // ── Already in cart? — calculate effective delta ──
    const existing = await CartItem.findOne({
      cart: cart._id,
      product: productId,
      selectedColor,
      selectedSize,
    });

    // reserveStock handles availability atomically (race-condition safe)
    try {
      await reserveStock({ productId, color: selectedColor, size: selectedSize, quantity });
    } catch (err) {
      const msgMap = {
        PRODUCT_NOT_FOUND: [404, "Product not found"],
        COLOR_NOT_FOUND: [400, "Selected color not available"],
        SIZE_NOT_FOUND: [400, "Selected size not available"],
        INSUFFICIENT_STOCK: [400, "Not enough stock available"],
      };
      const [status, message] = msgMap[err.message] ?? [500, "Stock reservation failed"];
      return res.status(status).json({ message });
    }

    // ── Persist cart item ──
    if (existing) {
      const updatedItem = await CartItem.findByIdAndUpdate(
        existing._id,
        { $inc: { quantity } },
        { new: true }
      );
      logger.info(`Cart item quantity merged: ${productId} | Cart: ${cart._id}`);
      return res.status(200).json({ message: "Quantity updated in cart", cartItem: updatedItem });
    }

    const cartItem = await CartItem.create({
      cart: cart._id,
      product: productId,
      quantity,
      selectedColor,
      selectedSize,
    });

    logger.info(`Cart item added: ${productId} | Cart: ${cart._id}`);
    return res.status(201).json({ message: "Item added to cart", cartItem });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// GET CART WITH ITEMS
// GET /api/cart-items/:cartId
// ─────────────────────────────────────────────────────────────────
export const getCartItems = async (req, res, next) => {
  try {

    const { cartId } = req.params;
    const userId = req.user._id;

    const cart = await getActiveCart(cartId, userId);
    if (!cart) return res.status(403).json({ message: "Unauthorized" });

    const cartItems = await CartItem.find({ cart: cartId }).populate({
      path: "product",
      select: "name price offer offerStart offerEnd colors slug",
    });

    const detailedCart = cartItems.map((item) => {
      const { finalprice, offertype: offerType, discountper } = calculateoffer(item.product);
      const product = item.product;
      const colorObj = product.colors.find((c) => c.colorName === item.selectedColor);
      const sizeObj = colorObj?.sizes.find((s) => s.size === item.selectedSize);

      // Use the `available` field maintained by inventoryService — source of truth
      const availableQty = (sizeObj?.stock ?? 0) - (sizeObj?.reserved ?? 0);
      const isAvailable = availableQty >= item.quantity;

      return {
        _id: item._id,
        productId: product._id,
        name: product.name,
        slug: product.slug,
        images: colorObj?.images || [],
        selectedColor: item.selectedColor,
        selectedSize: item.selectedSize,
        quantity: item.quantity,
        price: finalprice,
        originalPrice: product.price,
        offerType,
        offer: discountper,
        availableQty,
        isAvailable,
      };
    });

    const total = detailedCart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    return res.status(200).json({ cartItems: detailedCart, total });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// UPDATE CART ITEM QUANTITY
// PATCH /api/cart-items/:cartItemId
// Body: { quantity }
//
// Delta approach:
//   newQty > oldQty → reserve the difference
//   newQty < oldQty → release the difference
//   newQty = oldQty → no-op
// ─────────────────────────────────────────────────────────────────
export const updateCartItem = async (req, res, next) => {
  try {
    const { cartItemId } = req.params;
    const { quantity } = req.body;
    const userId = req.user._id;

    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ message: "Quantity must be a positive integer" });
    }

    const cartItem = await CartItem.findById(cartItemId).populate("product");
    if (!cartItem) return res.status(404).json({ message: "Cart item not found" });

    // ── Ownership check ──
    const cart = await getActiveCart(cartItem.cart, userId);
    if (!cart) return res.status(403).json({ message: "Unauthorized" });

    const oldQty = cartItem.quantity;
    const delta = quantity - oldQty;

    if (delta === 0) {
      return res.status(200).json({ message: "Quantity unchanged", cartItem });
    }

    const inventoryParams = {
      productId: cartItem.product._id,
      color: cartItem.selectedColor,
      size: cartItem.selectedSize,
    };

    if (delta > 0) {
      // Need more stock — reserve the delta
      try {
        await reserveStock({ ...inventoryParams, quantity: delta });
      } catch (err) {
        if (err.message === "INSUFFICIENT_STOCK") {
          // Tell user exactly how many they can have
          const colorObj = cartItem.product.colors.find(
            (c) => c.colorName === cartItem.selectedColor
          );
          const sizeObj = colorObj?.sizes.find((s) => s.size === cartItem.selectedSize);
          const maxAllowed = oldQty + (sizeObj?.available ?? 0);
          return res.status(400).json({
            message: `Only ${maxAllowed} items available (you have ${oldQty} in cart)`,
          });
        }
        return res.status(400).json({ message: "Stock update failed" });
      }
    } else {
      // Releasing stock (delta is negative)
      await releaseStock({ ...inventoryParams, quantity: Math.abs(delta) });
    }

    await CartItem.findByIdAndUpdate(cartItemId, { $set: { quantity } });

    logger.info(`Cart item updated: ${cartItemId} | ${oldQty} → ${quantity}`);
    return res.status(200).json({ message: "Quantity updated", cartItem });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// REMOVE CART ITEM
// DELETE /api/cart-items/:cartItemId
// ─────────────────────────────────────────────────────────────────
export const removeCartItem = async (req, res, next) => {
  try {
    const { cartItemId } = req.params;
    const userId = req.user._id;

    const cartItem = await CartItem.findById(cartItemId);
    if (!cartItem) return res.status(404).json({ message: "Cart item not found" });

    // ── Ownership check ──
    const cart = await getActiveCart(cartItem.cart, userId);
    if (!cart) return res.status(403).json({ message: "Unauthorized" });

    // ── Release reserved stock before deleting ──
    await releaseStock({
      productId: cartItem.product,
      color: cartItem.selectedColor,
      size: cartItem.selectedSize,
      quantity: cartItem.quantity,
    });

    await cartItem.deleteOne();

    logger.info(`Cart item removed: ${cartItemId}`);
    return res.status(200).json({ message: "Item removed from cart" });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// CLEAR CART
// DELETE /api/cart-items/clear/:cartId
//
// Releases stock for every item before deleting.
// Uses Promise.allSettled so one release failure doesn't block
// the rest — failures are logged for manual review.
// ─────────────────────────────────────────────────────────────────
export const clearCart = async (req, res, next) => {
  try {
    const { cartId } = req.params;
    const userId = req.user._id;

    const cart = await getActiveCart(cartId, userId);
    if (!cart) return res.status(403).json({ message: "Unauthorized" });

    const items = await CartItem.find({ cart: cartId });

    // ── Release all reserved stock ──
    const releaseResults = await Promise.allSettled(
      items.map((item) =>
        releaseStock({
          productId: item.product,
          color: item.selectedColor,
          size: item.selectedSize,
          quantity: item.quantity,
        })
      )
    );

    releaseResults.forEach((result, i) => {
      if (result.status === "rejected") {
        logger.error(
          `clearCart: release failed | cart: ${cartId} | product: ${items[i]?.product}`,
          result.reason
        );
      }
    });

    await CartItem.deleteMany({ cart: cartId });

    logger.info(`Cart cleared: ${cartId} | ${items.length} items released`);
    return res.status(200).json({ message: "Cart cleared" });
  } catch (err) {
    next(err);
  }
};