// controllers/admin/adminSubcategoryController.js
import slugify from "slugify";
import Subcategory from "../../models/Subcategory.js";
import Category from "../../models/Category.js";
import client from "../../lib/redis.js";
import logger from "../../utils/logger.js";
import { v2 as cloudinary } from "cloudinary";
import { clearProductCache } from "../../services/productHelpers.js";  

const CACHE_TTL = 300;

// ─── Helper: clear subcategory cache ─────────
const clearSubcategoryCache = async (categorySlug) => {
  await client.del(`subcategory:${categorySlug}`);
  await client.del("subcategories:all");
};

// ─── Helper: extract Cloudinary public_id ────
const getPublicId = (url) => {
  if (!url) return null;
  try {
    const parts = url.split("/");
    const folder = parts[parts.length - 2];
    const filename = parts[parts.length - 1].split(".")[0];
    return `${folder}/${filename}`;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────
// CREATE SUBCATEGORY
// POST /api/admin/subcategories
// ─────────────────────────────────────────────
export const createsubcategory = async (req, res, next) => {
  try {
    const { name, categorySlug } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ message: "Subcategory name must be at least 2 characters" });
    }
    if (!categorySlug) {
      return res.status(400).json({ message: "Category is required" });
    }

    const imageUrl = req.file?.path;
    if (!imageUrl) {
      return res.status(400).json({ message: "Subcategory image is required" });
    }

    // ── Category check ──
    const category = await Category.findOne({ slug: categorySlug }).lean();
    if (!category) return res.status(404).json({ message: "Category not found" });

    const slug = slugify(name.trim(), { lower: true, strict: true });

    // ── Duplicate check ──
    const existing = await Subcategory.findOne({ slug }).lean();
    if (existing) return res.status(400).json({ message: "Subcategory already exists" });

    const subcategory = await Subcategory.create({
      name: name.trim(),
      slug,
      image: imageUrl,
      category: category._id,
    });

    await clearSubcategoryCache(categorySlug);

    logger.info(`Subcategory created: ${slug}`);
    return res.status(201).json({
      message: "Subcategory created successfully",
      subcategory,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// UPDATE SUBCATEGORY
// PATCH /api/admin/subcategories/:subcategorySlug
// ─────────────────────────────────────────────
export const updatesubcategory = async (req, res, next) => {
  try {
    const { subcategorySlug } = req.params;
    const { name, categorySlug } = req.body;
    const newImageUrl = req.file?.path;

    if (!name && !newImageUrl && !categorySlug) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const updateData = {};
    let newSlug = subcategorySlug;

    // ── Name update ──
    if (name) {
      updateData.name = name.trim();
      newSlug = slugify(name.trim(), { lower: true, strict: true });
      updateData.slug = newSlug;
    }

    // ── Category update ──
    if (categorySlug) {
      const newCategory = await Category.findOne({ slug: categorySlug }).lean();
      if (!newCategory) return res.status(404).json({ message: "Category not found" });
      updateData.category = newCategory._id;
    }

    // ── Image update ──
    if (newImageUrl) {
      const old = await Subcategory.findOne({ slug: subcategorySlug }).lean();
      if (old?.image) {
        const publicId = getPublicId(old.image);
        if (publicId) {
          await cloudinary.uploader.destroy(publicId).catch((e) =>
            logger.warn(`Failed to delete old subcategory image: ${e.message}`)
          );
        }
      }
      updateData.image = newImageUrl;
    }

    const subcategory = await Subcategory.findOneAndUpdate(
      { slug: subcategorySlug },
      updateData,
      { new: true }
    ).populate("category", "name slug");

    if (!subcategory) return res.status(404).json({ message: "Subcategory not found" });

    // ── Clear cache ──
    // ── Clear cache ──
    await clearSubcategoryCache(subcategory.category?.slug);
    if (categorySlug) await clearSubcategoryCache(categorySlug);
    await clearProductCache();   // ← naya — product responses mein subcategory data populate hota hai

    if (categorySlug) await clearSubcategoryCache(categorySlug);

    logger.info(`Subcategory updated: ${subcategorySlug}`);
    return res.status(200).json({
      message: "Subcategory updated successfully",
      subcategory,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// DELETE SUBCATEGORY
// DELETE /api/admin/subcategories/:subcategorySlug
// ─────────────────────────────────────────────
export const deletesubcategory = async (req, res, next) => {
  try {
    const { subcategorySlug } = req.params;

    const subcategory = await Subcategory.findOneAndDelete({ slug: subcategorySlug })
      .populate("category", "slug");

    if (!subcategory) return res.status(404).json({ message: "Subcategory not found" });

    // ── Delete image from Cloudinary ──
    if (subcategory.image) {
      const publicId = getPublicId(subcategory.image);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId).catch((e) =>
          logger.warn(`Failed to delete subcategory image: ${e.message}`)
        );
      }
    }

    await clearSubcategoryCache(subcategory.category?.slug);
    await clearProductCache();   // ← naya

    logger.info(`Subcategory deleted: ${subcategorySlug}`);
    return res.status(200).json({ message: "Subcategory deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// UPDATE SIZE CHART
// PATCH /api/admin/subcategories/:subcategorySlug/size-chart
// ─────────────────────────────────────────────
export const updateSizeChart = async (req, res, next) => {
  try {
    const { subcategorySlug } = req.params;
    const { unit, rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "At least one size row is required" });
    }

    const subcategory = await Subcategory.findOneAndUpdate(
      { slug: subcategorySlug },
      { $set: { "sizeChart.unit": unit || "in", "sizeChart.rows": rows } },
      { new: true }
    ).populate("category", "name slug");

    if (!subcategory) return res.status(404).json({ message: "Subcategory not found" });

    // ── Clear cache — subcategory cache + product cache dono ──
    await clearSubcategoryCache(subcategory.category?.slug);
    await clearProductCache();   // ← naya — size chart product detail page pe dikhta hai

    logger.info(`Size chart updated: ${subcategorySlug}`);
    return res.status(200).json({
      message: "Size chart updated successfully",
      subcategory,
    });
  } catch (err) {
    next(err);
  }
};