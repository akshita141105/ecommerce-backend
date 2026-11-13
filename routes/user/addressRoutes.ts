// routes/user/addressRoutes.ts
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

router.use(publicLimiter, authenticate);

router.post("/", createAddress);
router.get("/", getallAddress);
router.get("/:addressId", getsingleAddress);
router.patch("/:addressId", updateAddress);
router.delete("/:addressId", deleteAddress);

export default router;
