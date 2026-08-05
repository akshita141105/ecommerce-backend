// ═══════════════════════════════════════════
// routes/user/authRoutes.js
// ═══════════════════════════════════════════
import express from "express";
import {
    signup, verifyotp, login, Logout,
    resendOtp, forgotPassword, resetPassword, getMe, refreshAccessToken
} from "../../controllers/user/authController.js";
import { authenticate } from "../../middleware/auth.js";
import { authLimiter, otpLimiter, publicLimiter } from "../../middleware/rateLimiter.js";

const router = express.Router();

router.get("/me", authenticate, getMe);
router.post("/signup", authLimiter, signup);
router.post("/verify-otp", otpLimiter, verifyotp);
router.post("/login", authLimiter, login);
router.post("/logout", authenticate, Logout);
router.post("/resendOtp", otpLimiter, resendOtp);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password/:token", authLimiter, resetPassword);
router.post("/refresh-token", authLimiter, refreshAccessToken);

export default router;

