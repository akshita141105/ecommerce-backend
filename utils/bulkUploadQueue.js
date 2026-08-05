import { Queue, Worker } from "bullmq";
import crypto from "crypto";
import Product from "../models/Product.js";
import Subcategory from "../models/Subcategory.js";
import slugify from "slugify";
import logger from "./logger.js";
import client from "../lib/redis.js";
import { notifyAdmin } from "./notifyAdmin.js";
import { clearProductCache } from "../services/productHelpers.js";

const connection = {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
};

const CHUNK_SIZE = 25;
const GROUP_TTL_SECONDS = 24 * 60 * 60; // 24 ghante ke baad redis se auto-clean
const IMAGE_SESSION_TTL_SECONDS = 6 * 60 * 60; // 6 ghante — ek bulk-upload session ke liye kaafi hai

// ─── Queue ────────────────────────────────────
export const bulkUploadQueue = new Queue("bulkUploadQueue", {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential", // 2s, 4s, 8s
            delay: 2000,
        },
        removeOnComplete: 200,
        removeOnFail: 200,
    },
});

// ═══════════════════════════════════════════════
// CORE VALIDATOR — works on already-structured product objects.
// Both the CSV path and the direct JSON (table UI) path convert
// their input into this shape before calling this function, so
// there's exactly one place that decides what makes a valid product.
// ═══════════════════════════════════════════════
const validateProduct = async (product, rowNum) => {
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
            colorName: c.colorName,
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
            videoVisible: product.videoVisible === undefined
                ? true
                : (product.videoVisible === true || product.videoVisible === "true"),
            // ← naye fields
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
export const csvRowToProduct = (row) => {
    let colors = [];
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
export const imageSessionKey = (sessionId) => `bulkupload:imgsession:${sessionId}`;

// Merge newly uploaded {originalname → url} pairs into an existing session map
export const saveImageSessionMappings = async (sessionId, uploadedImages) => {
    const key = imageSessionKey(sessionId);
    const existingRaw = await client.get(key).catch(() => null);
    const map = existingRaw ? JSON.parse(existingRaw) : {};
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
export const resolveProductImages = async (products, sessionId) => {
    let imageMap = {};
    if (sessionId) {
        const raw = await client.get(imageSessionKey(sessionId)).catch(() => null);
        imageMap = raw ? JSON.parse(raw) : {};
    }

    // Build a normalized lookup (trimmed + lowercased key → real url)
    // so minor whitespace/case differences from manual typing/Excel
    // autocorrect don't silently break the match.
    const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const normalizedMap = {};
    Object.entries(imageMap).forEach(([name, url]) => {
        normalizedMap[normalize(name)] = url;
    });

    const resolveOne = (val) => {
        if (typeof val !== "string" || !val) return val;
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
                images: Array.isArray(c.images) ? c.images.map(resolveOne).filter(Boolean) : [],
            }))
            : [],
    }));
};

// const clearProductCache = async () => {
//     const keys = ["product:newArrivals", "product:lookbook", "product:videos", "admin:products"];
//     await Promise.all(keys.map((k) => client.del(k)));
// };

const chunkArray = (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
};

// ═══════════════════════════════════════════════
// FIX #1 — insertMany partial-failure handling
//
// With { ordered: false }, MongoDB inserts every doc it can and only
// fails the ones that actually error (e.g. duplicate key race). Mongoose
// surfaces this via `err.insertedDocs` (docs that succeeded) and
// `err.writeErrors` (docs that failed, with their index). Previously
// this code treated ANY error as "the whole chunk failed", which
// silently mislabeled successfully-inserted products as failed.
// ═══════════════════════════════════════════════
const insertValidDocs = async (validDocs, results) => {
    if (validDocs.length === 0) return;

    try {
        const inserted = await Product.insertMany(
            validDocs.map((v) => v.doc),
            { ordered: false }
        );
        inserted.forEach((doc, i) => {
            results.success.push({ row: validDocs[i].row, name: doc.name, slug: doc.slug });
        });
    } catch (err) {
        // Docs that DID succeed despite the error (Mongoose-specific property)
        const insertedDocs = err.insertedDocs || [];
        const insertedSlugs = new Set(insertedDocs.map((d) => d.slug));

        // Docs that explicitly failed, keyed by their index in the insertMany array
        const writeErrors = err.writeErrors || [];
        const failedIndexReasons = new Map();
        writeErrors.forEach((we) => {
            const idx = typeof we.index === "number" ? we.index : we.err?.index;
            const reason = we.errmsg || we.err?.errmsg || we.message || "Insert failed";
            if (typeof idx === "number") failedIndexReasons.set(idx, reason);
        });

        validDocs.forEach((v, i) => {
            if (insertedSlugs.has(v.doc.slug)) {
                results.success.push({ row: v.row, name: v.doc.name, slug: v.doc.slug });
            } else if (failedIndexReasons.has(i)) {
                results.failed.push({ row: v.row, name: v.name, reason: failedIndexReasons.get(i) });
            } else {
                // Unknown outcome — surface it rather than silently dropping the row
                results.failed.push({ row: v.row, name: v.name, reason: err.message || "Insert failed (unknown reason)" });
            }
        });

        logger.error(`insertMany partial failure: ${insertedDocs.length} succeeded, ${writeErrors.length} failed — ${err.message}`);
    }
};

