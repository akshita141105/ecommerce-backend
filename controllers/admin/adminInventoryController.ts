// controllers/admin/adminInventoryController.ts
import type { NextFunction, Request, Response } from "express";
import Product from "../../models/Product.js";
import logger from "../../utils/logger.js";
import { clearProductCache, sendError } from "../../services/productHelpers.js";
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  BULK_UPDATE_LIMIT,
  DEFAULT_PAGE_LIMIT,
  resolveInventoryMatchStage,
  queryInventory,
  emptyInventoryResult,
  buildAvailableUpdatePipeline,
  parseStockUpdateEntry,
} from "../../services/adminInventoryService.js";

// ─────────────────────────────────────────────────────────────────
// GET INVENTORY — flat list of product/color/size/stock
//
// GET /api/admin/inventory
// Query params:
//   page            — default 1
//   limit           — default 50, max 200
//   search          — product name substring (regex-escaped)
//   categorySlug    — filter by category
//   subcategorySlug — filter by subcategory (takes priority over categorySlug)
//   stockStatus     — "all" | "out" | "low" | "in"  (default "all")
//   sort            — "stock_asc" | "stock_desc" | "name"  (default "name")
//   lowStockThreshold — override default threshold (default 5)
// ─────────────────────────────────────────────────────────────────
export const getInventory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      page = "1",
      limit = String(DEFAULT_PAGE_LIMIT),
      search,
      categorySlug,
      subcategorySlug,
      stockStatus = "all",
      sort = "name",
      lowStockThreshold,
    } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || DEFAULT_PAGE_LIMIT));
    const skip = (pageNum - 1) * limitNum;
    const LOW = Number(lowStockThreshold) > 0 ? Number(lowStockThreshold) : DEFAULT_LOW_STOCK_THRESHOLD;

    const matchResult = await resolveInventoryMatchStage({ subcategorySlug, categorySlug, search });

    if (matchResult.empty) {
      return res.status(200).json({
        success: true,
        ...emptyInventoryResult(),
        page: pageNum,
        totalPages: 0,
      });
    }

    const { stats, items, total } = await queryInventory(matchResult.matchStage, {
      lowStockThreshold: LOW,
      stockStatus: stockStatus === "all" ? undefined : (stockStatus as "out" | "low" | "in" | undefined),
      sort: sort as "stock_asc" | "stock_desc" | "name",
      skip,
      limitNum,
    });

    return res.status(200).json({
      success: true,
      stats,
      items,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// UPDATE STOCK — single variant
//
// PATCH /api/admin/inventory/stock
// Body: { productId, colorId, sizeId, stock }
//
// Atomically updates stock and recalculates available:
//   available = max(0, newStock - reserved)
// Reserved stays intact — active cart holds are not disturbed.
// ─────────────────────────────────────────────────────────────────
export const updateStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let parsedEntry;
    try {
      parsedEntry = parseStockUpdateEntry(req.body);
    } catch (e) {
      return sendError(res, (e as { status?: number }).status ?? 400, (e as Error).message);
    }
    const { productOid, colorOid, sizeOid, newStock } = parsedEntry;

    // ── Atomic update via pipeline — available recalculated from reserved ──
    const updated = await Product.findOneAndUpdate(
      {
        _id: productOid,
        "colors._id": colorOid,
        "colors.sizes._id": sizeOid,
      },
      buildAvailableUpdatePipeline(colorOid, sizeOid, newStock),
      { new: true }
    );

    if (!updated) {
      return sendError(res, 404, "Product / Color / Size combination not found");
    }

    // Derive the final available that was persisted (for response)
    const colorObj = updated.colors.find((c) => c._id.equals(colorOid));
    const sizeObj = colorObj?.sizes.find((s) => s._id.equals(sizeOid));
    const newAvailable = sizeObj?.available ?? null;

    await clearProductCache();

    logger.info(`Stock updated | product: ${req.body.productId} | color: ${req.body.colorId} | ` + `size: ${req.body.sizeId} | stock: ${newStock} | available: ${newAvailable}`);

    return res.status(200).json({
      success: true,
      message: "Stock updated",
      stock: newStock,
      available: newAvailable,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────
// BULK UPDATE STOCK — multiple variants in one request
//
// PATCH /api/admin/inventory/bulk-stock
// Body: { updates: [{ productId, colorId, sizeId, stock }, ...] }
// Max 500 updates per request.
//
// Uses bulkWrite with pipeline updates so available is recalculated
// atomically per variant. One bad ID does not abort the rest.
// ─────────────────────────────────────────────────────────────────
export const bulkUpdateStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return sendError(res, 400, "updates must be a non-empty array");
    }

    if (updates.length > BULK_UPDATE_LIMIT) {
      return sendError(res, 400, `Max ${BULK_UPDATE_LIMIT} updates per request`);
    }

    // ── Validate + convert every entry up-front ──
    const parsed = [];
    for (let i = 0; i < updates.length; i++) {
      try {
        parsed.push(parseStockUpdateEntry(updates[i], `updates[${i}]`));
      } catch (e) {
        return sendError(res, (e as { status?: number }).status ?? 400, (e as Error).message);
      }
    }

    // ── Build bulkWrite ops — pipeline update per variant ──
    // Pipeline update is required because available = stock - reserved
    // needs to read "$$s.reserved" from the document itself, which
    // plain $set with arrayFilters cannot do.
    const bulkOps = parsed.map(({ productOid, colorOid, sizeOid, newStock }) => ({
      updateOne: {
        filter: {
          _id: productOid,
          "colors._id": colorOid,
          "colors.sizes._id": sizeOid,
        },
        update: buildAvailableUpdatePipeline(colorOid, sizeOid, newStock),
        // ⚠️ arrayFilters omitted — incompatible with pipeline updates
      },
    }));

    const result = await Product.bulkWrite(bulkOps, {
      ordered: false, // continue remaining ops even if one fails
    });

    const unmatched = updates.length - result.matchedCount;
    if (unmatched > 0) {
      logger.warn(`Bulk stock update: ${unmatched} variant(s) not found ` + `(bad productId/colorId/sizeId combination)`);
    }

    await clearProductCache();

    logger.info(`Bulk stock update | modified: ${result.modifiedCount} / ${updates.length}`);

    return res.status(200).json({
      success: true,
      message: `${result.modifiedCount} of ${updates.length} variants updated`,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
      unmatchedCount: unmatched,
    });
  } catch (err) {
    // bulkWrite with ordered:false throws BulkWriteError — partial results inside
    if ((err as Error).name === "BulkWriteError") {
      logger.error("BulkWriteError during bulk stock update", err);
      return res.status(207).json({
        success: false,
        message: "Partial update — some operations failed",
        modifiedCount: (err as { result?: { nModified?: number } }).result?.nModified ?? 0,
      });
    }
    next(err);
  }
};
