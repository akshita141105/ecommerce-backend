import express from "express";
import { getFaqs, getFaqTopics } from "../../controllers/user/faqController.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(publicLimiter);

router.get("/", getFaqs);
router.get("/topics", getFaqTopics);

export default router;
