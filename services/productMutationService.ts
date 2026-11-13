// services/productMutationService.ts
// The many small in-place mutations supported by
// PATCH /api/admin/products/:productId — kept out of the controller so it
// only handles request parsing, persistence, and the response.
import slugify from "../utils/slug.js";
import type { Types } from "mongoose";
import Product, { type IColor, type IProduct, type ProductFit, type ProductSleeve } from "../models/Product.js";
import Subcategory from "../models/Subcategory.js";
import { findVideoFile } from "./productHelpers.js";

export class ProductUpdateError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface SizeInput {
  size: string;
  stock?: number | string;
}

interface ProductUpdateData {
  price?: number;
  details?: string;
  description?: string;
  offer?: number;
  offerStart?: string | null;
  offerEnd?: string | null;
  newArrival?: boolean;
  type?: string;
  material?: string;
  fit?: ProductFit;
  pattern?: string;
  sleeve?: ProductSleeve;
  collar?: string;
  videoVisible?: boolean;
  name?: string;
  subcategorySlug?: string;
  updateColor?: { colorId: string; colorName?: string; images?: string[] };
  addImagesToColor?: { colorId: string };
  removeImageFromColor?: { colorId: string; imageUrl: string };
  addColor?: { colorName: string; sizes?: SizeInput[] } | { colorName: string; sizes?: SizeInput[] }[];
  removeColor?: { colorId: string };
  updateSize?: { colorId: string; sizeId: string; size?: string; stock?: number };
  addSize?: { colorId: string; sizes: SizeInput[] };
  removeSize?: { colorId: string; sizeId: string };
}

/**
 * Apply every requested operation in `data` to the in-memory `product` doc
 * (does not save it — caller is responsible for `product.save()`).
 * Supported operations, mirrored from the admin UI:
 *   scalar fields, name/slug, subcategorySlug, video,
 *   updateColor, addImagesToColor, removeImageFromColor, addColor,
 *   removeColor, updateSize, addSize, removeSize.
 * Throws ProductUpdateError (with `.status`) for any invalid operation.
 */
