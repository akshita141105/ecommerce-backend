// controllers/user/faqController.ts
import type { NextFunction, Request, Response } from "express";
import type { FilterQuery } from "mongoose";
import Faq, { type IFaq } from "../../models/Faq.js";
import logger from "../../utils/logger.js";

// GET /api/faqs?search=&topic=
// Public endpoint — storefront FAQ page. Read-only, no admin-only fields exposed.
export const getFaqs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search = "", topic = "" } = req.query as { search?: string; topic?: string };
    const filter: FilterQuery<IFaq> = {};

    if (search) {
      const safeSearch = search.trim().slice(0, 200); // guard against pathological regex input
      filter.$or = [{ question: { $regex: safeSearch, $options: "i" } }, { answer: { $regex: safeSearch, $options: "i" } }];
    }
    if (topic) filter.topic = topic;

    const faqs = await Faq.find(filter, "question answer topic").sort({ topic: 1, createdAt: -1 }).lean();

    res.json(faqs);
  } catch (err) {
    logger.error(`Fetching public FAQ list failed: ${(err as Error).message}`);
    next(err);
  }
};

// GET /api/faqs/topics
// Returns the distinct list of topics currently in use, for building filter UI.
export const getFaqTopics = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const topics = await Faq.distinct("topic");
    res.json(topics.filter(Boolean).sort());
  } catch (err) {
    logger.error(`Fetching FAQ topics failed: ${(err as Error).message}`);
    next(err);
  }
};