// ─── Process one chunk (called inside worker) ──
const processChunk = async (chunkItems) => {
    const results = { success: [], failed: [], skipped: [] };

    const validations = await Promise.all(
        chunkItems.map(({ product, rowNum }) =>
            retryAsync(() => validateProduct(product, rowNum), 3, 400).catch((err) => ({
                status: "failed",
                row: rowNum,
                name: product.name || "Unknown",
                reason: `${err.message} (failed after 3 attempts)`,
            }))
        )
    );

    const validDocs = validations.filter((v) => v.status === "valid");
    await insertValidDocs(validDocs, results);

    validations
        .filter((v) => v.status !== "valid")
        .forEach((v) => {
            if (v.__attemptsUsed) {
                v.reason = `${v.reason} (recovered after ${v.__attemptsUsed} attempts)`;
            }
            results[v.status].push(v);
        });

    return results;
};

// ─── Redis key helpers ─────────────────────────
const metaKey = (groupId) => `bulkgroup:${groupId}:meta`;
const completedKey = (groupId) => `bulkgroup:${groupId}:completed`;
const chunkResultKey = (groupId, chunkIndex) => `bulkgroup:${groupId}:chunk:${chunkIndex}`;
const summaryKey = (groupId) => `bulkgroup:${groupId}:summary`;

// ═══════════════════════════════════════════════
// FIX #2 — stuck-status handling
//
// Previously, if a chunk job failed all 3 retries, the "completed"
// counter was NEVER incremented for that chunk — so the group could
// never reach totalChunks, and the frontend would poll "processing"
// forever with no error surfaced. Now BOTH the success path and the
// permanent-failure path go through the same finalize logic, so the
// group always reaches "completed" and failed rows are recorded with
// a clear reason.
// ═══════════════════════════════════════════════
const finalizeGroup = async (groupId, totalChunks, adminId, adminName) => {
    const allResults = { success: [], failed: [], skipped: [] };

    for (let i = 0; i < totalChunks; i++) {
        const raw = await client.get(chunkResultKey(groupId, i));
        if (raw) {
            const r = JSON.parse(raw);
            allResults.success.push(...r.success);
            allResults.failed.push(...r.failed);
            allResults.skipped.push(...r.skipped);
        }
    }

    const summary = {
        total: allResults.success.length + allResults.failed.length + allResults.skipped.length,
        success: allResults.success.length,
        failed: allResults.failed.length,
        skipped: allResults.skipped.length,
    };

    await client.set(
        summaryKey(groupId),
        JSON.stringify({ summary, results: allResults }),
        { EX: GROUP_TTL_SECONDS }
    );

    await clearProductCache();

    logger.info(
        `Bulk upload group ${groupId} fully complete: ${summary.success} success, ${summary.failed} failed, ${summary.skipped} skipped`
    );

    await notifyAdmin({
        type: "BULK_UPLOAD_COMPLETE",
        severity: summary.failed > 0 ? "medium" : "low",
        title: "Bulk product upload complete",
        message: `${adminName || "Admin"}'s upload finished: ${summary.success} added, ${summary.failed} failed, ${summary.skipped} skipped (of ${summary.total}).`,
        link: `/products`,
        data: { groupId, ...summary, adminId },
        dedupeKey: `bulk_upload_complete:${groupId}`,
    }).catch((err) => logger.error("notifyAdmin (bulk upload complete) failed:", err));
};

const finalizeChunk = async (groupId, chunkIndex, totalChunks, chunkResult, adminId, adminName) => {
    await client.set(
        chunkResultKey(groupId, chunkIndex),
        JSON.stringify(chunkResult),
        { EX: GROUP_TTL_SECONDS }
    );

    const completedCount = await client.incr(completedKey(groupId));
    await client.expire(completedKey(groupId), GROUP_TTL_SECONDS);

    if (completedCount === totalChunks) {
        await finalizeGroup(groupId, totalChunks, adminId, adminName);
    }
};

