import mongoose from "mongoose";

const faqSchema = new mongoose.Schema(
    {
        question: { type: String, required: true, trim: true },

        // Lowercased, trimmed copy of "question" — used ONLY for duplicate
        // detection at the database level. A unique index on THIS field (not
        // on "question" itself) means "What is X?" and "what is x?" are
        // correctly treated as the same FAQ, and — crucially — MongoDB will
        // reject the second insert even if two bulk-upload chunks try to
        // insert the same question at the exact same time (the application-
        // level check in validateFaq() can't catch that race, but a unique
        // index always can, since it's enforced by the DB itself).
        questionNormalized: { type: String, required: true, unique: true },

        answer: { type: String, required: true, trim: true },
        // Replaces the old "category" field. Every FAQ belongs to exactly one topic,
        // used to group questions on the public FAQ page and to filter in the admin panel.
        topic: { type: String, required: true, trim: true, default: "General" },
    },
    { timestamps: true }
);

// Auto-derive questionNormalized whenever question is set/changed via .save()
// or Model.create() — so createFaq() never has to remember to set it manually.
// (Bulk insertMany bypasses this hook, so faqBulkUpload.js sets it explicitly.)
faqSchema.pre("save", function (next) {
    if (this.isModified("question")) {
        this.questionNormalized = this.question.trim().toLowerCase();
    }
    next();
});

// Same auto-derivation for the findByIdAndUpdate path used by updateFaq().
faqSchema.pre("findOneAndUpdate", function (next) {
    const update = this.getUpdate() || {};
    const newQuestion = update.question ?? update.$set?.question;
    if (newQuestion) {
        const normalized = newQuestion.trim().toLowerCase();
        if (update.$set) {
            update.$set.questionNormalized = normalized;
        } else {
            update.questionNormalized = normalized;
        }
    }
    next();
});

// topic index -> fast filtering/grouping on both the public listing and admin views
faqSchema.index({ topic: 1 });
// Note: no separate index on "question" needed anymore — questionNormalized's
// unique index (declared above) covers duplicate-check lookups and is faster
// than the old case-insensitive regex scan.

export default mongoose.model("Faq", faqSchema);