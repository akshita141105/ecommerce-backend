// routes/index.js
// Aggregates every route module into a single router mounted at /api in index.js.
import express from "express";
import mongoose from "mongoose";

// ─── User Routes ──────────────────────────────
import authRoutes from "./user/authRoutes.js";
import addressRoutes from "./user/addressRoutes.js";
import cartRoutes from "./user/cartRoutes.js";
import cartItemRoutes from "./user/cartItemRoutes.js";
import categoryPublicRoutes from "./user/categoryRoutes.js";
import subcategoryPublicRoutes from "./user/subcategoryRoutes.js";
import productPublicRoutes from "./user/productRoutes.js";
import orderRoutes from "./user/orderRoutes.js";
import paymentRoutes from "./user/paymentRoutes.js";
import walletRoutes from "./user/walletRoutes.js";
import wishlistRoutes from "./user/wishlistRoutes.js";
import returnPublicRoutes from "./user/returnRoutes.js";
import lookbookPublicRoutes from "./user/lookbookRoutes.js";
import faqRoutes from "./user/faqRoutes.js";
import contactRoutes from "./user/contactRoutes.js";
import promoBannerRoutes from "./user/promoBannerRoutes.js";

// ─── Admin Routes ─────────────────────────────
import adminDashboardRoutes from "./admin/adminDashboardRoutes.js";
import adminProductRoutes from "./admin/adminProductRoutes.js";
import adminCategoryRoutes from "./admin/adminCategoryRoutes.js";
import adminSubcategoryRoutes from "./admin/adminSubcategoryRoutes.js";
import adminReturnRoutes from "./admin/adminReturnRoutes.js";
import adminLookbookRoutes from "./admin/lookbookRoutes.js";
import bulkUploadRoutes from "./admin/bulkUploadRoutes.js";
import adminInventoryRoutes from "./admin/adminInventoryRoutes.js";
import notificationRoutes from "./admin/adminnotificationsRoutes.js";
import adminOrderRoutes from "./admin/adminOrderRoutes.js";
import adminCustomerRoutes from "./admin/adminCustomerRoutes.js";
import adminFaqRoutes from "./admin/adminfaqRoutes.js";
import adminContactRoutes from "./admin/adminContactRoutes.js";
import adminErrorsRoutes from "./admin/adminErrorsRoutes.js";
import failedEmailRoutes from "./admin/failedEmailRoutes.js";
import adminPromoBannerRoutes from "./admin/adminPromoBannerRoutes.js";
import adminPaymentRoutes from "./admin/adminPaymentRoutes.js";

const router = express.Router();

// ─── Health Check ─────────────────────────────
router.get("/health", async (req, res) => {
    try {
        await mongoose.connection.db.admin().ping();
        res.json({
            status: "ok",
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        });
    } catch {
        res.status(503).json({ status: "degraded" });
    }
});

// ═══════════════════════════════════════════
// USER ROUTES
// ═══════════════════════════════════════════
router.use("/auth", authRoutes);
router.use("/address", addressRoutes);
router.use("/cart", cartRoutes);
router.use("/cart-items", cartItemRoutes);
router.use("/categories", categoryPublicRoutes);
router.use("/subcategories", subcategoryPublicRoutes);
router.use("/products", productPublicRoutes);
router.use("/orders", orderRoutes);
router.use("/payment", paymentRoutes);
router.use("/wallet", walletRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/returns", returnPublicRoutes);
router.use("/lookbook", lookbookPublicRoutes);
router.use("/faqs", faqRoutes);
router.use("/contact", contactRoutes);
router.use("/promo-banner", promoBannerRoutes);

// ═══════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════
router.use("/admin/dashboard", adminDashboardRoutes);
router.use("/admin/products/bulk-upload", bulkUploadRoutes); // specific before dynamic
router.use("/admin/products", adminProductRoutes);
router.use("/admin/categories", adminCategoryRoutes);
router.use("/admin/subcategories", adminSubcategoryRoutes);
router.use("/admin/returns", adminReturnRoutes);
router.use("/admin/lookbook", adminLookbookRoutes);
router.use("/admin/inventory", adminInventoryRoutes);
router.use("/admin/notifications", notificationRoutes);
router.use("/admin/orders", adminOrderRoutes);
router.use("/admin/customers", adminCustomerRoutes);
router.use("/admin/faqs", adminFaqRoutes);
router.use("/admin/contact", adminContactRoutes);
router.use("/admin", failedEmailRoutes);
router.use("/admin/errors", adminErrorsRoutes);
router.use("/admin/promo-banner", adminPromoBannerRoutes);
router.use("/admin/payments", adminPaymentRoutes);

export default router;
