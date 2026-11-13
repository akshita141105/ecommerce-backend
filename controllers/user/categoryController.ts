// controllers/user/categoryController.ts
import type { Request, Response } from "express";
import Category from "../../models/Category.js";
import client from "../../config/redis.js";
import logger from "../../utils/logger.js";

const CACHE_TTL = 300; // 5 minutes

// -------------------------------------------
// GET ALL CATEGORIES
// GET /api/categories
// -------------------------------------------
export const getCategory = async (_req: Request, res: Response) => {
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
    logger.error(`getCategory error: ${(err as Error).message}`);
    return res.status(500).json({ message: (err as Error).message });
  }
};

// -------------------------------------------
// GET SINGLE CATEGORY
// GET /api/categories/:categorySlug
// -------------------------------------------
export const getsingleCategory = async (req: Request, res: Response) => {
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
    logger.error(`getsingleCategory error: ${(err as Error).message}`);
    return res.status(500).json({ message: (err as Error).message });
  }
};
