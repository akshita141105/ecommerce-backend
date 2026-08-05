// controllers/admin/adminProductController.js
import slugify from "slugify";
import Product from "../../models/Product.js";
import Subcategory from "../../models/Subcategory.js";
import logger from "../../utils/logger.js";
import { clearProductCache, sendError, safeParse, parseColors, buildProductFilter } from "../../services/productHelpers.js";


// ─────────────────────────────────────────────
// GET ALL PRODUCTS — ADMIN PANEL
// GET /api/admin/products?page=1&limit=10&search=&subcategorySlug=&categorySlug=
// ─────────────────────────────────────────────
export const getAdminProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search, subcategorySlug, categorySlug, hasOffer } = req.query;
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
      success: true, products, total, totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    next(err);
  }
};


// ─────────────────────────────────────────────
// GET PRODUCT IDs MATCHING FILTER — for "Select All"
// GET /api/admin/products/ids?categorySlug=&subcategorySlug=&search=
// ─────────────────────────────────────────────
export const getAdminProductIds = async (req, res, next) => {
  try {
    const { search, subcategorySlug, categorySlug, hasOffer } = req.query;
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
export const getAdminProductById = async (req, res, next) => {
  try {
    const { productId } = req.params;

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
export const createProduct = async (req, res, next) => {
  try {
    const {
      name,
      subcategoryslug,
      price,
      description,
      details,
      offer,
      offerStart,
      offerEnd,
      newArrival,
      colors: colorsData,
      type,
      material,
      fit,
      pattern,
      sleeve,
      collar,
      videoVisible,
    } = req.body;

    // ── Required field checks ──
    if (!name)            return sendError(res, 400, "name is required");
    if (!subcategoryslug) return sendError(res, 400, "subcategory is required");
    if (!price)           return sendError(res, 400, "price is required");
    if (!description)     return sendError(res, 400, "description is required");
    if (!details)         return sendError(res, 400, "details is required");
    if (!colorsData)      return sendError(res, 400, "colors are required");

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

    const hasInvalidColor = colors.some(
      (c) => !c.colorName || !c.images.length || !c.sizes.length
    );
    if (hasInvalidColor) {
      return sendError(
        res, 400,
        "Each color must have a colorName, at least 1 image, and at least 1 size"
      );
    }

    // ── Video ──
    const videoUrl = req.files?.video?.[0]?.path || null;

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
      videoVisible: videoVisible === undefined
        ? true
        : (videoVisible === "true" || videoVisible === true),
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
export const updateproduct = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const data = safeParse(req.body?.data) || {};

    const product = await Product.findById(productId);
    if (!product) return sendError(res, 404, "Product not found");

    // ── 1. Basic scalar fields ──
    const scalarFields = [
      "price", "details", "description",
      "offer", "offerStart", "offerEnd", "newArrival",
      "type", "material", "fit", "pattern", "sleeve", "collar", "videoVisible",
    ];
    scalarFields.forEach((k) => {
      if (data[k] !== undefined) product[k] = data[k];
    });

    // ── Name + slug ──
    if (data.name) {
      const newSlug = slugify(data.name, { lower: true, strict: true });
      const conflict = await Product.findOne({ slug: newSlug, _id: { $ne: productId } });
      if (conflict) return sendError(res, 400, "Product name already exists");
      product.name = data.name;
      product.slug = newSlug;
    }

    // ← YAHAN ADD KARO (name block ke bilkul neeche)
    if (data.subcategorySlug) {
      const sub = await Subcategory.findOne({ slug: data.subcategorySlug }).lean();
      if (!sub) return sendError(res, 400, "Invalid subcategory");
      product.subcategory = sub._id;
    }

    // ── 2. Video ──
    const videoFile = Array.isArray(req.files?.video) ? req.files.video[0] : null;
    if (videoFile) product.video = videoFile.path;

    // ── 3. Update color name/images ──
    if (data.updateColor) {
      const { colorId, colorName, images } = data.updateColor;
      const color = product.colors.id(colorId);
      if (!color) return sendError(res, 404, "Color not found");
      if (colorName) color.colorName = colorName;
      if (Array.isArray(images) && images.length) color.images = images;
    }

    // ── 4. Add images to existing color ──
    if (data.addImagesToColor) {
      const { colorId } = data.addImagesToColor;
      const color = product.colors.id(colorId);
      if (!color) return sendError(res, 404, "Color not found");
      const newImages = (Array.isArray(req.files) ? req.files : [])
        .filter((f) => f.fieldname === "newImages")
        .map((f) => f.path);
      if (newImages.length) color.images.push(...newImages);
    }

    // ── 5. Remove image from color ──
    if (data.removeImageFromColor) {
      const { colorId, imageUrl } = data.removeImageFromColor;
      const color = product.colors.id(colorId);
      if (!color) return sendError(res, 404, "Color not found");
      color.images = color.images.filter((img) => img !== imageUrl);
      if (!color.images.length) {
        return sendError(res, 400, "Cannot remove last image from a color");
      }
    }

    // ── 6. Add new color(s) ──
    if (data.addColor) {
      const newColors = Array.isArray(data.addColor) ? data.addColor : [data.addColor];

      const newImageFiles = (Array.isArray(req.files) ? req.files : [])
        .filter(f => f.fieldname === "newImages")
        .map(f => f.path);

      newColors.forEach((c) => {
        product.colors.push({
          colorName: c.colorName,
          images: newImageFiles,
          sizes: (c.sizes || []).map((s) => ({
            size: String(s.size).toUpperCase().trim(),
            stock: Math.max(0, Number(s.stock) || 0),
            reserved: 0,
          })),
        });
      });
    }

    // ── 7. Remove color ──
    if (data.removeColor) {
      const { colorId } = data.removeColor;
      if (product.colors.length === 1) {
        return sendError(res, 400, "Cannot remove the only color of a product");
      }
      product.colors = product.colors.filter(
        (c) => c._id.toString() !== colorId
      );
    }

    // ── 8. Update size inside color ──
    if (data.updateSize) {
      const { colorId, sizeId, size, stock } = data.updateSize;
      const color = product.colors.id(colorId);
      if (!color) return sendError(res, 404, "Color not found");
      const sizeDoc = color.sizes.id(sizeId);
      if (!sizeDoc) return sendError(res, 404, "Size not found");
      if (size !== undefined) sizeDoc.size = String(size).toUpperCase().trim();
      if (stock !== undefined) sizeDoc.stock = Math.max(0, Number(stock));
    }

    // ── 9. Add size(s) to color ──
    if (data.addSize) {
      const { colorId, sizes } = data.addSize;
      const color = product.colors.id(colorId);
      if (!color) return sendError(res, 404, "Color not found");
      if (!Array.isArray(sizes) || !sizes.length) {
        return sendError(res, 400, "sizes array is required for addSize");
      }
      sizes.forEach((s) => {
        color.sizes.push({
          size: String(s.size).toUpperCase().trim(),
          stock: Math.max(0, Number(s.stock) || 0),
          reserved: 0, // ← bas yeh ek line add karo
        });
      });
    }

    // ── 10. Remove size from color ──
    if (data.removeSize) {
      const { colorId, sizeId } = data.removeSize;
      const color = product.colors.id(colorId);
      if (!color) return sendError(res, 404, "Color not found");
      if (color.sizes.length === 1) {
        return sendError(res, 400, "Cannot remove the only size of a color");
      }
      color.sizes = color.sizes.filter((s) => s._id.toString() !== sizeId);
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
export const bulkUpdateProducts = async (req, res, next) => {
  try {
    const { productIds, data } = req.body;

    if (!Array.isArray(productIds) || !productIds.length) {
      return sendError(res, 400, "productIds array is required");
    }
    if (!data || typeof data !== "object") {
      return sendError(res, 400, "data object is required");
    }

    const allowedFields = ["newArrival", "offer", "offerStart", "offerEnd"];
    const updateData = {};
    allowedFields.forEach((k) => {
      if (data[k] !== undefined) updateData[k] = data[k];
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

    const result = await Product.updateMany(
      { _id: { $in: productIds } },
      { $set: updateData }
    );

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
export const deleteproduct = async (req, res, next) => {
  try {
    const { productId } = req.params;

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

// export const getAdminProductIds = async (req, res, next) => {
//   try {
//     const { search, subcategorySlug, categorySlug } = req.query;
//     const filter = await buildProductFilter({ search, subcategorySlug, categorySlug });
//     const ids = await Product.find(filter).distinct("_id");
//     return res.status(200).json({ success: true, ids });
//   } catch (err) {
//     next(err);
//   }
// };

// controllers/admin/productController.js
export const toggleVideoVisibility = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    product.videoVisible = !product.videoVisible;
    await product.save();

    await clearProductCache(); 

    return res.status(200).json({
      message: `Video is now ${product.videoVisible ? "visible" : "hidden"}`,
      videoVisible: product.videoVisible,
    });
  } catch (err) {
    next(err);
  }
};

