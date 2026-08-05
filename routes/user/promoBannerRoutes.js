// routes/user/promoBannerRoutes.js
import express from "express";
import { getActivePromoBanner } from "../../controllers/user/promoBannerController.js";

const router = express.Router();

router.get("/active", getActivePromoBanner);

export default router;