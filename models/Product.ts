// models/Product.ts
import mongoose, { Schema, type Document, type Types } from "mongoose";

// ─── Size Schema ──────────────────────────────
export interface ISize {
  _id: Types.ObjectId;
  size: string;
  stock: number;
  reserved: number;
  // Derived/invariant — always recomputed as stock - reserved in the
  // pre("validate") hook below, never settable directly by a caller.
  available: number;
}

const sizeSchema = new Schema<ISize>(
  {
    size: {
      type: String,
      required: [true, "Size is required"],
      trim: true,
      uppercase: true,
    },
    stock: {
      type: Number,
      required: [true, "Stock is required"],
      min: [0, "Stock cannot be negative"],
      default: 0,
    },
    reserved: {
      type: Number,
      default: 0,
      min: [0, "Reserved cannot be negative"],
    },
    available: {
      type: Number,
      default: 0,
      min: [0, "Available cannot be negative"],
    },
  },
  { _id: true }
);

// ─── Color Schema ─────────────────────────────
export interface IColor {
  _id: Types.ObjectId;
  colorName: string;
  images: string[];
  sizes: Types.DocumentArray<ISize>;
}

const colorSchema = new Schema<IColor>(
  {
    colorName: {
      type: String,
      required: [true, "Color name is required"],
      trim: true,
    },
    images: {
      type: [String],
      validate: {
        validator: (arr: string[]) => arr.length >= 1,
        message: "At least 1 image is required per color",
      },
    },
    sizes: {
      type: [sizeSchema],
      validate: {
        validator: (arr: ISize[]) => arr.length >= 1,
        message: "At least 1 size is required per color",
      },
    },
  },
  { _id: true }
);

export type ProductFit =
  | "Slim Fit"
  | "Regular Fit"
  | "Relaxed Fit"
  | "Oversized Fit"
  | "Loose Fit"
  | "Tailored Fit"
  | "Skinny Fit"
  | "Straight Fit"
  | "";

export type ProductSleeve = "Full Sleeve" | "Half Sleeve" | "Sleeveless" | "3/4 Sleeve" | "";

// ─── Product Schema ───────────────────────────
export interface IProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  subcategory: Types.ObjectId;
  category: Types.ObjectId | null;
  description: string;
  details: string;
  colors: Types.DocumentArray<IColor>;
  price: number;
  video: string | null;
  videoVisible: boolean;
  offer: number;
  offerStart: Date | null;
  offerEnd: Date | null;
  newArrival: boolean;
  type: string;
  material: string;
  fit: ProductFit;
  pattern: string;
  sleeve: ProductSleeve;
  collar: string;
  // Virtuals
  totalStock: number;
  isOutOfStock: boolean;
  totalReserved: number;
}

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      unique: true,
      trim: true,
      maxlength: [200, "Name cannot exceed 200 characters"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    subcategory: {
      type: Schema.Types.ObjectId,
      ref: "Subcategory",
      required: [true, "Subcategory is required"],
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },
    details: {
      type: String,
      required: [true, "Details is required"],
      trim: true,
    },
    colors: {
      type: [colorSchema],
      validate: {
        validator: (arr: IColor[]) => arr.length >= 1,
        message: "At least 1 color is required",
      },
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    video: {
      type: String,
      default: null,
    },
    videoVisible: {
      type: Boolean,
      default: true,
    },
    offer: {
      type: Number,
      default: 0,
      min: [0, "Offer cannot be negative"],
      max: [100, "Offer cannot exceed 100%"],
    },
    offerStart: {
      type: Date,
      default: null,
    },
    offerEnd: {
      type: Date,
      default: null,
    },
    newArrival: {
      type: Boolean,
      default: false,
    },
    // ═══ Structured fields — filtering/search ═══
    type: {
      type: String,
      trim: true,
      default: "",
    },
    material: {
      type: String,
      trim: true,
      default: "",
    },
    fit: {
      type: String,
      trim: true,
      enum: [
        "Slim Fit",
        "Regular Fit",
        "Relaxed Fit",
        "Oversized Fit",
        "Loose Fit",
        "Tailored Fit",
        "Skinny Fit",
        "Straight Fit",
        "",
      ],
      default: "",
    },
    pattern: {
      type: String,
      trim: true,
      default: "",
    },
    sleeve: {
      type: String,
      trim: true,
      enum: ["Full Sleeve", "Half Sleeve", "Sleeveless", "3/4 Sleeve", ""],
      default: "",
    },
    collar: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

// ─── Indexes ──────────────────────────────────
productSchema.index({ slug: 1 });
productSchema.index({ subcategory: 1 });
productSchema.index({ newArrival: 1, createdAt: -1 });
productSchema.index({ price: 1 });
productSchema.index({ "colors.sizes.stock": 1 });
productSchema.index({ "colors.sizes.available": 1 });
productSchema.index({ offer: 1, offerEnd: 1 });
productSchema.index({ name: "text", description: "text" });
productSchema.index({ "colors._id": 1 });
productSchema.index({ "colors.sizes._id": 1 });
productSchema.index({ type: 1 });
productSchema.index({ fit: 1 });
productSchema.index({ material: 1 });
productSchema.index({ pattern: 1 });

// ═══════════════════════════════════════════════
// PERMANENT FIX — `available` is never settable by a caller. Recomputed
// here on every save/insert so it can never drift from stock - reserved,
// regardless of what any controller (admin panel, bulk upload, future
// endpoint) sends.
// ═══════════════════════════════════════════════
productSchema.pre("validate", function (this: IProduct, next) {
  this.colors.forEach((color) => {
    color.sizes.forEach((size) => {
      size.available = Math.max(0, (size.stock || 0) - (size.reserved || 0));
    });
  });
  next();
});

// ─── Virtuals ─────────────────────────────────
productSchema.virtual("totalStock").get(function (this: IProduct) {
  return this.colors.reduce((total, color) => total + color.sizes.reduce((s, size) => s + (size.available ?? 0), 0), 0);
});

productSchema.virtual("isOutOfStock").get(function (this: IProduct) {
  return this.colors.every((color) => color.sizes.every((size) => (size.available ?? 0) <= 0));
});

productSchema.virtual("totalReserved").get(function (this: IProduct) {
  return this.colors.reduce((total, color) => total + color.sizes.reduce((s, size) => s + (size.reserved ?? 0), 0), 0);
});

export default mongoose.model<IProduct>("Product", productSchema);
