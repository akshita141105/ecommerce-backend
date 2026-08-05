// routes/user/addressRoutes.js
import express from "express";
import {
  createAddress,
  getallAddress,
  getsingleAddress,
  updateAddress,
  deleteAddress,
} from "../../controllers/user/addressController.js";
import { authenticate } from "../../middleware/auth.js";
import { publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticate);

router.post("/", publicLimiter, createAddress);
router.get("/", getallAddress);
router.get("/:addressId", getsingleAddress);
router.patch("/:addressId", publicLimiter, updateAddress);
router.delete("/:addressId", deleteAddress);

export default router;