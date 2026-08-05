// controllers/admin/promoBannerController.js
import PromoBanner from "../../models/PromoBanner.js";
import cloudinary from "../../config/cloudinary.js";

// CREATE new banner
export const createPromoBanner = async (req, res) => {
    try {
        const { startDate, endDate, linkUrl } = req.body;

        if (!req.file) {
            return res.status(400).json({ message: "Banner image is required" });
        }
        if (!startDate || !endDate) {
            return res.status(400).json({ message: "startDate and endDate are required" });
        }
        if (new Date(startDate) >= new Date(endDate)) {
            return res.status(400).json({ message: "endDate must be after startDate" });
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
        console.error("Create promo banner error:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// GET all banners (admin - list/manage)
export const getAllPromoBanners = async (req, res) => {
    try {
        const banners = await PromoBanner.find().sort({ createdAt: -1 });
        res.status(200).json({ banners });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// UPDATE banner (dates/isActive/linkUrl, optionally new image)
export const updatePromoBanner = async (req, res) => {
    try {
        const { id } = req.params;
        const banner = await PromoBanner.findById(id);
        if (!banner) return res.status(404).json({ message: "Banner not found" });

        const { startDate, endDate, linkUrl, isActive } = req.body;

        if (req.file) {
            // purani image cloudinary se delete karo
            if (banner.imagePublicId) {
                await cloudinary.uploader.destroy(banner.imagePublicId);
            }
            banner.imageUrl = req.file.path;
            banner.imagePublicId = req.file.filename;
        }

        if (startDate) banner.startDate = new Date(startDate);
        if (endDate) {
            const endDateObj = new Date(endDate);
            endDateObj.setHours(23, 59, 59, 999);
            banner.endDate = endDateObj;
        }
        if (linkUrl !== undefined) banner.linkUrl = linkUrl;
        if (isActive !== undefined) banner.isActive = isActive;

        await banner.save();
        res.status(200).json({ message: "Banner updated", banner });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// DELETE banner
export const deletePromoBanner = async (req, res) => {
    try {
        const { id } = req.params;
        const banner = await PromoBanner.findById(id);
        if (!banner) return res.status(404).json({ message: "Banner not found" });

        if (banner.imagePublicId) {
            await cloudinary.uploader.destroy(banner.imagePublicId);
        }
        await banner.deleteOne();

        res.status(200).json({ message: "Banner deleted" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};