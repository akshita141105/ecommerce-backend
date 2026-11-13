// services/bulkUploadEngine.ts
// Generic chunked-bulk-upload engine: BullMQ queue + worker + Redis progress
// tracking, retrying, and partial-insertMany-failure handling. Domain modules
// (products, FAQs, ...) each instantiate their own ChunkedBulkUploader with
// their model, validator, and notification copy — everything else (chunking,
// retries, progress polling, the insertMany partial-failure reconciliation)
// lives here exactly once instead of being copy-pasted per domain.
import { Queue, Worker, type Job } from "bullmq";
import crypto from "crypto";
import type { Model, Types } from "mongoose";
import client from "../config/redis.js";
import logger from "../utils/logger.js";

const connection = {
  url: process.env.REDIS_URL,
  maxRetriesPerRequest: null, // required by BullMQ
};

const chunkArray = <T>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
};

const retryAsync = async <T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 400): Promise<T & { __attemptsUsed?: number }> => {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await fn();
      if (i > 0) (result as T & { __attemptsUsed?: number }).__attemptsUsed = i + 1; // only tag if it actually needed a retry
      return result as T & { __attemptsUsed?: number };
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
};

export interface ValidResult<TDoc> {
  status: "valid";
  row: number;
  name: string;
  doc: TDoc;
}

export interface SkippedOrFailedResult {
  status: "failed" | "skipped";
  row: number;
  name: string;
  reason: string;
}

export type ValidationResult<TDoc> = ValidResult<TDoc> | SkippedOrFailedResult;

interface AdminRef {
  _id?: Types.ObjectId | string;
  name?: string;
}

interface ResultEntry {
  row: number;
  name?: string;
  reason?: string;
  [key: string]: unknown;
}

interface ChunkResult {
  success: ResultEntry[];
  failed: ResultEntry[];
  skipped: ResultEntry[];
}

interface Summary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
}

interface GroupStatus {
  state: "processing" | "completed";
  progress: number;
  summary: Summary | null;
  results: ChunkResult | null;
}

interface ChunkJobData<TItem> {
  groupId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkItems: { item: TItem; rowNum: number }[];
  adminId?: Types.ObjectId | string;
  adminName?: string;
}

interface NotifyCompleteCtx {
  groupId: string;
  summary: Summary;
  results: ChunkResult;
  adminId?: Types.ObjectId | string;
  adminName?: string;
}

interface NotifyChunkFailedCtx {
  groupId: string;
  chunkIndex: number;
  totalChunks: number;
  jobId: string | undefined;
  error: Error;
}

interface ChunkedBulkUploaderOptions<TItem, TDoc> {
  /** BullMQ queue name (also used in log lines) */
  queueName: string;
  /** Redis key prefix for this queue's group progress state */
  keyPrefix: string;
  /** Mongoose model to insertMany validated docs into */
  model: Model<any>;
  /** extra fields (besides `row`) to report for a successfully inserted doc */
  buildSuccessEntry: (doc: TDoc & { _id: Types.ObjectId }) => Record<string, unknown>;
  /** returns a ValidationResult — valid with a doc, or failed/skipped with a reason */
  validateItem: (item: TItem, rowNum: number) => Promise<ValidationResult<TDoc>>;
  chunkSize?: number;
  groupTtlSeconds?: number;
  concurrency?: number;
  notifyComplete: (ctx: NotifyCompleteCtx) => Promise<unknown>;
  notifyChunkFailed: (ctx: NotifyChunkFailedCtx) => Promise<unknown>;
  /** extra side effect once a group fully finishes (e.g. cache invalidation) */
  onGroupComplete?: () => Promise<void>;
}

export class ChunkedBulkUploader<TItem, TDoc> {
  private queueName: string;
  private keyPrefix: string;
  private model: Model<any>;
  private buildSuccessEntry: (doc: TDoc & { _id: Types.ObjectId }) => Record<string, unknown>;
  private validateItem: (item: TItem, rowNum: number) => Promise<ValidationResult<TDoc>>;
  private chunkSize: number;
  private groupTtlSeconds: number;
  private notifyComplete: (ctx: NotifyCompleteCtx) => Promise<unknown>;
  private notifyChunkFailed: (ctx: NotifyChunkFailedCtx) => Promise<unknown>;
  private onGroupComplete?: () => Promise<void>;

