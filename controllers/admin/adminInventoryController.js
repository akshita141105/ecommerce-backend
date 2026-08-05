// controllers/admin/adminInventoryController.js
import mongoose from "mongoose";
import Product from "../../models/Product.js";
import Subcategory from "../../models/Subcategory.js";
import logger from "../../utils/logger.js";
import { clearProductCache, sendError } from "../../services/productHelpers.js";

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────
const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const BULK_UPDATE_LIMIT = 500;
const DEFAULT_PAGE_LIMIT = 50;

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/** Escape regex special characters to prevent injection / crash */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * toObjectId — safe conversion with early error.
 * Prevents Mongoose from silently casting bad IDs to null.
 */
const toObjectId = (id, label = "id") => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        const err = new Error(`Invalid ${label}: ${id}`);
        err.status = 400;
        throw err;
    }
    return new mongoose.Types.ObjectId(id);
};

/**
 * buildAvailableUpdatePipeline — aggregation pipeline that updates
 * stock for a specific (colorId, sizeId) variant and atomically
 * recalculates available = max(0, newStock - reserved).
 *
 * Why pipeline instead of $set + arrayFilters?
 * arrayFilters cannot reference other fields in the same document —
 * we need "$$s.reserved" to compute the new available, which only
 * works inside an aggregation pipeline stage.
 */
