// controllers/admin/adminProductController.ts
import type { NextFunction, Request, Response } from "express";
import slugify from "../../utils/slug.js";
import Product, { type IProduct } from "../../models/Product.js";
import Subcategory from "../../models/Subcategory.js";
import logger from "../../utils/logger.js";
import { clearProductCache, sendError, safeParse, parseColors, buildProductFilter, findVideoFile } from "../../services/productHelpers.js";
import { applyProductUpdate, ProductUpdateError } from "../../services/productMutationService.js";

// ─────────────────────────────────────────────
// GET ALL PRODUCTS — ADMIN PANEL
// GET /api/admin/products?page=1&limit=10&search=&subcategorySlug=&categorySlug=
// ─────────────────────────────────────────────
export const getAdminProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = "1", limit = "10", search, subcategorySlug, categorySlug, hasOffer } = req.query as Record<string, string | undefined>;
    const filter = await buildProductFilter({ search, subcategorySlug, categorySlug, hasOffer });
    const skip = (Number(page) - 1) * Number(limit);

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .populate({ path: "subcategory", populate: { path: "category", select: "name slug" } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      products,
      total,
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET PRODUCT IDs MATCHING FILTER — for "Select All"
// GET /api/admin/products/ids?categorySlug=&subcategorySlug=&search=
// ─────────────────────────────────────────────
export const getAdminProductIds = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, subcategorySlug, categorySlug, hasOffer } = req.query as Record<string, string | undefined>;
    const filter = await buildProductFilter({ search, subcategorySlug, categorySlug, hasOffer });
    const ids = await Product.find(filter).distinct("_id");
    return res.status(200).json({ success: true, ids });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET SINGLE PRODUCT BY ID — ADMIN
// GET /api/admin/products/:productId
// ─────────────────────────────────────────────
export const getAdminProductById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId } = req.params as { productId: string };

    const product = await Product.findById(productId)
      .populate({
        path: "subcategory",
        populate: { path: "category", select: "name slug" },
      })
      .lean();

    if (!product) return sendError(res, 404, "Product not found");

    return res.status(200).json({ success: true, product });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// CREATE PRODUCT
