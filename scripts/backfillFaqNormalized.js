// scripts/backfillFaqNormalized.js
//
// One-time backfill: sets `questionNormalized` (trim + lowercase of `question`)
// on every existing Faq document that doesn't already have it.
//
// Why this is needed: FAQs created one-at-a-time (admin "Add FAQ" form) or
// imported before the duplicate-check logic was added never got a
// `questionNormalized` value. The bulk-upload duplicate check
// (services/faqBulkUpload.js) looks up existing FAQs by `questionNormalized`
// — so any doc missing that field is invisible to the check, and the same
// question can get added again instead of being skipped. Run this once to
// fix all existing data; going forward, createFaq/updateFaq
// (controllers/admin/adminfaqController.js) set the field on every write, so
// this backfill should not need to run again after that fix ships.
//
// Usage:
//   node scripts/backfillFaqNormalized.js
//
// Safe to re-run — it only touches docs where questionNormalized is missing,
// and skips (reporting) any doc whose normalized form collides with another
// doc's, since questionNormalized is expected to be unique.

import mongoose from "mongoose";
import dotenv from "dotenv";
import Faq from "../models/Faq.js";
import logger from "../utils/logger.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

    if (!MONGO_URI) {
            console.error("❌ MONGO_URI env variable nahi mila.");
            process.exit(1);
        }
    
        console.log("Connecting to MongoDB...");
        await mongoose.connect(MONGO_URI);
        console.log("✅ Connected");

const normalizeQuestion = (question) => question.trim().toLowerCase();

const run = async () => {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error("MONGO_URI (or MONGODB_URI) not set in environment. Aborting.");
        process.exit(1);
    }

    await mongoose.connect(mongoUri);
    logger.info("backfillFaqNormalized: connected to MongoDB");

    const candidates = await Faq.find({
        $or: [{ questionNormalized: { $exists: false } }, { questionNormalized: null }, { questionNormalized: "" }],
    }).select("_id question questionNormalized");

    logger.info(`backfillFaqNormalized: ${candidates.length} FAQ(s) missing questionNormalized`);

    if (candidates.length === 0) {
        logger.info("backfillFaqNormalized: nothing to do");
        await mongoose.disconnect();
        return;
    }

    // Track normalized values already present in the collection (including
    // ones we backfill in this run) so we can flag any collisions instead of
    // silently violating the unique index / creating ambiguous duplicates.
    const seen = new Set(
        (await Faq.find({ questionNormalized: { $exists: true, $ne: null } }).select("questionNormalized")).map(
            (doc) => doc.questionNormalized
        )
    );

    let updated = 0;
    let skippedCollisions = 0;
    const collisions = [];

    for (const doc of candidates) {
        if (!doc.question || !doc.question.trim()) {
            logger.warn(`backfillFaqNormalized: FAQ ${doc._id} has empty question, skipping`);
            continue;
        }

        const normalized = normalizeQuestion(doc.question);

        if (seen.has(normalized)) {
            skippedCollisions++;
            collisions.push({ id: doc._id.toString(), question: doc.question });
            continue;
        }

        await Faq.updateOne({ _id: doc._id }, { $set: { questionNormalized: normalized } });
        seen.add(normalized);
        updated++;
    }

    logger.info(`backfillFaqNormalized: done — ${updated} updated, ${skippedCollisions} skipped due to collision`);

    if (collisions.length > 0) {
        logger.warn(
            `backfillFaqNormalized: the following FAQs share a question with another FAQ and were NOT backfilled — resolve manually (merge or delete duplicates) then re-run this script:`
        );
        collisions.forEach((c) => logger.warn(`  - ${c.id}: "${c.question}"`));
    }

    await mongoose.disconnect();
    logger.info("backfillFaqNormalized: disconnected, exiting");
};

run().catch((err) => {
    console.error("backfillFaqNormalized: fatal error", err);
    process.exit(1);
});