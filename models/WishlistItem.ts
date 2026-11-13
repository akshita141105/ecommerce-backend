// models/WishlistItem.ts
import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IWishlistItem extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  productId: Types.ObjectId;
  color: string;
  addedAt: Date;
}

const wishlistItemSchema = new Schema<IWishlistItem>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  productId: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  color: {
    type: String,
    required: true,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
});

// Same user same product+color dobara add na ho paaye
wishlistItemSchema.index({ userId: 1, productId: 1, color: 1 }, { unique: true });

export default mongoose.model<IWishlistItem>("WishlistItem", wishlistItemSchema);