  queue: Queue<ChunkJobData<TItem>>;
  worker: Worker<ChunkJobData<TItem>, ChunkResult>;

  constructor(opts: ChunkedBulkUploaderOptions<TItem, TDoc>) {
    this.queueName = opts.queueName;
    this.keyPrefix = opts.keyPrefix;
    this.model = opts.model;
    this.buildSuccessEntry = opts.buildSuccessEntry;
    this.validateItem = opts.validateItem;
    this.chunkSize = opts.chunkSize ?? 25;
    this.groupTtlSeconds = opts.groupTtlSeconds ?? 24 * 60 * 60;
    this.notifyComplete = opts.notifyComplete;
    this.notifyChunkFailed = opts.notifyChunkFailed;
    this.onGroupComplete = opts.onGroupComplete;

    this.queue = new Queue<ChunkJobData<TItem>>(this.queueName, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 }, // 2s, 4s, 8s
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    });

    this.worker = new Worker<ChunkJobData<TItem>, ChunkResult>(
      this.queueName,
      async (job) => {
        const { groupId, chunkIndex, totalChunks, chunkItems, adminId, adminName } = job.data;
        const chunkResult = await this.processChunk(chunkItems);
        logger.info(`${this.queueName} chunk ${chunkIndex + 1}/${totalChunks} done for group ${groupId}`);
        await this.finalizeChunk(groupId, chunkIndex, totalChunks, chunkResult, adminId, adminName);
        return chunkResult;
      },
      { connection, concurrency: opts.concurrency ?? 3 }
    );

    this.worker.on("completed", (job) => {
      logger.info(`${this.queueName} chunk job completed: ${job.id} (group ${job.data.groupId}, chunk ${job.data.chunkIndex + 1}/${job.data.totalChunks})`);
    });

    // A chunk lands here after EVERY failed attempt, not just the final one —
    // so a retry that's still pending must not be treated as a permanent
    // failure (that would finalize/notify early and then block the eventual
    // successful retry from ever being recorded, since finalizeChunk only
    // writes once per chunk).
    this.worker.on("failed", async (job: Job<ChunkJobData<TItem>, ChunkResult> | undefined, err: Error) => {
      try {
        if (!job) return;

        const maxAttempts = job.opts?.attempts || 1;
        if (job.attemptsMade < maxAttempts) {
          logger.warn(
            `${this.queueName} job attempt ${job.attemptsMade}/${maxAttempts} failed for group ${job.data?.groupId}, chunk ${(job.data?.chunkIndex ?? 0) + 1} — will retry: ${err.message}`
          );
          return;
        }

        const { groupId, chunkIndex, totalChunks, chunkItems, adminId, adminName } = job.data || {};
        if (!groupId) return;

        logger.error(`${this.queueName} chunk job failed permanently: ${job.id} (group ${groupId}, chunk ${chunkIndex + 1}/${totalChunks}) | ${err.message}`);

        // Safety guard: don't double-finalize if this chunk was somehow already recorded
        const alreadyRecorded = await client.get(this.chunkResultKey(groupId, chunkIndex));
        if (alreadyRecorded) return;

        const chunkResult: ChunkResult = {
          success: [],
          failed: (chunkItems || []).map(({ item, rowNum }) => ({
            row: rowNum,
            name: (item as { name?: string; question?: string })?.name || (item as { name?: string; question?: string })?.question || "Unknown",
            reason: `Processing failed after retries: ${err.message}`,
          })),
          skipped: [],
        };

        await this.finalizeChunk(groupId, chunkIndex, totalChunks, chunkResult, adminId, adminName);

        await this.notifyChunkFailed({ groupId, chunkIndex, totalChunks, jobId: job.id, error: err }).catch(() => {});
      } catch (handlerErr) {
        logger.error(`Error in ${this.queueName} 'failed' handler: ${(handlerErr as Error).message}`);
      }
    });
  }

  // ─── Redis key helpers ─────────────────────────
  private metaKey(groupId: string) {
    return `${this.keyPrefix}:${groupId}:meta`;
  }
  private completedKey(groupId: string) {
    return `${this.keyPrefix}:${groupId}:completed`;
  }
  private chunkResultKey(groupId: string, chunkIndex: number) {
    return `${this.keyPrefix}:${groupId}:chunk:${chunkIndex}`;
  }
  private summaryKey(groupId: string) {
    return `${this.keyPrefix}:${groupId}:summary`;
  }

  // insertMany with { ordered: false } inserts every doc it can and only
  // fails the ones that actually error (e.g. duplicate key race). writeErrors
  // tells us exactly which original indices failed; insertedDocs preserves
  // the relative order of the successes (it just skips the failed ones), so
  // a single pointer walked alongside validDocs pairs each success back up
  // with the right doc.
  private async insertValidDocs(validDocs: ValidResult<TDoc>[], results: ChunkResult) {
    if (validDocs.length === 0) return;

    try {
      const inserted = await this.model.insertMany(
        validDocs.map((v) => v.doc),
        { ordered: false }
      );
      inserted.forEach((doc, i) => {
        results.success.push({ row: validDocs[i].row, ...this.buildSuccessEntry(doc as unknown as TDoc & { _id: Types.ObjectId }) });
      });
    } catch (err) {
      const mongoErr = err as Error & {
        insertedDocs?: (TDoc & { _id: Types.ObjectId })[];
        writeErrors?: { index?: number; err?: { index?: number; errmsg?: string }; errmsg?: string; message?: string }[];
      };
      const insertedDocs = mongoErr.insertedDocs || [];
      const writeErrors = mongoErr.writeErrors || [];
      const failedIndexReasons = new Map<number, string>();
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
          results.success.push({ row: v.row, ...this.buildSuccessEntry(doc) });
        } else {
          // Safety net: index wasn't reported as a write error but we ran out
          // of inserted docs — surface it rather than silently dropping it.
          results.failed.push({ row: v.row, name: v.name, reason: mongoErr.message || "Insert result missing (unexpected)" });
        }
      });

      logger.error(`${this.queueName} insertMany partial failure: ${insertedDocs.length} succeeded, ${writeErrors.length} failed — ${mongoErr.message}`);
    }
  }

  private async processChunk(chunkItems: { item: TItem; rowNum: number }[]): Promise<ChunkResult> {
    const results: ChunkResult = { success: [], failed: [], skipped: [] };

    const validations = await Promise.all(
      chunkItems.map(({ item, rowNum }) =>
        retryAsync(() => this.validateItem(item, rowNum), 3, 400).catch(
          (err): SkippedOrFailedResult => ({
            status: "failed",
            row: rowNum,
            name: (item as { name?: string; question?: string })?.name || (item as { name?: string; question?: string })?.question || "Unknown",
            reason: `${(err as Error).message} (failed after 3 attempts)`,
          })
        )
      )
    );

    const validDocs = validations.filter((v): v is ValidResult<TDoc> & { __attemptsUsed?: number } => v.status === "valid");
    await this.insertValidDocs(validDocs, results);

    validations
      .filter((v): v is SkippedOrFailedResult & { __attemptsUsed?: number } => v.status !== "valid")
      .forEach((v) => {
        const entry: ResultEntry = { row: v.row, name: v.name, reason: v.__attemptsUsed ? `${v.reason} (recovered after ${v.__attemptsUsed} attempts)` : v.reason };
        results[v.status].push(entry);
      });

    return results;
  }

  private async finalizeGroup(groupId: string, totalChunks: number, adminId?: Types.ObjectId | string, adminName?: string) {
    const allResults: ChunkResult = { success: [], failed: [], skipped: [] };

    for (let i = 0; i < totalChunks; i++) {
      const raw = await client.get(this.chunkResultKey(groupId, i));
      if (raw) {
        const r = JSON.parse(raw) as ChunkResult;
        allResults.success.push(...r.success);
        allResults.failed.push(...r.failed);
        allResults.skipped.push(...r.skipped);
      }
    }

    const summary: Summary = {
      total: allResults.success.length + allResults.failed.length + allResults.skipped.length,
      success: allResults.success.length,
      failed: allResults.failed.length,
      skipped: allResults.skipped.length,
    };

    await client.set(this.summaryKey(groupId), JSON.stringify({ summary, results: allResults }), { EX: this.groupTtlSeconds });

    if (this.onGroupComplete) await this.onGroupComplete();

    logger.info(`${this.queueName} group ${groupId} fully complete: ${summary.success} success, ${summary.failed} failed, ${summary.skipped} skipped`);

    // One consolidated notification once the whole group is done — not per
    // chunk, otherwise 100 chunks = 100 notifications.
    await this.notifyComplete({ groupId, summary, results: allResults, adminId, adminName }).catch((err) =>
      logger.error(`notifyAdmin (${this.queueName} complete) failed: ${(err as Error).message}`)
    );
  }

  private async finalizeChunk(
    groupId: string,
    chunkIndex: number,
    totalChunks: number,
    chunkResult: ChunkResult,
    adminId?: Types.ObjectId | string,
    adminName?: string
  ) {
    await client.set(this.chunkResultKey(groupId, chunkIndex), JSON.stringify(chunkResult), { EX: this.groupTtlSeconds });

    const completedCount = await client.incr(this.completedKey(groupId));
    await client.expire(this.completedKey(groupId), this.groupTtlSeconds);

    if (completedCount === totalChunks) await this.finalizeGroup(groupId, totalChunks, adminId, adminName);
  }

  // Arrow-function fields (not prototype methods) so callers can safely
  // extract these as standalone function references, e.g.
  // `export const queueBulkUpload = uploader.queueUpload;`
  queueUpload = async (items: TItem[], admin?: AdminRef): Promise<string> => {
    const groupId = crypto.randomUUID();
    const itemsWithNum = items.map((item, i) => ({ item, rowNum: i + 2 })); // +2: header row + 1-index
    const chunks = chunkArray(itemsWithNum, this.chunkSize);
    const totalChunks = chunks.length;

    await client.set(this.metaKey(groupId), JSON.stringify({ totalChunks, totalRows: items.length, adminName: admin?.name }), { EX: this.groupTtlSeconds });
    await client.set(this.completedKey(groupId), "0", { EX: this.groupTtlSeconds });

    await Promise.all(
      chunks.map((chunkItems, index) =>
        this.queue.add("process-chunk", {
          groupId,
          chunkIndex: index,
          totalChunks,
          chunkItems,
          adminId: admin?._id,
          adminName: admin?.name,
        })
      )
    );

    logger.info(`${this.queueName} group ${groupId} queued: ${totalChunks} chunks, ${items.length} items`);
    return groupId;
  };

  getGroupStatus = async (groupId: string): Promise<GroupStatus | null> => {
    const metaRaw = await client.get(this.metaKey(groupId)).catch(() => null);
    if (!metaRaw) return null;

    const meta = JSON.parse(metaRaw) as { totalChunks: number; totalRows: number; adminName?: string };
    const completedRaw = await client.get(this.completedKey(groupId)).catch(() => "0");
    const completedCount = Number(completedRaw) || 0;

    const summaryRaw = await client.get(this.summaryKey(groupId)).catch(() => null);
    if (summaryRaw) {
      const { summary, results } = JSON.parse(summaryRaw) as { summary: Summary; results: ChunkResult };
      return { state: "completed", progress: 100, summary, results };
    }

    return {
      state: "processing",
      progress: Math.round((completedCount / meta.totalChunks) * 100),
      summary: null,
      results: null,
    };
  };
}