const buildAvailableUpdatePipeline = (colorOid, sizeOid, newStock) => [
    {
        $set: {
            colors: {
                $map: {
                    input: "$colors",
                    as: "c",
                    in: {
                        $cond: [
                            { $eq: ["$$c._id", colorOid] },
                            {
                                $mergeObjects: [
                                    "$$c",
                                    {
                                        sizes: {
                                            $map: {
                                                input: "$$c.sizes",
                                                as: "s",
                                                in: {
                                                    $cond: [
                                                        { $eq: ["$$s._id", sizeOid] },
                                                        {
                                                            $mergeObjects: [
                                                                "$$s",
                                                                {
                                                                    stock: newStock,
                                                                    // Invariant: available = stock - reserved
                                                                    // $max[0,...] prevents negative available
                                                                    available: {
                                                                        $max: [
                                                                            0,
                                                                            { $subtract: [newStock, "$$s.reserved"] },
                                                                        ],
                                                                    },
                                                                    // reserved is intentionally NOT changed —
                                                                    // active cart holds stay intact
                                                                },
                                                            ],
                                                        },
                                                        "$$s", // other sizes untouched
                                                    ],
                                                },
                                            },
                                        },
                                    },
                                ],
                            },
                            "$$c", // other colors untouched
                        ],
                    },
                },
            },
        },
    },
];

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
export const getInventory = async (req, res, next) => {
    try {
        const {
            page = 1,
            limit = DEFAULT_PAGE_LIMIT,
            search,
            categorySlug,
            subcategorySlug,
            stockStatus = "all",
            sort = "name",
            lowStockThreshold,
        } = req.query;

        // ── Input sanitisation ──
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || DEFAULT_PAGE_LIMIT));
        const skip = (pageNum - 1) * limitNum;

        const LOW = Number(lowStockThreshold) > 0
            ? Number(lowStockThreshold)
            : DEFAULT_LOW_STOCK_THRESHOLD;

        // ── Category / subcategory pre-filter ──
        const matchStage = {};

        if (subcategorySlug) {
            const sub = await Subcategory.findOne({ slug: subcategorySlug }).lean();

            // Unknown slug → return empty result immediately (don't set null)
            if (!sub) {
                return res.status(200).json({
                    success: true,
                    stats: {
                        totalVariants: 0, outOfStock: 0,
                        lowStock: 0, inStock: 0, totalStockUnits: 0,
                    },
                    items: [], total: 0, page: pageNum, totalPages: 0,
                });
            }

            matchStage.subcategory = sub._id;

        } else if (categorySlug) {
            // Populate category on subcategory to match by slug
            const subs = await Subcategory.find({})
                .populate("category", "slug")
                .lean();

            const matchedIds = subs
                .filter((s) => s.category?.slug === categorySlug)
                .map((s) => s._id);

            // No subcategories under this category → empty result
            if (!matchedIds.length) {
                return res.status(200).json({
                    success: true,
                    stats: {
                        totalVariants: 0, outOfStock: 0,
                        lowStock: 0, inStock: 0, totalStockUnits: 0,
                    },
                    items: [], total: 0, page: pageNum, totalPages: 0,
                });
            }

            matchStage.subcategory = { $in: matchedIds };
        }

        if (search?.trim()) {
            const searchRegex = { $regex: escapeRegex(search.trim()), $options: "i" };

            const matchedSubs = await Subcategory.find({ name: searchRegex }).lean();

            if (matchedSubs.length > 0) {
                // Subcategory naam match hua (e.g. "Shirts")
                const subIds = matchedSubs.map(s => s._id);
                matchStage.subcategory = { $in: subIds };

            } else {
                // Category naam se match try karo (e.g. "Men", "Women")
                const subsUnderCategory = await Subcategory.find({})
                    .populate("category", "name slug")
                    .lean();

                const categoryMatchedSubIds = subsUnderCategory
                    .filter(s => s.category?.name?.match(
                        new RegExp(escapeRegex(search.trim()), "i")
                    ))
                    .map(s => s._id);

                if (categoryMatchedSubIds.length > 0) {
                    // Category naam match hua (e.g. "Men")
                    matchStage.subcategory = { $in: categoryMatchedSubIds };
                } else {
                    // Kuch match nahi → product naam search
                    matchStage.name = searchRegex;
                }
            }
        }

        // ── Base pipeline — unwind to variant (product × color × size) level ──
        const basePipeline = [
            { $match: matchStage },
            { $unwind: "$colors" },
            { $unwind: "$colors.sizes" },
            {
                $lookup: {
                    from: "subcategories",
                    localField: "subcategory",
                    foreignField: "_id",
                    as: "subcategoryInfo",
                },
            },
            {
                $unwind: {
                    path: "$subcategoryInfo",
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $project: {
                    _id: 0,
                    productId: "$_id",
                    productName: "$name",
                    productSlug: "$slug",
                    price: "$price",
                    colorId: "$colors._id",
                    colorName: "$colors.colorName",
                    image: { $arrayElemAt: ["$colors.images", 0] },
                    sizeId: "$colors.sizes._id",
                    size: "$colors.sizes.size",
                    stock: "$colors.sizes.stock",
                    reserved: "$colors.sizes.reserved",   // useful for admin visibility
                    available: "$colors.sizes.available",  // useful for admin visibility
                    subcategoryName: "$subcategoryInfo.name",
                    subcategorySlug: "$subcategoryInfo.slug",
                },
            },
        ];

        // ── Stock-status filter (applied to data pipeline, NOT stats) ──
        const stockFilterMap = {
            out: { stock: { $eq: 0 } },
            low: { stock: { $gt: 0, $lte: LOW } },
            in: { stock: { $gt: LOW } },
        };
        const stockFilter = stockFilterMap[stockStatus] ?? null;

        // ── Sort stage ──
        const sortMap = {
            stock_asc: { stock: 1, productName: 1 },
            stock_desc: { stock: -1, productName: 1 },
            name: { productName: 1, colorName: 1, size: 1 },
        };
        const sortStage = sortMap[sort] ?? sortMap.name;

        // ── Stats pipeline — full result set (ignores stockStatus filter) ──
        const statsPipeline = [
            ...basePipeline,
            {
                $group: {
                    _id: null,
                    totalVariants: { $sum: 1 },
                    outOfStock: { $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] } },
                    lowStock: {
                        $sum: {
                            $cond: [
                                { $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", LOW] }] },
                                1, 0,
                            ],
                        },
                    },
                    inStock: {
                        $sum: { $cond: [{ $gt: ["$stock", LOW] }, 1, 0] },
                    },
                    totalStockUnits: { $sum: "$stock" },
                    totalReservedUnits: { $sum: "$reserved" },
                },
            },
        ];

        // ── Data pipeline — filtered + sorted + paginated ──
        const dataPipeline = [
            ...basePipeline,
            ...(stockFilter ? [{ $match: stockFilter }] : []),
            { $sort: sortStage },
            {
                $facet: {
                    items: [{ $skip: skip }, { $limit: limitNum }],
                    totalCount: [{ $count: "count" }],
                },
            },
        ];

        // ── Run both pipelines in parallel ──
        const [statsResult, dataResult] = await Promise.all([
            Product.aggregate(statsPipeline),
            Product.aggregate(dataPipeline),
        ]);

        const rawStats = statsResult[0] ?? {};
        const stats = {
            totalVariants: rawStats.totalVariants ?? 0,
            outOfStock: rawStats.outOfStock ?? 0,
            lowStock: rawStats.lowStock ?? 0,
            inStock: rawStats.inStock ?? 0,
            totalStockUnits: rawStats.totalStockUnits ?? 0,
            totalReservedUnits: rawStats.totalReservedUnits ?? 0,
        };

        const items = dataResult[0]?.items ?? [];
        const total = dataResult[0]?.totalCount[0]?.count ?? 0;

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
export const updateStock = async (req, res, next) => {
    try {
        const { productId, colorId, sizeId, stock } = req.body;

        // ── Validate required fields ──
        if (!productId || !colorId || !sizeId || stock === undefined) {
            return sendError(res, 400, "productId, colorId, sizeId, and stock are required");
        }

        const newStock = Math.floor(Number(stock));
        if (isNaN(newStock) || newStock < 0) {
            return sendError(res, 400, "stock must be a non-negative integer");
        }

        // ── Safe ObjectId conversion ──
        let productOid, colorOid, sizeOid;
        try {
            productOid = toObjectId(productId, "productId");
            colorOid = toObjectId(colorId, "colorId");
            sizeOid = toObjectId(sizeId, "sizeId");
        } catch (e) {
            return sendError(res, 400, e.message);
        }

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

        logger.info(
            `Stock updated | product: ${productId} | color: ${colorId} | ` +
            `size: ${sizeId} | stock: ${newStock} | available: ${newAvailable}`
        );

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
export const bulkUpdateStock = async (req, res, next) => {
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
            const u = updates[i];

            if (!u.productId || !u.colorId || !u.sizeId || u.stock === undefined) {
                return sendError(
                    res, 400,
                    `updates[${i}]: productId, colorId, sizeId, and stock are required`
                );
            }

            const newStock = Math.floor(Number(u.stock));
            if (isNaN(newStock) || newStock < 0) {
                return sendError(
                    res, 400,
                    `updates[${i}]: stock must be a non-negative integer`
                );
            }

            try {
                parsed.push({
                    productOid: toObjectId(u.productId, `updates[${i}].productId`),
                    colorOid: toObjectId(u.colorId, `updates[${i}].colorId`),
                    sizeOid: toObjectId(u.sizeId, `updates[${i}].sizeId`),
                    newStock,
                });
            } catch (e) {
                return sendError(res, 400, e.message);
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
            logger.warn(
                `Bulk stock update: ${unmatched} variant(s) not found ` +
                `(bad productId/colorId/sizeId combination)`
            );
        }

        await clearProductCache();

        logger.info(
            `Bulk stock update | modified: ${result.modifiedCount} / ${updates.length}`
        );

        return res.status(200).json({
            success: true,
            message: `${result.modifiedCount} of ${updates.length} variants updated`,
            modifiedCount: result.modifiedCount,
            matchedCount: result.matchedCount,
            unmatchedCount: unmatched,
        });

    } catch (err) {
        // bulkWrite with ordered:false throws BulkWriteError — partial results inside
        if (err.name === "BulkWriteError") {
            logger.error("BulkWriteError during bulk stock update", err);
            return res.status(207).json({
                success: false,
                message: "Partial update — some operations failed",
                modifiedCount: err.result?.nModified ?? 0,
            });
        }
        next(err);
    }
};