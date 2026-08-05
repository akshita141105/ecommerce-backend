// routes/admin/adminInventoryRoutes.js
import express from "express";
import {
    getInventory,
    bulkUpdateStock,
    updateStock,
} from "../../controllers/admin/adminInventoryController.js"; 
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

// GET  /api/admin/inventory
router.get("/", getInventory);

// PATCH /api/admin/inventory/bulk-stock  ← yahi 404 de raha tha
router.patch("/bulk-stock", bulkUpdateStock);

// PATCH /api/admin/inventory/stock
router.patch("/stock", updateStock);

export default router;

