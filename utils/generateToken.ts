import jwt from "jsonwebtoken";
import crypto from "crypto";
import dotenv from "dotenv";
import type { Types } from "mongoose";
dotenv.config();

interface TokenUser {
  _id: Types.ObjectId | string;
  role: string;
}

export const generateAccessToken = (user: TokenUser): string => {
  return jwt.sign({ _id: user._id, role: user.role }, process.env.JWT_SECRET_KEY as string, { expiresIn: "15m" });
};

export const generateRefreshToken = (user: TokenUser): string => {
  return jwt.sign({ _id: user._id }, process.env.JWT_REFRESH_SECRET_KEY as string, { expiresIn: "7d" });
};

// Naya helper — refresh token ko hash karega DB mein store karne se pehle
export const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};
