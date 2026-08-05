// middleware/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies.accessToken;
    if (!token) {
      return res.status(401).json({ message: "Not logged in!", code: "NO_TOKEN" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

    const user = await User.findById(decoded._id).select("-password").lean();
    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        message: user.blockedReason
          ? `Your account has been blocked: ${user.blockedReason}`
          : "Your account has been blocked. Please contact support.",
        isBlocked: true
      });
    }

    req.user = user;
    next();
  } catch (err) {
    // JWT expired ya invalid
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Access token expired", code: "TOKEN_EXPIRED" });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid token" });
    }
    next(err);
  }
};

export const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
};