// services/faqBulkUpload.js
// Place alongside your existing Product bulk upload service so the relative
// imports below (../models, ../utils/logger, ../lib/redis, ../utils/notifyAdmin)
// resolve exactly the same way.

import { Queue, Worker } from "bullmq";
import crypto from "crypto";
import Faq from "../models/Faq.js";
import logger from "../utils/logger.js";
import client from "../lib/redis.js";
import { notifyAdmin } from "../utils/notifyAdmin.js";

const connection = {
    url: process.env.REDIS_URL,
    maxRetriesPerRequest: null, // BullMQ ke liye required hai
};

const CHUNK_SIZE = 25;
const GROUP_TTL_SECONDS = 24 * 60 * 60; // auto-clean from redis after 24h

// ─── Queue ────────────────────────────────────
export const faqBulkUploadQueue = new Queue("faqBulkUploadQueue", {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 }, // 2s, 4s, 8s
        removeOnComplete: 200,
        removeOnFail: 200,
    },
});

// ═══════════════════════════════════════════════
// CORE VALIDATOR — CSV rows and direct JSON (admin table UI) both go through
// this shape so validation rules live in exactly one place.
//
// Duplicate check queries the unique-indexed `questionNormalized` field with
// an exact match instead of a case-insensitive regex scan against `question`.
// This is both faster (uses the index directly) AND closes the race
// condition where two chunks processing in parallel (concurrency: 3) could
// both pass this check for the same question before either finishes
// inserting — the unique index at the DB level catches that case even when
// this application-level check misses it.
// ═══════════════════════════════════════════════
const validateFaq = async (item, rowNum) => {
    const question = item.question?.trim();
    const answer = item.answer?.trim();
    const topic = item.topic?.trim() || "General";

    if (!question) return { status: "failed", row: rowNum, name: "Unknown", reason: "Question is required" };
    if (!answer) return { status: "failed", row: rowNum, name: question, reason: "Answer is required" };

    const questionNormalized = question.toLowerCase();

    const existing = await Faq.findOne({ questionNormalized });
    if (existing) {
        return { status: "skipped", row: rowNum, name: question, reason: "FAQ with this question already exists" };
    }

    return {
        status: "valid",
        row: rowNum,
        name: question,
        doc: { question, answer, topic, questionNormalized },
    };
};

// ─── Convert a raw CSV/Excel row (all strings) into the structured shape ──
export const csvRowToFaq = (row) => ({
    question: row.question || row.Question || "",
    answer: row.answer || row.Answer || "",
    topic: row.topic || row.Topic || "",
});

const chunkArray = (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
};

const retryAsync = async (fn, attempts = 3, baseDelayMs = 400) => {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const result = await fn();
            if (i > 0) result.__attemptsUsed = i + 1;
            return result;
        } catch (err) {
            lastErr = err;
            if (i < attempts - 1) {
                await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
            }
        }
    }
    throw lastErr;
};

// ═══════════════════════════════════════════════
// insertMany partial-failure handling.
//
// FIXED: the previous version matched failures/successes by looking up
// insertedDocs[i] against validDocs[i] — but insertedDocs only contains the
// docs that succeeded, so it's SHORTER than validDocs whenever anything
// failed, and every index after the first failure was misaligned (wrong
// doc's id/name attached to the wrong row).
//
// Correct approach: writeErrors tells us exactly which original indices
// failed. For every index NOT in that set, we know it succeeded — and since
// insertedDocs preserves the relative order of the successful docs (it just
// skips the failed ones), we can walk both arrays with a single pointer to
// pick up the right doc for each success, in order.
// ═══════════════════════════════════════════════
const insertValidDocs = async (validDocs, results) => {
    if (validDocs.length === 0) return;

    try {
        const inserted = await Faq.insertMany(
            validDocs.map((v) => v.doc),
            { ordered: false }
        );
        inserted.forEach((doc, i) => {
            results.success.push({ row: validDocs[i].row, name: doc.question, id: doc._id });
        });
    } catch (err) {
        const insertedDocs = err.insertedDocs || [];

        const writeErrors = err.writeErrors || [];
        const failedIndexReasons = new Map();
        writeErrors.forEach((we) => {
            const idx = typeof we.index === "number" ? we.index : we.err?.index;
            const reason = we.errmsg || we.err?.errmsg || we.message || "Insert failed";
            if (typeof idx === "number") failedIndexReasons.set(idx, reason);
        });

        let insertedPtr = 0; // walks insertedDocs in lockstep with the successful indices
        validDocs.forEach((v, i) => {
            if (failedIndexReasons.has(i)) {
                results.failed.push({ row: v.row, name: v.name, reason: failedIndexReasons.get(i) });
                return;
            }
            const doc = insertedDocs[insertedPtr++];
            if (doc) {
                results.success.push({ row: v.row, name: doc.question, id: doc._id });
            } else {
                // Safety net: index wasn't reported as a write error but we ran out of
                // inserted docs. Surface it as failed rather than silently dropping it.
                results.failed.push({ row: v.row, name: v.name, reason: err.message || "Insert result missing (unexpected)" });
            }
        });

        logger.error(`Faq insertMany partial failure: ${insertedDocs.length} succeeded, ${writeErrors.length} failed — ${err.message}`);
    }
};

