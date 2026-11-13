import express from "express";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";
import {
  getDashboardStats,
  getRevenueChart,
  getRecentOrders,
  getTopProducts,
  getAdminOrders,
} from "../../controllers/admin/adminDashboardController.js";

const router = express.Router();

// All routes protected
router.use(authenticate, isAdmin, adminLimiter);

// Dashboard
router.get("/stats",         getDashboardStats);
router.get("/revenue-chart", getRevenueChart);
router.get("/recent-orders", getRecentOrders);
router.get("/top-products",  getTopProducts);

// Orders
router.get("/orders", getAdminOrders);
// Status updates go through /api/admin/orders/:id/status (adminOrderRoutes.js) —
// this endpoint used to duplicate that with weaker validation and no
// stock/wallet reversal on cancel; removed in favor of the one real path.

export default router;
