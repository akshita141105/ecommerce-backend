// routes/admin/adminContactRoutes.ts
import express from "express";
import {
    getAllContactMessages,
    getContactMessageById,
    updateContactMessageStatus,
    deleteContactMessage,
} from "../../controllers/admin/adminContactController.js";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

router.get("/", getAllContactMessages);
router.get("/:id", getContactMessageById);
router.patch("/:id/status", updateContactMessageStatus);
router.delete("/:id", deleteContactMessage);

export default router;
