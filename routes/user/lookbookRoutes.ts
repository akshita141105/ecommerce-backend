import express from "express";
import { getLookbook } from "../../controllers/admin/adminLookbookController.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(publicLimiter);

router.get("/", getLookbook);

export default router;
