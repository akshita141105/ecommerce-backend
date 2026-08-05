// controllers/admin/adminNotificationController.js
import AdminNotification from "../../models/AdminNotification.js";

// GET /admin/notifications?page=1&limit=20&unreadOnly=true
export const getNotifications = async (req, res, next) => {
    try {
        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Number(req.query.limit) || 20, 50);
        const skip = (page - 1) * limit;
        const filter = req.query.unreadOnly === "true" ? { read: false } : {};

        const [notifications, unreadCount, total] = await Promise.all([
            AdminNotification.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AdminNotification.countDocuments({ read: false }),
            AdminNotification.countDocuments(filter),
        ]);

        res.json({
            success: true,
            notifications,
            unreadCount,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit),
                hasMore: skip + notifications.length < total,
            },
        });
    } catch (err) {
        next(err);
    }
};

// GET /admin/notifications/unread-count
export const getUnreadCount = async (req, res, next) => {
    try {
        const unreadCount = await AdminNotification.countDocuments({ read: false });
        res.json({ success: true, unreadCount });
    } catch (err) {
        next(err);
    }
};

// PATCH /admin/notifications/read-all
export const markAllRead = async (req, res, next) => {
    try {
        const result = await AdminNotification.updateMany(
            { read: false },
            { $set: { read: true } }
        );
        res.json({
            success: true,
            updated: result.modifiedCount  // kitni mark hui — useful for frontend
        });
    } catch (err) {
        next(err);
    }
};

// PATCH /admin/notifications/:id/read
export const markOneRead = async (req, res, next) => {
    try {
        const result = await AdminNotification.updateOne(
            { _id: req.params.id },
            { $set: { read: true } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Notification not found"
            });
        }

        res.json({ success: true });
    } catch (err) {
        next(err);
    }
};