import express from "express";
import { authenticate, isAdmin } from "../../middleware/auth.js";
import { adminLimiter } from "../../middleware/rateLimiter.js";
import {
  getLookbook,
  initLookbook,
  addProductToSection,
  removeProductFromSection,
  addSection,
  removeSection,
  updateSection,
} from "../../controllers/admin/adminLookbookController.js";

const router = express.Router();

router.use(authenticate, isAdmin, adminLimiter);

router.get("/",                                        getLookbook);
router.post("/init",                                   initLookbook);
router.post("/sections",                               addSection);
router.patch("/sections/:sectionId",                   updateSection);
router.delete("/sections/:sectionId",                  removeSection);
router.post("/sections/:sectionId/products",           addProductToSection);
router.delete("/sections/:sectionId/products/:productId", removeProductFromSection);

export default router;