// ─── Worker — ek call = ek chunk ────────────────
export const bulkUploadWorker = new Worker(
    "bulkUploadQueue",
    async (job) => {
        const { groupId, chunkIndex, totalChunks, chunkItems, adminId, adminName } = job.data;

        const chunkResult = await processChunk(chunkItems);

        logger.info(`Bulk upload chunk ${chunkIndex + 1}/${totalChunks} done for group ${groupId}`);

        await finalizeChunk(groupId, chunkIndex, totalChunks, chunkResult, adminId, adminName);

        return chunkResult;
    },
    {
        connection,
        concurrency: 3,
    }
);

// ─── Worker events ────────────────────────────
bulkUploadWorker.on("completed", (job) => {
    logger.info(`Chunk job completed: ${job.id} (group ${job.data.groupId}, chunk ${job.data.chunkIndex + 1}/${job.data.totalChunks})`);
});

// A chunk lands here only after ALL retry attempts (default 3) are exhausted.
// We must still finalize it — otherwise the group's completed-counter never
// reaches totalChunks and the frontend polls "processing" forever.
bulkUploadWorker.on("failed", async (job, err) => {
    try {
        if (!job) return;
        const { groupId, chunkIndex, totalChunks, chunkItems, adminId, adminName } = job.data || {};
        if (!groupId) return;

        logger.error(
            `Chunk job failed permanently: ${job.id} (group ${groupId}, chunk ${chunkIndex + 1}/${totalChunks}) | ${err.message}`
        );

        // Safety guard: don't double-finalize if this chunk was somehow already recorded
        const alreadyRecorded = await client.get(chunkResultKey(groupId, chunkIndex));
        if (alreadyRecorded) return;

        const chunkResult = {
            success: [],
            failed: (chunkItems || []).map(({ product, rowNum }) => ({
                row: rowNum,
                name: product?.name || "Unknown",
                reason: `Processing failed after retries: ${err.message}`,
            })),
            skipped: [],
        };

        await finalizeChunk(groupId, chunkIndex, totalChunks, chunkResult, adminId, adminName);

        await notifyAdmin({
            type: "BULK_UPLOAD_CHUNK_FAILED",
            severity: "high",
            title: "Bulk upload: a chunk failed after all retries",
            message: `Group ${groupId}, chunk ${chunkIndex + 1}/${totalChunks} failed permanently: ${err.message}`,
            dedupeKey: `bulk_upload_chunk_failed:${job.id}`,
        }).catch(() => { });
    } catch (handlerErr) {
        logger.error(`Error in bulkUploadWorker 'failed' handler: ${handlerErr.message}`);
    }
});

// ─── Helper: queue an array of STRUCTURED products ──
export const queueBulkUpload = async (products, admin) => {
    const groupId = crypto.randomUUID();
    const itemsWithNum = products.map((product, i) => ({ product, rowNum: i + 2 }));
    const chunks = chunkArray(itemsWithNum, CHUNK_SIZE);
    const totalChunks = chunks.length;

    await client.set(
        metaKey(groupId),
        JSON.stringify({ totalChunks, totalRows: products.length, adminName: admin?.name }),
        { EX: GROUP_TTL_SECONDS }
    );
    await client.set(completedKey(groupId), "0", { EX: GROUP_TTL_SECONDS });

    await Promise.all(
        chunks.map((chunkItems, index) =>
            bulkUploadQueue.add("process-chunk", {
                groupId,
                chunkIndex: index,
                totalChunks,
                chunkItems,
                adminId: admin?._id,
                adminName: admin?.name,
            })
        )
    );

    logger.info(`Bulk upload group ${groupId} queued: ${totalChunks} chunks, ${products.length} products`);
    return groupId;
};

// ─── Helper: status check ──────────────────────
export const getBulkUploadGroupStatus = async (groupId) => {
    const metaRaw = await client.get(metaKey(groupId)).catch(() => null);
    if (!metaRaw) return null;

    const meta = JSON.parse(metaRaw);
    const completedRaw = await client.get(completedKey(groupId)).catch(() => "0");
    const completedCount = Number(completedRaw) || 0;

    const summaryRaw = await client.get(summaryKey(groupId)).catch(() => null);

    if (summaryRaw) {
        const { summary, results } = JSON.parse(summaryRaw);
        return { state: "completed", progress: 100, summary, results };
    }

    return {
        state: "processing",
        progress: Math.round((completedCount / meta.totalChunks) * 100),
        summary: null,
        results: null,
    };
};


export const getImageSessionMappings = async (sessionId) => {
    const raw = await client.get(imageSessionKey(sessionId)).catch(() => null);
    return raw ? JSON.parse(raw) : {};
};

const retryAsync = async (fn, attempts = 3, baseDelayMs = 400) => {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const result = await fn();
            if (i > 0) result.__attemptsUsed = i + 1; // only tag if it actually needed a retry
            return result;
        } catch (err) {
            lastErr = err;
            if (i < attempts - 1) {
                await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1))); // 400ms, 800ms
            }
        }
    }
    throw lastErr;
};