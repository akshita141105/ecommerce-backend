import jwt from "jsonwebtoken";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

export const generateAccessToken = (user) => {
    return jwt.sign(
        { _id: user._id, role: user.role },
        process.env.JWT_SECRET_KEY,
        { expiresIn: "15m" }
    );
};

export const generateRefreshToken = (user) => {
    return jwt.sign(
        { _id: user._id },
        process.env.JWT_REFRESH_SECRET_KEY,
        { expiresIn: "7d" }
    );
};

// Naya helper — refresh token ko hash karega DB mein store karne se pehle
export const hashToken = (token) => {
    return crypto.createHash("sha256").update(token).digest("hex");
};