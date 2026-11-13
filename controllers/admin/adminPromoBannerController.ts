// controllers/admin/promoBannerController.ts
import type { Request, Response, NextFunction } from "express";
import PromoBanner from "../../models/PromoBanner.js";
import cloudinary from "../../config/cloudinary.js";

// CREATE new banner
export const createPromoBanner = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { startDate, endDate, linkUrl } = req.body;

        if (!req.file) {
            res.status(400).json({ message: "Banner image is required" });
            return;
        }
        if (!startDate || !endDate) {
            res.status(400).json({ message: "startDate and endDate are required" });
            return;
        }
        if (new Date(startDate) >= new Date(endDate)) {
            res.status(400).json({ message: "endDate must be after startDate" });
            return;
        }

        // ek time pe ek hi banner active rahe
        await PromoBanner.updateMany({}, { isActive: false });
        // controllers/admin/promoBannerController.js — createPromoBanner mein
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999); // ← end of day

        const banner = await PromoBanner.create({
            imageUrl: req.file.path,
            imagePublicId: req.file.filename,
            startDate: new Date(startDate),
            endDate: endDateObj,   // ← ab full day cover karega
            linkUrl,
            isActive: true,
        });

        res.status(201).json({ message: "Promo banner created", banner });
    } catch (error) {
        next(error);
        res.status(500).json({ message: "Server error", error: (error as Error).message });
    }
};

// GET all banners (admin - list/manage)
export const getAllPromoBanners = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const banners = await PromoBanner.find().sort({ createdAt: -1 });
        res.status(200).json({ banners });
    } catch (error) {
        next(error);
    }
};

// UPDATE banner (dates/isActive/linkUrl, optionally new image)
export const updatePromoBanner = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { id } = req.params;
        const existing = await PromoBanner.findById(id).lean();
        if (!existing) {
            res.status(404).json({ message: "Banner not found" });
            return;
        }

        const { startDate, endDate, linkUrl, isActive } = req.body;
        const updateFields: Record<string, unknown> = {};

        if (req.file) {
            // purani image cloudinary se delete karo
            if (existing.imagePublicId) {
                await cloudinary.uploader.destroy(existing.imagePublicId);
            }
            updateFields.imageUrl = req.file.path;
            updateFields.imagePublicId = req.file.filename;
        }

        if (startDate) updateFields.startDate = new Date(startDate);
        if (endDate) {
            const endDateObj = new Date(endDate);
            endDateObj.setHours(23, 59, 59, 999);
            updateFields.endDate = endDateObj;
        }
        if (linkUrl !== undefined) updateFields.linkUrl = linkUrl;
        if (isActive !== undefined) updateFields.isActive = isActive;

        const banner = await PromoBanner.findByIdAndUpdate(
            id,
            { $set: updateFields },
            { new: true }
        );
        res.status(200).json({ message: "Banner updated", banner });
    } catch (error) {
        next(error);
    }
};

// DELETE banner
export const deletePromoBanner = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { id } = req.params;
        const banner = await PromoBanner.findById(id);
        if (!banner) {
            res.status(404).json({ message: "Banner not found" });
            return;
        }

        if (banner.imagePublicId) {
            await cloudinary.uploader.destroy(banner.imagePublicId);
        }
        await banner.deleteOne();

        res.status(200).json({ message: "Banner deleted" });
    } catch (error) {
        next(error);
    }
};
