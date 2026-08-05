// routes/admin/adminProductRoutes.js
import express from "express";
import {
  getAdminProducts,
  getAdminProductById,
  getAdminProductIds,
  createProduct,
  updateproduct,
  deleteproduct,
  bulkUpdateProducts,
  toggleVideoVisibility,
} from "../../controllers/admin/adminProductController.js";
import { uploadProductMedia } from "../../config/multer.js";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter, bulkUploadLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

// ── Auth middleware — sab admin routes protected ──
router.use(authenticate, isAdmin, adminLimiter);

// ── GET all products (paginated, filtered) ────
// GET /api/admin/products
router.get("/", getAdminProducts);

// ── Bulk update (newArrival, offer etc.) ──────
// PATCH /api/admin/products/bulk-update
router.patch("/bulk-update", bulkUploadLimiter, bulkUpdateProducts);

// ← YAHAN ADD KARO — /:productId se pehle honi chahiye
router.get("/ids", getAdminProductIds);

// ── GET single product by ID ──────────────────
// GET /api/admin/products/:productId
router.get("/:productId", getAdminProductById);

// ── CREATE product ────────────────────────────
// POST /api/admin/products
router.post(
  "/",
  uploadProductMedia.any(),  // ← koi bhi fieldname accept karega
  createProduct
);

// ── UPDATE product ────────────────────────────
// PATCH /api/admin/products/:productId
// Update product — .any() use karo
router.patch(
  "/:productId",
  uploadProductMedia.any(),  // ← fields() ki jagah
  updateproduct
);

// ── DELETE product ────────────────────────────
// DELETE /api/admin/products/:productId
router.delete("/:productId", deleteproduct);

// routes
router.patch("/products/:productId/toggle-video", toggleVideoVisibility);

export default router;
