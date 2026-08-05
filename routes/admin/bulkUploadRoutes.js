// routes/admin/bulkUploadRoutes.js
import express from "express";
import multer from "multer";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { bulkUploadLimiter } from "../../middleware/rateLimiter.js";
import { uploadProductMedia } from "../../config/multer.js"; // ← cloudinary engine
import {
  bulkUploadProducts,
  bulkUploadProductsJSON,
  bulkUploadImages,
  getBulkUploadStatus,
  downloadTemplate,
  getSessionImages
} from "../../controllers/admin/bulkUploadController.js";

// ── CSV/Excel upload — memory storage, file filter allows both ──
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isCSV = file.mimetype === "text/csv" || file.originalname.endsWith(".csv");
    const isExcel =
      file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || // .xlsx
      file.mimetype === "application/vnd.ms-excel" || // .xls
      /\.(xlsx|xls)$/i.test(file.originalname);

    if (isCSV || isExcel) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV or Excel (.xlsx/.xls) files allowed"));
    }
  },
});

const router = express.Router();

// Template download — public (no auth needed)
router.get("/template", downloadTemplate);

// Bulk upload via CSV/Excel — admin only + rate limited
router.post(
  "/",
  authenticate,
  isAdmin,
  bulkUploadLimiter,
  csvUpload.single("file"),
  bulkUploadProducts
);

// Bulk upload via JSON / table UI — admin only + rate limited
router.post(
  "/json",
  authenticate,
  isAdmin,
  bulkUploadLimiter,
  bulkUploadProductsJSON
);

// Image/video upload (per color / per product) — admin only
router.post(
  "/images",
  authenticate,
  isAdmin,
  uploadProductMedia.array("images", 15),
  bulkUploadImages
);

// Status polling — admin only, no rate limit needed (frequent polling)
router.get(
  "/status/:jobId",
  authenticate,
  isAdmin,
  getBulkUploadStatus
);

router.get("/images/:sessionId", authenticate, isAdmin, getSessionImages);

export default router;