// routes/admin/notifications.js
import express from "express";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import {
    getNotifications,
    getUnreadCount,
    markAllRead,
    markOneRead,
} from "../../controllers/admin/adminNotificationController.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);


// ✅ Specific routes pehle
router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.patch("/read-all", markAllRead);

// ✅ Dynamic route sabse last
router.patch("/:id/read", markOneRead);


export default router;