// ─── Process one chunk (called inside worker) ──
const processChunk = async (chunkItems) => {
    const results = { success: [], failed: [], skipped: [] };

    const validations = await Promise.all(
        chunkItems.map(({ item, rowNum }) =>
            retryAsync(() => validateFaq(item, rowNum), 3, 400).catch((err) => ({
                status: "failed",
                row: rowNum,
                name: item.question || "Unknown",
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
const metaKey = (groupId) => `faqbulkgroup:${groupId}:meta`;
const completedKey = (groupId) => `faqbulkgroup:${groupId}:completed`;
const chunkResultKey = (groupId, chunkIndex) => `faqbulkgroup:${groupId}:chunk:${chunkIndex}`;
const summaryKey = (groupId) => `faqbulkgroup:${groupId}:summary`;

// ─── Finalize: once every chunk is done, build a summary and notify admin ──
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

    logger.info(
        `FAQ bulk upload group ${groupId} fully complete: ${summary.success} success, ${summary.failed} failed, ${summary.skipped} skipped`
    );

    // One consolidated notification once the whole group is done — not per chunk,
    // otherwise 100 chunks = 100 notifications.
    await notifyAdmin({
        type: "FAQ_BULK_UPLOAD_COMPLETE",
        severity: summary.failed > 0 ? "medium" : "low",
        title: "FAQ bulk upload complete",
        message: `${adminName || "Admin"}'s FAQ upload finished: ${summary.success} added, ${summary.failed} failed, ${summary.skipped} skipped (of ${summary.total}).`,
        link: `/faqs`,
        data: { groupId, ...summary, adminId },
        dedupeKey: `faq_bulk_upload_complete:${groupId}`,
    }).catch((err) => logger.error("notifyAdmin (FAQ bulk upload complete) failed:", err));
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

// ─── Worker — one call = one chunk ────────────────
export const faqBulkUploadWorker = new Worker(
    "faqBulkUploadQueue",
    async (job) => {
        const { groupId, chunkIndex, totalChunks, chunkItems, adminId, adminName } = job.data;

        const chunkResult = await processChunk(chunkItems);

        logger.info(`FAQ bulk upload chunk ${chunkIndex + 1}/${totalChunks} done for group ${groupId}`);

        await finalizeChunk(groupId, chunkIndex, totalChunks, chunkResult, adminId, adminName);

        return chunkResult;
    },
    {
        connection,
        concurrency: 3,
    }
);

// ─── Worker events ────────────────────────────
faqBulkUploadWorker.on("completed", (job) => {
    logger.info(`FAQ chunk job completed: ${job.id} (group ${job.data.groupId}, chunk ${job.data.chunkIndex + 1}/${job.data.totalChunks})`);
});

// A chunk lands here only once all retry attempts (default 3) are exhausted.
// This still needs to be finalized — otherwise the completed-counter never
// reaches totalChunks and the frontend polls "processing" forever.
faqBulkUploadWorker.on("failed", async (job, err) => {
    try {
        if (!job) return;

        const maxAttempts = job.opts?.attempts || 1;
        if (job.attemptsMade < maxAttempts) {
            // Not the final attempt — a retry is still coming. Do nothing.
            logger.warn(
                `FAQ chunk job attempt ${job.attemptsMade}/${maxAttempts} failed for group ${job.data?.groupId}, chunk ${(job.data?.chunkIndex ?? 0) + 1} — will retry: ${err.message}`
            );
            return;
        }

        const { groupId, chunkIndex, totalChunks, chunkItems, adminId, adminName } = job.data || {};
        if (!groupId) return;

        logger.error(
            `FAQ chunk job failed permanently: ${job.id} (group ${groupId}, chunk ${chunkIndex + 1}/${totalChunks}) | ${err.message}`
        );

        const alreadyRecorded = await client.get(chunkResultKey(groupId, chunkIndex));
        if (alreadyRecorded) return;

        const chunkResult = {
            success: [],
            failed: (chunkItems || []).map(({ item, rowNum }) => ({
                row: rowNum,
                name: item?.question || "Unknown",
                reason: `Processing failed after retries: ${err.message}`,
            })),
            skipped: [],
        };

        await finalizeChunk(groupId, chunkIndex, totalChunks, chunkResult, adminId, adminName);

        await notifyAdmin({
            type: "FAQ_BULK_UPLOAD_CHUNK_FAILED",
            severity: "high",
            title: "FAQ bulk upload: a chunk failed after all retries",
            message: `Group ${groupId}, chunk ${chunkIndex + 1}/${totalChunks} failed permanently: ${err.message}`,
            dedupeKey: `faq_bulk_upload_chunk_failed:${job.id}`,
        }).catch(() => { });
    } catch (handlerErr) {
        logger.error(`Error in faqBulkUploadWorker 'failed' handler: ${handlerErr.message}`);
    }
});

// ─── Helper: queue an array of STRUCTURED faq rows ({question, answer, topic}) ──
export const queueFaqBulkUpload = async (faqRows, admin) => {
    const groupId = crypto.randomUUID();
    const itemsWithNum = faqRows.map((item, i) => ({ item, rowNum: i + 2 })); // +2: header row + 1-index
    const chunks = chunkArray(itemsWithNum, CHUNK_SIZE);
    const totalChunks = chunks.length;

    await client.set(
        metaKey(groupId),
        JSON.stringify({ totalChunks, totalRows: faqRows.length, adminName: admin?.name }),
        { EX: GROUP_TTL_SECONDS }
    );
    await client.set(completedKey(groupId), "0", { EX: GROUP_TTL_SECONDS });

    await Promise.all(
        chunks.map((chunkItems, index) =>
            faqBulkUploadQueue.add("process-chunk", {
                groupId,
                chunkIndex: index,
                totalChunks,
                chunkItems,
                adminId: admin?._id,
                adminName: admin?.name,
            })
        )
    );

    logger.info(`FAQ bulk upload group ${groupId} queued: ${totalChunks} chunks, ${faqRows.length} rows`);
    return groupId;
};

// ─── Helper: status check (poll from admin UI) ──────────────────────
export const getFaqBulkUploadGroupStatus = async (groupId) => {
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