// routes/admin/adminContactRoutes.js
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
// TODO: import and apply the same admin auth middleware used on your
// existing admin customer/FAQ routes, e.g.:
// import protectAdmin from "../../middleware/protectAdmin.js";


// router.use(protectAdmin); // ← uncomment once wired to your real auth middleware

router.get("/", getAllContactMessages);
router.get("/:id", getContactMessageById);
router.patch("/:id/status", updateContactMessageStatus);
router.delete("/:id", deleteContactMessage);

export default router;
