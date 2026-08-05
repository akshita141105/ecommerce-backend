import express from "express";
import { getFaqs, getFaqTopics } from "../../controllers/user/faqController.js";

const router = express.Router();

router.get("/", getFaqs);
router.get("/topics", getFaqTopics);

export default router;