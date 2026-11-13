// services/adminInventoryService.ts
// Business logic behind admin inventory listing/reporting and stock
// updates — kept out of controllers/admin/adminInventoryController.js so
// the controller only handles request parsing and response shaping.
import mongoose, { type PipelineStage, type Types } from "mongoose";
import Product from "../models/Product.js";
import Subcategory from "../models/Subcategory.js";

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const BULK_UPDATE_LIMIT = 500;
export const DEFAULT_PAGE_LIMIT = 50;

interface HttpError extends Error {
  status?: number;
}

/** Escape regex special characters to prevent injection / crash */
const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * toObjectId — safe conversion with early error.
 * Prevents Mongoose from silently casting bad IDs to null.
 */
export const toObjectId = (id: unknown, label = "id"): Types.ObjectId => {
  if (!mongoose.Types.ObjectId.isValid(id as string)) {
    const err: HttpError = new Error(`Invalid ${label}: ${id}`);
    err.status = 400;
    throw err;
  }
  return new mongoose.Types.ObjectId(id as string);
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
export const buildAvailableUpdatePipeline = (colorOid: Types.ObjectId, sizeOid: Types.ObjectId, newStock: number): PipelineStage[] => [
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
                                    $max: [0, { $subtract: [newStock, "$$s.reserved"] }],
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

interface ResolveMatchStageParams {
  subcategorySlug?: string;
  categorySlug?: string;
  search?: string;
}

type MatchStage = Record<string, unknown>;
type MatchStageResult = { empty: true } | { empty: false; matchStage: MatchStage };

/**
 * Resolve categorySlug / subcategorySlug / free-text search query params
 * into a Mongo match stage for the Product collection. Returns
 * `{ empty: true }` when the filter can never match anything (e.g. an
 * unknown slug), so the caller can short-circuit without running the
 * aggregation at all.
 */
export const resolveInventoryMatchStage = async ({ subcategorySlug, categorySlug, search }: ResolveMatchStageParams): Promise<MatchStageResult> => {
  const matchStage: MatchStage = {};

  if (subcategorySlug) {
    const sub = await Subcategory.findOne({ slug: subcategorySlug }).lean();
    if (!sub) return { empty: true };
    matchStage.subcategory = sub._id;
  } else if (categorySlug) {
    const subs = await Subcategory.find({}).populate<{ category: { slug: string } | null }>("category", "slug").lean();
    const matchedIds = subs.filter((s) => s.category?.slug === categorySlug).map((s) => s._id);
    if (!matchedIds.length) return { empty: true };
    matchStage.subcategory = { $in: matchedIds };
  }

  if (search?.trim()) {
    const searchRegex = { $regex: escapeRegex(search.trim()), $options: "i" };
    const matchedSubs = await Subcategory.find({ name: searchRegex }).lean();

    if (matchedSubs.length > 0) {
      // Subcategory naam match hua (e.g. "Shirts")
      matchStage.subcategory = { $in: matchedSubs.map((s) => s._id) };
    } else {
      // Category naam se match try karo (e.g. "Men", "Women")
      const subsUnderCategory = await Subcategory.find({}).populate<{ category: { name: string; slug: string } | null }>("category", "name slug").lean();
      const categoryMatchedSubIds = subsUnderCategory
        .filter((s) => s.category?.name?.match(new RegExp(escapeRegex(search.trim()), "i")))
        .map((s) => s._id);

      if (categoryMatchedSubIds.length > 0) {
        // Category naam match hua (e.g. "Men")
        matchStage.subcategory = { $in: categoryMatchedSubIds };
      } else {
        // Kuch match nahi → product naam search
        matchStage.name = searchRegex;
      }
    }
  }

  return { empty: false, matchStage };
};

export const emptyInventoryResult = () => ({
  stats: { totalVariants: 0, outOfStock: 0, lowStock: 0, inStock: 0, totalStockUnits: 0, totalReservedUnits: 0 },
  items: [] as unknown[],
  total: 0,
});

interface QueryInventoryOptions {
  lowStockThreshold: number;
  stockStatus?: "out" | "low" | "in";
  sort?: "stock_asc" | "stock_desc" | "name";
  skip: number;
  limitNum: number;
}

/**
 * Run the paginated inventory listing + stats aggregation for a resolved
 * match stage. Mirrors the shape the admin inventory table needs.
 */
export const queryInventory = async (matchStage: MatchStage, { lowStockThreshold, stockStatus, sort, skip, limitNum }: QueryInventoryOptions) => {
  const LOW = lowStockThreshold;

  // ── Base pipeline — unwind to variant (product × color × size) level ──
  const basePipeline: PipelineStage[] = [
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
    { $unwind: { path: "$subcategoryInfo", preserveNullAndEmptyArrays: true } },
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
        reserved: "$colors.sizes.reserved", // useful for admin visibility
        available: "$colors.sizes.available", // useful for admin visibility
        subcategoryName: "$subcategoryInfo.name",
        subcategorySlug: "$subcategoryInfo.slug",
      },
    },
  ];

  // ── Stock-status filter (applied to data pipeline, NOT stats) ──
  const stockFilterMap: Record<string, Record<string, unknown>> = {
    out: { stock: { $eq: 0 } },
    low: { stock: { $gt: 0, $lte: LOW } },
    in: { stock: { $gt: LOW } },
  };
  const stockFilter = stockStatus ? (stockFilterMap[stockStatus] ?? null) : null;

  // ── Sort stage ──
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    stock_asc: { stock: 1, productName: 1 },
    stock_desc: { stock: -1, productName: 1 },
    name: { productName: 1, colorName: 1, size: 1 },
  };
  const sortStage = (sort && sortMap[sort]) ?? sortMap.name;

  // ── Stats pipeline — full result set (ignores stockStatus filter) ──
  const statsPipeline: PipelineStage[] = [
    ...basePipeline,
    {
      $group: {
        _id: null,
        totalVariants: { $sum: 1 },
        outOfStock: { $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] } },
        lowStock: {
          $sum: {
            $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", LOW] }] }, 1, 0],
          },
        },
        inStock: { $sum: { $cond: [{ $gt: ["$stock", LOW] }, 1, 0] } },
        totalStockUnits: { $sum: "$stock" },
        totalReservedUnits: { $sum: "$reserved" },
      },
    },
  ];

  // ── Data pipeline — filtered + sorted + paginated ──
  const dataPipeline: PipelineStage[] = [
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
  const [statsResult, dataResult] = await Promise.all([Product.aggregate(statsPipeline), Product.aggregate(dataPipeline)]);

  const rawStats = statsResult[0] ?? {};
  const stats = {
    totalVariants: rawStats.totalVariants ?? 0,
    outOfStock: rawStats.outOfStock ?? 0,
    lowStock: rawStats.lowStock ?? 0,
    inStock: rawStats.inStock ?? 0,
    totalStockUnits: rawStats.totalStockUnits ?? 0,
    totalReservedUnits: rawStats.totalReservedUnits ?? 0,
  };

  return {
    stats,
    items: dataResult[0]?.items ?? [],
    total: dataResult[0]?.totalCount[0]?.count ?? 0,
  };
};

