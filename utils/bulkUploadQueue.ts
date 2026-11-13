// utils/bulkUploadQueue.ts
// Product-specific bulk upload: validation, image-session resolution, and
// wiring into the shared chunked-upload engine (services/bulkUploadEngine.js).
import type { Types } from "mongoose";
import Product from "../models/Product.js";
import Subcategory from "../models/Subcategory.js";
import slugify from "./slug.js";
import client from "../config/redis.js";
import { notifyAdmin } from "./notifyAdmin.js";
import { clearProductCache } from "../services/productHelpers.js";
import { ChunkedBulkUploader, type ValidationResult } from "../services/bulkUploadEngine.js";

const IMAGE_SESSION_TTL_SECONDS = 6 * 60 * 60; // 6h — plenty for one bulk-upload session

export interface BulkProductItem {
  name?: string;
  price?: string | number;
  subcategorySlug?: string;
  description?: string;
  details?: string;
  offer?: string | number;
  offerStart?: string | null;
  offerEnd?: string | null;
  newArrival?: boolean | string;
  video?: string | null;
  videoVisible?: boolean | string;
  type?: string;
  material?: string;
  fit?: string;
  pattern?: string;
  sleeve?: string;
  collar?: string;
  colors?: { colorName?: string; images?: string[]; sizes?: { size?: string; stock?: string | number }[] }[];
}

interface ProductInsertDoc {
  name: string;
  slug: string;
  price: number;
  description: string;
  details: string;
  offer: number;
  offerStart: string | null;
  offerEnd: string | null;
  newArrival: boolean;
  colors: { colorName: string; images: string[]; sizes: { size: string; stock: number }[] }[];
  subcategory: Types.ObjectId;
  video: string | null;
  videoVisible: boolean;
  type: string;
  material: string;
  fit: string;
  pattern: string;
  sleeve: string;
  collar: string;
}

// ═══════════════════════════════════════════════
// CORE VALIDATOR — works on already-structured product objects.
// Both the CSV path and the direct JSON (table UI) path convert
// their input into this shape before calling this function, so
// there's exactly one place that decides what makes a valid product.
// ═══════════════════════════════════════════════
const validateProduct = async (product: BulkProductItem, rowNum: number): Promise<ValidationResult<ProductInsertDoc>> => {
  const name = product.name?.trim();
  const subcategorySlug = product.subcategorySlug?.trim();
  const price = Number(product.price);
  const description = product.description?.trim();
  const details = product.details?.trim();

  if (!name) return { status: "failed", row: rowNum, name: name || "Unknown", reason: "Name is required" };
  if (!subcategorySlug) return { status: "failed", row: rowNum, name, reason: "subcategorySlug is required" };
  if (!price || isNaN(price)) return { status: "failed", row: rowNum, name, reason: "Valid price is required" };
  if (!description) return { status: "failed", row: rowNum, name, reason: "Description is required" };
  if (!details) return { status: "failed", row: rowNum, name, reason: "Details is required" };

  const subcategory = await Subcategory.findOne({ slug: subcategorySlug });
  if (!subcategory) return { status: "failed", row: rowNum, name, reason: `Subcategory "${subcategorySlug}" not found` };

  const slug = slugify(name, { lower: true, strict: true });
  const existing = await Product.findOne({ slug });
  if (existing) return { status: "skipped", row: rowNum, name, reason: "Product already exists" };

  const rawColors = Array.isArray(product.colors) ? product.colors : [];
  const colors = rawColors
    .filter((c) => c && c.colorName)
    .map((c) => ({
      colorName: c.colorName as string,
      images: Array.isArray(c.images) ? c.images.filter(Boolean) : [],
      sizes: (Array.isArray(c.sizes) ? c.sizes : [])
        .filter((s) => s && s.size)
        .map((s) => ({
          size: String(s.size).toUpperCase(),
          stock: Number(s.stock) || 0,
        })),
    }));

  if (colors.length === 0) {
    return { status: "failed", row: rowNum, name, reason: "At least 1 color is required" };
  }
  const missingImages = colors.find((c) => c.images.length === 0);
  if (missingImages) {
    return {
      status: "failed",
      row: rowNum,
      name,
      reason: `Color "${missingImages.colorName}" has no images (check filenames match uploaded images)`,
    };
  }
  const missingSizes = colors.find((c) => c.sizes.length === 0);
  if (missingSizes) {
    return { status: "failed", row: rowNum, name, reason: `Color "${missingSizes.colorName}" has no sizes` };
  }

  return {
    status: "valid",
    row: rowNum,
    name,
    doc: {
      name,
      slug,
      price,
      description,
      details,
      offer: product.offer ? Number(product.offer) : 0,
      offerStart: product.offerStart || null,
      offerEnd: product.offerEnd || null,
      newArrival: product.newArrival === true || product.newArrival === "true" || product.newArrival === "1",
      colors,
      subcategory: subcategory._id,
      video: product.video || null,
      videoVisible: product.videoVisible === undefined ? true : product.videoVisible === true || product.videoVisible === "true",
      type: product.type?.trim() || "",
      material: product.material?.trim() || "",
      fit: product.fit?.trim() || "",
      pattern: product.pattern?.trim() || "",
      sleeve: product.sleeve?.trim() || "",
      collar: product.collar?.trim() || "",
    },
  };
};

