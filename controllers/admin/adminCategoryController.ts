// controllers/admin/adminCategoryController.ts
import type { NextFunction, Request, Response } from "express";
import slugify from "../../utils/slug.js";
import Category from "../../models/Category.js";
import client from "../../config/redis.js";
import logger from "../../utils/logger.js";
import { v2 as cloudinary } from "cloudinary";

// ─── Helper: clear category cache ────────────
const clearCategoryCache = async (slug: string | null = null) => {
  const keys = ["categories"];
  if (slug) keys.push(`category:${slug}`);
  await Promise.all(keys.map((k) => client.del(k)));
};

// ─── Helper: extract Cloudinary public_id ────
const getPublicId = (url: string | null | undefined) => {
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
// CREATE CATEGORY
// POST /api/admin/categories
// ─────────────────────────────────────────────
export const createCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ message: "Category name must be at least 2 characters" });
    }

    const imageUrl = req.file?.path;
    if (!imageUrl) {
      return res.status(400).json({ message: "Category image is required" });
    }

    const slug = slugify(name.trim(), { lower: true, strict: true });

    const existing = await Category.findOne({ slug }).lean();
    if (existing) return res.status(400).json({ message: "Category already exists" });

    const category = await Category.create({ name: name.trim(), slug, image: imageUrl });

    await clearCategoryCache();

    logger.info(`Category created: ${slug}`);
    return res.status(201).json({ message: "Category created successfully", category });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// UPDATE CATEGORY
// PATCH /api/admin/categories/:categorySlug
// ─────────────────────────────────────────────
export const updateCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { categorySlug } = req.params as { categorySlug: string };
    const { name } = req.body;
    const newImageUrl = req.file?.path;

    if (!name && !newImageUrl) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const updateData: { name?: string; slug?: string; image?: string } = {};
    let newSlug = categorySlug;

    if (name) {
      updateData.name = name.trim();
      newSlug = slugify(name.trim(), { lower: true, strict: true });
      updateData.slug = newSlug;
    }

    if (newImageUrl) {
      updateData.image = newImageUrl;
    }

    // ── new: false → yeh update se PEHLE wala (purana) document return karega ──
    const oldCategory = await Category.findOneAndUpdate(
      { slug: categorySlug },
      updateData,
      { new: false }
    );

    if (!oldCategory) return res.status(404).json({ message: "Category not found" });

    // ── ab purani image (agar nayi image aayi thi) safely delete karo ──
    if (newImageUrl && oldCategory.image) {
      const publicId = getPublicId(oldCategory.image);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId).catch((e) =>
          logger.warn(`Failed to delete old image: ${e.message}`)
        );
      }
    }

    const category = await Category.findOne({ slug: newSlug });

    await clearCategoryCache(categorySlug);
    if (newSlug !== categorySlug) await clearCategoryCache(newSlug);

    logger.info(`Category updated: ${categorySlug}`);
    return res.status(200).json({ message: "Category updated successfully", category });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// DELETE CATEGORY
// DELETE /api/admin/categories/:categorySlug
// ─────────────────────────────────────────────
export const deleteCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { categorySlug } = req.params as { categorySlug: string };

    const category = await Category.findOneAndDelete({ slug: categorySlug });
    if (!category) return res.status(404).json({ message: "Category not found" });

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
    next(err);
  }
};
