// services/productHelpers.ts
import type { Response } from "express";
import type { FilterQuery } from "mongoose";
import client from "../config/redis.js";
import Subcategory from "../models/Subcategory.js";
import type { IProduct } from "../models/Product.js";
import logger from "../utils/logger.js";

// ─────────────────────────────────────────────
// CACHE TTL
// ─────────────────────────────────────────────
export const CACHE_TTL = {
  products: 600, // 10 min
  single: 600, // 10 min
  newArrivals: 300, // 5 min
  videos: 300,
  offers: 300, // 5 min
};

// ─────────────────────────────────────────────
// CACHE KEYS
// ─────────────────────────────────────────────
export const cacheKeys = {
  allProducts: (subcategoryslug: string, query: unknown) => `product:${subcategoryslug}:${JSON.stringify(query)}`,
  single: (slug: string) => `product:${slug}`,
  newArrivals: "product:newArrivals",
  videos: "product:videos",
  categoryProducts: (categorySlug: string) => `category-products:${categorySlug}`,
  offers: "product:offers",
};

// ─────────────────────────────────────────────
// CLEAR ALL PRODUCT CACHE
// ─────────────────────────────────────────────
export const clearProductCache = async (): Promise<void> => {
  const [productKeys, categoryKeys] = await Promise.all([client.keys("product:*"), client.keys("category-products:*")]);
  const allKeys = [...productKeys, ...categoryKeys];
  if (allKeys.length) await client.del(allKeys);
};

// ─────────────────────────────────────────────
// SEND ERROR RESPONSE
// ─────────────────────────────────────────────
export const sendError = (res: Response, status: number, message: string) => res.status(status).json({ success: false, message });

// ─────────────────────────────────────────────
// SAFE JSON PARSE
// ─────────────────────────────────────────────
export const safeParse = <T = unknown>(data: unknown): T | null => {
  if (!data) return null;
  try {
    return typeof data === "string" ? JSON.parse(data) : (data as T);
  } catch {
    return null;
  }
};

interface RawColorInput {
  colorName: string;
  sizes?: { size: string; stock?: string | number }[];
}

// ─────────────────────────────────────────────
// PARSE COLORS — builds colors array with
// nested sizes from request body + uploaded files
// ─────────────────────────────────────────────
export const parseColors = (colorsData: unknown, files?: Express.Multer.File[]) => {
  const parsed = safeParse<RawColorInput[]>(colorsData);
  if (!parsed || !Array.isArray(parsed)) return [];

  return parsed.map((color, index) => {
    const images = files?.filter((f) => f.fieldname === `colors[${index}][images]`).map((f) => f.path) || [];

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

interface BuildProductFilterParams {
  search?: string;
  subcategorySlug?: string;
  categorySlug?: string;
  fit?: string;
  type?: string;
  material?: string;
  pattern?: string;
  hasOffer?: string;
}

export const buildProductFilter = async ({
  search,
  subcategorySlug,
  categorySlug,
  fit,
  type,
  material,
  pattern,
  hasOffer,
}: BuildProductFilterParams): Promise<FilterQuery<IProduct>> => {
  const filter: FilterQuery<IProduct> = {};

  if (search) {
    filter.$or = [{ name: { $regex: search, $options: "i" } }, { slug: { $regex: search, $options: "i" } }];
  }

  if (subcategorySlug) {
    const sub = await Subcategory.findOne({ slug: subcategorySlug }).lean();
    if (sub) filter.subcategory = sub._id;
  } else if (categorySlug) {
    const subs = await Subcategory.find({}).populate<{ category: { slug: string } | null }>("category", "slug").lean();
    const matched = subs.filter((s) => s.category?.slug === categorySlug);
    filter.subcategory = { $in: matched.map((s) => s._id) };
  }

  if (fit) filter.fit = fit as IProduct["fit"];
  if (type) filter.type = { $regex: type, $options: "i" };
  if (material) filter.material = { $regex: material, $options: "i" };
  if (pattern) filter.pattern = { $regex: pattern, $options: "i" };

  // active offer filter
  if (hasOffer === "true") {
    const now = new Date();
    filter.offer = { $gt: 0 };
    filter.offerStart = { $ne: null, $lte: now };
    filter.offerEnd = { $ne: null, $gte: now };
  }

  return filter;
};

// ─────────────────────────────────────────────
// FIND VIDEO FILE — from a flat multer .any() files array
// ─────────────────────────────────────────────
// Looks for the file uploaded under the expected fieldname "video" first;
// falls back to any file with a video/* mimetype (and logs a warning) so a
// frontend fieldname mismatch doesn't silently drop the upload instead of
// erroring or falling back visibly.
export const findVideoFile = (files?: Express.Multer.File[] | null): Express.Multer.File | null => {
  const list = Array.isArray(files) ? files : [];
  const byFieldname = list.find((f) => f.fieldname === "video");
  if (byFieldname) return byFieldname;

  const byMimetype = list.find((f) => f.mimetype?.startsWith("video/"));
  if (byMimetype) {
    logger.warn(
      `findVideoFile: no file with fieldname "video" found, but a video/* file was uploaded under fieldname "${byMimetype.fieldname}" — using it as a fallback. Check the upload form's field name.`
    );
  }
  return byMimetype || null;
};