// ─── Convert a raw CSV row (all strings) into the structured shape ──
export const csvRowToProduct = (row: Record<string, string>): BulkProductItem => {
  let colors: BulkProductItem["colors"] = [];
  if (row.colors) {
    try {
      colors = JSON.parse(row.colors);
    } catch {
      colors = []; // validateProduct isse "no colors" ke through fail kar dega with clear reason
    }
  }
  return {
    name: row.name,
    price: row.price,
    subcategorySlug: row.subcategorySlug,
    description: row.description,
    details: row.details,
    offer: row.offer,
    offerStart: row.offerStart,
    offerEnd: row.offerEnd,
    newArrival: row.newArrival,
    video: row.video,
    videoVisible: row.videoVisible,
    type: row.type,
    material: row.material,
    fit: row.fit,
    pattern: row.pattern,
    sleeve: row.sleeve,
    collar: row.collar,
    colors,
  };
};

// ═══════════════════════════════════════════════
// IMAGE SESSION — filename → URL resolution
//
// Jab admin "Upload Images" step use karta hai, har uploaded image ka
// { originalname → url } mapping ek sessionId ke against Redis mein
// store hota hai. Baad mein CSV/JSON submit karte waqt, agar colors.images
// mein URL ki jagah sirf filename diya gaya hai, to yahan se resolve
// ho jata hai — admin ko kabhi URL copy-paste nahi karna padta.
// ═══════════════════════════════════════════════
export const imageSessionKey = (sessionId: string) => `bulkupload:imgsession:${sessionId}`;

// Merge newly uploaded {originalname → url} pairs into an existing session map
export const saveImageSessionMappings = async (sessionId: string, uploadedImages: { originalname: string; url: string }[]) => {
  const key = imageSessionKey(sessionId);
  const existingRaw = await client.get(key).catch(() => null);
  const map: Record<string, string> = existingRaw ? JSON.parse(existingRaw) : {};
  uploadedImages.forEach((img) => {
    map[img.originalname] = img.url;
  });
  await client.set(key, JSON.stringify(map), { EX: IMAGE_SESSION_TTL_SECONDS });
  return map;
};

// Resolve any filename references in products' colors.images into real URLs
// using the stored session map. Entries that are already full URLs pass through
// unchanged. Entries that can't be resolved are dropped (validateProduct will
// then correctly report "no images" for that color, rather than storing a broken link).
export const resolveProductImages = async (products: BulkProductItem[], sessionId?: string): Promise<BulkProductItem[]> => {
  let imageMap: Record<string, string> = {};
  if (sessionId) {
    const raw = await client.get(imageSessionKey(sessionId)).catch(() => null);
    imageMap = raw ? JSON.parse(raw) : {};
  }

  // Build a normalized lookup (trimmed + lowercased key → real url)
  // so minor whitespace/case differences from manual typing/Excel
  // autocorrect don't silently break the match.
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedMap: Record<string, string> = {};
  Object.entries(imageMap).forEach(([name, url]) => {
    normalizedMap[normalize(name)] = url;
  });

  const resolveOne = (val: string | null | undefined): string | null => {
    if (typeof val !== "string" || !val) return val ?? null;
    const trimmed = val.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed; // already a full URL
    if (imageMap[trimmed]) return imageMap[trimmed]; // exact match first
    return normalizedMap[normalize(trimmed)] || null; // fallback: normalized match
  };

  return products.map((p) => ({
    ...p,
    video: resolveOne(p.video),
    colors: Array.isArray(p.colors)
      ? p.colors.map((c) => ({
          ...c,
          images: Array.isArray(c.images) ? (c.images.map(resolveOne).filter(Boolean) as string[]) : [],
        }))
      : [],
  }));
};

export const getImageSessionMappings = async (sessionId: string): Promise<Record<string, string>> => {
  const raw = await client.get(imageSessionKey(sessionId)).catch(() => null);
  return raw ? JSON.parse(raw) : {};
};

// ─── Wire into the shared chunked-upload engine ──
const uploader = new ChunkedBulkUploader<BulkProductItem, ProductInsertDoc>({
  queueName: "bulkUploadQueue",
  keyPrefix: "bulkgroup",
  model: Product,
  buildSuccessEntry: (doc) => ({ name: doc.name, slug: doc.slug }),
  validateItem: validateProduct,
  onGroupComplete: clearProductCache,
  notifyComplete: ({ groupId, summary, adminId, adminName }) =>
    notifyAdmin({
      type: "BULK_UPLOAD_COMPLETE",
      severity: summary.failed > 0 ? "medium" : "low",
      title: "Bulk product upload complete",
      message: `${adminName || "Admin"}'s upload finished: ${summary.success} added, ${summary.failed} failed, ${summary.skipped} skipped (of ${summary.total}).`,
      link: `/products`,
      data: { groupId, ...summary, adminId },
      dedupeKey: `bulk_upload_complete:${groupId}`,
    }),
  notifyChunkFailed: ({ groupId, chunkIndex, totalChunks, jobId, error }) =>
    notifyAdmin({
      type: "BULK_UPLOAD_CHUNK_FAILED",
      severity: "high",
      title: "Bulk upload: a chunk failed after all retries",
      message: `Group ${groupId}, chunk ${chunkIndex + 1}/${totalChunks} failed permanently: ${error.message}`,
      dedupeKey: `bulk_upload_chunk_failed:${jobId}`,
    }),
});

export const bulkUploadQueue = uploader.queue;
export const bulkUploadWorker = uploader.worker;
export const queueBulkUpload = uploader.queueUpload;
export const getBulkUploadGroupStatus = uploader.getGroupStatus;
