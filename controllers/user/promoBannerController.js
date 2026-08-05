// controllers/user/promoBannerController.js
import PromoBanner from "../../models/PromoBanner.js";

// GET active banner for homepage
// controllers/user/promoBannerController.js
export const getActivePromoBanner = async (req, res, next) => {
    try {
        const now = new Date();
        console.log("NOW:", now); // ← temp debug

        const allBanners = await PromoBanner.find({}); // ← temp debug — sab dikhao
        console.log("ALL BANNERS:", JSON.stringify(allBanners, null, 2));

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