// controllers/lookbookController.js
import Lookbook from "../../models/LookBook.js"
import Product from "../../models/Product.js";
import client from "../../lib/redis.js";

const CACHE_KEY = "lookbook:data";
const CACHE_TTL = 600;

const clearCache = async () => {
  await client.del(CACHE_KEY);
  // product cache bhi clear karo
  const keys = await client.keys("product:*");
  if (keys.length) await client.del(keys);
};

// ─── Initialize default sections (ek baar) ───
// GET /api/lookbook/init  (sirf pehli baar chalao)
export const initLookbook = async (req, res, next) => {
  try {
    const existing = await Lookbook.findOne();
    if (existing) return res.json({ message: "Already initialized", lookbook: existing });

    const lookbook = await Lookbook.create({
      sections: [
        { title: "Old Money", slug: "old-money", products: [], order: 0 },
        { title: "New Money", slug: "new-money", products: [], order: 1 },
      ],
    });

    res.status(201).json({ success: true, lookbook });
  } catch (err) {
    next(err);
  }
};

// ─── GET Lookbook (public + admin) ───────────
// GET /api/lookbook
export const getLookbook = async (req, res, next) => {
  try {
    const cached = await client.get(CACHE_KEY);
    if (cached) return res.json({ fromCache: true, ...JSON.parse(cached) });

    const lookbook = await Lookbook.findOne()
      .populate({
        path: "sections.products",
        select: "name slug price offer offerStart offerEnd colors subcategory newArrival",
        populate: {
          path: "subcategory",
          select: "slug name",
          populate: { path: "category", select: "slug name" },
        },
      })
      .lean();

    if (!lookbook) return res.status(404).json({ message: "Lookbook not found" });

    const data = { sections: lookbook.sections };
    await client.setEx(CACHE_KEY, CACHE_TTL, JSON.stringify(data));

    res.json({ fromCache: false, ...data });
  } catch (err) {
    next(err);
  }
};

// ─── ADD product to section ───────────────────
// POST /api/lookbook/sections/:sectionId/products
// Body: { productId }
export const addProductToSection = async (req, res, next) => {
  try {
    const { sectionId } = req.params;
    const { productId } = req.body;

    const lookbook = await Lookbook.findOneAndUpdate(
      { "sections._id": sectionId },
      { $addToSet: { "sections.$.products": productId } },
      { new: true }
    );

    if (!lookbook) {
      return res.status(404).json({ message: "Lookbook or section not found" });
    }

    const section = lookbook.sections.id(sectionId);

    await clearCache();
    res.json({ success: true, section });
  } catch (err) {
    next(err);
  }
};

// ─── REMOVE product from section ─────────────
// DELETE /api/lookbook/sections/:sectionId/products/:productId
export const removeProductFromSection = async (req, res, next) => {
  try {
    const { sectionId, productId } = req.params;

    const lookbook = await Lookbook.findOneAndUpdate(
      { "sections._id": sectionId },
      { $pull: { "sections.$.products": productId } },
      { new: true }
    );

    if (!lookbook) {
      return res.status(404).json({ message: "Lookbook or section not found" });
    }

    const section = lookbook.sections.id(sectionId);

    await clearCache();
    res.json({ success: true, section });
  } catch (err) {
    next(err);
  }
};

// ─── ADD new section ──────────────────────────
// POST /api/lookbook/sections
// Body: { title, slug }
export const addSection = async (req, res, next) => {
  try {
    const { title, slug } = req.body;
    if (!title || !slug) return res.status(400).json({ message: "title and slug required" });

    const lookbook = await Lookbook.findOne();
    if (!lookbook) return res.status(404).json({ message: "Lookbook not found" });

    lookbook.sections.push({ title, slug, products: [], order: lookbook.sections.length });
    await lookbook.save();
    await clearCache();

    res.json({ success: true, sections: lookbook.sections });
  } catch (err) {
    next(err);
  }
};

// ─── REMOVE section ───────────────────────────
// DELETE /api/lookbook/sections/:sectionId
export const removeSection = async (req, res, next) => {
  try {
    const { sectionId } = req.params;

    const lookbook = await Lookbook.findOne();
    if (!lookbook) return res.status(404).json({ message: "Lookbook not found" });

    if (lookbook.sections.length === 1) {
      return res.status(400).json({ message: "Cannot remove the only section" });
    }

    lookbook.sections = lookbook.sections.filter(
      (s) => s._id.toString() !== sectionId
    );

    await lookbook.save();
    await clearCache();

    res.json({ success: true, sections: lookbook.sections });
  } catch (err) {
    next(err);
  }
};

// ─── UPDATE section title/slug ────────────────
// PATCH /api/lookbook/sections/:sectionId
// Body: { title?, slug? }
export const updateSection = async (req, res, next) => {
  try {
    const { sectionId } = req.params;
    const { title, slug } = req.body;

    const setFields = {};
    if (title) setFields["sections.$.title"] = title;
    if (slug) setFields["sections.$.slug"] = slug;

    const lookbook = await Lookbook.findOneAndUpdate(
      { "sections._id": sectionId },
      { $set: setFields },
      { new: true }
    );

    if (!lookbook) {
      return res.status(404).json({ message: "Lookbook or section not found" });
    }

    const section = lookbook.sections.id(sectionId);

    await clearCache();
    res.json({ success: true, section });
  } catch (err) {
    next(err);
  }
};