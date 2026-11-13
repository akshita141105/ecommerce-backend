// models/CartItem.ts
import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ICartItem extends Document {
  _id: Types.ObjectId;
  cart: Types.ObjectId;
  product: Types.ObjectId;
  quantity: number;
  selectedColor: string;
  selectedSize: string;
}

const cartItemSchema = new Schema<ICartItem>(
  {
    cart: {
      type: Schema.Types.ObjectId,
      ref: "Cart",
      required: true,
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
      default: 1,
    },
    selectedColor: {
      type: String,
      required: true,
      trim: true,
    },
    selectedSize: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
  },
  { timestamps: true }
);

cartItemSchema.index({ cart: 1 });
cartItemSchema.index({ cart: 1, product: 1, selectedColor: 1, selectedSize: 1 });

export default mongoose.model<ICartItem>("CartItem", cartItemSchema);
