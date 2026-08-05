// controllers/categoryController.js
import slugify from "slugify";
import Category from "../../models/Category.js";
import client from "../../lib/redis.js";
import logger from "../../utils/logger.js";
import { v2 as cloudinary } from "cloudinary";

const CACHE_TTL = 300; // 5 minutes

// ─── Helper: clear all category cache ────────
const clearCategoryCache = async (slug = null) => {
  const keys = ["categories"];
  if (slug) keys.push(`category:${slug}`);
  await Promise.all(keys.map((k) => client.del(k)));
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

// -------------------------------------------
// CREATE CATEGORY
// POST /api/categories
// -------------------------------------------
export const createCategory = async (req, res) => {
  try {
    const { name } = req.body;

    // ── Validation ──
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ message: "Category name must be at least 2 characters" });
    }

    const imageUrl = req.file?.path;
    if (!imageUrl) {
      return res.status(400).json({ message: "Category image is required" });
    }

    const slug = slugify(name.trim(), { lower: true, strict: true });

    // ── Duplicate check ──
    const existing = await Category.findOne({ slug });
    if (existing) {
      return res.status(400).json({ message: "Category already exists" });
    }

    const category = new Category({ name: name.trim(), slug, image: imageUrl });
    await category.save();

    // Clear cache
    await clearCategoryCache();

    logger.info(`Category created: ${slug}`);
    return res.status(201).json({ message: "Category created successfully", category });

  } catch (err) {
    logger.error(`createCategory error: ${err.message}`);
    return res.status(500).json({ message: err.message });
  }
};

// -------------------------------------------
// GET ALL CATEGORIES
// GET /api/categories
// -------------------------------------------
export const getCategory = async (req, res) => {
  try {
    const cached = await client.get("categories");
    if (cached) {
      logger.info("Categories cache hit");
      return res.status(200).json({ fromCache: true, data: JSON.parse(cached) });
    }

    const categories = await Category.find().sort({ createdAt: -1 }).lean();

    await client.setEx("categories", CACHE_TTL, JSON.stringify(categories));

    logger.info("Categories fetched from DB");
    return res.status(200).json({ fromCache: false, data: categories });

  } catch (err) {
    logger.error(`getCategory error: ${err.message}`);
    return res.status(500).json({ message: err.message });
  }
};

// -------------------------------------------
// GET SINGLE CATEGORY
// GET /api/categories/:categorySlug
// -------------------------------------------
export const getsingleCategory = async (req, res) => {
  try {
    const { categorySlug } = req.params;

    const cacheKey = `category:${categorySlug}`;
    const cached = await client.get(cacheKey);
    if (cached) {
      logger.info(`Single category cache hit: ${categorySlug}`);
      return res.status(200).json({ fromCache: true, data: JSON.parse(cached) });
    }

    const category = await Category.findOne({ slug: categorySlug }).lean();
    if (!category) {
      return res.status(404).json({ message: "Category not found" }); // 404 not 400
    }

    await client.setEx(cacheKey, CACHE_TTL, JSON.stringify(category));

    logger.info(`Single category fetched: ${categorySlug}`);
    return res.status(200).json({ fromCache: false, data: category });

  } catch (err) {
    logger.error(`getsingleCategory error: ${err.message}`);
    return res.status(500).json({ message: err.message });
  }
};

// -------------------------------------------
// UPDATE CATEGORY
// PUT /api/categories/:categorySlug
// -------------------------------------------
export const updateCategory = async (req, res) => {
  try {
    const { categorySlug } = req.params;
    const { name } = req.body;
    const newImageUrl = req.file?.path;

    // At least one field required
    if (!name && !newImageUrl) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const updateData = {};
    let newSlug = categorySlug;

    if (name) {
      updateData.name = name.trim();
      newSlug = slugify(name.trim(), { lower: true, strict: true });
      updateData.slug = newSlug;
    }

    if (newImageUrl) {
      // ── Delete old image from Cloudinary ──
      const oldCategory = await Category.findOne({ slug: categorySlug }).lean();
      if (oldCategory?.image) {
        const publicId = getPublicId(oldCategory.image);
        if (publicId) {
          await cloudinary.uploader.destroy(publicId).catch((e) =>
            logger.warn(`Failed to delete old image: ${e.message}`)
          );
        }
      }
      updateData.image = newImageUrl;
    }

    const category = await Category.findOneAndUpdate(
      { slug: categorySlug },
      updateData,
      { new: true }
    );

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Clear both old and new slug cache
    await clearCategoryCache(categorySlug);
    if (newSlug !== categorySlug) await clearCategoryCache(newSlug);

    logger.info(`Category updated: ${categorySlug}`);
    return res.status(200).json({ message: "Category updated successfully", category });

  } catch (err) {
    logger.error(`updateCategory error: ${err.message}`);
    return res.status(500).json({ message: err.message });
  }
};

// -------------------------------------------
// DELETE CATEGORY
// DELETE /api/categories/:categorySlug
// -------------------------------------------
export const deleteCategory = async (req, res) => {
  try {
    const { categorySlug } = req.params;

    const category = await Category.findOneAndDelete({ slug: categorySlug });
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // ── Delete image from Cloudinary ──
    if (category.image) {
      const publicId = getPublicId(category.image);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId).catch((e) =>
          logger.warn(`Failed to delete category image: ${e.message}`)
        );
      }
    }

    await clearCategoryCache(categorySlug);

    logger.info(`Category deleted: ${categorySlug}`);
    return res.status(200).json({ message: "Category deleted successfully" });

  } catch (err) {
    logger.error(`deleteCategory error: ${err.message}`);
    return res.status(500).json({ message: err.message });
  }
};