// POST /api/admin/products
// ─────────────────────────────────────────────
export const createProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, subcategoryslug, price, description, details, offer, offerStart, offerEnd, newArrival, colors: colorsData, type, material, fit, pattern, sleeve, collar, videoVisible } =
      req.body;

    // ── Required field checks ──
    if (!name) return sendError(res, 400, "name is required");
    if (!subcategoryslug) return sendError(res, 400, "subcategory is required");
    if (!price) return sendError(res, 400, "price is required");
    if (!description) return sendError(res, 400, "description is required");
    if (!details) return sendError(res, 400, "details is required");
    if (!colorsData) return sendError(res, 400, "colors are required");

    // ── Subcategory check ──
    const subcategory = await Subcategory.findOne({ slug: subcategoryslug }).lean();
    if (!subcategory) return sendError(res, 400, "Invalid subcategory");

    // ── Slug + duplicate check ──
    const slug = slugify(name, { lower: true, strict: true });
    if (await Product.findOne({ slug }).lean()) {
      return sendError(res, 400, "Product name already exists!");
    }

    // ── Parse colors ──
    const files = Array.isArray(req.files) ? req.files : [];
    const colors = parseColors(colorsData, files);

    if (!colors.length) {
      return sendError(res, 400, "At least 1 color with sizes is required");
    }

    const hasInvalidColor = colors.some((c) => !c.colorName || !c.images.length || !c.sizes.length);
    if (hasInvalidColor) {
      return sendError(res, 400, "Each color must have a colorName, at least 1 image, and at least 1 size");
    }

    // ── Video ── (req.files is a flat array — uploadProductMedia.any())
    const videoFile = findVideoFile(files);
    const videoUrl = videoFile?.path || null;

    // ── Create ──
    const product = await Product.create({
      name,
      slug,
      price: Number(price),
      description,
      details,
      offer: offer ? Number(offer) : 0,
      offerStart: offerStart || null,
      offerEnd: offerEnd || null,
      newArrival: newArrival === "true" || newArrival === true,
      colors,
      subcategory: subcategory._id,
      video: videoUrl,
      videoVisible: videoVisible === undefined ? true : videoVisible === "true" || videoVisible === true,
      // ← naye fields, default "" agar na diye ho
      type: type || "",
      material: material || "",
      fit: fit || "",
      pattern: pattern || "",
      sleeve: sleeve || "",
      collar: collar || "",
    });

    await clearProductCache();

    logger.info(`Product created: ${slug}`);

    return res.status(201).json({
      success: true,
      message: "Product created successfully!",
      product,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// UPDATE PRODUCT — operation based
// PATCH /api/admin/products/:productId
//
// Supported operations via req.body.data (JSON):
//
// Basic fields:
//   { name, price, description, details, offer,
//     offerStart, offerEnd, newArrival }
//
// updateColor:        { colorId, colorName, images? }
// addImagesToColor:   { colorId } + files "newImages"
// removeImageFromColor: { colorId, imageUrl }
// addColor:           [{ colorName, images, sizes }]
// removeColor:        { colorId }
// updateSize:         { colorId, sizeId, size, stock }
// addSize:            { colorId, sizes: [{size, stock}] }
// removeSize:         { colorId, sizeId }
// ─────────────────────────────────────────────
export const updateproduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId } = req.params as { productId: string };
    const data = safeParse(req.body?.data) || {};

    const product = await Product.findById(productId);
    if (!product) return sendError(res, 404, "Product not found");

    try {
      await applyProductUpdate(product, data, req.files as Express.Multer.File[] | undefined);
    } catch (e) {
      if (e instanceof ProductUpdateError) return sendError(res, e.status, e.message);
      throw e;
    }

    await product.save();
    await clearProductCache();

    logger.info(`Product updated: ${product.slug}`);

    return res.status(200).json({
      success: true,
      message: "Product updated successfully!",
      product,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// BULK UPDATE — newArrival toggle for multiple
// PATCH /api/admin/products/bulk-update
// Body: { productIds: [...], data: { newArrival: true } }
// ─────────────────────────────────────────────
const BULK_ALLOWED_FIELDS = ["newArrival", "offer", "offerStart", "offerEnd"] as const;

export const bulkUpdateProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productIds, data } = req.body;

    if (!Array.isArray(productIds) || !productIds.length) {
      return sendError(res, 400, "productIds array is required");
    }
    if (!data || typeof data !== "object") {
      return sendError(res, 400, "data object is required");
    }

    const updateData: Partial<Pick<IProduct, "newArrival" | "offer" | "offerStart" | "offerEnd">> = {};
    BULK_ALLOWED_FIELDS.forEach((k) => {
      if (data[k] !== undefined) (updateData as Record<string, unknown>)[k] = data[k];
    });

    if (!Object.keys(updateData).length) {
      return sendError(res, 400, "No valid fields to update");
    }

    // ── Validation: offer range ──
    if (updateData.offer !== undefined) {
      const offerNum = Number(updateData.offer);
      if (isNaN(offerNum) || offerNum < 0 || offerNum > 100) {
        return sendError(res, 400, "offer must be a number between 0 and 100");
      }
      updateData.offer = offerNum;
    }

    // ── Validation: date range ──
    if (updateData.offerStart && updateData.offerEnd) {
      if (new Date(updateData.offerEnd) <= new Date(updateData.offerStart)) {
        return sendError(res, 400, "offerEnd must be after offerStart");
      }
    }

    const result = await Product.updateMany({ _id: { $in: productIds } }, { $set: updateData });

    await clearProductCache();
    logger.info(`Bulk update: ${result.modifiedCount} products updated`);

    return res.status(200).json({
      success: true,
      message: `${result.modifiedCount} products updated`,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// DELETE PRODUCT
// DELETE /api/admin/products/:productId
// ─────────────────────────────────────────────
export const deleteproduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId } = req.params as { productId: string };

    const product = await Product.findByIdAndDelete(productId);
    if (!product) return sendError(res, 404, "Product not found");

    await clearProductCache();

    logger.info(`Product deleted: ${productId}`);

    return res.status(200).json({
      success: true,
      message: "Product deleted successfully!",
    });
  } catch (err) {
    next(err);
  }
};

export const toggleVideoVisibility = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId } = req.params as { productId: string };
    const existing = await Product.findById(productId).select("videoVisible").lean();
    if (!existing) {
      return res.status(404).json({ message: "Product not found" });
    }

    const product = await Product.findOneAndUpdate(
      { _id: productId, videoVisible: existing.videoVisible },
      { $set: { videoVisible: !existing.videoVisible } },
      { new: true }
    );

    if (!product) {
      return res.status(409).json({ message: "Video visibility changed concurrently, please retry" });
    }

    await clearProductCache();

    return res.status(200).json({
      message: `Video is now ${product.videoVisible ? "visible" : "hidden"}`,
      videoVisible: product.videoVisible,
    });
  } catch (err) {
    next(err);
  }
};
