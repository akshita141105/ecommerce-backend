import express from "express";
import { getLookbook } from "../../controllers/admin/adminLookbookController.js";

const router = express.Router();

router.get("/", getLookbook);

export default router;