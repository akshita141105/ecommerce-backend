// services/productHelpers.js
import client from "../lib/redis.js";
import Subcategory from "../models/Subcategory.js"; // agar already import nahi hai


// ─────────────────────────────────────────────
// CACHE TTL
// ─────────────────────────────────────────────
export const CACHE_TTL = {
  products: 600,    // 10 min
  single: 600,      // 10 min
  newArrivals: 300, // 5 min
  videos: 300,
  offers: 300,      // 5 min
};

// ─────────────────────────────────────────────
// CACHE KEYS
// ─────────────────────────────────────────────
export const cacheKeys = {
  allProducts: (subcategoryslug, query) =>
    `product:${subcategoryslug}:${JSON.stringify(query)}`,
  single: (slug) => `product:${slug}`,
  newArrivals: "product:newArrivals",
  videos: "product:videos",
  categoryProducts: (categorySlug) => `category-products:${categorySlug}`,
  offers: "product:offers",     // ← naya
};

// ─────────────────────────────────────────────
// CLEAR ALL PRODUCT CACHE
// ─────────────────────────────────────────────
export const clearProductCache = async () => {
  const [productKeys, categoryKeys] = await Promise.all([
    client.keys("product:*"),
    client.keys("category-products:*"),
  ]);
  const allKeys = [...productKeys, ...categoryKeys];
  if (allKeys.length) await client.del(allKeys);
};

// ─────────────────────────────────────────────
// SEND ERROR RESPONSE
// ─────────────────────────────────────────────
export const sendError = (res, status, message) =>
  res.status(status).json({ success: false, message });

// ─────────────────────────────────────────────
// SAFE JSON PARSE
// ─────────────────────────────────────────────
export const safeParse = (data) => {
  if (!data) return null;
  try {
    return typeof data === "string" ? JSON.parse(data) : data;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────
// PARSE COLORS — builds colors array with
// nested sizes from request body + uploaded files
// ─────────────────────────────────────────────
export const parseColors = (colorsData, files) => {
  const parsed = safeParse(colorsData);
  if (!parsed || !Array.isArray(parsed)) return [];

  return parsed.map((color, index) => {
    const images =
      files
        ?.filter((f) => f.fieldname === `colors[${index}][images]`)
        .map((f) => f.path) || [];

    const sizes = Array.isArray(color.sizes)
      ? color.sizes.map((s) => ({
          size: String(s.size).toUpperCase().trim(),
          stock: Math.max(0, Number(s.stock) || 0),
        }))
      : [];

    return {
      colorName: color.colorName,
      images,
      sizes,
    };
  });
};

export const buildProductFilter = async ({ search, subcategorySlug, categorySlug, fit, type, material, pattern, hasOffer }) => {
  const filter = {};

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { slug: { $regex: search, $options: "i" } },
    ];
  }

  if (subcategorySlug) {
    const sub = await Subcategory.findOne({ slug: subcategorySlug }).lean();
    if (sub) filter.subcategory = sub._id;
  } else if (categorySlug) {
    const subs = await Subcategory.find({}).populate("category", "slug").lean();
    const matched = subs.filter((s) => s.category?.slug === categorySlug);
    filter.subcategory = { $in: matched.map((s) => s._id) };
  }

  if (fit) filter.fit = fit;
  if (type) filter.type = { $regex: type, $options: "i" };
  if (material) filter.material = { $regex: material, $options: "i" };
  if (pattern) filter.pattern = { $regex: pattern, $options: "i" };

  // ★ NAYA — active offer filter
  if (hasOffer === "true") {
    const now = new Date();
    filter.offer = { $gt: 0 };
    filter.offerStart = { $ne: null, $lte: now };
    filter.offerEnd = { $ne: null, $gte: now };
  }

  return filter;
};


