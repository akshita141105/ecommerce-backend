// routes/admin/faqRoutes.js
import express from "express";
import multer from "multer";
import {
    bulkUploadFaqs,
    getFaqBulkUploadStatus,
    getAllFaqsAdmin,
    createFaq,
    updateFaq,
    deleteFaq,
} from "../../controllers/admin/adminfaqController.js";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";
const router = express.Router();
const upload = multer({ dest: "tmp_uploads/" });

router.use(authenticate, isAdmin, adminLimiter); // All routes below require admin authentication

router.get("/", getAllFaqsAdmin);
router.post("/", createFaq);
router.patch("/:id", updateFaq);
router.delete("/:id", deleteFaq);

router.post("/bulk-upload", upload.single("file"), bulkUploadFaqs);
router.get("/bulk-upload/:groupId/status", getFaqBulkUploadStatus);

export default router;