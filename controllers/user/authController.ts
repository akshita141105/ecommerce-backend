import type { CookieOptions, Request, Response } from "express";
import User from "../../models/User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { sendEmail } from "../../utils/emailQueue.js";
import { generateAccessToken, generateRefreshToken, hashToken } from "../../utils/generateToken.js";
import { checkOtpRisk, checkResetRisk } from "../../utils/riskFlags.js";
import crypto from "crypto";

const isProd = process.env.NODE_ENV === "production";
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
};

export const signup = async (req: Request, res: Response) => {
  try {
    const { email, name, password } = req.body;
    if (!name || name.trim().length < 3) {
      return res.status(400).json({ message: "Name must be atleast 3 characters" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email" });
    }
    if (!password || password.trim().length < 6) {
      return res.status(400).json({ message: "Password must be atleast 6 characters" });
    }
    const existing = await User.findOne({ email });
    if (existing) {
      if (existing.isVerified) {
        return res.status(400).json({ message: "Email already registered!" });
      }
      // Unverified purana record hai — usse hata do, naya banayenge
      await User.deleteOne({ _id: existing._id });
    }

    const hashed = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    const newUser = new User({
      name,
      email,
      password: hashed,
      otp,
      otpExpires,
      isVerified: false,
      otpRequestCount: 1,
      otpRequestResetTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await newUser.save();
    await sendEmail(email, "Your otp for TEC Signup", `<p>Your OTP is <b> ${otp}</b>. It will expire in 10 minutes.</p>`);
    return res.status(200).json({
      message: "Signup successful ! Otp is sent to email",
      email: newUser.email,
    });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
};

export const verifyotp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ message: "UserId and OTP requires" });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found!" });
    }
    if (user.isVerified) {
      return res.status(400).json({ message: "User already verified!" });
    }
    if (user.otp !== otp) {
      return res.status(400).json({ message: "Invalid otp" });
    }
    if (!user.otpExpires || user.otpExpires < new Date()) {
      return res.status(400).json({ message: "Otp expired" });
    }
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await User.findByIdAndUpdate(user._id, {
      $set: { isVerified: true, refreshToken: hashToken(refreshToken) },
      $unset: { otp: "", otpExpires: "" },
    });

    res.cookie("accessToken", accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      message: "User verified successfully!",
      user: { name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and Password required!" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!user.isVerified) {
      return res.status(400).json({ message: "Please verify your email first!" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        message: "Your account has been blocked. Please contact support.",
        isBlocked: true,
      });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await User.findByIdAndUpdate(user._id, {
      $set: { refreshToken: hashToken(refreshToken) },
    });

    res.cookie("accessToken", accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      message: "Login successful!",
      user: { name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
};

export const Logout = async (req: Request, res: Response) => {
  try {
    const token = req.cookies.refreshToken;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET_KEY as string) as { _id: string };
        await User.findByIdAndUpdate(decoded._id, { refreshToken: null });
      } catch {
        // token already invalid/expired, ignore
      }
    }
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    res.status(200).json({ message: "Logout successful!" });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
};

export const resendOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "UserId required!" });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found!" });
    }
    if (user.isVerified) {
      return res.status(400).json({ message: "User alrerady verified" });
    }

    const now = new Date();

    if (user.lastOtpSentAt && now.getTime() - user.lastOtpSentAt.getTime() < 2 * 60 * 1000) {
      const secondsLeft = Math.ceil((2 * 60 * 1000 - (now.getTime() - user.lastOtpSentAt.getTime())) / 1000);
      return res.status(429).json({ message: `Wait ${secondsLeft} sec before requesting OTP again.` });
    }

    if (!user.otpRequestResetTime || now > user.otpRequestResetTime) {
      user.otpRequestCount = 0;
      user.otpRequestResetTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }

    if (user.otpRequestCount >= 5) {
      return res.status(429).json({ message: "OTP limiting reached today . Try tomorrow" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await User.findByIdAndUpdate(user._id, {
      $set: {
        otpRequestCount: user.otpRequestCount + 1,
        lastOtpSentAt: now,
        otp,
        otpExpires,
        otpRequestResetTime: user.otpRequestResetTime,
      },
    });

    // Mirrors checkResetRisk in forgotPassword below — this alert was wired
    // up in riskFlags.js but never actually called from here, so OTP abuse
    // went unmonitored while password-reset abuse was.
    checkOtpRisk(user).catch(() => {});

    await sendEmail(email, "Your otp for TEC Signup", `<p>Your new OTP is <b> ${otp}</b>. It will expire in 10 minutes.</p>`);
    return res.status(200).json({ message: "Otp resent successfully!" });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email required" });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found!" });
    }

    const now = new Date();
    if (!user.resetRequestResetTime || now > user.resetRequestResetTime) {
      user.resetRequestCount = 0;
      user.resetRequestResetTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }

    if (user.resetRequestCount >= 5) {
      return res.status(429).json({ message: "Reset request limit reached. Try later." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    const resetTokenExpires = Date.now() + 15 * 60 * 1000;

    await User.findByIdAndUpdate(user._id, {
      $set: {
        resetRequestCount: user.resetRequestCount + 1,
        resetRequestResetTime: user.resetRequestResetTime,
        resetToken: hashedToken,
        resetTokenExpires,
      },
    });

    checkResetRisk(user).catch(() => {});

    const resetUrl = `https://ecommerce-frontend-snowy-iota.vercel.app/reset-password/${resetToken}`;
    await sendEmail(
      email,
      "Password Reset Request",
      `<p>Click the link to reset your password : </p>
        <a href="${resetUrl}">${resetUrl}</a>
        <p>This link expires in 15 minutes.</p>`
    );
    res.status(200).json({ message: "Password reset link sent to email!" });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token } = req.params as { token: string };
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Password must be atleast 6 characters" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      resetToken: hashedToken,
      resetTokenExpires: { $gt: Date.now() },
    });
    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset token!" });
    }
    const hashed = await bcrypt.hash(password, 10);

    await User.findByIdAndUpdate(user._id, {
      $set: { password: hashed },
      $unset: { resetToken: "", resetTokenExpires: "", resetRequestCount: "", resetRequestResetTime: "" },
    });

    return res.status(200).json({ message: "Password reset successfully!" });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
};

export const getMe = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ user: req.user });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
};

export const refreshAccessToken = async (req: Request, res: Response) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) {
      return res.status(401).json({ message: "No refresh token, please login again" });
    }

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET_KEY as string) as { _id: string };

    const user = await User.findById(decoded._id).select("+refreshToken");
    const incomingHash = hashToken(token);

    if (!user || user.refreshToken !== incomingHash) {
      return res.status(401).json({ message: "Invalid or expired session, please login again" });
    }

    if (user.isBlocked) {
      await User.findByIdAndUpdate(user._id, { $set: { refreshToken: null } });
      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      return res.status(403).json({
        message: "Your account has been blocked. Please contact support.",
        isBlocked: true,
      });
    }

    const newAccessToken = generateAccessToken(user);
    res.cookie("accessToken", newAccessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000,
    });

    res.status(200).json({ message: "Token refreshed" });
  } catch (err) {
    if ((err as Error).name === "TokenExpiredError" || (err as Error).name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Session expired, please login again" });
    }
    return res.status(500).json({ message: (err as Error).message });
  }
};
