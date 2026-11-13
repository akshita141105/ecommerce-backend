// services/faqBulkUpload.ts
// FAQ-specific bulk upload: validation and wiring into the shared chunked
// upload engine (services/bulkUploadEngine.js).
import Faq, { type IFaq } from "../models/Faq.js";
import { notifyAdmin } from "../utils/notifyAdmin.js";
import { ChunkedBulkUploader, type ValidationResult } from "./bulkUploadEngine.js";

export interface FaqCsvItem {
  question?: string;
  answer?: string;
  topic?: string;
}

type FaqInsertDoc = Pick<IFaq, "question" | "answer" | "topic" | "questionNormalized">;

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
const validateFaq = async (item: FaqCsvItem, rowNum: number): Promise<ValidationResult<FaqInsertDoc>> => {
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
export const csvRowToFaq = (row: Record<string, string>): FaqCsvItem => ({
  question: row.question || row.Question || "",
  answer: row.answer || row.Answer || "",
  topic: row.topic || row.Topic || "",
});

// ─── Wire into the shared chunked-upload engine ──
const uploader = new ChunkedBulkUploader<FaqCsvItem, FaqInsertDoc>({
  queueName: "faqBulkUploadQueue",
  keyPrefix: "faqbulkgroup",
  model: Faq,
  buildSuccessEntry: (doc) => ({ name: doc.question, id: doc._id }),
  validateItem: validateFaq,
  notifyComplete: ({ groupId, summary, adminId, adminName }) =>
    notifyAdmin({
      type: "FAQ_BULK_UPLOAD_COMPLETE",
      severity: summary.failed > 0 ? "medium" : "low",
      title: "FAQ bulk upload complete",
      message: `${adminName || "Admin"}'s FAQ upload finished: ${summary.success} added, ${summary.failed} failed, ${summary.skipped} skipped (of ${summary.total}).`,
      link: `/faqs`,
      data: { groupId, ...summary, adminId },
      dedupeKey: `faq_bulk_upload_complete:${groupId}`,
    }),
  notifyChunkFailed: ({ groupId, chunkIndex, totalChunks, jobId, error }) =>
    notifyAdmin({
      type: "FAQ_BULK_UPLOAD_CHUNK_FAILED",
      severity: "high",
      title: "FAQ bulk upload: a chunk failed after all retries",
      message: `Group ${groupId}, chunk ${chunkIndex + 1}/${totalChunks} failed permanently: ${error.message}`,
      dedupeKey: `faq_bulk_upload_chunk_failed:${jobId}`,
    }),
});

export const faqBulkUploadQueue = uploader.queue;
export const faqBulkUploadWorker = uploader.worker;
export const queueFaqBulkUpload = uploader.queueUpload;
export const getFaqBulkUploadGroupStatus = uploader.getGroupStatus;
