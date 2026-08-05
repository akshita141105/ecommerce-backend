// controllers/user/productController.js
import client from "../../lib/redis.js";
import Product from "../../models/Product.js";
import Subcategory from "../../models/Subcategory.js";
import { calculateoffer } from "../../services/offer.js";
import logger from "../../utils/logger.js";
import Category from "../../models/Category.js";

import {
  CACHE_TTL,
  cacheKeys,
  sendError,
} from "../../services/productHelpers.js";

// ─────────────────────────────────────────────
// GET ALL PRODUCTS — customer facing
// GET /api/products/:subcategoryslug
// Query: color, size, minprice, maxprice, sort
// ─────────────────────────────────────────────
export const getallproduct = async (req, res, next) => {
  try {
    const { subcategoryslug } = req.params;
    const { color, size, minprice, maxprice, sort, pattern } = req.query; 

    const cacheKey = cacheKeys.allProducts(subcategoryslug, req.query);
    const cached = await client.get(cacheKey);
    if (cached) {
      logger.info("Product list cache hit");
      return res.status(200).json({ fromCache: true, ...JSON.parse(cached) });
    }

    const subcategory = await Subcategory.findOne({ slug: subcategoryslug })
      .populate("category", "name slug")
      .lean();
    if (!subcategory) return sendError(res, 404, "SubCategory not found");

    const filter = { subcategory: subcategory._id };

    if (color) {
      filter["colors.colorName"] = {
        $regex: new RegExp(`^${color.trim()}$`, "i"),
      };
    }
    if (size) {
      filter["colors.sizes.size"] = size.toUpperCase().trim();
    }

    if (pattern) {
      filter.pattern = { $regex: new RegExp(`^${pattern.trim()}$`, "i") };
    }

    if (minprice || maxprice) {
      filter.price = {};
      if (minprice) filter.price.$gte = Number(minprice);
      if (maxprice) filter.price.$lte = Number(maxprice);
    }

    const sortOptions = {
      price_low: { price: 1 },
      price_high: { price: -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
    };

    let products = await Product.find(filter)
      .sort(sortOptions[sort] || { createdAt: -1 })
      .lean();

    if (color) {
      products = products.map((p) => {
        const matched = p.colors.find(
          (c) => c.colorName.toLowerCase().trim() === color.toLowerCase().trim()
        );
        return matched ? { ...p, colors: [matched] } : p;
      });
    }

    products = products.map((p) => ({ ...p, ...calculateoffer(p) }));

    // ✅ NAYA: subcategory ke saare colors — color/price/size filter se independent
    const allColorsAgg = await Product.aggregate([
      { $match: { subcategory: subcategory._id } }, // sirf subcategory, koi aur filter nahi
      { $unwind: "$colors" },
      {
        $group: {
          _id: { $toLower: { $trim: { input: "$colors.colorName" } } },
          colorName: { $first: { $trim: { input: "$colors.colorName" } } },
        },
      },
    ]);
    const allColors = allColorsAgg.map((c) => c.colorName).filter(Boolean);

    const allPatternsAgg = await Product.aggregate([
      { $match: { subcategory: subcategory._id, pattern: { $nin: [null, ""] } } },
      {
        $group: {
          _id: { $toLower: { $trim: { input: "$pattern" } } },
          pattern: { $first: { $trim: { input: "$pattern" } } },
        },
      },
    ]);
    const allPatterns = allPatternsAgg.map((p) => p.pattern).filter(Boolean);

    const responseData = {
      products,
      categorySlug: subcategory?.category?.slug || null,
      subcategorySlug: subcategory?.slug || null,
      allColors, // ✅ frontend ye use karega filter UI ke liye
      allPatterns,
    };

    await client.setEx(cacheKey, CACHE_TTL.products, JSON.stringify(responseData));

    return res.status(200).json({ fromCache: false, ...responseData });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET SINGLE PRODUCT
// GET /api/products/single/:productslug
// ─────────────────────────────────────────────
export const getsingleproduct = async (req, res, next) => {
  try {
    const { productslug } = req.params;

    // ── Cache ──
    const cacheKey = cacheKeys.single(productslug);
    const cached = await client.get(cacheKey);
    if (cached) {
      logger.info("Single product cache hit");
      return res.status(200).json({ fromCache: true, ...JSON.parse(cached) });
    }

    const product = await Product.findOne({ slug: productslug })
      .populate({
        path: "subcategory",
        populate: { path: "category", select: "name slug" },
      })
      .lean();

    if (!product) return sendError(res, 404, "Product not found");

    const productWithOffer = {
      ...product,
      ...calculateoffer(product),
    };

    const data = {
      product: productWithOffer,
      categorySlug: product.subcategory?.category?.slug || null,
      subcategorySlug: product.subcategory?.slug || null,
    };

    await client.setEx(cacheKey, CACHE_TTL.single, JSON.stringify(data));

    return res.status(200).json({ fromCache: false, ...data });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// NEW ARRIVALS
// GET /api/products/new-arrivals
// ─────────────────────────────────────────────
export const getnewarrival = async (req, res, next) => {
  try {
    const cacheKey = cacheKeys.newArrivals;
    const cached = await client.get(cacheKey);
    if (cached) {
      logger.info("New arrivals cache hit");
      return res.status(200).json({ fromCache: true, ...JSON.parse(cached) });
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    let newArrivals = await Product.find({
      newArrival: { $ne: false },
      $or: [{ newArrival: true }, { createdAt: { $gte: weekAgo } }],
    })
      .populate({
        path: "subcategory",
        select: "slug name",
        populate: { path: "category", select: "slug name" },
      })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // ── Same shared function jo getallproduct/getsingleproduct use karte hain ──
    newArrivals = newArrivals.map((p) => ({ ...p, ...calculateoffer(p) }));

    const data = { newArrivals };
    await client.setEx(cacheKey, CACHE_TTL.newArrivals, JSON.stringify(data));

    return res.status(200).json({ fromCache: false, ...data });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET VIDEOS
// GET /api/products/videos
// ─────────────────────────────────────────────
export const getVideos = async (req, res, next) => {
  try {
    const cacheKey = cacheKeys.videos;
    const cached = await client.get(cacheKey);
    if (cached) {
      logger.info("Videos cache hit");
      return res.status(200).json({ fromCache: true, ...JSON.parse(cached) });
    }

    const products = await Product.find({
      video: { $nin: [null, ""] },
    })
      .populate({
        path: "subcategory",
        select: "slug name",
        populate: { path: "category", select: "slug name" },
      })
      .sort({ createdAt: -1 })
      .lean();

    const data = { products };
    await client.setEx(cacheKey, CACHE_TTL.videos, JSON.stringify(data));

    return res.status(200).json({ fromCache: false, ...data });
  } catch (err) {
    next(err);
  }
};

export const getCategoryProducts = async (req, res, next) => {
  try {
    const { categorySlug } = req.params;

    const cacheKey = cacheKeys.categoryProducts
      ? cacheKeys.categoryProducts(categorySlug)
      : `category-products:${categorySlug}`;

    const cached = await client.get(cacheKey);
    if (cached) {
      logger.info("Category products cache hit");
      return res.status(200).json({ fromCache: true, ...JSON.parse(cached) });
    }

    // ── Category check ──
    const category = await Category.findOne({ slug: categorySlug }).lean();
    if (!category) return sendError(res, 404, "Category not found");

    // ── Sab subcategories jo is category ke andar aati hain ──
    const subcategories = await Subcategory.find({ category: category._id })
      .sort({ createdAt: -1 })
      .lean();

    if (!subcategories.length) {
      const emptyData = {
        categorySlug: category.slug,
        categoryName: category.name,
        groups: [],
      };
      await client.setEx(cacheKey, CACHE_TTL.products, JSON.stringify(emptyData));
      return res.status(200).json({ fromCache: false, ...emptyData });
    }

    const subcategoryIds = subcategories.map((s) => s._id);

    // ── In sab subcategories ke saare products ek hi query mein ──
    const products = await Product.find({ subcategory: { $in: subcategoryIds } })
      .sort({ createdAt: -1 })
      .lean();

    // ── subcategoryId → products[] map bana lo (fast grouping) ──
    const productsBySubcategory = new Map();
    products.forEach((p) => {
      const key = p.subcategory.toString();
      if (!productsBySubcategory.has(key)) productsBySubcategory.set(key, []);
      productsBySubcategory.get(key).push({ ...p, ...calculateoffer(p) });
    });

    // ── Har subcategory ke against uske products group karo ──
    // ── Har subcategory ke against uske products group karo ──
    const groups = subcategories.map((sub) => ({
      subcategorySlug: sub.slug,
      subcategoryName: sub.name,
      products: (productsBySubcategory.get(sub._id.toString()) || []).map((p) => ({
        ...p,
        subcategorySlug: sub.slug,       // ← naya
        categorySlug: category.slug,     // ← naya
      })),
    }));

    const responseData = {
      categorySlug: category.slug,
      categoryName: category.name,
      groups,
    };

    await client.setEx(cacheKey, CACHE_TTL.products, JSON.stringify(responseData));

    return res.status(200).json({ fromCache: false, ...responseData });
  } catch (err) {
    next(err);
  }
};


// ─────────────────────────────────────────────
// OFFERED PRODUCTS
// GET /api/products/offers
// ─────────────────────────────────────────────
export const getOfferedProducts = async (req, res, next) => {
  try {
    const cacheKey = cacheKeys.offers;   // ← ab "product:offers" (pehle "products:offers" tha — 's' ka mismatch)
    const cached = await client.get(cacheKey);
    if (cached) {
      logger.info("Offers cache hit");
      return res.status(200).json({ fromCache: true, ...JSON.parse(cached) });
    }

    const candidates = await Product.find({
      offer: { $gt: 0 },
      offerStart: { $ne: null },
      offerEnd: { $ne: null },
    })
      .populate({
        path: "subcategory",
        select: "slug name",
        populate: { path: "category", select: "slug name" },
      })
      .lean();

    const products = candidates
      .map((p) => ({ ...p, ...calculateoffer(p) }))
      .filter((p) => p.offertype === "active" || p.offertype === "last24Hr")
      .map((p) => ({
        ...p,
        subcategorySlug: p.subcategory?.slug || null,
        categorySlug: p.subcategory?.category?.slug || null,
      }))
      .sort((a, b) => b.discountper - a.discountper);

    const responseData = { products };

    await client.setEx(cacheKey, CACHE_TTL.offers, JSON.stringify(responseData));

    return res.status(200).json({ fromCache: false, ...responseData });
  } catch (err) {
    next(err);
  }
};