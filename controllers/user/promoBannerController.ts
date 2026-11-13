// controllers/user/promoBannerController.ts
import type { NextFunction, Request, Response } from "express";
import PromoBanner from "../../models/PromoBanner.js";

// GET active banner for homepage
export const getActivePromoBanner = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();

    const banner = await PromoBanner.findOne({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).sort({ createdAt: -1 });

    res.status(200).json({ banner: banner || null });
  } catch (error) {
    next(error);
  }
};
