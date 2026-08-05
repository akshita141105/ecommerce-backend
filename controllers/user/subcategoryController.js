// controllers/user/subcategoryController.js
import Subcategory from "../../models/Subcategory.js";
import Category from "../../models/Category.js";
import client from "../../lib/redis.js";
import logger from "../../utils/logger.js";

const CACHE_TTL = 300;

export const getsinglesubcategory = async (req, res, next) => {
  try {
    const { categorySlug } = req.params;
    const cacheKey = `subcategory:${categorySlug}`;

    const cached = await client.get(cacheKey);
    if (cached) {
      logger.info(`Subcategory cache hit: ${categorySlug}`);
      return res.status(200).json({ fromCache: true, data: JSON.parse(cached) });
    }

    const category = await Category.findOne({ slug: categorySlug }).lean();
    if (!category) return res.status(404).json({ message: "Category not found" });

    const subcategories = await Subcategory.find({ category: category._id })
      .populate("category", "name slug")
      .sort({ createdAt: -1 })
      .lean();

    await client.setEx(cacheKey, CACHE_TTL, JSON.stringify(subcategories));
    logger.info(`Subcategories fetched: ${categorySlug}`);

    return res.status(200).json({ fromCache: false, data: subcategories });
  } catch (err) {
    next(err);
  }
};

export const getAllSubcategories = async (req, res, next) => {
  try {
    const cacheKey = "subcategories:all";

    const cached = await client.get(cacheKey);
    if (cached) {
      return res.status(200).json({ fromCache: true, data: JSON.parse(cached) });
    }

    const subcategories = await Subcategory.find()
      .populate("category", "name slug")
      .sort({ createdAt: -1 })
      .lean();

    await client.setEx(cacheKey, CACHE_TTL, JSON.stringify(subcategories));

    return res.status(200).json({ fromCache: false, data: subcategories });
  } catch (err) {
    next(err);
  }
};