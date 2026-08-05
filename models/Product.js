// models/Product.js
import mongoose from 'mongoose';

// ─── Size Schema ──────────────────────────────
const sizeSchema = new mongoose.Schema({
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
  available: {           // ← YAHAN ADD KARO — stock - reserved
    type: Number,
    default: 0,
    min: [0, "Available cannot be negative"],
  },
}, { _id: true });

// ─── Color Schema ─────────────────────────────
const colorSchema = new mongoose.Schema({
  colorName: {
    type: String,
    required: [true, "Color name is required"],
    trim: true,
  },
  images: {
    type: [String],
    validate: {
      validator: (arr) => arr.length >= 1,
      message: "At least 1 image is required per color",
    },
  },
  sizes: {
    type: [sizeSchema],
    validate: {
      validator: (arr) => arr.length >= 1,
      message: "At least 1 size is required per color",
    },
  },
}, { _id: true });

// ─── Product Schema ───────────────────────────
const productSchema = new mongoose.Schema({
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
    type: mongoose.Schema.Types.ObjectId,
    ref: "Subcategory",
    required: [true, "Subcategory is required"],
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
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
      validator: (arr) => arr.length >= 1,
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
  videoVisible: {          // ← naya field
    type: Boolean,
    default: true,          // by default video dikhega agar hai
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
  // ═══════════════════════════════════════════
  // NAYE STRUCTURED FIELDS — filtering/search ke liye
  // ═══════════════════════════════════════════
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
}, { timestamps: true });

// ─── Indexes ──────────────────────────────────
productSchema.index({ slug: 1 });
productSchema.index({ subcategory: 1 });
productSchema.index({ newArrival: 1, createdAt: -1 });
productSchema.index({ price: 1 });
productSchema.index({ "colors.sizes.stock": 1 });
productSchema.index({ "colors.sizes.available": 1 });  // ← naya index
productSchema.index({ offer: 1, offerEnd: 1 });
productSchema.index({ name: "text", description: "text" });
productSchema.index({ "colors._id": 1 });
productSchema.index({ "colors.sizes._id": 1 });

// ← naye filter-friendly indexes
productSchema.index({ type: 1 });
productSchema.index({ fit: 1 });
productSchema.index({ material: 1 });
productSchema.index({ pattern: 1 });

// ═══════════════════════════════════════════════
// PERMANENT FIX — `available` kabhi manually set nahi hota.
// Har save/insertMany se pehle, har size ka `available` yahan
// se hi calculate hota hai (stock - reserved). Koi bhi controller
// (admin panel, bulk upload, future koi bhi naya endpoint) is field
// ko galat ya missing bhi bheje, to bhi DB mein hamesha sahi value
// jayegi — kyunki ye value ab kisi bhi caller pe depend nahi karti.
// ═══════════════════════════════════════════════
productSchema.pre("validate", function (next) {
  this.colors.forEach((color) => {
    color.sizes.forEach((size) => {
      size.available = Math.max(0, (size.stock || 0) - (size.reserved || 0));
    });
  });
  next();
});

// ─── Virtuals ─────────────────────────────────
productSchema.virtual("totalStock").get(function () {
  return this.colors.reduce((total, color) =>
    total + color.sizes.reduce((s, size) => s + (size.available ?? 0), 0), 0
  );
});

productSchema.virtual("isOutOfStock").get(function () {
  return this.colors.every(color =>
    color.sizes.every(size => (size.available ?? 0) <= 0)
  );
});

productSchema.virtual("totalReserved").get(function () {
  return this.colors.reduce((total, color) =>
    total + color.sizes.reduce((s, size) => s + (size.reserved ?? 0), 0), 0
  );
});

export default mongoose.model("Product", productSchema);