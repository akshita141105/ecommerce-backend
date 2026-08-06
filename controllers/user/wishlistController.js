// controllers/user/wishlistController.js
import WishlistItem from "../../models/WishlistItem.js";
import Product from "../../models/Product.js";
import client from "../../lib/redis.js";
import logger from "../../utils/logger.js";
import { calculateoffer } from "../../services/offer.js";

const CACHE_TTL = 300; // 5 min
const cacheKey = (userId) => `wishlist:${userId}`;

// ✅ FIX (still applies): "category" Product model ka direct field nahi hai —
// sirf subcategory ke andar hi nested milta hai.
const POPULATE_OPTS = {
  path: "productId",
  select: "name price description offer offerStart offerEnd colors subcategory slug",
  populate: {
    path: "subcategory",
    select: "slug name category",
    populate: { path: "category", select: "slug name" },
  },
};

// ─── Helper: fetch + shape wishlist with offer calc ──
const buildWishlistWithOffer = async (userId) => {
  const items = await WishlistItem.find({ userId }).populate(POPULATE_OPTS).lean();

  return items.map((item) => ({
    ...item,
    productId: item.productId
      ? { ...item.productId, ...calculateoffer(item.productId) }
      : item.productId,
  }));
};

// ─── Helper: update cache after any mutation ──
const refreshCache = async (userId) => {
  const wishlistWithOffer = await buildWishlistWithOffer(userId);
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

    const wishlistWithOffer = await buildWishlistWithOffer(userId);

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

    // ── Idempotent add: unique index (userId, productId, color) DB level pe bhi guard karta hai ──
    try {
      await WishlistItem.create({
        userId: req.user._id,
        productId,
        color,
        addedAt: new Date(),
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(200).json({ message: "Already in wishlist" });
      }
      throw err;
    }

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

    const result = await WishlistItem.deleteOne({
      userId: req.user._id,
      productId,
      color,
    });

    if (result.deletedCount === 0) {
      return res.status(200).json({ message: "Product not in wishlist" });
    }

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
    await WishlistItem.deleteMany({ userId: req.user._id });

    await client.del(cacheKey(req.user._id.toString()));

    logger.info(`Wishlist cleared: user ${req.user._id}`);
    return res.status(200).json({ message: "Wishlist cleared", wishlist: [] });
  } catch (err) {
    next(err);
  }
};