export const applyProductUpdate = async (product: IProduct, data: ProductUpdateData, files?: Express.Multer.File[]): Promise<void> => {
  // ── 1. Basic scalar fields ──
  if (data.price !== undefined) product.price = data.price;
  if (data.details !== undefined) product.details = data.details;
  if (data.description !== undefined) product.description = data.description;
  if (data.offer !== undefined) product.offer = data.offer;
  if (data.offerStart !== undefined) product.offerStart = data.offerStart ? new Date(data.offerStart) : null;
  if (data.offerEnd !== undefined) product.offerEnd = data.offerEnd ? new Date(data.offerEnd) : null;
  if (data.newArrival !== undefined) product.newArrival = data.newArrival;
  if (data.type !== undefined) product.type = data.type;
  if (data.material !== undefined) product.material = data.material;
  if (data.fit !== undefined) product.fit = data.fit;
  if (data.pattern !== undefined) product.pattern = data.pattern;
  if (data.sleeve !== undefined) product.sleeve = data.sleeve;
  if (data.collar !== undefined) product.collar = data.collar;
  if (data.videoVisible !== undefined) product.videoVisible = data.videoVisible;

  // ── Name + slug ──
  if (data.name) {
    const newSlug = slugify(data.name, { lower: true, strict: true });
    const conflict = await Product.findOne({ slug: newSlug, _id: { $ne: product._id } });
    if (conflict) throw new ProductUpdateError(400, "Product name already exists");
    product.name = data.name;
    product.slug = newSlug;
  }

  if (data.subcategorySlug) {
    const sub = await Subcategory.findOne({ slug: data.subcategorySlug }).lean();
    if (!sub) throw new ProductUpdateError(400, "Invalid subcategory");
    product.subcategory = sub._id as Types.ObjectId;
  }

  // ── 2. Video ── (files is a flat array — uploadProductMedia.any())
  const videoFile = findVideoFile(files);
  if (videoFile) product.video = videoFile.path;

  // ── 3. Update color name/images ──
  if (data.updateColor) {
    const { colorId, colorName, images } = data.updateColor;
    const color = product.colors.id(colorId);
    if (!color) throw new ProductUpdateError(404, "Color not found");
    if (colorName) color.colorName = colorName;
    if (Array.isArray(images) && images.length) color.images = images;
  }

  // ── 4. Add images to existing color ──
  if (data.addImagesToColor) {
    const { colorId } = data.addImagesToColor;
    const color = product.colors.id(colorId);
    if (!color) throw new ProductUpdateError(404, "Color not found");
    const newImages = (Array.isArray(files) ? files : []).filter((f) => f.fieldname === "newImages").map((f) => f.path);
    if (newImages.length) color.images.push(...newImages);
  }

  // ── 5. Remove image from color ──
  if (data.removeImageFromColor) {
    const { colorId, imageUrl } = data.removeImageFromColor;
    const color = product.colors.id(colorId);
    if (!color) throw new ProductUpdateError(404, "Color not found");
    color.images = color.images.filter((img) => img !== imageUrl);
    if (!color.images.length) {
      throw new ProductUpdateError(400, "Cannot remove last image from a color");
    }
  }

  // ── 6. Add new color(s) ──
  if (data.addColor) {
    const newColors = Array.isArray(data.addColor) ? data.addColor : [data.addColor];

    const newImageFiles = (Array.isArray(files) ? files : []).filter((f) => f.fieldname === "newImages").map((f) => f.path);

    newColors.forEach((c) => {
      product.colors.push({
        colorName: c.colorName,
        images: newImageFiles,
        sizes: (c.sizes || []).map((s) => ({
          size: String(s.size).toUpperCase().trim(),
          stock: Math.max(0, Number(s.stock) || 0),
          reserved: 0,
        })),
      } as IColor);
    });
  }

  // ── 7. Remove color ──
  if (data.removeColor) {
    const { colorId } = data.removeColor;
    if (product.colors.length === 1) {
      throw new ProductUpdateError(400, "Cannot remove the only color of a product");
    }
    product.colors = product.colors.filter((c) => c._id.toString() !== colorId) as unknown as IProduct["colors"];
  }

  // ── 8. Update size inside color ──
  if (data.updateSize) {
    const { colorId, sizeId, size, stock } = data.updateSize;
    const color = product.colors.id(colorId);
    if (!color) throw new ProductUpdateError(404, "Color not found");
    const sizeDoc = color.sizes.id(sizeId);
    if (!sizeDoc) throw new ProductUpdateError(404, "Size not found");
    if (size !== undefined) sizeDoc.size = String(size).toUpperCase().trim();
    if (stock !== undefined) sizeDoc.stock = Math.max(0, Number(stock));
  }

  // ── 9. Add size(s) to color ──
  if (data.addSize) {
    const { colorId, sizes } = data.addSize;
    const color = product.colors.id(colorId);
    if (!color) throw new ProductUpdateError(404, "Color not found");
    if (!Array.isArray(sizes) || !sizes.length) {
      throw new ProductUpdateError(400, "sizes array is required for addSize");
    }
    sizes.forEach((s) => {
      color.sizes.push({
        size: String(s.size).toUpperCase().trim(),
        stock: Math.max(0, Number(s.stock) || 0),
        reserved: 0,
      } as IColor["sizes"][number]);
    });
  }

  // ── 10. Remove size from color ──
  if (data.removeSize) {
    const { colorId, sizeId } = data.removeSize;
    const color = product.colors.id(colorId);
    if (!color) throw new ProductUpdateError(404, "Color not found");
    if (color.sizes.length === 1) {
      throw new ProductUpdateError(400, "Cannot remove the only size of a color");
    }
    color.sizes = color.sizes.filter((s) => s._id.toString() !== sizeId) as unknown as IColor["sizes"];
  }
};
