// routes/user/productRoutes.js
import express from "express";
import {
  getallproduct,
  getsingleproduct,
  getnewarrival,
  getVideos,
  getCategoryProducts,
  getOfferedProducts,
} from "../../controllers/user/productController.js";
import { publicLimiter, searchLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.get("/offers", getOfferedProducts);   

// ── New Arrivals ──────────────────────────────
// GET /api/products/new-arrivals
router.get("/new-arrivals", getnewarrival);

// ── Videos ───────────────────────────────────
// GET /api/products/videos
router.get("/videos", getVideos);

// ── All products of a category, grouped by subcategory ──
// GET /api/products/category/:categorySlug
router.get("/category/:categorySlug", getCategoryProducts);

// ── Single product ────────────────────────────
// GET /api/products/single/:productslug
router.get("/single/:productslug", getsingleproduct);

// ── All products by subcategory ───────────────
// GET /api/products/:subcategoryslug
router.get("/:subcategoryslug", getallproduct);


export default router;