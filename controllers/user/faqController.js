// controllers/user/faqController.js
// Path assumption: controllers/user/faqController.js -> models/Faq.js is ../../models/Faq.js

import Faq from "../../models/Faq.js";
import logger from "../../utils/logger.js";

// GET /api/faqs?search=&topic=
// Public endpoint — storefront FAQ page. Read-only, no admin-only fields exposed.
export const getFaqs = async (req, res, next) => {
    try {
        const { search = "", topic = "" } = req.query;
        const filter = {};

        if (search) {
            const safeSearch = search.trim().slice(0, 200); // guard against pathological regex input
            filter.$or = [
                { question: { $regex: safeSearch, $options: "i" } },
                { answer: { $regex: safeSearch, $options: "i" } },
            ];
        }
        if (topic) filter.topic = topic;

        const faqs = await Faq.find(filter, "question answer topic")
            .sort({ topic: 1, createdAt: -1 })
            .lean();

        res.json(faqs);
    } catch (err) {
        logger.error(`Fetching public FAQ list failed: ${err.message}`);
        next(err);
    }
};

// GET /api/faqs/topics
// Returns the distinct list of topics currently in use, for building filter UI.
export const getFaqTopics = async (req, res, next) => {
    try {
        const topics = await Faq.distinct("topic");
        res.json(topics.filter(Boolean).sort());
    } catch (err) {
        logger.error(`Fetching FAQ topics failed: ${err.message}`);
        next(err);
    }
};