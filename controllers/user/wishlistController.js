// controllers/user/wishlistController.js
import User from "../../models/User.js";
import Product from "../../models/Product.js";
import client from "../../lib/redis.js";
import logger from "../../utils/logger.js";
import { calculateoffer } from "../../services/offer.js";

const CACHE_TTL = 300; // 5 min
const cacheKey = (userId) => `wishlist:${userId}`;

// ✅ FIX: "category" Product model ka direct field nahi hai — sirf
// subcategory ke andar hi nested milta hai. Isliye category ko
// subcategory ke populate ke andar nest karna zaroori hai.
const POPULATE_OPTS = {
  path: "wishlist.productId",
  select: "name price description offer offerStart offerEnd colors subcategory slug",
  populate: {
    path: "subcategory",
    select: "slug name category",
    populate: { path: "category", select: "slug name" },
  },
};

// ─── Helper: update cache after any mutation ──
const refreshCache = async (userId) => {
  const user = await User.findById(userId).populate(POPULATE_OPTS).lean();
  const wishlistWithOffer = user.wishlist.map((item) => ({
    ...item,
    productId: item.productId
      ? { ...item.productId, ...calculateoffer(item.productId) }
      : item.productId,
  }));
  await client.setEx(cacheKey(userId), CACHE_TTL, JSON.stringify(wishlistWithOffer));
  return wishlistWithOffer;
};

// ─────────────────────────────────────────────
// GET WISHLIST
// GET /api/wishlist
// ─────────────────────────────────────────────
export const getWishlist = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();

    const cached = await client.get(cacheKey(userId));
    if (cached) {
      logger.info(`Wishlist cache hit: ${userId}`);
      return res.status(200).json({ fromCache: true, wishlist: JSON.parse(cached) });
    }

    const user = await User.findById(userId).populate(POPULATE_OPTS).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    const wishlistWithOffer = user.wishlist.map((item) => ({
      ...item,
      productId: item.productId
        ? { ...item.productId, ...calculateoffer(item.productId) }
        : item.productId,
    }));

    await client.setEx(cacheKey(userId), CACHE_TTL, JSON.stringify(wishlistWithOffer));

    logger.info(`Wishlist fetched from DB: ${userId}`);
    return res.status(200).json({ fromCache: false, wishlist: wishlistWithOffer });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// ADD TO WISHLIST
// POST /api/wishlist
// Body: { productId, color }
// ─────────────────────────────────────────────
export const addToWishlist = async (req, res, next) => {
  try {
    const { productId, color } = req.body;

    if (!productId || !color) {
      return res.status(400).json({ message: "Product ID and color required" });
    }

    // ── Product exists check ──
    const productExists = await Product.findById(productId).lean();
    if (!productExists) {
      return res.status(404).json({ message: "Product not found" });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ── Idempotent add ──
    const alreadyExists = user.wishlist.some(
      (item) => item.productId.toString() === productId && item.color === color
    );

    if (alreadyExists) {
      return res.status(200).json({ message: "Already in wishlist" });
    }

    user.wishlist.push({ productId, color, addedAt: new Date() });
    await user.save();

    // ── Refresh cache ──
    const wishlist = await refreshCache(req.user._id.toString());

    logger.info(`Wishlist add: product ${productId} by user ${req.user._id}`);
    return res.status(200).json({ message: "Added to wishlist", wishlist });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// REMOVE FROM WISHLIST
// DELETE /api/wishlist
// Body: { productId, color }
// ─────────────────────────────────────────────
export const removeFromWishlist = async (req, res, next) => {
  try {
    const { productId, color } = req.body;

    if (!productId || !color) {
      return res.status(400).json({ message: "Product ID and color required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // ── Idempotent remove ──
    const exists = user.wishlist.some(
      (item) => item.productId.toString() === productId && item.color === color
    );

    if (!exists) {
      return res.status(200).json({ message: "Product not in wishlist" });
    }

    user.wishlist = user.wishlist.filter(
      (item) => !(item.productId.toString() === productId && item.color === color)
    );
    await user.save();

    // ── Refresh cache ──
    const wishlist = await refreshCache(req.user._id.toString());

    logger.info(`Wishlist remove: product ${productId} by user ${req.user._id}`);
    return res.status(200).json({ message: "Removed from wishlist", wishlist });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// CLEAR WISHLIST
// DELETE /api/wishlist/clear
// ─────────────────────────────────────────────
export const clearWishlist = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.wishlist = [];
    await user.save();

    await client.del(cacheKey(req.user._id.toString()));

    logger.info(`Wishlist cleared: user ${req.user._id}`);
    return res.status(200).json({ message: "Wishlist cleared", wishlist: [] });
  } catch (err) {
    next(err);
  }
};