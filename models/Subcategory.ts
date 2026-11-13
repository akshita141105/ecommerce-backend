import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ISizeChartRow {
  size: string;
  sizeNumber?: string;
  chest?: number;
  frontLength?: number;
  acrossShoulder?: number;
  waist?: number;
  sleeveLength?: number;
}

const sizeChartRowSchema = new Schema<ISizeChartRow>(
  {
    size: { type: String, required: true }, // "S", "M", "L", "XL"
    sizeNumber: { type: String }, // "38", "40", "42" — optional numeric size
    chest: Number,
    frontLength: Number,
    acrossShoulder: Number,
    waist: Number,
    sleeveLength: Number, // optional — shirts ke liye
  },
  { _id: false }
);

export interface ISubcategory extends Document {
  _id: Types.ObjectId;
  name: string;
  category: Types.ObjectId;
  slug: string;
  image: string;
  sizeChart: {
    unit: "in" | "cm";
    rows: Types.DocumentArray<ISizeChartRow>;
  };
}

const subcategorySchema = new Schema<ISubcategory>(
  {
    name: {
      required: true,
      unique: true,
      trim: true,
      type: String,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    image: {
      required: true,
      type: String,
    },
    sizeChart: {
      unit: { type: String, enum: ["in", "cm"], default: "in" },
      rows: [sizeChartRowSchema],
    },
  },
  {
    timestamps: true,
  }
);

subcategorySchema.index({ category: 1 }); // category se subcategories fetch ke liye

export default mongoose.model<ISubcategory>("Subcategory", subcategorySchema);
