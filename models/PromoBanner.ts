// models/PromoBanner.ts
import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IPromoBanner extends Document {
  _id: Types.ObjectId;
  imageUrl: string;
  imagePublicId: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  linkUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const promoBannerSchema = new Schema<IPromoBanner>(
  {
    imageUrl: { type: String, required: true },
    imagePublicId: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    linkUrl: { type: String }, // optional - banner click pe redirect
  },
  { timestamps: true }
);

export default mongoose.model<IPromoBanner>("PromoBanner", promoBannerSchema);