interface RawStockUpdateEntry {
  productId?: string;
  colorId?: string;
  sizeId?: string;
  stock?: number | string;
}

/**
 * Validate + convert one bulk/single stock-update entry. `indexLabel`
 * (e.g. "updates[0]") is prefixed onto error messages when validating as
 * part of a bulk request; omit it for a single-entry update.
 */
export const parseStockUpdateEntry = (u: RawStockUpdateEntry, indexLabel = "") => {
  const prefix = indexLabel ? `${indexLabel}: ` : "";
  const dotPrefix = indexLabel ? `${indexLabel}.` : "";

  if (!u.productId || !u.colorId || !u.sizeId || u.stock === undefined) {
    const err: HttpError = new Error(`${prefix}productId, colorId, sizeId, and stock are required`);
    err.status = 400;
    throw err;
  }

  const newStock = Math.floor(Number(u.stock));
  if (isNaN(newStock) || newStock < 0) {
    const err: HttpError = new Error(`${prefix}stock must be a non-negative integer`);
    err.status = 400;
    throw err;
  }

  return {
    productOid: toObjectId(u.productId, `${dotPrefix}productId`),
    colorOid: toObjectId(u.colorId, `${dotPrefix}colorId`),
    sizeOid: toObjectId(u.sizeId, `${dotPrefix}sizeId`),
    newStock,
  };
};
