// routes/admin/adminCustomerRoutes.js
import express from "express";
import { authenticate } from "../../middleware/auth.js";
import { isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";
import { getAllCustomers, getCustomerById, toggleBlockCustomer } from "../../controllers/admin/adminCustomerController.js";


const router = express.Router();

// All routes below: authenticate → isAdmin → adminLimiter → controller
router.use(authenticate, isAdmin, adminLimiter);

// GET /api/admin/customers?search=&page=&limit=&sort=&order=&verified=
router.get("/", getAllCustomers);

// GET /api/admin/customers/:id
router.get("/:id", getCustomerById);

router.patch("/:id/block", toggleBlockCustomer);

export default router;